package server

import (
	"errors"
	"net/http"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// GET /api/reports/balances (0.8.1-5, docs/api.md "Reports"): what Overzicht's
// balance chart draws, per account of the selection: the end-of-day balance of
// every day with booked rows over the selected months, reconstructed backwards
// from the account's newest balance (planning/history.go, the forecast's past-
// balance rule), and the account's buffer. Never a sum over accounts.

// The wire shape.
type (
	balanceAccount struct {
		ID        int64            `json:"id"`
		Buffer    int64            `json:"buffer"`
		FirstDate *string          `json:"firstDate"` // first booked date, null without
		Missing   bool             `json:"missing"`   // no balance snapshot: no points
		Points    []planning.Point `json:"points"`
	}
	balanceAnswer struct {
		Accounts []balanceAccount `json:"accounts"`
	}
)

// monthEnd is the last day (YYYY-MM-DD) of a valid YYYY-MM month.
func monthEnd(month string) string {
	t, _ := time.Parse("2006-01", month)
	return t.AddDate(0, 1, -1).Format(time.DateOnly)
}

func (s *Server) getReportBalances(w http.ResponseWriter, r *http.Request) {
	q, ok := s.reportQuery(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	// The report of the period decides what is valid (months, scope, account, in the report's order and words)
	// and which accounts and months the answer holds, as for the budgets.
	rep, err := s.store.ReportMonths(ctx, viewerOf(r), q)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	today := s.brusselsToday()
	to := q.To
	if to == "" {
		to = today[:7]
	}
	from := to // a selection without booked rows in the period has no months: no point either way
	if n := len(rep.Months); n > 0 {
		from, to = rep.Months[0].Month, rep.Months[n-1].Month
	}
	last := monthEnd(to)
	out := balanceAnswer{Accounts: make([]balanceAccount, 0, len(rep.Accounts))}
	for _, id := range rep.Accounts {
		h, err := planning.LoadHistory(ctx, s.db, id, from+"-01", today)
		a := balanceAccount{ID: id, Buffer: h.Buffer, Points: []planning.Point{}}
		switch {
		case errors.Is(err, planning.ErrNoBalance):
			a.Missing = true
		case err != nil:
			s.fail(w, r, err, msgAccountNotFound)
			return
		default:
			if h.FirstBooked != "" {
				first := h.FirstBooked
				a.FirstDate = &first
			}
			// The history runs to today; the answer ends with the last selected month.
			for _, p := range h.Points {
				if p.Date <= last {
					a.Points = append(a.Points, p)
				}
			}
		}
		out.Accounts = append(out.Accounts, a)
	}
	writeJSON(w, http.StatusOK, out)
}
