package banklink

import (
	"context"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// The nightly sync (analysis 4.1): banks allow about four background calls
// a day, so at most maxBackground attempts per connection per day, starting
// at nightlyHour (Brussels). A failed attempt is retried after retryAfter,
// doubling: 30 minutes, 1 hour (the cap is reached before 2 hours).
const (
	nightlyHour   = 4
	maxBackground = 3
	retryAfter    = 30 * time.Minute
)

// Nightly syncs, one after another, every active connection that is due at
// now. It is a catch-up job, meant to run every few minutes: a connection is
// due after 04:00 when it had no attempt since 04:00 today, or when its last
// attempt failed and the backoff has passed. That also covers a restart or
// the Home Assistant backup window, whenever they end. A lapsed consent is
// not active, so it is never retried; "Sync now" does not count towards the
// daily cap. A connection that is syncing already is left for the next run.
func (s *Service) Nightly(ctx context.Context, now time.Time) error {
	local := now.In(clock.Brussels)
	y, m, d := local.Date()
	cutoff := time.Date(y, m, d, nightlyHour, 0, 0, 0, clock.Brussels)
	if local.Before(cutoff) {
		return nil
	}
	ids, err := s.activeConnections(ctx, 0)
	if err != nil {
		return err
	}
	today := local.Format(time.DateOnly)
	for _, id := range ids {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.nightlyOne(ctx, id, now, cutoff, today); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) nightlyOne(ctx context.Context, id int64, now, cutoff time.Time, today string) error {
	release, _ := s.claim(id)
	if release == nil {
		return nil
	}
	defer release()
	// Read under the claim, so a sync that just ended is seen.
	var status, syncStatus, lastAttempt, day string
	var attempts int
	err := s.db.QueryRowContext(ctx, `SELECT status, sync_status, COALESCE(last_attempt_at, ''),
		COALESCE(background_day, ''), background_attempts FROM provider_connections WHERE id = ?`, id).
		Scan(&status, &syncStatus, &lastAttempt, &day, &attempts)
	if err != nil {
		return err
	}
	if day != today {
		attempts = 0
	}
	if status != "active" || !due(now, cutoff, syncStatus, lastAttempt, attempts) {
		return nil
	}
	// Counted before the bank is called, so a crash halfway still counts.
	if _, err := s.db.ExecContext(ctx, `UPDATE provider_connections SET background_day = ?, background_attempts = ? WHERE id = ?`,
		today, attempts+1, id); err != nil {
		return err
	}
	return s.syncConnection(ctx, id, now)
}

// due decides whether the nightly job syncs a connection at now.
func due(now, cutoff time.Time, syncStatus, lastAttempt string, attempts int) bool {
	if attempts >= maxBackground {
		return false
	}
	last, err := time.Parse(time.RFC3339, lastAttempt)
	if err != nil || last.Before(cutoff) {
		return true
	}
	if syncStatus == "ok" {
		return false
	}
	return !now.Before(last.Add(retryAfter << max(attempts-1, 0)))
}
