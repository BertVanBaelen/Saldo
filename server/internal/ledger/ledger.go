// Package ledger holds accounts, access, transactions and transfers. Every
// read takes the viewer's user id and goes through account_access, so a user
// only ever sees the accounts they hold (analysis 2) and figures computed from
// them. Something the viewer cannot see is reported as apperr.ErrNotFound.
package ledger

import (
	"database/sql"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// StaleAfter is how old the last successful sync may be before an account or
// connection counts as stale.
const StaleAfter = 36 * time.Hour

// StoppedAfter is how long a linked connection may go without a successful
// sync before it counts as stopped (decision of 5 Nov 2026: three days).
const StoppedAfter = 72 * time.Hour

// ConsentWarnDays is how many days before expiry a consent raises an alert.
const ConsentWarnDays = 14

// Store runs the ledger queries.
type Store struct {
	db *sql.DB
}

// New returns a Store on db.
func New(db *sql.DB) *Store { return &Store{db: db} }

// formatTimestamp turns a stored UTC timestamp into RFC 3339 in Brussels.
func formatTimestamp(stored string) (string, time.Time, bool) {
	t, err := time.Parse(time.RFC3339, stored)
	if err != nil {
		return "", time.Time{}, false
	}
	t = t.In(clock.Brussels)
	return t.Format(time.RFC3339), t, true
}

// dateOf returns the Brussels date (YYYY-MM-DD) of a stored timestamp, or a
// stored date unchanged.
func dateOf(stored string) (string, bool) {
	if len(stored) == len(time.DateOnly) {
		if _, err := time.Parse(time.DateOnly, stored); err == nil {
			return stored, true
		}
		return "", false
	}
	_, t, ok := formatTimestamp(stored)
	if !ok {
		return "", false
	}
	return t.Format(time.DateOnly), true
}

func ptr[T any](v T) *T { return &v }
