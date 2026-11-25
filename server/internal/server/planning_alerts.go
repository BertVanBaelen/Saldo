package server

import (
	"context"
	"errors"
	"fmt"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// Planning alerts (0.8-4, docs/api.md "Planning (0.8)"): per current account of
// the scope, the first month inside the viewer's look-ahead whose end is below
// zero (red) and the first month before that one whose end is in the buffer.
// Month ends only (plan 0.8 decision 14). The rule itself is planning.Warnings
// (0.9-3), which the notifications use too; this file only maps it to alerts.

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

// accountPlanningAlerts maps planning.Warnings (the month-end rule, shared
// with the notifications) to the red alert and the buffer alert, each nil
// when there is none.
func accountPlanningAlerts(id int64, name string, f planning.AccountForecast, look int) (red, buffer *ledger.Alert) {
	w := planning.Warnings(f, look)
	if len(f.Months) == 0 {
		return nil, nil
	}
	running := f.Months[0].Month
	href := func(w *planning.Warning) string { return "/planning?maand=" + w.Month + "#maanden" }
	if r := w.Red; r != nil {
		red = &ledger.Alert{Kind: "neg", Type: "planning", AccountID: id, Href: href(r),
			Title: name + " staat rood in " + ledger.MonthLabel(r.Month, running),
			Note:  "Verwacht eindsaldo " + ledger.Eur0(r.End) + " · bekijk de planning"}
	}
	if b := w.Buffer; b != nil {
		buffer = &ledger.Alert{Kind: "warn", Type: "planning", AccountID: id, Href: href(b),
			Title: name + " zakt in de buffer in " + ledger.MonthLabel(b.Month, running),
			Note:  fmt.Sprintf("Verwacht %s, %s onder de buffer van %s", ledger.Eur0(b.End), ledger.Eur0(b.UnderBuffer), ledger.Eur0(b.Buffer))}
	}
	return red, buffer
}
