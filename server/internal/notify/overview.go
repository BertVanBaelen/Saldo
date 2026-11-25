package notify

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
	"github.com/BertVanBaelen/Saldo/server/internal/receipt"
)

// The week and month overviews (plan 0.9-3e, NOTIF-6). Two opt-in
// notifications (both types default to off for push and e-mail) that open the
// receipt of 0.9-3d: a generic push and an e-mail with a static receipt, to
// every user about their own current accounts (scope alles, built for that
// user as the viewer, so a user never reads about an account they cannot see).
//
//   - The week of Monday to Sunday is due from Sunday 19:00 Brussels, the month
//     from 19:00 on its last day. When the last day is a Sunday both are due
//     and go out as two messages, the week first (the triggers run in that
//     order), with different push tags.
//   - Keys overview:week:<Monday> and overview:month:<YYYY-MM>, one log row per
//     user and channel, suppressed where the type or the channel is off, so
//     switching a type on in the middle of a week never replays last Sunday.
//   - The message expires three days after its 19:00 (EventExpiry): a restart
//     or a failing mailbox is a catch-up, after three days the overview is
//     dropped (the receipt page still works). A push that falls in the quiet
//     hours waits for 07:00 as every push does; the e-mail does not wait.
//   - A period without income, expenses or saved (the model's Empty) writes no
//     row and sends nothing.
//   - The first run of each trigger (baseline:week, baseline:month) records the
//     period whose 19:00 has already passed as suppressed and sends nothing,
//     at any time of day, so an upgrade never sends an old overview.
//
// A failure for one user (the receipt, a database error) does not stop the
// others; the period stays open and the next run, 15 minutes later, tries
// again until the message expires.

// overviewHour is when a period is due (Brussels): 19:00 on its last day.
const overviewHour = 19

// buildReceipt is receipt.Build; tests replace it to make one user's receipt
// fail.
var buildReceipt = receipt.Build

// ovKind is one of the two overview types.
type ovKind struct {
	name  string // the trigger name and the word in keys and tags: week, month
	typ   string // the notification type
	route string // the receipt route's periode
}

var (
	ovWeek  = ovKind{name: "week", typ: TypeWeek, route: receipt.KindWeek}
	ovMonth = ovKind{name: "month", typ: TypeMonth, route: receipt.KindMonth}
)

// latest is the period whose 19:00 deadline is the latest one at or before now,
// and that moment. A catch-up on the Monday after a Sunday is still about that
// Sunday's week, never about the week that started this morning. Dates are
// taken in Brussels, whatever zone now is in; the noon time keeps date
// arithmetic clear of the daylight-saving hours.
func (k ovKind) latest(now time.Time) (receipt.Period, time.Time) {
	y, m, d := now.In(clock.Brussels).Date()
	at19 := func(t time.Time) time.Time {
		return time.Date(t.Year(), t.Month(), t.Day(), overviewHour, 0, 0, 0, clock.Brussels)
	}
	if k.typ == TypeWeek {
		sunday := time.Date(y, m, d, 12, 0, 0, 0, clock.Brussels)
		sunday = sunday.AddDate(0, 0, -int(sunday.Weekday()))
		if at19(sunday).After(now) {
			sunday = sunday.AddDate(0, 0, -7)
		}
		return receipt.Week(sunday), at19(sunday)
	}
	last := time.Date(y, m+1, 0, 12, 0, 0, 0, clock.Brussels) // day 0 of next month
	if at19(last).After(now) {
		last = time.Date(y, m, 0, 12, 0, 0, 0, clock.Brussels)
	}
	return receipt.Month(last), at19(last)
}

// key is what names the period in keys and tags: the Monday (a week) or the
// month.
func (k ovKind) key(p receipt.Period) string {
	if k.typ == TypeWeek {
		return p.From
	}
	return p.From[:7]
}

// path is the app path of the period's receipt: /overzicht/bon/week/<Monday>
// or /overzicht/bon/maand/<YYYY-MM>-01, always about all accounts.
func (k ovKind) path(p receipt.Period) string {
	return "/overzicht/bon/" + k.route + "/" + p.From + "?scope=alles"
}

// OverviewWeek delivers the week overview that is due at now, see the comment
// above.
func (s *Service) OverviewWeek(ctx context.Context, now time.Time) error {
	return s.overview(ctx, now, ovWeek, false)
}

// OverviewMonth delivers the month overview that is due at now.
func (s *Service) OverviewMonth(ctx context.Context, now time.Time) error {
	return s.overview(ctx, now, ovMonth, false)
}

// baselineWeek and baselineMonth are the first run of the triggers: the period
// whose 19:00 has passed is recorded as suppressed.
func (s *Service) baselineWeek(ctx context.Context, now time.Time) error {
	return s.overview(ctx, now, ovWeek, true)
}

func (s *Service) baselineMonth(ctx context.Context, now time.Time) error {
	return s.overview(ctx, now, ovMonth, true)
}

// overview does one pass for kind k: the latest period that is due, for every
// user. The pass is recorded in notify_runs (overview:<name> = the period's
// key) once every user is handled and nothing waits, so the following runs do
// nothing until the next period; the log keeps a restart, a lost marker or two
// processes from sending twice. With baseline set nothing is sent: the rows
// are written suppressed.
func (s *Service) overview(ctx context.Context, now time.Time, k ovKind, baseline bool) error {
	p, due := k.latest(now)
	periodKey := k.key(p)
	marker := "overview:" + k.name
	if done, err := s.runDay(ctx, marker); err != nil || done == periodKey {
		return err
	}
	expires := due.Add(EventExpiry)
	if !now.Before(expires) {
		// Dropped: no one is sent anything of an overview that old, and no row
		// is needed because the next period has other keys.
		return s.setRunDay(ctx, marker, periodKey)
	}
	users, err := s.overviewUsers(ctx)
	if err != nil {
		return err
	}
	var errs []error
	retry := false
	for _, user := range users {
		m := Message{User: user, Type: k.typ, Key: "overview:" + k.name + ":" + periodKey, Expires: expires}
		if handled, err := s.handled(ctx, m); err != nil {
			errs = append(errs, err)
			continue
		} else if handled {
			continue
		}
		model, err := buildReceipt(ctx, s.db, s.store, user, receipt.Query{Period: p, Scope: "alles", Now: now})
		if err != nil {
			s.log.Error("overview: the receipt failed", "type", k.typ, "user", user, "error", err)
			if baseline {
				// Not known to be empty, and an old overview must never go out.
				if err := s.suppressAll(ctx, now, m); err != nil {
					return err
				}
				continue
			}
			errs = append(errs, fmt.Errorf("user %d: %w", user, err))
			retry = true
			continue
		}
		if model.Empty {
			continue
		}
		if baseline {
			if err := s.suppressAll(ctx, now, m); err != nil {
				return err
			}
			continue
		}
		msg, err := s.overviewMessage(k, p, m, model, now)
		if err != nil {
			errs = append(errs, fmt.Errorf("user %d: %w", user, err))
			retry = true
			continue
		}
		res, err := s.Deliver(ctx, now, msg)
		if err != nil {
			errs = append(errs, fmt.Errorf("user %d: %w", user, err))
			retry = true
			continue
		}
		retry = retry || res.Retry
	}
	if len(errs) == 0 && !retry {
		if err := s.setRunDay(ctx, marker, periodKey); err != nil {
			return err
		}
	}
	return errors.Join(errs...)
}

// overviewUsers are every user, in id order.
func (s *Service) overviewUsers(ctx context.Context) ([]int64, error) {
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

// overviewMessage is the user's message for the period: the generic push and
// the e-mail with the static receipt. base carries the user, type, key and
// expiry.
func (s *Service) overviewMessage(k ovKind, p receipt.Period, base Message, model receipt.Model, now time.Time) (Message, error) {
	path := k.path(p)
	data := overviewData(model, s.links(), s.abs(path), now)
	var em mail.Message
	var err error
	if k.typ == TypeWeek {
		em, err = mail.WeekOverview("", data)
	} else {
		em, err = mail.MonthOverview("", data)
	}
	if err != nil {
		return base, err
	}
	pl := overviewPayload(k.typ, model, Detail)
	pl.URL, pl.Tag = path, "overview-"+k.name+"-"+k.key(p)
	base.Push, base.Email = &pl, &em
	return base, nil
}

// overviewPayload is the push of an overview at detail: generic, the same
// title and line for every user, until the lock-screen spike decides; at
// DetailFull the label and the three figures of the receipt, in whole euros
// ("Uitgegeven € 412 · gespaard € 50 · over € 390").
func overviewPayload(typ string, m receipt.Model, detail string) push.Payload {
	p := Payload(typ, Text{}, detail)
	if detail != DetailFull {
		return p
	}
	name := "Weekoverzicht"
	if typ == TypeMonth {
		name = "Maandoverzicht"
	}
	p.Title = name + " · " + strings.ToLower(strings.SplitN(m.Label, " · ", 2)[0])
	p.Body = "Uitgegeven " + ledger.Eur0(m.Expenses.Total) + " · gespaard " + ledger.Eur0(m.Saved.Total) + " · over " + ledger.Eur0(m.Result.Total)
	return p
}

// overviewData converts the receipt model to the input of the overview mails
// (mail imports neither receipt nor ledger): the same rows, children, trends
// and notes, the budget lines of a month, and the snapshot line of the moment
// the receipt was built. A budget without a percentage (a reference of 0) has
// nothing to say and is left out.
func overviewData(m receipt.Model, links mail.Links, receiptURL string, now time.Time) mail.OverviewData {
	d := mail.OverviewData{
		Links:      links,
		Label:      m.Label,
		ScopeLabel: m.ScopeLabel,
		Income:     overviewSection(m.Income.Total, m.Income.Trend, m.Income.Rows),
		Expenses:   overviewSection(m.Expenses.Total, m.Expenses.Trend, m.Expenses.Groups),
		Saved:      overviewSection(m.Saved.Total, m.Saved.Trend, m.Saved.Rows),
		Result:     m.Result.Total,
		Notes:      append([]string(nil), m.Notes...),
		Stand:      mail.StandLine(now),
		ReceiptURL: receiptURL,
	}
	if m.Result.Prev != nil {
		prev := *m.Result.Prev
		d.PrevResult = &prev
	}
	return d
}

func overviewSection(total int64, t *receipt.Trend, rows []receipt.Row) mail.OverviewSection {
	s := mail.OverviewSection{Total: total, Trend: overviewTrend(t)}
	for _, r := range rows {
		l := mail.OverviewLine{Name: r.Name, Amount: r.Amount, Trend: overviewTrend(r.Trend)}
		if b := r.Budget; b != nil && b.Pct != nil {
			kind := "budget"
			switch b.Kind {
			case "average", "mixed":
				kind = b.Kind // the mail words them like the receipt page
			}
			l.Budget = &mail.OverviewBudget{Kind: kind, Amount: b.Amount, Pct: *b.Pct}
		}
		for _, c := range r.Children {
			l.Children = append(l.Children, mail.OverviewChild{Name: c.Name, Amount: c.Amount})
		}
		s.Rows = append(s.Rows, l)
	}
	return s
}

// overviewTrend: no trend is no comparison; "new" has no percentage.
func overviewTrend(t *receipt.Trend) mail.OverviewTrend {
	if t == nil {
		return mail.OverviewTrend{}
	}
	o := mail.OverviewTrend{Kind: t.Kind}
	if t.Pct != nil {
		o.Pct = *t.Pct
	}
	return o
}
