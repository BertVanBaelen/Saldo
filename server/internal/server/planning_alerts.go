package server

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// Planning alerts (0.8-4, docs/api.md "Planning (0.8)"): per current account of
// the scope, the first month inside the viewer's look-ahead whose end is below
// zero (red) and the first month before that one whose end is in the buffer.
// Month ends only (plan 0.8 decision 14). 0.9-3 sends mails from the same
// function, accountPlanningAlerts.

// planningAlerts are the red and buffer alerts of the current accounts of the
// scope the viewer holds, the red ones first (accounts in id order), then the
// buffer ones. An account without a balance has none.
func (s *Server) planningAlerts(ctx context.Context, viewer int64, scope string) ([]ledger.Alert, error) {
	var look int
	if err := s.db.QueryRowContext(ctx, `SELECT lookahead_months FROM users WHERE id = ?`, viewer).Scan(&look); err != nil {
		return nil, err
	}
	accounts, err := s.store.Accounts(ctx, viewer, s.now())
	if err != nil {
		return nil, err
	}
	var red, buffer []ledger.Alert
	for _, a := range accounts {
		if a.Type != "current" || !inScope(scope, a.Kind) {
			continue
		}
		f, err := planning.Forecast(ctx, s.db, a.ID, s.brusselsToday(), max(3, look)) // look is 1, 3 or 6: horizon 3 or 6
		if errors.Is(err, planning.ErrNoBalance) {
			continue
		}
		if err != nil {
			// A forecast that fails must not take the sync and consent alerts down with it.
			s.log.ErrorContext(ctx, "planning alerts: forecast failed", "account", a.ID, "error", err)
			continue
		}
		r, b := accountPlanningAlerts(a.ID, a.Name, f, look)
		if r != nil {
			red = append(red, *r)
		}
		if b != nil {
			buffer = append(buffer, *b)
		}
	}
	return append(red, buffer...), nil
}

// accountPlanningAlerts is the red alert and the buffer alert (each nil when
// there is none) of one account's forecast for the running month and the look
// months after it.
func accountPlanningAlerts(id int64, name string, f planning.AccountForecast, look int) (red, buffer *ledger.Alert) {
	months := f.Months[:min(look+1, len(f.Months))]
	running := f.Months[0].Month
	first := len(months) // the first red month
	for i, m := range months {
		if m.End < 0 {
			first = i
			break
		}
	}
	href := func(m planning.Month) string { return "/planning?maand=" + m.Month + "#maanden" }
	if first < len(months) {
		m := months[first]
		red = &ledger.Alert{Kind: "neg", Type: "planning", AccountID: id, Href: href(m),
			Title: name + " staat rood in " + monthLabel(m.Month, running),
			Note:  "Verwacht eindsaldo " + eur0(m.End) + " · bekijk de planning"}
	}
	for _, m := range months[:first] {
		if m.End < f.Buffer {
			buffer = &ledger.Alert{Kind: "warn", Type: "planning", AccountID: id, Href: href(m),
				Title: name + " zakt in de buffer in " + monthLabel(m.Month, running),
				Note:  fmt.Sprintf("Verwacht %s, %s onder de buffer van %s", eur0(m.End), eur0(f.Buffer-m.End), eur0(f.Buffer))}
			break
		}
	}
	return red, buffer
}

// monthLabel is a "YYYY-MM" month in lower-case Dutch, with its year when it is
// more than 11 months after the running month ("januari", "januari 2028").
func monthLabel(month, running string) string {
	t, _ := time.Parse("2006-01", month)
	r, _ := time.Parse("2006-01", running)
	name := ledger.MonthDutch(t.Month())
	if (t.Year()-r.Year())*12+int(t.Month()-r.Month()) > 11 {
		name += " " + strconv.Itoa(t.Year())
	}
	return name
}

// eur0 is an amount in cents in whole euros as the web app writes it:
// "€ 1.134", negative "−€ 1.134" (U+2212), half a euro rounded up.
func eur0(cents int64) string {
	sign := ""
	if cents < 0 {
		sign, cents = "−", -cents
	}
	digits := strconv.FormatInt((cents+50)/100, 10)
	var b strings.Builder
	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return sign + "€ " + b.String()
}
