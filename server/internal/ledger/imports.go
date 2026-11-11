package ledger

import (
	"context"
	"database/sql"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// ImportFile is one parsed CSV upload for an account (phase 0.3-6).
type ImportFile struct {
	AccountID int64
	Source    string // "argenta", "bilance" or "csv"
	FileName  string // a sanitised base name
	FileHash  string // hex SHA-256 of the file
	Rows      []ImportRow
	Invalid   int // unreadable rows, skipped
}

// ImportRow is one readable row of a file: its line, the file's own account
// (a normalised IBAN, "" when unknown), the note and the transaction.
type ImportRow struct {
	Line    int
	Account string
	Note    string // "" for none
	// The file's category in two parts ("" when empty); stored with the row
	// when the import has a CategoryPlan.
	Category, Subcategory string
	Tx                    bank.Transaction
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
	// Categorised counts the imported rows that now have a category; the
	// preview and the answer of an import show it, the batch JSON does not.
	Categorised int `json:"-"`
	// Bilance files only (0.5-4); the preview and the answer of an import
	// show them, the batch JSON does not. AfterCutoff counts the rows the
	// cutoff skipped, Found the probable duplicates found and Probable the
	// ones skipped (the rest was imported anyway), Taken the stored rows that
	// took the file's category. Duplicates lists the probable duplicates, at
	// most MaxListedDuplicates, skipped or not. FirstSynced is the account's
	// first synced booking date ("" for none), the suggested cutoff.
	AfterCutoff, Found, Probable, Taken int         `json:"-"`
	Duplicates                          []Duplicate `json:"-"`
	FirstSynced                         string      `json:"-"`
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
	bs, errs, err := s.ImportFiles(ctx, viewer, []ImportFile{f}, nil, ImportOptions{}, dryRun)
	if err != nil {
		return Batch{}, nil, err
	}
	return bs[0], errs, nil
}

// ImportFiles is Import for the parts of one file that go to several
// accounts (accounts from a column, 0.5-2): one batch per part, all in one
// database transaction, so the whole import is atomic and a dry run rolls
// all of it back. No parts is an error for a real import (nothing readable),
// and an empty answer for a dry run.
//
// plan is nil for a file without category columns. Otherwise the rows keep
// the two parts of their file category, and the choices (CategoryPlan) are
// resolved first, in this same transaction: new categories are created,
// rows of a mapped pair get that category with origin "import", and after a
// real import the choices are saved as the viewer's mapping. A dry run
// does all of it and rolls it back, so a bad choice fails the preview too.
//
// opts is for a Bilance file (0.5-4): rows booked on or after the cutoff of
// their account are skipped first; the rows left are matched against what the
// account holds, exactly (dropped, counted as present) and fuzzily (probable
// duplicates, skipped unless opts.Include names their line). A skipped
// probable duplicate whose stored row has no category and no split parts
// takes the category the file's row would get, through categorise.Assign
// with origin "import", in this same transaction (not part of the batch).
func (s *Store) ImportFiles(ctx context.Context, viewer int64, files []ImportFile, plan *CategoryPlan, opts ImportOptions, dryRun bool) ([]Batch, []LineError, error) {
	if len(files) == 0 && !dryRun {
		return nil, nil, apperr.Invalid(msgNoRows)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()
	var targets resolved
	if plan != nil && len(files) > 0 {
		if targets, err = resolveChoices(ctx, tx, plan); err != nil {
			return nil, nil, err
		}
	}
	var batches []Batch
	var errs []LineError
	for _, f := range files {
		b, e, err := importIn(ctx, tx, viewer, f, plan != nil, targets, opts, dryRun)
		if err != nil {
			return nil, nil, err
		}
		batches, errs = append(batches, b), append(errs, e...)
	}
	if dryRun {
		return batches, errs, nil // the deferred rollback undoes it all
	}
	if targets != nil {
		if err := saveMappings(ctx, tx, viewer, plan.Source, targets); err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return batches, errs, nil
}

const msgNoRows = "Geen enkele regel van het bestand kon gelezen worden. Er is niets geïmporteerd."

// importIn is the body of Import, inside the caller's transaction.
func importIn(ctx context.Context, tx *sql.Tx, viewer int64, f ImportFile, withPairs bool, targets resolved, opts ImportOptions, dryRun bool) (Batch, []LineError, error) {
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
	var notes []string
	var pairs [][2]string
	var lines []int
	var errs []LineError
	cutoff, afterCutoff := opts.Cutoffs[f.AccountID], 0
	for _, r := range f.Rows {
		switch {
		case mixed:
			errs = append(errs, LineError{r.Line, msgMixedRow})
		case iban != "" && r.Account != "" && NormalizeIBAN(r.Account) != iban:
			errs = append(errs, LineError{r.Line, "Rekening " + MaskIBAN(r.Account) + " in het bestand is niet de gekozen rekening."})
		case cutoff != "" && r.Tx.BookingDate >= cutoff:
			afterCutoff++
		default:
			txs = append(txs, r.Tx)
			notes = append(notes, r.Note)
			pairs = append(pairs, [2]string{r.Category, r.Subcategory})
			lines = append(lines, r.Line)
		}
	}
	if len(txs)+afterCutoff == 0 && !dryRun {
		if mixed {
			return Batch{}, nil, apperr.Invalid(msgMixedFile)
		}
		if len(errs) > 0 {
			return Batch{}, nil, apperr.Invalid("Dit bestand hoort bij een andere rekening dan de gekozen rekening.")
		}
		return Batch{}, nil, apperr.Invalid(msgNoRows)
	}
	b := Batch{Source: f.Source, FileName: f.FileName, AccountID: f.AccountID, Invalid: f.Invalid + len(errs), AfterCutoff: afterCutoff}
	if err := tx.QueryRowContext(ctx, `INSERT INTO import_batches (source, file_name, file_hash, account_id, created_by)
		VALUES (?, ?, ?, ?, ?) RETURNING id`, f.Source, f.FileName, f.FileHash, f.AccountID, viewer).Scan(&b.ID); err != nil {
		return Batch{}, nil, err
	}
	rows := Keyed(f.AccountID, iban, 0, txs)
	for i := range rows {
		rows[i].ImportBatch = b.ID
		rows[i].Note = notes[i]
		if withPairs {
			rows[i].ImportPair = &pairs[i]
			if id := targets[pairs[i]]; id != 0 {
				rows[i].CategoryID, rows[i].CategoryOrigin = id, "import"
			}
		}
	}
	fuzzy := f.Source == SourceBilance
	exact, probable, err := matchStored(ctx, tx, f.AccountID, rows, fuzzy)
	if err != nil {
		return Batch{}, nil, err
	}
	kept, present := make([]NewTransaction, 0, len(rows)), 0
	cats := map[int64]*CategoryRef{}
	for i, r := range rows {
		s, dup := probable[i]
		switch {
		case exact[i]:
			present++
		case dup:
			skip := !opts.Include[lines[i]]
			if err := noteProbable(ctx, tx, &b, lines[i], notes[i], pairs[i], r, s, skip, cats); err != nil {
				return Batch{}, nil, err
			}
			if !skip {
				kept = append(kept, r)
			}
		default:
			kept = append(kept, r)
		}
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
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM transactions WHERE import_batch_id = ? AND category_id IS NOT NULL`,
		b.ID).Scan(&b.Categorised); err != nil {
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
	if fuzzy {
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MIN(booking_date), '') FROM transactions WHERE account_id = ? AND source_connection_id IS NOT NULL AND status = 'booked'`,
			f.AccountID).Scan(&b.FirstSynced); err != nil {
			return Batch{}, nil, err
		}
	}
	var created string
	if err := tx.QueryRowContext(ctx, `UPDATE import_batches SET rows_imported = ?, rows_duplicate = ?, rows_skipped = ?
		WHERE id = ? RETURNING created_at`, b.Imported, b.Present, b.Invalid, b.ID).Scan(&created); err != nil {
		return Batch{}, nil, err
	}
	b.CreatedAt, _, _ = formatTimestamp(created)
	return b, errs, nil
}

// noteProbable records a probable duplicate on the batch: it is listed (up to
// MaxListedDuplicates), and when it is skipped it counts and its stored row
// takes the category the file's row would get, if that row has none and no
// split parts (categorise.Assign, origin "import", which repeats the guard in
// SQL).
func noteProbable(ctx context.Context, tx *sql.Tx, b *Batch, line int, note string, pair [2]string, r NewTransaction, s storedRow,
	skip bool, cats map[int64]*CategoryRef) error {
	takes := r.CategoryID != 0 && s.category == 0 && !s.split
	b.Found++
	if skip {
		b.Probable++
		if takes {
			changed, err := categorise.Assign(ctx, tx, s.id, r.CategoryID, 0, "import")
			if err != nil {
				return err
			}
			if changed {
				b.Taken++
			}
		}
	}
	if len(b.Duplicates) >= MaxListedDuplicates {
		return nil
	}
	ref := func(id int64) (*CategoryRef, error) {
		if id == 0 {
			return nil, nil
		}
		if c, ok := cats[id]; ok {
			return c, nil
		}
		c := &CategoryRef{}
		if err := tx.QueryRowContext(ctx, `SELECT name, COALESCE(icon, ''), colour FROM categories WHERE id = ?`, id).Scan(&c.Name, &c.Icon, &c.Colour); err != nil {
			return nil, err
		}
		cats[id] = c
		return c, nil
	}
	incoming, err := ref(r.CategoryID)
	if err != nil {
		return err
	}
	have, err := ref(s.category)
	if err != nil {
		return err
	}
	b.Duplicates = append(b.Duplicates, Duplicate{Line: line, AccountID: b.AccountID, Date: r.BookingDate, Amount: r.Amount,
		Counterparty: r.CounterpartyName, Note: note, Source: pair, Category: incoming, Takes: takes,
		Existing: Existing{ID: s.id, Date: s.BookingDate, Amount: s.Amount, Counterparty: s.CounterpartyName,
			Communication: s.Communication, Category: have, Imported: s.fromImport}})
	return nil
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
