package ledger_test

import (
	"context"
	"maps"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// sumRanges adds day reports into one ReportTotals and drops the zero entries,
// as a month is pruned once over its days.
func sumRanges(parts []ledger.ReportTotals, detail bool) ledger.ReportTotals {
	out := ledger.ReportTotals{Expenses: map[string]int64{}}
	if detail {
		out.Detail = &ledger.ReportDetail{Income: map[string]int64{}, Saved: map[string]int64{}, Expenses: map[string]map[string]int64{}}
	}
	for _, p := range parts {
		out.Income += p.Income
		out.Saved += p.Saved
		for k, v := range p.Expenses {
			out.Expenses[k] += v
		}
		if detail {
			for k, v := range p.Detail.Income {
				out.Detail.Income[k] += v
			}
			for k, v := range p.Detail.Saved {
				out.Detail.Saved[k] += v
			}
			for k, own := range p.Detail.Expenses {
				if out.Detail.Expenses[k] == nil {
					out.Detail.Expenses[k] = map[string]int64{}
				}
				for id, v := range own {
					out.Detail.Expenses[k][id] += v
				}
			}
		}
	}
	live := func(m map[string]int64) {
		maps.DeleteFunc(m, func(_ string, v int64) bool { return v == 0 })
	}
	live(out.Expenses)
	if detail {
		live(out.Detail.Income)
		live(out.Detail.Saved)
		for k, own := range out.Detail.Expenses {
			if live(own); len(own) == 0 {
				delete(out.Detail.Expenses, k)
			}
		}
	}
	return out
}

func equalTotals(a, b ledger.ReportTotals) bool {
	if a.Income != b.Income || a.Saved != b.Saved || !maps.Equal(a.Expenses, b.Expenses) || (a.Detail == nil) != (b.Detail == nil) {
		return false
	}
	if a.Detail == nil {
		return true
	}
	if !maps.Equal(a.Detail.Income, b.Detail.Income) || !maps.Equal(a.Detail.Saved, b.Detail.Saved) || len(a.Detail.Expenses) != len(b.Detail.Expenses) {
		return false
	}
	for k, own := range a.Detail.Expenses {
		if !maps.Equal(own, b.Detail.Expenses[k]) {
			return false
		}
	}
	return true
}

// TestReportRangeDaysEqualMonths: on the demo, for every month of the history,
// every scope and each of the viewer's accounts, with and without detail, the
// month as one range and the sum of its days one by one both equal the month
// of ReportMonths. The range is the months' statement, not a copy of it.
func TestReportRangeDaysEqualMonths(t *testing.T) {
	ctx := context.Background()
	_, s := seeded(t)
	type sel struct {
		viewer  int64
		scope   string
		account int64
	}
	sels := []sel{{bert, "alles", 0}, {bert, "persoonlijk", 0}, {bert, "gedeeld", 0}, {bert, "", 1}, {bert, "", 4}, {partner, "alles", 0}}
	for _, detail := range []bool{false, true} {
		for _, c := range sels {
			rep, err := s.ReportMonths(ctx, c.viewer, ledger.ReportQuery{Scope: c.scope, AccountID: c.account, Now: demoNow, Detail: detail})
			if err != nil {
				t.Fatal(err)
			}
			if len(rep.Months) < 13 {
				t.Fatalf("%+v: %d months", c, len(rep.Months))
			}
			for _, m := range rep.Months {
				first, _ := time.Parse("2006-01", m.Month)
				last := first.AddDate(0, 1, -1)
				whole, err := s.ReportRange(ctx, c.viewer, c.scope, c.account, first.Format(time.DateOnly), last.Format(time.DateOnly), detail)
				if err != nil {
					t.Fatal(err)
				}
				if !equalTotals(whole.ReportTotals, m.ReportTotals) {
					t.Errorf("%+v detail %v %s: range %+v, month %+v", c, detail, m.Month, whole.ReportTotals, m.ReportTotals)
				}
				if *whole.FirstDate != *rep.FirstDate || !slicesEqual(whole.Accounts, rep.Accounts) {
					t.Errorf("%+v %s: first %s accounts %v, months %s %v", c, m.Month, *whole.FirstDate, whole.Accounts, *rep.FirstDate, rep.Accounts)
				}
				// Days one by one, for the selections of a scope (an account alone is a month above).
				if c.account != 0 {
					continue
				}
				var days []ledger.ReportTotals
				for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
					day, err := s.ReportRange(ctx, c.viewer, c.scope, c.account, d.Format(time.DateOnly), d.Format(time.DateOnly), detail)
					if err != nil {
						t.Fatal(err)
					}
					days = append(days, day.ReportTotals)
				}
				if got := sumRanges(days, detail); !equalTotals(got, m.ReportTotals) {
					t.Errorf("%+v %s: sum of days %+v, month %+v", c, m.Month, got, m.ReportTotals)
				}
			}
		}
	}
}

func slicesEqual(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestReportRangeAcrossMonthEnd: a week crossing a month end is the sum of its
// two pieces, each the same as the days in their own months.
func TestReportRangeAcrossMonthEnd(t *testing.T) {
	ctx := context.Background()
	_, s := seeded(t)
	// ISO week 44 of 2026: Monday 26 October to Sunday 1 November.
	week, err := s.ReportRange(ctx, bert, "alles", 0, "2026-10-26", "2026-11-01", true)
	if err != nil {
		t.Fatal(err)
	}
	oct, _ := s.ReportRange(ctx, bert, "alles", 0, "2026-10-26", "2026-10-31", true)
	nov, _ := s.ReportRange(ctx, bert, "alles", 0, "2026-11-01", "2026-11-01", true)
	if got := sumRanges([]ledger.ReportTotals{oct.ReportTotals, nov.ReportTotals}, true); !equalTotals(got, week.ReportTotals) {
		t.Errorf("week %+v, pieces %+v", week.ReportTotals, got)
	}
	if week.Income == 0 && len(week.Expenses) == 0 {
		t.Errorf("week 44 holds nothing: %+v", week)
	}
}

// TestReportRangeRule: the oracle world of plan 0.7-1 through a range. A
// transfer whose two sides are both in the selection stays out (r9/r10 in
// January), a split row counts by its parts (r14 in Persoonlijk is toShared
// 12000 whole; s7 is 3000 Overig and 6000 saved), and the 3-day window of a
// first booked row holds in a range as in a month.
func TestReportRangeRule(t *testing.T) {
	ctx := context.Background()
	_, s, _ := reportWorld(t)
	at := func(scope string, account int64, from, to string) ledger.RangeReport {
		t.Helper()
		r, err := s.ReportRange(ctx, bert, scope, account, from, to, true)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	// r9 Zicht -> Tweede 30000 on 2026-01-12: out in Alles (both in the selection), toOwn with Zicht alone.
	if r := at("alles", 0, "2026-01-12", "2026-01-12"); r.Income != 0 || len(r.Expenses) != 0 {
		t.Errorf("internal transfer in Alles: %+v", r.ReportTotals)
	}
	if r := at("", rwZicht, "2026-01-12", "2026-01-12"); r.Expenses["toOwn"] != 30000 {
		t.Errorf("Zicht alone: %+v", r.ReportTotals)
	}
	// s7 on 2026-04-08, split Sparen -6000 and Overig -3000.
	if r := at("alles", 0, "2026-04-08", "2026-04-08"); r.Saved != 6000 || !maps.Equal(r.Expenses, map[string]int64{"6": 3000}) ||
		r.Detail.Saved["26"] != 6000 || r.Detail.Expenses["6"]["6"] != 3000 {
		t.Errorf("split s7: %+v %+v", r.ReportTotals, r.Detail)
	}
	// r14 on 2026-01-22, Zicht -> Gedeeld split Wonen/Overig: a transfer, so its parts go to toShared in Persoonlijk.
	if r := at("persoonlijk", 0, "2026-01-22", "2026-01-22"); !maps.Equal(r.Expenses, map[string]int64{"toShared": 12000}) {
		t.Errorf("split transfer r14: %+v", r.ReportTotals)
	}
	// The 3-day window: r25 (2025-10-29) is internal in Alles, r26 (2025-10-28) a flow.
	if r := at("alles", 0, "2025-10-28", "2025-10-29"); !maps.Equal(r.Expenses, map[string]int64{"toShared": 4700}) {
		t.Errorf("window: %+v", r.ReportTotals)
	}
	// A pending row counts nowhere (r27, 2025-09-15).
	if r := at("alles", 0, "2025-09-15", "2025-09-15"); r.Income != 0 || len(r.Expenses) != 0 {
		t.Errorf("pending: %+v", r.ReportTotals)
	}
}

func TestReportRangeErrors(t *testing.T) {
	ctx := context.Background()
	_, s, _ := reportWorld(t)
	for _, c := range []struct{ from, to, want string }{
		{"2026-01-1", "2026-01-31", "Kies een datum als JJJJ-MM-DD."},
		{"2026-02-30", "2026-03-01", "Kies een datum als JJJJ-MM-DD."},
		{"2026-02-01", "2026-01-31", "De begindatum ligt na de einddatum."},
		{"2024-01-01", "2024-12-31" + "x", "Kies een datum als JJJJ-MM-DD."},
		{"1976-01-31", "2026-01-01", "Kies een periode van hooguit 50 jaar."}, // 601 calendar months, as ReportMonths
		{"1976-01-01", "2026-01-01", "Kies een periode van hooguit 50 jaar."},
	} {
		if _, err := s.ReportRange(ctx, bert, "alles", 0, c.from, c.to, false); err == nil || err.Error() != apperr.Invalid(c.want).Error() {
			t.Errorf("%s..%s: %v, want %q", c.from, c.to, err, c.want)
		}
	}
	// A year (366 days in a leap year), more than a year, and 600 whole months (50 years) are allowed.
	for _, c := range [][2]string{{"2024-01-01", "2024-12-31"}, {"2025-01-01", "2026-01-02"}, {"1976-02-01", "2026-01-31"}} {
		if _, err := s.ReportRange(ctx, bert, "alles", 0, c[0], c[1], false); err != nil {
			t.Errorf("%s..%s: %v", c[0], c[1], err)
		}
	}
	// The selection's errors are the months route's.
	if _, err := s.ReportRange(ctx, bert, "", rwSpaar, "2026-01-01", "2026-01-31", false); err == nil || err.Error() != apperr.Invalid("Kies een betaalrekening.").Error() {
		t.Errorf("savings account: %v", err)
	}
	for _, id := range []int64{rwPartner, 999} {
		if _, err := s.ReportRange(ctx, bert, "", id, "2026-01-01", "2026-01-31", false); err != apperr.ErrNotFound {
			t.Errorf("account %d: %v", id, err)
		}
	}
	if _, err := s.ReportRange(ctx, bert, "iedereen", 0, "2026-01-01", "2026-01-31", false); err == nil {
		t.Error("unknown scope accepted")
	}
	// An empty selection: zeros, empty maps, no first date.
	r, err := s.ReportRange(ctx, partner, "", rwOud, "2026-01-01", "2026-01-31", true)
	if err != nil || r.FirstDate != nil || r.Income != 0 || r.Expenses == nil || r.Detail == nil {
		t.Errorf("no rows: %+v %v", r, err)
	}
}
