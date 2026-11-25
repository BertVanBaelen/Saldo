package notify

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// The planning warnings (plan 0.9-3 step 5, README decisions 1, 2 and 4):
// once a day from 07:00 Brussels, per current account one forecast, per
// person who sees the account the warnings within their look-ahead (what
// Start shows: the first red month, the first buffer month before it).
//
// The state machine per user and account:
//   - re-arm: the log rows of a month that is now ok, and of past months, are
//     deleted (for every user), so a new dip notifies again;
//   - a warning whose key is not handled on both channels is due, unless a
//     red row of the same month exists: then it is a silent downgrade, logged
//     suppressed;
//   - at most one message per account per morning, red before buffer; the
//     other one stays due for the next morning.

const (
	// planningHour is when the daily planning run is due (Brussels).
	planningHour = 7
	// planningHorizon is the forecast's months after the running one; each
	// user's look-ahead (1, 3 or 6) cuts it.
	planningHorizon = 6
	// planningCutoff: after this hour (Brussels) the day is recorded even
	// when a send keeps failing or a forecast errs, so the warnings do not
	// turn into an every-15-minutes check for the rest of the day; what is
	// still due goes the next morning.
	planningCutoff = 10
	// staleDays: a bank account whose newest data is older than this gets no
	// planning warning (the sync message covers it).
	staleDays = 3
)

// Planning runs the daily planning warnings when they are due at now: from
// 07:00 Brussels, once per day. Until 10:00 the day is recorded only when the
// run ended without an error and nothing waits (a failed send), so the next
// run picks those up; from 10:00 it is recorded anyway and what is left goes
// the next morning (a push held by quiet hours after a late catch-up too).
func (s *Service) Planning(ctx context.Context, now time.Time) error {
	local := now.In(clock.Brussels)
	today := local.Format(time.DateOnly)
	if local.Hour() < planningHour {
		return nil
	}
	day, err := s.runDay(ctx, "planning")
	if err != nil || day == today {
		return err
	}
	retry, err := s.planning(ctx, now, false)
	if err != nil || retry {
		if local.Hour() < planningCutoff {
			return err
		}
		s.log.Warn("planning warnings: not everything went out; the rest is tried tomorrow morning", "error", err)
	}
	if serr := s.setRunDay(ctx, "planning", today); serr != nil {
		return errors.Join(err, serr)
	}
	return err
}

// baselinePlanning is the planning trigger's first run: every warning that is
// true now is logged as suppressed for both channels, nothing is sent.
func (s *Service) baselinePlanning(ctx context.Context, now time.Time) error {
	_, err := s.planning(ctx, now, true)
	return err
}

// candidate is one warning of one account for one user.
type candidate struct {
	typ, state string // rood/red or buffer/buffer
	w          *planning.Warning
}

func (c candidate) key(account int64) string {
	return fmt.Sprintf("account:%d|%s|%s|%s", account, c.typ, c.w.Month, c.state)
}

// planning evaluates every current account. A forecast that fails is logged
// and skipped (the others go on) and the run reports an error at the end.
func (s *Service) planning(ctx context.Context, now time.Time, baseline bool) (retry bool, err error) {
	local := now.In(clock.Brussels)
	today := local.Format(time.DateOnly)
	staleBefore := local.AddDate(0, 0, -staleDays).Format(time.DateOnly)
	morning := stamp(time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, clock.Brussels))

	type acct struct {
		id     int64
		source string
	}
	var accounts []acct
	rows, err := s.db.QueryContext(ctx, `SELECT id, source FROM accounts WHERE type = 'current' ORDER BY id`)
	if err != nil {
		return false, fmt.Errorf("notify: %w", err)
	}
	for rows.Next() {
		var a acct
		if err := rows.Scan(&a.id, &a.source); err != nil {
			rows.Close()
			return false, fmt.Errorf("notify: %w", err)
		}
		accounts = append(accounts, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("notify: %w", err)
	}

	var failed []error
	for _, a := range accounts {
		f, err := planning.Forecast(ctx, s.db, a.id, today, planningHorizon)
		if errors.Is(err, planning.ErrNoBalance) {
			continue
		}
		if err != nil {
			s.log.Error("planning warnings: forecast failed", "account", a.id, "error", err)
			failed = append(failed, fmt.Errorf("account %d: %w", a.id, err))
			continue
		}
		if len(f.Months) == 0 || a.source == "bank" && f.DataDate < staleBefore {
			continue
		}
		if !baseline {
			if err := s.rearm(ctx, a.id, f); err != nil {
				return retry, err
			}
		}
		members, err := s.members(ctx, a.id)
		if err != nil {
			return retry, err
		}
		for _, u := range members {
			w := planning.Warnings(f, u.look)
			var cands []candidate
			if w.Red != nil {
				cands = append(cands, candidate{TypeRood, "red", w.Red})
			}
			if w.Buffer != nil {
				cands = append(cands, candidate{TypeBuffer, "buffer", w.Buffer})
			}
			for _, c := range cands {
				m := Message{User: u.id, Type: c.typ, Key: c.key(a.id), Account: a.id, Month: c.w.Month, State: c.state}
				if baseline {
					if err := s.suppressAll(ctx, now, m); err != nil {
						return retry, err
					}
					continue
				}
				handled, err := s.handled(ctx, m)
				if err != nil {
					return retry, err
				}
				if handled {
					continue
				}
				if c.state == "buffer" {
					worse, err := s.redLogged(ctx, u.id, a.id, c.w.Month)
					if err != nil {
						return retry, err
					}
					if worse { // red → buffer inside the same month: silent
						if err := s.suppressAll(ctx, now, m); err != nil {
							return retry, err
						}
						continue
					}
				}
				other, err := s.otherToday(ctx, m, morning)
				if err != nil {
					return retry, err
				}
				if other { // one message per account per morning
					break
				}
				m, ok, err := s.planningMessage(ctx, now, m, c, f)
				if err != nil {
					return retry, err
				}
				if ok {
					res, err := s.Deliver(ctx, now, m)
					if err != nil {
						return retry, err
					}
					retry = retry || res.Retry
				}
				break
			}
		}
	}
	return retry, errors.Join(failed...)
}

type member struct {
	id   int64
	look int
}

// members are the users who see the account, with their look-ahead.
func (s *Service) members(ctx context.Context, account int64) ([]member, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT u.id, u.lookahead_months FROM account_access x JOIN users u ON u.id = x.user_id
		WHERE x.account_id = ? ORDER BY u.id`, account)
	if err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	defer rows.Close()
	var out []member
	for rows.Next() {
		var m member
		if err := rows.Scan(&m.id, &m.look); err != nil {
			return nil, fmt.Errorf("notify: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// rearm deletes the planning rows of the account's months that are ok in the
// forecast now and of the months before the running month, for every user.
func (s *Service) rearm(ctx context.Context, account int64, f planning.AccountForecast) error {
	args := []any{account, f.Months[0].Month}
	var ok []string
	for _, m := range f.Months {
		if m.State == "ok" {
			ok = append(ok, "?")
			args = append(args, m.Month)
		}
	}
	q := `DELETE FROM notification_log WHERE account_id = ? AND type IN ('rood', 'buffer') AND (month < ?`
	if len(ok) > 0 {
		q += ` OR month IN (` + strings.Join(ok, ", ") + `)`
	}
	if _, err := s.db.ExecContext(ctx, q+`)`, args...); err != nil {
		return fmt.Errorf("notify: re-arm: %w", err)
	}
	return nil
}

// suppressAll logs m as suppressed on both channels (where it has no row).
func (s *Service) suppressAll(ctx context.Context, now time.Time, m Message) error {
	for _, ch := range []string{ChannelEmail, ChannelPush} {
		if err := s.suppress(ctx, now, m, ch); err != nil {
			return err
		}
	}
	return nil
}

// handled reports whether both channels have a final row (sent or
// suppressed) for m's key. A key with one channel still open (a push held by
// quiet hours, a failed send) is not handled.
func (s *Service) handled(ctx context.Context, m Message) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_log
		WHERE user_id = ? AND dedupe = ? AND status IN ('sent', 'suppressed')`, m.User, m.Key).Scan(&n); err != nil {
		return false, fmt.Errorf("notify: %w", err)
	}
	return n >= 2, nil
}

// redLogged reports whether the user has a red row for the account's month.
func (s *Service) redLogged(ctx context.Context, user, account int64, month string) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_log
		WHERE user_id = ? AND account_id = ? AND type = 'rood' AND month = ?`, user, account, month).Scan(&n); err != nil {
		return false, fmt.Errorf("notify: %w", err)
	}
	return n > 0, nil
}

// otherToday reports whether another planning message of this account went
// to the user (claimed or sent) since this morning's midnight: read from the
// log, so a restart or a second process keeps "one per morning".
func (s *Service) otherToday(ctx context.Context, m Message, morning string) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_log
		WHERE user_id = ? AND account_id = ? AND type IN ('rood', 'buffer') AND dedupe <> ?
		AND status IN ('claimed', 'sent') AND claimed_at >= ?`, m.User, m.Account, m.Key, morning).Scan(&n); err != nil {
		return false, fmt.Errorf("notify: %w", err)
	}
	return n > 0, nil
}

// planningMessage fills the push and the e-mail of a warning for its user.
// ok is false when the user no longer sees the account.
func (s *Service) planningMessage(ctx context.Context, now time.Time, m Message, c candidate, f planning.AccountForecast) (Message, bool, error) {
	a, err := s.store.Account(ctx, m.User, m.Account, now)
	if errors.Is(err, apperr.ErrNotFound) {
		return m, false, nil
	}
	if err != nil {
		return m, false, err
	}
	w := c.w
	month, err := time.ParseInLocation("2006-01", w.Month, clock.Brussels)
	if err != nil {
		return m, false, fmt.Errorf("notify: month %q: %w", w.Month, err)
	}
	path := fmt.Sprintf("/planning?maand=%s&rekening=%d#maanden", w.Month, m.Account)
	ref := accountRef(a)
	var cause *mail.Expense
	if w.Cause != nil {
		cause = &mail.Expense{Name: w.Cause.Label, Amount: w.Cause.Amount}
	}
	text := Text{Account: a.Name, Month: ledger.MonthLabel(w.Month, f.Months[0].Month), Amount: w.End, Under: w.UnderBuffer}
	var em mail.Message
	if c.typ == TypeRood {
		em, err = mail.PlanningRed("", mail.PlanningRedData{Links: s.links(), Account: ref, Month: month.Month(), EndBalance: w.End,
			EndDate: month.AddDate(0, 1, -1), RedFrom: date(w.RedFrom), Cause: cause, Buffer: w.Buffer, ActionURL: s.abs(path)})
	} else {
		em, err = mail.PlanningBuffer("", mail.PlanningBufferData{Links: s.links(), Account: ref, Month: month.Month(), EndBalance: w.End,
			UnderBuffer: w.UnderBuffer, Buffer: w.Buffer, LowestPoint: date(w.LowDate), Cause: cause, ActionURL: s.abs(path)})
	}
	if err != nil {
		return m, false, err
	}
	p := Payload(c.typ, text, Detail)
	p.URL, p.Tag = path, fmt.Sprintf("planning-%d-%s", m.Account, c.typ)
	m.Push, m.Email = &p, &em
	return m, true, nil
}

// date parses a YYYY-MM-DD date in Brussels; "" or a bad date is zero.
func date(s string) time.Time {
	t, err := time.ParseInLocation(time.DateOnly, s, clock.Brussels)
	if err != nil {
		return time.Time{}
	}
	return t
}
