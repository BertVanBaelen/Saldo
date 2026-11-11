package ledger

import (
	"cmp"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// NewTransaction is a bank transaction ready to be stored on an account.
type NewTransaction struct {
	AccountID    int64
	ConnectionID int64 // 0 when it does not come from a bank connection
	ImportBatch  int64 // the CSV import that brought it, 0 otherwise
	DedupeKey    string
	Occurrence   int
	// The category it is stored with; 0 and "" for none. tagByRules
	// leaves a row that already has one alone (a manual one carried over
	// from its pending row, or a future import with CategoryOrigin
	// "import").
	CategoryID     int64
	CategoryOrigin string
	RuleID         int64
	Note           string // "" for none
	// ImportPair is the two parts of the file's category on an imported row
	// (nil for none), kept so a changed mapping can be re-applied (0.5-3).
	ImportPair *[2]string
	bank.Transaction
}

// DedupeKey is a transaction's identity on an account (analysis 6.3): the
// account IBAN and the bank's entry reference for booked rows, otherwise a
// hash of date, amount, counterparty and communication.
func DedupeKey(accountIBAN string, t bank.Transaction) string {
	if t.Status == bank.StatusBooked && t.EntryReference != "" {
		return "ref:" + NormalizeIBAN(accountIBAN) + ":" + t.EntryReference
	}
	return "hash:" + ContentHash(t)
}

// ContentHash is the fallback identity of a transaction; it is the same on
// every connection that reports the transaction.
func ContentHash(t bank.Transaction) string {
	norm := func(s string) string { return strings.Join(strings.Fields(strings.ToLower(s)), " ") }
	h := sha256.Sum256([]byte(t.BookingDate + "\x1f" + strconv.FormatInt(t.Amount, 10) + "\x1f" +
		norm(t.CounterpartyName) + "\x1f" + norm(t.Communication)))
	return hex.EncodeToString(h[:16])
}

// Keyed computes the dedupe key and occurrence of one fetch of an account.
// Identical rows in the same fetch (two coffees on one day) are kept apart by
// their occurrence number.
func Keyed(accountID int64, accountIBAN string, connectionID int64, txs []bank.Transaction) []NewTransaction {
	seen := map[string]int{}
	out := make([]NewTransaction, 0, len(txs))
	for _, t := range txs {
		key := DedupeKey(accountIBAN, t)
		seen[key]++
		t.CounterpartyIBAN = NormalizeIBAN(t.CounterpartyIBAN)
		out = append(out, NewTransaction{
			AccountID: accountID, ConnectionID: connectionID, DedupeKey: key, Occurrence: seen[key], Transaction: t,
		})
	}
	return out
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// InsertTransactions stores rows in the given order and skips any row whose
// account, dedupe key and occurrence already exist. It returns how many rows
// were new.
func InsertTransactions(ctx context.Context, db execer, rows []NewTransaction) (int, error) {
	inserted := 0
	for _, r := range rows {
		res, err := db.ExecContext(ctx, `
			INSERT INTO transactions (account_id, amount, currency, booking_date, value_date,
			    counterparty_name, counterparty_iban, communication, status, external_id,
			    dedupe_key, occurrence, source_connection_id, import_batch_id, raw_payload,
			    category_id, category_origin, rule_id, note, import_category, import_subcategory)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (account_id, dedupe_key, occurrence) DO NOTHING`,
			r.AccountID, r.Amount, currencyOr(r.Currency), r.BookingDate, nullIfEmpty(r.ValueDate),
			r.CounterpartyName, nullIfEmpty(r.CounterpartyIBAN), r.Communication, r.Status,
			nullIfEmpty(r.EntryReference), r.DedupeKey, r.Occurrence, nullIfZero(r.ConnectionID), nullIfZero(r.ImportBatch), nullIfEmpty(string(r.Raw)),
			nullIfZero(r.CategoryID), nullIfEmpty(r.CategoryOrigin), nullIfZero(r.RuleID), nullIfEmpty(r.Note),
			pairPart(r.ImportPair, 0), pairPart(r.ImportPair, 1))
		if err != nil {
			return inserted, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			inserted++
		}
	}
	return inserted, nil
}

func currencyOr(c string) string {
	if c == "" {
		return "EUR"
	}
	return c
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func pairPart(p *[2]string, i int) any {
	if p == nil {
		return nil
	}
	return p[i]
}

func nullIfZero(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}

// StoreFetch stores one complete fetch (every page) of an account from a
// connection, inside the caller's transaction, and returns how many rows were
// new. from is the fetch's first date ("" for the whole history).
//
// Pending rows follow the bank: a local pending row of this connection inside
// the window that the bank no longer reports as pending is deleted, because
// it is booked now (and arrives as a booked row in the same fetch) or gone.
// Booked rows are never deleted or changed. Call it only after the whole
// fetch succeeded: a failed or partial fetch must change nothing.
//
// A deleted pending row hands its note, and a manual category, to the booked
// row of the same fetch that replaces it (carryOver). New rows get the
// category of the first matching rule of the account (tagByRules); stored
// rows are never re-evaluated here.
func StoreFetch(ctx context.Context, tx *sql.Tx, accountID, connectionID int64, from string, rows []NewTransaction) (int, error) {
	type slot struct {
		key string
		occ int
	}
	reported := map[slot]bool{}
	refs := map[string]bool{}
	for _, r := range rows {
		switch {
		case r.Status == bank.StatusPending:
			reported[slot{r.DedupeKey, r.Occurrence}] = true
		case r.EntryReference != "":
			refs[r.EntryReference] = true
		}
	}

	// Rows before from were not asked for, so their absence says nothing.
	q, err := tx.QueryContext(ctx, `SELECT id, dedupe_key, occurrence, amount, counterparty_name, booking_date,
		    COALESCE(category_id, 0), COALESCE(category_origin, ''), COALESCE(note, '')
		FROM transactions
		WHERE account_id = ? AND source_connection_id = ? AND status = 'pending' AND booking_date >= ?`,
		accountID, connectionID, from)
	if err != nil {
		return 0, err
	}
	var stale []pendingRow
	for q.Next() {
		var p pendingRow
		var s slot
		if err := q.Scan(&p.id, &s.key, &s.occ, &p.amount, &p.counterparty, &p.date, &p.category, &p.origin, &p.note); err != nil {
			q.Close()
			return 0, err
		}
		if !reported[s] {
			stale = append(stale, p)
		}
	}
	q.Close()
	if err := q.Err(); err != nil {
		return 0, err
	}
	for _, p := range stale {
		if _, err := tx.ExecContext(ctx, `DELETE FROM transactions WHERE id = ?`, p.id); err != nil {
			return 0, err
		}
	}

	allowed, err := importAllowance(ctx, tx, accountID, rows)
	if err != nil {
		return 0, err
	}
	keep := make([]NewTransaction, 0, len(rows))
	for _, r := range rows {
		if r.Status == bank.StatusBooked && r.EntryReference != "" {
			skip, err := checkReference(ctx, tx, &r, refs)
			if err != nil {
				return 0, err
			}
			if skip {
				continue
			}
		}
		if r.Status == bank.StatusBooked && allowed != nil {
			skip, err := checkImported(ctx, tx, &r, allowed)
			if err != nil {
				return 0, err
			}
			if skip {
				continue
			}
		}
		keep = append(keep, r)
	}
	if err := carryOver(ctx, tx, stale, keep); err != nil {
		return 0, err
	}
	if err := tagByRules(ctx, tx, accountID, keep); err != nil {
		return 0, err
	}
	return InsertTransactions(ctx, tx, keep)
}

// pendingRow is a stored pending row that a fetch deletes.
type pendingRow struct {
	id, amount, category int64
	counterparty, date   string
	origin, note         string
}

// carryWindow is how far a booked row's date may lie from its pending row's.
const carryWindow = 7 * 24 * time.Hour

// carryOver hands what the user set on a deleted pending row to the booked
// row of the same fetch that replaces it (plan 0.4-3): its note, and its
// category with origin manual when the pending row's was manual. Nothing
// else (a rule's category comes back through tagByRules). Only a booked row
// that is going to be inserted qualifies, never a stored one. Pairs have the
// same signed amount, an equal normalised counterparty and dates at most 7
// days apart; they are made one to one, the closest dates first (then the
// lower pending id, then the earlier booked row).
func carryOver(ctx context.Context, tx *sql.Tx, stale []pendingRow, rows []NewTransaction) error {
	type pair struct {
		p, b int
		gap  time.Duration
	}
	var pairs []pair
	carries := false
	for _, p := range stale {
		carries = carries || p.note != "" || p.origin == "manual" && p.category != 0
	}
	if !carries {
		return nil
	}
	isNew := map[int]bool{}
	for pi, p := range stale {
		pd, err := time.Parse(time.DateOnly, p.date)
		if err != nil {
			continue
		}
		for bi, b := range rows {
			if b.Status != bank.StatusBooked || b.Amount != p.amount ||
				categorise.Normalise(b.CounterpartyName) != categorise.Normalise(p.counterparty) {
				continue
			}
			bd, err := time.Parse(time.DateOnly, b.BookingDate)
			gap := bd.Sub(pd).Abs()
			if err != nil || gap > carryWindow {
				continue
			}
			fresh, seen := isNew[bi]
			if !seen {
				var exists bool
				if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM transactions
					WHERE account_id = ? AND dedupe_key = ? AND occurrence = ?)`, b.AccountID, b.DedupeKey, b.Occurrence).Scan(&exists); err != nil {
					return err
				}
				fresh = !exists
				isNew[bi] = fresh
			}
			if fresh {
				pairs = append(pairs, pair{pi, bi, gap})
			}
		}
	}
	slices.SortStableFunc(pairs, func(x, y pair) int {
		return cmp.Or(cmp.Compare(x.gap, y.gap), cmp.Compare(stale[x.p].id, stale[y.p].id), cmp.Compare(x.b, y.b))
	})
	usedP, usedB := map[int]bool{}, map[int]bool{}
	for _, x := range pairs {
		if usedP[x.p] || usedB[x.b] {
			continue
		}
		usedP[x.p], usedB[x.b] = true, true
		p, b := stale[x.p], &rows[x.b]
		b.Note = p.note
		if p.origin == "manual" && p.category != 0 {
			b.CategoryID, b.CategoryOrigin, b.RuleID = p.category, "manual", 0
		}
	}
	return nil
}

// tagByRules gives each new row of an account without a category the
// category of the first rule that matches it (origin "rule"), pending rows
// too. It runs before the insert, inside the caller's transaction.
func tagByRules(ctx context.Context, tx *sql.Tx, accountID int64, rows []NewTransaction) error {
	rules, err := categorise.RulesFor(ctx, tx, accountID)
	if err != nil || len(rules) == 0 {
		return err
	}
	for i, r := range rows {
		if r.CategoryID != 0 {
			continue
		}
		if m := categorise.Match(rules, categorise.Candidate{Counterparty: r.CounterpartyName,
			CounterpartyIBAN: r.CounterpartyIBAN, Communication: r.Communication, Amount: r.Amount}); m != nil {
			rows[i].CategoryID, rows[i].CategoryOrigin, rows[i].RuleID = m.CategoryID, "rule", m.ID
		}
	}
	return nil
}

// importAllowance is the sync's side of the CSV import (0.3-6): a bank row
// that a CSV import already brought in under another key is not stored
// again. Per content group (ContentHash) of the fetch's booked rows that has
// imported rows in the account, it returns how many rows that are new by
// key may still go in: the group's count in this fetch minus the stored
// booked rows of that content (synced and imported). Repeating the fetch
// then finds as many stored as reported and adds nothing; a fetch with one
// more than stored adds exactly that one. It returns nil for an account
// without imported rows, which therefore syncs exactly as before; that test
// reads the small import_batches table, not the account's transactions.
func importAllowance(ctx context.Context, tx *sql.Tx, accountID int64, rows []NewTransaction) (map[string]int, error) {
	var imports bool
	// A batch's rows live as long as the batch (ON DELETE CASCADE).
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM import_batches
		WHERE account_id = ? AND rows_imported > 0 AND undone_at IS NULL)`, accountID).Scan(&imports); err != nil || !imports {
		return nil, err
	}
	var booked []NewTransaction
	fetched := map[string]int{}
	for _, r := range rows {
		if r.Status == bank.StatusBooked {
			booked = append(booked, r)
			fetched[ContentHash(r.Transaction)]++
		}
	}
	if len(booked) == 0 {
		return nil, nil
	}
	stored, imported, err := storedContent(ctx, tx, accountID, booked)
	if err != nil {
		return nil, err
	}
	allowed := map[string]int{}
	for h, f := range fetched {
		if imported[h] > 0 {
			allowed[h] = max(0, f-stored[h])
		}
	}
	return allowed, nil
}

// checkImported skips a booked row of a group in allowed whose key is new
// once the group's allowance is used up; a row whose key is stored passes
// (the insert is a no-op).
func checkImported(ctx context.Context, tx *sql.Tx, r *NewTransaction, allowed map[string]int) (skip bool, err error) {
	h := ContentHash(r.Transaction)
	n, ok := allowed[h]
	if !ok {
		return false, nil
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM transactions
		WHERE account_id = ? AND dedupe_key = ? AND occurrence = ?)`, r.AccountID, r.DedupeKey, r.Occurrence).Scan(&exists); err != nil || exists {
		return false, err
	}
	if n == 0 {
		return true, nil
	}
	allowed[h] = n - 1
	return false, nil
}

// checkReference guards a booked row's entry reference against a bank that
// reuses or changes it. A stored row with the same reference but another
// date or amount is a different transaction (a reused reference): the row
// gets a key of reference plus content, the same on every later fetch. A row
// whose reference is new while a stored booked row with the same content has
// a reference this fetch no longer lists is that row re-referenced: skip it.
func checkReference(ctx context.Context, tx *sql.Tx, r *NewTransaction, refs map[string]bool) (skip bool, err error) {
	var date string
	var amount int64
	err = tx.QueryRowContext(ctx, `SELECT booking_date, amount FROM transactions
		WHERE account_id = ? AND dedupe_key = ? AND occurrence = ?`, r.AccountID, r.DedupeKey, r.Occurrence).Scan(&date, &amount)
	switch {
	case err == nil:
		if date != r.BookingDate || amount != r.Amount {
			r.DedupeKey += ":" + ContentHash(r.Transaction)
		}
		return false, nil
	case !errors.Is(err, sql.ErrNoRows):
		return false, err
	}
	q, err := tx.QueryContext(ctx, `SELECT external_id FROM transactions
		WHERE account_id = ? AND status = 'booked' AND external_id IS NOT NULL
		  AND booking_date = ? AND amount = ? AND counterparty_name = ? AND communication = ?`,
		r.AccountID, r.BookingDate, r.Amount, r.CounterpartyName, r.Communication)
	if err != nil {
		return false, err
	}
	defer q.Close()
	for q.Next() {
		var ref string
		if err := q.Scan(&ref); err != nil {
			return false, err
		}
		if !refs[ref] {
			return true, nil
		}
	}
	return false, q.Err()
}
