package planning

import (
	"context"
	"database/sql"
	"maps"
	"slices"
	"strconv"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// The budget reference of Overzicht (0.8.1-2): what a category's amount is
// read against, per account and month: the account's budget row (the one
// Planning uses), else a full-amount average of the account's history months,
// computed from the report's own rule (the per-account report's expense of
// that category, recurring items included), not the engine's variable-only
// average. It lives here, not in the server package, so GET
// /api/reports/budgets and the overview receipt (0.9-3c) read the same one.

// RefCategory is the reference of one category in one month (the wire shape
// of GET /api/reports/budgets).
type RefCategory struct {
	CategoryID int64  `json:"categoryId"`
	Reference  int64  `json:"reference"`
	Source     string `json:"source"` // budget | average
}

// BudgetReference holds one account's facts for its references.
type BudgetReference struct {
	first   string          // first booked row, "" without
	average map[int64]int64 // top category id -> full-amount average of the history months; only above 0
	budgets []FactBudget    // rows of valid categories, as the forecast reads them
}

// LoadBudgetReference reads the budget rows and the history months of one
// account (account-level, viewer-free) and the viewer's report of it over
// those months. The caller checks that the viewer holds the account; now is
// the report's clock, today its Brussels date.
func LoadBudgetReference(ctx context.Context, db *sql.DB, store *ledger.Store, viewer, account int64, today string, now time.Time) (BudgetReference, error) {
	f := BudgetReference{average: map[int64]int64{}}
	first, hist, err := LoadHistoryMonths(ctx, db, account, today)
	if err != nil {
		return f, err
	}
	f.first = first
	if f.budgets, err = LoadBudgets(ctx, db, account); err != nil {
		return f, err
	}
	if len(hist) == 0 {
		return f, nil
	}
	// The account alone, so every transfer of it is a flow, for the same viewer; the months in between
	// that hold no booked row are left out of the sum (as the engine leaves them out of its average).
	rep, err := store.ReportMonths(ctx, viewer, ledger.ReportQuery{AccountID: account, From: hist[0], To: hist[len(hist)-1], Now: now})
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
		if avg := AverageOf(sum, len(hist)); avg > 0 {
			f.average[id] = avg
		}
	}
	return f, nil
}

// In lists the references of a month by category id: a budget row that
// applies, else the average when there is one. No month before the account's
// first booked month has any. Never nil.
func (f BudgetReference) In(month string) []RefCategory {
	out := []RefCategory{}
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
		if amount, ok := BudgetFor(f.budgets, id, month); ok {
			out = append(out, RefCategory{CategoryID: id, Reference: amount, Source: "budget"})
		} else if avg := f.average[id]; avg > 0 {
			out = append(out, RefCategory{CategoryID: id, Reference: avg, Source: "average"})
		}
	}
	return out
}
