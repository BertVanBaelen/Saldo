package ledger

import (
	"context"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// Connection is one of the viewer's own bank connections (docs/api.md).
type Connection struct {
	ID         int64   `json:"id"`
	Bank       string  `json:"bank"`
	Since      *string `json:"since"`
	ValidUntil *string `json:"validUntil"`
	DaysLeft   *int    `json:"daysLeft"`
	LastSync   *string `json:"lastSync"`
	Status     string  `json:"status"`
	Accounts   []int64 `json:"accounts"`
	// Error is the last sync's error code, nil after a good sync; only
	// GET /api/sync shows it.
	Error *string `json:"-"`

	lastAttempt time.Time
}

// Connection statuses: ok, stale (no successful sync for 36 hours), failed
// (the last sync failed), expired (the consent lapsed) and pending (the
// consent is not finished yet).
const (
	ConnOK      = "ok"
	ConnStale   = "stale"
	ConnFailed  = "failed"
	ConnExpired = "expired"
	ConnPending = "pending"
)

// Connections returns the viewer's own connections. Revoked links are left out.
func (s *Store) Connections(ctx context.Context, viewer int64, now time.Time) ([]Connection, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, aspsp_name, COALESCE(consent_since, ''), COALESCE(valid_until, ''), status, sync_status,
		       COALESCE(last_sync_at, ''), COALESCE(last_attempt_at, ''), last_error
		FROM provider_connections WHERE user_id = ? AND status <> 'revoked' ORDER BY id`, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Connection{}
	today := now.In(clock.Brussels).Format(time.DateOnly)
	for rows.Next() {
		var c Connection
		var since, validUntil, status, syncStatus, lastSync, lastAttempt string
		if err := rows.Scan(&c.ID, &c.Bank, &since, &validUntil, &status, &syncStatus, &lastSync, &lastAttempt, &c.Error); err != nil {
			return nil, err
		}
		c.Accounts = []int64{}
		if d, ok := dateOf(since); ok {
			c.Since = &d
		}
		if d, ok := dateOf(validUntil); ok {
			c.ValidUntil = &d
			if days, err := clock.DaysBetween(today, d); err == nil {
				c.DaysLeft = &days
			}
		}
		var last time.Time
		if ts, t, ok := formatTimestamp(lastSync); ok {
			c.LastSync, last = &ts, t
		}
		if _, t, ok := formatTimestamp(lastAttempt); ok {
			c.lastAttempt = t
		}
		switch {
		case status == "pending":
			c.Status = ConnPending
		case status == "expired" || consentLapsed(validUntil, now):
			c.Status = ConnExpired
		case syncStatus == "failed":
			c.Status = ConnFailed
		case last.IsZero() || now.Sub(last) > StaleAfter:
			c.Status = ConnStale
		default:
			c.Status = ConnOK
		}
		list = append(list, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	// Only accounts the viewer can see (a connection might feed an account the
	// viewer has left).
	accRows, err := s.db.QueryContext(ctx, `
		SELECT s.connection_id, s.account_id FROM account_sources s
		JOIN account_access x ON x.account_id = s.account_id AND x.user_id = ?
		JOIN provider_connections c ON c.id = s.connection_id AND c.user_id = ?
		ORDER BY s.account_id`, viewer, viewer)
	if err != nil {
		return nil, err
	}
	defer accRows.Close()
	index := map[int64]int{}
	for i, c := range list {
		index[c.ID] = i
	}
	for accRows.Next() {
		var connID, accountID int64
		if err := accRows.Scan(&connID, &accountID); err != nil {
			return nil, err
		}
		if i, ok := index[connID]; ok {
			list[i].Accounts = append(list[i].Accounts, accountID)
		}
	}
	return list, accRows.Err()
}

// MarkSynced records a successful sync at the given time for every active
// connection of the viewer and the accounts they feed. It returns the number
// of connections.
func (s *Store) MarkSynced(ctx context.Context, viewer int64, at time.Time) (int, error) {
	ts := at.UTC().Format(time.RFC3339)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `
		UPDATE provider_connections
		SET last_sync_at = ?, last_attempt_at = ?, sync_status = 'ok', last_error = NULL
		WHERE user_id = ? AND status = 'active'`, ts, ts, viewer)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if _, err := tx.ExecContext(ctx, `
		UPDATE account_sources
		SET last_sync_at = ?, last_attempt_at = ?, status = 'ok', last_error = NULL
		WHERE connection_id IN (SELECT id FROM provider_connections WHERE user_id = ? AND status = 'active')`,
		ts, ts, viewer); err != nil {
		return 0, err
	}
	return int(n), tx.Commit()
}
