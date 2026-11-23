package server

import (
	"context"
	"maps"
	"net/http"
	"slices"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// GET /api/reports/budgets (0.8.1-2, docs/api.md "Reports"): what Overzicht
// reads each category's amount against, per account and month: the account's
// budget row (the one Planning uses), else a full-amount average of the
// account's history months, computed from the report's own rule (the per-account
// report's expense of that category, recurring items included), not the
// engine's variable-only average.

// The wire shape.
type (
	refCategory struct {
		CategoryID int64  `json:"categoryId"`
		Reference  int64  `json:"reference"`
		Source     string `json:"source"` // budget | average
	}
	refAccount struct {
		ID         int64         `json:"id"`
		Categories []refCategory `json:"categories"`
	}
	refMonth struct {
		Month    string       `json:"month"`
		Accounts []refAccount `json:"accounts"`
	}
	refAnswer struct {
		Months []refMonth `json:"months"`
	}
)

// budgetFacts are one account's facts for its references.
type budgetFacts struct {
	first   string                // first booked row, "" without
	average map[int64]int64       // top category id -> full-amount average of the history months; only above 0
	budgets []planning.FactBudget // rows of valid categories, as the forecast reads them
}

// loadBudgetFacts reads the budget rows and the history months of one account
// (account-level, viewer-free) and the viewer's report of it over those months.
func (s *Server) loadBudgetFacts(ctx context.Context, viewer, account int64, today string) (budgetFacts, error) {
	f := budgetFacts{average: map[int64]int64{}}
	first, hist, err := planning.LoadHistoryMonths(ctx, s.db, account, today)
	if err != nil {
		return f, err
	}
	f.first = first
	if f.budgets, err = planning.LoadBudgets(ctx, s.db, account); err != nil {
		return f, err
	}
	if len(hist) == 0 {
		return f, nil
	}
	// The account alone, so every transfer of it is a flow, for the same viewer; the months in between
	// that hold no booked row are left out of the sum (as the engine leaves them out of its average).
	rep, err := s.store.ReportMonths(ctx, viewer, ledger.ReportQuery{AccountID: account, From: hist[0], To: hist[len(hist)-1], Now: s.now()})
	if err != nil {
		return f, err
	}
	sums := map[int64]int64{}
	for _, m := range rep.Months {
		if !slices.Contains(hist, m.Month) {
			continue
		}
		for key, v := range m.Expenses {
			if id, err := strconv.ParseInt(key, 10, 64); err == nil { // none, toShared and toOwn are no category
				sums[id] += v
			}
		}
	}
	for id, sum := range sums {
		if avg := planning.AverageOf(sum, len(hist)); avg > 0 {
			f.average[id] = avg
		}
	}
	return f, nil
}

// categoriesIn lists the references of a month by category id: a budget row
// that applies, else the average when there is one. No month before the
// account's first booked month has any.
func (f budgetFacts) categoriesIn(month string) []refCategory {
	out := []refCategory{}
	if f.first == "" || month < f.first[:7] {
		return out
	}
	ids := map[int64]bool{}
	for id := range f.average {
		ids[id] = true
	}
	for _, b := range f.budgets {
		ids[b.Category] = true
	}
	for _, id := range slices.Sorted(maps.Keys(ids)) {
		if amount, ok := planning.BudgetFor(f.budgets, id, month); ok {
			out = append(out, refCategory{CategoryID: id, Reference: amount, Source: "budget"})
		} else if avg := f.average[id]; avg > 0 {
			out = append(out, refCategory{CategoryID: id, Reference: avg, Source: "average"})
		}
	}
	return out
}

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
	facts := make(map[int64]budgetFacts, len(rep.Accounts))
	for _, id := range rep.Accounts {
		if facts[id], err = s.loadBudgetFacts(ctx, viewer, id, today); err != nil {
			s.fail(w, r, err, msgAccountNotFound)
			return
		}
	}
	out := refAnswer{Months: make([]refMonth, len(rep.Months))}
	for i, m := range rep.Months {
		rm := refMonth{Month: m.Month, Accounts: make([]refAccount, len(rep.Accounts))}
		for j, id := range rep.Accounts {
			rm.Accounts[j] = refAccount{ID: id, Categories: facts[id].categoriesIn(m.Month)}
		}
		out.Months[i] = rm
	}
	writeJSON(w, http.StatusOK, out)
}
