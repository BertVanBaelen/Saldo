package ledger

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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
