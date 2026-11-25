package notify

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
)

// "Te categoriseren" (plan 0.9-3b step 4, README decision 7): once a day from
// 19:00 Brussels, per user the number of NEW bank-synced rows that still need
// a category (ledger.UncategorisedSince), above the user's high-water mark.
// The mark lives in the state of the user's cat log rows ("<mark>:<count>"):
// a digest moves it to the highest id it counted, so the backlog never comes
// back; a day with nothing new writes nothing and keeps it. The digest's
// baseline (and a user's first digest) sets the mark silently.

const (
	digestHour = 19
	// digestStart is the key of the silent first mark of a user.
	digestStart = "digest:baseline"
	digestPath  = "/transacties?filter=niet-gecategoriseerd"
)

func digestKey(day string) string { return "digest:" + day }

// digestState is the state of a digest row: the mark and the count.
func digestState(mark int64, count int) string { return fmt.Sprintf("%d:%d", mark, count) }

func parseDigestState(s string) (mark int64, count int) {
	m, c, _ := strings.Cut(s, ":")
	mark, _ = strconv.ParseInt(m, 10, 64)
	count, _ = strconv.Atoi(c)
	return mark, count
}

// Digest delivers the digests that are due at now: first the ones of earlier
// runs that still wait for a channel (a push held by quiet hours after a late
// catch-up, a failed send), then, from 19:00 and once per day, the new ones.
func (s *Service) Digest(ctx context.Context, now time.Time) error {
	if err := s.heldDigests(ctx, now); err != nil {
		return err
	}
	local := now.In(clock.Brussels)
	today := local.Format(time.DateOnly)
	if local.Hour() < digestHour {
		return nil
	}
	day, err := s.runDay(ctx, "digest")
	if err != nil || day == today {
		return err
	}
	users, err := s.digestUsers(ctx)
	if err != nil {
		return err
	}
	key := digestKey(today)
	for _, u := range users {
		var n int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_log WHERE user_id = ? AND type = 'cat' AND dedupe = ?`,
			u, key).Scan(&n); err != nil {
			return fmt.Errorf("notify: %w", err)
		}
		if n > 0 {
			continue // today's digest exists: heldDigests finishes it
		}
		mark, ok, err := s.digestMark(ctx, u)
		if err != nil {
			return err
		}
		if !ok { // a user without a mark (new since the baseline): set it silently
			if err := s.markDigest(ctx, now, u); err != nil {
				return err
			}
			continue
		}
		count, last, err := s.store.UncategorisedSince(ctx, u, mark)
		if err != nil {
			return fmt.Errorf("notify: %w", err)
		}
		if count == 0 {
			continue
		}
		m, err := s.digestMessage(u, key, last, count, now)
		if err != nil {
			return err
		}
		if _, err := s.Deliver(ctx, now, m); err != nil {
			return err
		}
	}
	return s.setRunDay(ctx, "digest", today)
}

// heldDigests finishes the digests of the last EventExpiry that one channel
// has not handled yet, with the count and mark they were made with.
func (s *Service) heldDigests(ctx context.Context, now time.Time) error {
	rows, err := s.db.QueryContext(ctx, `SELECT user_id, dedupe, MIN(state), MIN(claimed_at) FROM notification_log
		WHERE type = 'cat' AND dedupe <> ? AND claimed_at > ?
		GROUP BY user_id, dedupe HAVING SUM(status IN ('sent', 'suppressed')) < 2`, digestStart, stamp(now.Add(-EventExpiry)))
	if err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	type held struct {
		user          int64
		key, state, t string
	}
	var list []held
	for rows.Next() {
		var h held
		if err := rows.Scan(&h.user, &h.key, &h.state, &h.t); err != nil {
			rows.Close()
			return fmt.Errorf("notify: %w", err)
		}
		list = append(list, h)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	for _, h := range list {
		mark, count := parseDigestState(h.state)
		first, err := time.Parse("2006-01-02T15:04:05Z", h.t)
		if err != nil || count < 1 {
			continue
		}
		m, err := s.digestMessage(h.user, h.key, mark, count, first)
		if err != nil {
			return err
		}
		if _, err := s.Deliver(ctx, now, m); err != nil {
			return err
		}
	}
	return nil
}

// digestMessage is the digest of count rows up to mark, made at made.
func (s *Service) digestMessage(user int64, key string, mark int64, count int, made time.Time) (Message, error) {
	em, err := mail.UncategorisedDigest("", mail.UncategorisedDigestData{Links: s.links(), Count: count, ActionURL: s.abs(digestPath)})
	if err != nil {
		return Message{}, err
	}
	p := Payload(TypeCat, Text{Count: count}, Detail)
	p.URL, p.Tag = digestPath, "cat"
	return Message{User: user, Type: TypeCat, Key: key, State: digestState(mark, count), Push: &p, Email: &em,
		Expires: made.Add(EventExpiry)}, nil
}

// digestMark is the user's high-water mark: the highest mark of their cat
// rows; ok is false when they have none.
func (s *Service) digestMark(ctx context.Context, user int64) (int64, bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT state FROM notification_log WHERE user_id = ? AND type = 'cat' AND state IS NOT NULL`, user)
	if err != nil {
		return 0, false, fmt.Errorf("notify: %w", err)
	}
	defer rows.Close()
	var mark int64
	ok := false
	for rows.Next() {
		var st string
		if err := rows.Scan(&st); err != nil {
			return 0, false, fmt.Errorf("notify: %w", err)
		}
		m, _ := parseDigestState(st)
		mark, ok = max(mark, m), true
	}
	return mark, ok, rows.Err()
}

// markDigest sets the user's first mark at the newest transaction, silently.
func (s *Service) markDigest(ctx context.Context, now time.Time, user int64) error {
	var top int64
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(id), 0) FROM transactions`).Scan(&top); err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	return s.suppressAll(ctx, now, Message{User: user, Type: TypeCat, Key: digestStart, State: digestState(top, 0)})
}

// baselineDigest sets every user's first mark.
func (s *Service) baselineDigest(ctx context.Context, now time.Time) error {
	users, err := s.digestUsers(ctx)
	if err != nil {
		return err
	}
	for _, u := range users {
		if err := s.markDigest(ctx, now, u); err != nil {
			return err
		}
	}
	return nil
}

// digestUsers are every user, by id.
func (s *Service) digestUsers(ctx context.Context) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM users ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("notify: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
