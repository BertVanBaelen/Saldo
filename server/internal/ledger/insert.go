package ledger

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// NewTransaction is a bank transaction ready to be stored on an account.
type NewTransaction struct {
	AccountID    int64
	ConnectionID int64 // 0 when it does not come from a bank connection
	DedupeKey    string
	Occurrence   int
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
			    dedupe_key, occurrence, source_connection_id, raw_payload)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (account_id, dedupe_key, occurrence) DO NOTHING`,
			r.AccountID, r.Amount, currencyOr(r.Currency), r.BookingDate, nullIfEmpty(r.ValueDate),
			r.CounterpartyName, nullIfEmpty(r.CounterpartyIBAN), r.Communication, r.Status,
			nullIfEmpty(r.EntryReference), r.DedupeKey, r.Occurrence, nullIfZero(r.ConnectionID), nullIfEmpty(string(r.Raw)))
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
// A category or note set on a deleted pending row goes with it; none can be
// set today. Carrying it over to the booked row is for 0.4 to decide.
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
	q, err := tx.QueryContext(ctx, `SELECT id, dedupe_key, occurrence FROM transactions
		WHERE account_id = ? AND source_connection_id = ? AND status = 'pending' AND booking_date >= ?`,
		accountID, connectionID, from)
	if err != nil {
		return 0, err
	}
	var stale []int64
	for q.Next() {
		var id int64
		var s slot
		if err := q.Scan(&id, &s.key, &s.occ); err != nil {
			q.Close()
			return 0, err
		}
		if !reported[s] {
			stale = append(stale, id)
		}
	}
	q.Close()
	if err := q.Err(); err != nil {
		return 0, err
	}
	for _, id := range stale {
		if _, err := tx.ExecContext(ctx, `DELETE FROM transactions WHERE id = ?`, id); err != nil {
			return 0, err
		}
	}

	keep := make([]NewTransaction, 0, len(rows))
	for _, r := range rows {
		if r.Status != bank.StatusBooked || r.EntryReference == "" {
			keep = append(keep, r)
			continue
		}
		skip, err := checkReference(ctx, tx, &r, refs)
		if err != nil {
			return 0, err
		}
		if !skip {
			keep = append(keep, r)
		}
	}
	return InsertTransactions(ctx, tx, keep)
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
