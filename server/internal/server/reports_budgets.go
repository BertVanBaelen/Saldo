package server

import (
	"net/http"

	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// GET /api/reports/budgets (0.8.1-2, docs/api.md "Reports"): what Overzicht
// reads each category's amount against, per account and month. The reference
// itself is planning.BudgetReference (moved there in 0.9-3c so the overview
// receipt reads the same one); this file is the route and its wire shape.

// The wire shape. Categories is a []planning.RefCategory, or with average=1
// (0.9.1-4) a []refWithAverage: RefCategory is also what the receipt reads, so
// it does not carry the average itself.
type (
	refWithAverage struct {
		CategoryID int64  `json:"categoryId"`
		Reference  int64  `json:"reference"`
		Source     string `json:"source"`
		Average    int64  `json:"average"` // the full-amount 6-month average, 0 without history, also when source is budget
	}
	refAccount struct {
		ID         int64 `json:"id"`
		Categories any   `json:"categories"`
	}
	refMonth struct {
		Month    string       `json:"month"`
		Accounts []refAccount `json:"accounts"`
	}
	refAnswer struct {
		Months []refMonth `json:"months"`
	}
)

func (s *Server) getReportBudgets(w http.ResponseWriter, r *http.Request) {
	q, ok := s.reportQuery(w, r)
	if !ok {
		return
	}
	ctx, viewer := r.Context(), viewerOf(r)
	// The report of the period decides what is valid (months, scope, account, in the report's order and words)
	// and which accounts and months the answer holds.
	rep, err := s.store.ReportMonths(ctx, viewer, q)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	today := s.brusselsToday()
	facts := make(map[int64]planning.BudgetReference, len(rep.Accounts))
	for _, id := range rep.Accounts {
		if facts[id], err = planning.LoadBudgetReference(ctx, s.db, s.store, viewer, id, today, s.now()); err != nil {
			s.fail(w, r, err, msgAccountNotFound)
			return
		}
	}
	withAverage := r.URL.Query().Get("average") == "1" // opt-in; any other value is ignored
	out := refAnswer{Months: make([]refMonth, len(rep.Months))}
	for i, m := range rep.Months {
		rm := refMonth{Month: m.Month, Accounts: make([]refAccount, len(rep.Accounts))}
		for j, id := range rep.Accounts {
			in := facts[id].In(m.Month)
			var categories any = in
			if withAverage {
				categories = mapTo(in, func(c planning.RefCategory) refWithAverage {
					return refWithAverage{c.CategoryID, c.Reference, c.Source, facts[id].Average(c.CategoryID)}
				})
			}
			rm.Accounts[j] = refAccount{ID: id, Categories: categories}
		}
		out.Months[i] = rm
	}
	writeJSON(w, http.StatusOK, out)
}
