package ledger

import (
	"context"
	"database/sql"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// ImportFile is one parsed CSV upload for an account (phase 0.3-6).
type ImportFile struct {
	AccountID int64
	Source    string // "argenta" or "csv"
	FileName  string // a sanitised base name
	FileHash  string // hex SHA-256 of the file
	Rows      []ImportRow
	Invalid   int // unreadable rows, skipped
}

// ImportRow is one readable row of a file: its line, the file's own account
// (a normalised IBAN, "" when unknown) and the transaction.
type ImportRow struct {
	Line    int
	Account string
	Tx      bank.Transaction
}

// LineError is a row Import excluded, with a Dutch message.
type LineError struct {
	Line    int
	Message string
}

// Batch is one CSV import. Present counts the rows the account already
// held; Invalid the unreadable rows that were skipped.
type Batch struct {
	ID        int64  `json:"id"`
	Source    string `json:"source"`
	FileName  string `json:"fileName"`
	AccountID int64  `json:"accountId"`
	CreatedAt string `json:"createdAt"`
	Imported  int    `json:"imported"`
	Present   int    `json:"present"`
	Invalid   int    `json:"invalid"`
	// Overlap counts the imported rows dated in the period the account
	// already syncs (from its earliest synced booked row on); the preview
	// shows it, the batch JSON does not.
	Overlap int `json:"-"`
}

// Messages for a file that names more than one own account, imported into an
// account without an IBAN: per row, and for the refused import.
const (
	msgMixedRow  = "Het bestand bevat rijen van meer dan één rekening, en de gekozen rekening heeft geen IBAN om ze uit elkaar te houden."
	msgMixedFile = "Dit bestand bevat meer dan één rekening. Kies een rekening met een IBAN of splits het bestand."
)

// Import stores the readable rows of a file on an account the viewer may
// edit, through the sync's key path (Keyed and InsertTransactions), with one
// batch row; everything in one database transaction. Rows the account
// already holds are counted, not stored, so the same file twice adds
// nothing. It never touches balances, sync status or connections. A hidden
// account is apperr.ErrNotFound, a read-only one apperr.ErrForbidden.
//
// When the account has an IBAN, a row whose file account is another IBAN is
// excluded and counted as invalid; the returned errors name those lines with
// the file's IBAN masked, never a full IBAN, an amount or another cell.
// When it has none and the rows name more than one account, every row is
// excluded (msgMixedRow) and a real import is refused (msgMixedFile).
//
// dryRun runs exactly the same writes and rolls them back: the preview's
// counts. A dry run accepts a file without readable rows; a real import
// refuses it.
func (s *Store) Import(ctx context.Context, viewer int64, f ImportFile, dryRun bool) (Batch, []LineError, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Batch{}, nil, err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, f.AccountID)
	if err != nil {
		return Batch{}, nil, err
	}
	if a.permission != "edit" {
		return Batch{}, nil, apperr.ErrForbidden
	}
	var iban string
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(iban, '') FROM accounts WHERE id = ?`, f.AccountID).Scan(&iban); err != nil {
		return Batch{}, nil, err
	}
	iban = NormalizeIBAN(iban)
	// Without an IBAN no row can be told apart, so a file of several accounts
	// is refused whole.
	accounts := map[string]bool{}
	for _, r := range f.Rows {
		if a := NormalizeIBAN(r.Account); a != "" {
			accounts[a] = true
		}
	}
	mixed := iban == "" && len(accounts) > 1
	var txs []bank.Transaction
	var errs []LineError
	for _, r := range f.Rows {
		switch {
		case mixed:
			errs = append(errs, LineError{r.Line, msgMixedRow})
		case iban != "" && r.Account != "" && NormalizeIBAN(r.Account) != iban:
			errs = append(errs, LineError{r.Line, "Rekening " + MaskIBAN(r.Account) + " in het bestand is niet de gekozen rekening."})
		default:
			txs = append(txs, r.Tx)
		}
	}
	if len(txs) == 0 && !dryRun {
		if mixed {
			return Batch{}, nil, apperr.Invalid(msgMixedFile)
		}
		if len(errs) > 0 {
			return Batch{}, nil, apperr.Invalid("Dit bestand hoort bij een andere rekening dan de gekozen rekening.")
		}
		return Batch{}, nil, apperr.Invalid("Geen enkele regel van het bestand kon gelezen worden. Er is niets geïmporteerd.")
	}
	b := Batch{Source: f.Source, FileName: f.FileName, AccountID: f.AccountID, Invalid: f.Invalid + len(errs)}
	if err := tx.QueryRowContext(ctx, `INSERT INTO import_batches (source, file_name, file_hash, account_id, created_by)
		VALUES (?, ?, ?, ?, ?) RETURNING id`, f.Source, f.FileName, f.FileHash, f.AccountID, viewer).Scan(&b.ID); err != nil {
		return Batch{}, nil, err
	}
	rows := Keyed(f.AccountID, iban, 0, txs)
	for i := range rows {
		rows[i].ImportBatch = b.ID
	}
	kept, present, err := dropPresent(ctx, tx, f.AccountID, rows)
	if err != nil {
		return Batch{}, nil, err
	}
	if err := aboveStored(ctx, tx, f.AccountID, kept); err != nil {
		return Batch{}, nil, err
	}
	if err := tagByRules(ctx, tx, f.AccountID, kept); err != nil {
		return Batch{}, nil, err
	}
	if b.Imported, err = InsertTransactions(ctx, tx, kept); err != nil {
		return Batch{}, nil, err
	}
	// The unique key (account, dedupe key, occurrence) refuses the rest.
	b.Present = present + len(kept) - b.Imported
	// MIN is NULL without a synced row, so the comparison counts nothing.
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM transactions WHERE import_batch_id = ? AND booking_date >=
		(SELECT MIN(booking_date) FROM transactions WHERE account_id = ? AND source_connection_id IS NOT NULL AND status = 'booked')`,
		b.ID, f.AccountID).Scan(&b.Overlap); err != nil {
		return Batch{}, nil, err
	}
	var created string
	if err := tx.QueryRowContext(ctx, `UPDATE import_batches SET rows_imported = ?, rows_duplicate = ?, rows_skipped = ?
		WHERE id = ? RETURNING created_at`, b.Imported, b.Present, b.Invalid, b.ID).Scan(&created); err != nil {
		return Batch{}, nil, err
	}
	if dryRun {
		return b, errs, nil // the deferred rollback undoes it all
	}
	if err := tx.Commit(); err != nil {
		return Batch{}, nil, err
	}
	b.CreatedAt, _, _ = formatTimestamp(created)
	return b, errs, nil
}

// dropPresent takes out the rows the account already holds by content
// (ContentHash: date, amount, counterparty, communication), counting: k
// equal rows in the file against m stored booked rows of any source drop the
// first min(k, m) in file order and keep the rest, so a second real purchase
// on one day is not lost. It returns the rows to insert and how many it took
// out.
//
// The kept rows of a group keep occurrences m+1..k; aboveStored moves them
// up when a stored row (a pending one, or an earlier moved import) holds
// one of those slots.
func dropPresent(ctx context.Context, tx *sql.Tx, accountID int64, rows []NewTransaction) ([]NewTransaction, int, error) {
	if len(rows) == 0 {
		return rows, 0, nil
	}
	have, _, err := storedContent(ctx, tx, accountID, rows)
	if err != nil {
		return nil, 0, err
	}
	kept := make([]NewTransaction, 0, len(rows))
	for _, r := range rows {
		if h := ContentHash(r.Transaction); have[h] > 0 {
			have[h]--
			continue
		}
		kept = append(kept, r)
	}
	return kept, len(rows) - len(kept), nil
}

// aboveStored renumbers the kept rows of a dedupe key to start above the
// highest occurrence the account stores for that key (any status), when that
// occurrence reaches the first kept one. A pending row shares the "hash:" key
// of its booked twin, so without this the unique key would refuse the booked
// row and count it present while only the pending row is stored; with no
// link left to clean that pending row up, the transaction would stay
// missing. Rows that collide with nothing keep m+1..k.
func aboveStored(ctx context.Context, tx *sql.Tx, accountID int64, kept []NewTransaction) error {
	shift := map[string]int{}
	for i, r := range kept {
		s, ok := shift[r.DedupeKey]
		if !ok {
			var top int
			if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(occurrence), 0) FROM transactions
				WHERE account_id = ? AND dedupe_key = ?`, accountID, r.DedupeKey).Scan(&top); err != nil {
				return err
			}
			// kept rows of a key are contiguous and ascending, so the first is the lowest
			s = max(0, top-r.Occurrence+1)
			shift[r.DedupeKey] = s
		}
		kept[i].Occurrence += s
	}
	return nil
}

// storedContent counts the account's stored booked rows per ContentHash
// between the earliest and the latest booking date of rows: all of them, and
// those an import brought.
func storedContent(ctx context.Context, tx *sql.Tx, accountID int64, rows []NewTransaction) (all, imported map[string]int, err error) {
	lo, hi := rows[0].BookingDate, rows[0].BookingDate
	for _, r := range rows {
		lo, hi = min(lo, r.BookingDate), max(hi, r.BookingDate)
	}
	q, err := tx.QueryContext(ctx, `SELECT booking_date, amount, counterparty_name, communication, import_batch_id IS NOT NULL
		FROM transactions WHERE account_id = ? AND status = 'booked' AND booking_date BETWEEN ? AND ?`, accountID, lo, hi)
	if err != nil {
		return nil, nil, err
	}
	defer q.Close()
	all, imported = map[string]int{}, map[string]int{}
	for q.Next() {
		var t bank.Transaction
		var fromImport bool
		if err := q.Scan(&t.BookingDate, &t.Amount, &t.CounterpartyName, &t.Communication, &fromImport); err != nil {
			return nil, nil, err
		}
		h := ContentHash(t)
		all[h]++
		if fromImport {
			imported[h]++
		}
	}
	return all, imported, q.Err()
}

// Batches lists the imports into accounts the viewer holds (any
// permission), newest first.
func (s *Store) Batches(ctx context.Context, viewer int64) ([]Batch, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT b.id, b.source, b.file_name, b.account_id, b.created_at,
		       b.rows_imported, b.rows_duplicate, b.rows_skipped
		FROM import_batches b JOIN account_access me ON me.account_id = b.account_id AND me.user_id = ?
		ORDER BY b.created_at DESC, b.id DESC`, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Batch{}
	for rows.Next() {
		var b Batch
		var created string
		if err := rows.Scan(&b.ID, &b.Source, &b.FileName, &b.AccountID, &created, &b.Imported, &b.Present, &b.Invalid); err != nil {
			return nil, err
		}
		b.CreatedAt, _, _ = formatTimestamp(created)
		list = append(list, b)
	}
	return list, rows.Err()
}
