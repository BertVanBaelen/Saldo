package planning_test

import (
	"fmt"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

func TestHistoryMonths(t *testing.T) {
	all := map[string]bool{}
	for _, m := range []string{"2025-11", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"} {
		all[m] = true
	}
	gap := map[string]bool{"2026-09": true, "2026-11": true} // no booked row in October
	cases := []struct {
		name, first string
		booked      map[string]bool
		want        string
	}{
		{"W1 partial first month: n = 1", "2026-09-08", map[string]bool{"2026-09": true, "2026-10": true, "2026-11": true}, "[2026-10]"},
		{"first on the 1st counts", "2026-09-01", map[string]bool{"2026-09": true, "2026-10": true}, "[2026-09 2026-10]"},
		{"at most 6, running month never", "2025-11-03", all, "[2026-05 2026-06 2026-07 2026-08 2026-09 2026-10]"},
		{"gap month skipped", "2026-09-01", gap, "[2026-09]"},
		{"first in the running month", "2026-11-02", all, "[]"},
		{"no booked row ever", "", all, "[]"},
	}
	for _, c := range cases {
		if got := fmt.Sprint(planning.HistoryMonths(c.first, c.booked, fcToday)); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
}

func TestBudgetFor(t *testing.T) {
	a := func(v int64) *int64 { return &v }
	rows := []planning.FactBudget{
		{Category: 1, From: "2026-09", Amount: a(100)},
		{Category: 1, From: "2026-11", Amount: a(300)},
		{Category: 1, From: "2026-11", Amount: a(999)}, // tie: the first row wins
		{Category: 2, From: "2026-10", Amount: a(50)},
		{Category: 2, From: "2026-12", Amount: nil}, // NULL: the average from December
	}
	cases := []struct {
		cat   int64
		month string
		want  string
	}{
		{1, "2026-08", "0 false"},
		{1, "2026-09", "100 true"},
		{1, "2026-10", "100 true"},
		{1, "2026-11", "300 true"},
		{1, "2027-03", "300 true"},
		{2, "2026-11", "50 true"},
		{2, "2026-12", "0 false"},
		{3, "2026-11", "0 false"},
	}
	for _, c := range cases {
		amount, ok := planning.BudgetFor(rows, c.cat, c.month)
		if got := fmt.Sprint(amount, " ", ok); got != c.want {
			t.Errorf("BudgetFor(%d, %s) = %s, want %s", c.cat, c.month, got, c.want)
		}
	}
	if _, ok := planning.BudgetFor(nil, 1, "2026-11"); ok {
		t.Error("BudgetFor(nil) ok")
	}
}

// AverageOf rounds as the engine's average does: half away from zero, never below 0, nothing without months.
func TestAverageOf(t *testing.T) {
	for _, c := range []struct {
		sum  int64
		n    int
		want int64
	}{{100, 2, 50}, {101, 2, 51}, {10007, 6, 1668}, {-101, 2, 0}, {0, 3, 0}, {5, 0, 0}} {
		if got := planning.AverageOf(c.sum, c.n); got != c.want {
			t.Errorf("AverageOf(%d, %d) = %d, want %d", c.sum, c.n, got, c.want)
		}
	}
}
