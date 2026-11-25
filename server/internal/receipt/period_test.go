package receipt

import (
	"testing"
	"time"
)

func day(s string) time.Time {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestWeek(t *testing.T) {
	for _, c := range []struct {
		day, from, to, label string
		year, week           int
	}{
		// Every day of a week gives that week.
		{"2026-11-16", "2026-11-16", "2026-11-22", "Week 47 · 16–22 nov 2026", 2026, 47},
		{"2026-11-22", "2026-11-16", "2026-11-22", "Week 47 · 16–22 nov 2026", 2026, 47},
		// Across a month end.
		{"2026-10-28", "2026-10-26", "2026-11-01", "Week 44 · 26 okt – 1 nov 2026", 2026, 44},
		// 29 Dec 2025 is a Monday in week 1 of 2026 (the ISO week-year, not 2025).
		{"2025-12-29", "2025-12-29", "2026-01-04", "Week 1 · 29 dec 2025 – 4 jan 2026", 2026, 1},
		{"2026-01-04", "2025-12-29", "2026-01-04", "Week 1 · 29 dec 2025 – 4 jan 2026", 2026, 1},
		// 2026 has 53 weeks (1 Jan 2026 is a Thursday): week 53 runs into 2027.
		{"2026-12-31", "2026-12-28", "2027-01-03", "Week 53 · 28 dec 2026 – 3 jan 2027", 2026, 53},
		{"2027-01-03", "2026-12-28", "2027-01-03", "Week 53 · 28 dec 2026 – 3 jan 2027", 2026, 53},
		// 1 Jan 2027 is a Friday in week 53 of 2026; week 1 of 2027 starts on 4 Jan.
		{"2027-01-04", "2027-01-04", "2027-01-10", "Week 1 · 4–10 jan 2027", 2027, 1},
		// 29 February.
		{"2028-02-29", "2028-02-28", "2028-03-05", "Week 9 · 28 feb – 5 mrt 2028", 2028, 9},
	} {
		p := Week(day(c.day))
		if p.Kind != KindWeek || p.From != c.from || p.To != c.to || p.Label != c.label || p.ISOYear != c.year || p.ISOWeek != c.week {
			t.Errorf("Week(%s) = %+v", c.day, p)
		}
	}
	// The previous week of week 1 of 2026 is week 1 of 2025's last: week 1 of 2026 minus 7 days.
	if p := Week(day("2025-12-29")).Previous(); p.From != "2025-12-22" || p.To != "2025-12-28" || p.ISOYear != 2025 || p.ISOWeek != 52 {
		t.Errorf("previous of week 1: %+v", p)
	}
	if p := Week(day("2027-01-04")).Previous(); p.ISOYear != 2026 || p.ISOWeek != 53 {
		t.Errorf("previous of week 1 of 2027: %+v", p)
	}
}

func TestMonth(t *testing.T) {
	for _, c := range []struct{ day, from, to, label string }{
		{"2026-10-15", "2026-10-01", "2026-10-31", "Oktober 2026"},
		{"2028-02-29", "2028-02-01", "2028-02-29", "Februari 2028"},
		{"2027-02-10", "2027-02-01", "2027-02-28", "Februari 2027"},
		// The 1st falling on a Monday (1 March 2027): the month is not the week.
		{"2027-03-01", "2027-03-01", "2027-03-31", "Maart 2027"},
	} {
		p := Month(day(c.day))
		if p.Kind != KindMonth || p.From != c.from || p.To != c.to || p.Label != c.label || p.ISOWeek != 0 {
			t.Errorf("Month(%s) = %+v", c.day, p)
		}
	}
	if w := Week(day("2027-03-01")); w.From != "2027-03-01" || w.To != "2027-03-07" || w.Label != "Week 9 · 1–7 mrt 2027" {
		t.Errorf("week of Monday 1 March 2027: %+v", w)
	}
	if p := Month(day("2026-01-20")).Previous(); p.From != "2025-12-01" || p.To != "2025-12-31" || p.Label != "December 2025" {
		t.Errorf("previous of January: %+v", p)
	}
	if p := Month(day("2028-03-31")).Previous(); p.From != "2028-02-01" || p.To != "2028-02-29" {
		t.Errorf("previous of March 2028: %+v", p)
	}
}

func TestPeriodHistory(t *testing.T) {
	w := Week(day("2026-11-16"))
	// Running while today is on or before its Sunday, at 19:00 on the Sunday too.
	for today, want := range map[string]bool{"2026-11-18": true, "2026-11-22": true, "2026-11-23": false} {
		if w.Running(today) != want {
			t.Errorf("running on %s: %v", today, !want)
		}
	}
	// The history starts inside the period after its first day: partial ("vanaf"), no comparison.
	if got := w.PartialFrom("2026-11-19"); got != "2026-11-19" || w.Comparable("2026-11-19") {
		t.Errorf("first 19 Nov: partial %q comparable %v", got, w.Comparable("2026-11-19"))
	}
	if got := PartialLabel("2026-11-19"); got != "vanaf 19 nov" {
		t.Errorf("label %q", got)
	}
	// Starting on the Monday: not partial, but last week is outside the history.
	if w.PartialFrom("2026-11-16") != "" || w.Comparable("2026-11-16") {
		t.Error("first on the Monday")
	}
	// Starting on last week's Monday: comparable; on its Tuesday: last week is partial, so not.
	if !w.Comparable("2026-11-09") || w.Comparable("2026-11-10") {
		t.Error("comparison against last week")
	}
	// No history, and a history that starts after the period.
	if w.Comparable("") || w.PartialFrom("") != "" || w.PartialFrom("2026-11-23") != "" {
		t.Error("no history in the period")
	}
}

func TestQuarter(t *testing.T) {
	for _, c := range []struct{ day, from, to, label string }{
		{"2026-08-15", "2026-07-01", "2026-09-30", "3e kwartaal 2026 · jul–sep"},
		{"2026-07-01", "2026-07-01", "2026-09-30", "3e kwartaal 2026 · jul–sep"},
		{"2026-10-01", "2026-10-01", "2026-12-31", "4e kwartaal 2026 · okt–dec"},
		{"2026-12-31", "2026-10-01", "2026-12-31", "4e kwartaal 2026 · okt–dec"},
		{"2026-05-31", "2026-04-01", "2026-06-30", "2e kwartaal 2026 · apr–jun"},
		// 3 Jan 2027 is in ISO week 53 of 2026: irrelevant, the quarter is the calendar's.
		{"2027-01-03", "2027-01-01", "2027-03-31", "1e kwartaal 2027 · jan–mrt"},
		// A leap year: the first quarter holds 29 February.
		{"2028-02-29", "2028-01-01", "2028-03-31", "1e kwartaal 2028 · jan–mrt"},
		// The 1st on a Monday (1 March 2027) changes nothing.
		{"2027-03-01", "2027-01-01", "2027-03-31", "1e kwartaal 2027 · jan–mrt"},
	} {
		p := Quarter(day(c.day))
		if p.Kind != KindQuarter || p.From != c.from || p.To != c.to || p.Label != c.label || p.ISOWeek != 0 || p.ISOYear != 0 {
			t.Errorf("Quarter(%s) = %+v", c.day, p)
		}
	}
	// Previous across a year end, and within a year.
	if p := Quarter(day("2027-02-10")).Previous(); p.Kind != KindQuarter || p.From != "2026-10-01" || p.To != "2026-12-31" || p.Label != "4e kwartaal 2026 · okt–dec" {
		t.Errorf("previous of Q1 2027: %+v", p)
	}
	if p := Quarter(day("2028-04-01")).Previous(); p.From != "2028-01-01" || p.To != "2028-03-31" {
		t.Errorf("previous of Q2 2028: %+v", p)
	}
}

func TestYear(t *testing.T) {
	for _, c := range []struct{ day, from, to, label string }{
		{"2026-11-18", "2026-01-01", "2026-12-31", "Jaar 2026"},
		{"2026-01-01", "2026-01-01", "2026-12-31", "Jaar 2026"},
		// 29 Dec 2025 is in ISO week 1 of 2026: irrelevant, the year is the calendar's.
		{"2025-12-29", "2025-01-01", "2025-12-31", "Jaar 2025"},
		{"2028-02-29", "2028-01-01", "2028-12-31", "Jaar 2028"},
	} {
		p := Year(day(c.day))
		if p.Kind != KindYear || p.From != c.from || p.To != c.to || p.Label != c.label || p.ISOWeek != 0 {
			t.Errorf("Year(%s) = %+v", c.day, p)
		}
	}
	if p := Year(day("2029-06-01")).Previous(); p.Kind != KindYear || p.From != "2028-01-01" || p.To != "2028-12-31" || p.Label != "Jaar 2028" {
		t.Errorf("previous of 2029: %+v", p)
	}
	// A partial first year says where it starts; the other kinds keep their label.
	if got := Year(day("2025-06-01")).LabelFrom("2025-11-01"); got != "Jaar 2025 · vanaf 1 nov" {
		t.Errorf("partial year %q", got)
	}
	for _, p := range []Period{Year(day("2025-06-01")), Quarter(day("2025-11-01")), Month(day("2025-11-01")), Week(day("2025-11-01")), Custom(day("2025-10-01"), day("2025-12-01"))} {
		if p.LabelFrom("") != p.Label || (p.Kind != KindYear && p.LabelFrom("2025-11-01") != p.Label) {
			t.Errorf("LabelFrom of %s: %q", p.Kind, p.LabelFrom("2025-11-01"))
		}
	}
}

func TestCustom(t *testing.T) {
	for _, c := range []struct{ from, to, wantFrom, wantTo, label, prevFrom, prevTo, prevLabel string }{
		// One month: Month's label; the previous range is the month before.
		{"2026-10-05", "2026-10-20", "2026-10-01", "2026-10-31", "Oktober 2026", "2026-09-01", "2026-09-30", "September 2026"},
		// Within a year; its previous range of six months runs across a year end.
		{"2026-05-20", "2026-10-03", "2026-05-01", "2026-10-31", "Mei – oktober 2026", "2025-11-01", "2026-04-30", "Nov 2025 – apr 2026"},
		// Across years, twelve months (more than 366 days with the previous range).
		{"2025-11-30", "2026-10-01", "2025-11-01", "2026-10-31", "Nov 2025 – okt 2026", "2024-11-01", "2025-10-31", "Nov 2024 – okt 2025"},
		// A leap February at the end; the previous range is November and December.
		{"2028-01-31", "2028-02-29", "2028-01-01", "2028-02-29", "Januari – februari 2028", "2027-11-01", "2027-12-31", "November – december 2027"},
		// The 1st on a Monday (1 March 2027).
		{"2027-03-01", "2027-03-01", "2027-03-01", "2027-03-31", "Maart 2027", "2027-02-01", "2027-02-28", "Februari 2027"},
	} {
		p := Custom(day(c.from), day(c.to))
		if p.Kind != KindCustom || p.From != c.wantFrom || p.To != c.wantTo || p.Label != c.label || p.ISOWeek != 0 {
			t.Errorf("Custom(%s, %s) = %+v", c.from, c.to, p)
		}
		if pp := p.Previous(); pp.Kind != KindCustom || pp.From != c.prevFrom || pp.To != c.prevTo || pp.Label != c.prevLabel || pp.monthsIn() != p.monthsIn() {
			t.Errorf("previous of %s: %+v", p.Label, pp)
		}
	}
	// 600 months: the previous range is as long and ends the day before.
	long := Custom(day("1976-02-01"), day("2026-01-31"))
	if pp := long.Previous(); long.monthsIn() != 600 || pp.From != "1926-02-01" || pp.To != "1976-01-31" || pp.Label != "Feb 1926 – jan 1976" {
		t.Errorf("600 months: %d, previous %+v", long.monthsIn(), pp)
	}
}

// The comparison rules on the demo's history, which starts Saturday 1 November
// 2025: what Running, PartialFrom and Comparable give for the longer kinds.
func TestLongerPeriodHistory(t *testing.T) {
	const first, today = "2025-11-01", "2026-11-18"
	for _, c := range []struct {
		p                   Period
		partial             string
		comparable, running bool
	}{
		{Year(day("2025-01-01")), "2025-11-01", false, false}, // partial first year
		{Year(day("2026-01-01")), "", false, true},            // 2025 starts before the history
		{Year(day("2027-01-01")), "", true, true},
		{Quarter(day("2025-10-01")), "2025-11-01", false, false}, // partial first quarter
		{Quarter(day("2026-01-01")), "", false, false},           // Q4 2025 starts before the history
		{Quarter(day("2026-04-01")), "", true, false},
		{Quarter(day("2026-11-18")), "", true, true}, // running, compares with Q3
		{Custom(day("2025-11-01"), day("2026-01-31")), "", false, false},
		{Custom(day("2026-02-01"), day("2026-04-30")), "", true, false},
		{Custom(day("2025-08-01"), day("2026-11-30")), "2025-11-01", false, true},
		{Custom(day("2026-09-01"), day("2026-12-31")), "", true, true},
	} {
		if got := c.p.PartialFrom(first); got != c.partial || c.p.Comparable(first) != c.comparable || c.p.Running(today) != c.running {
			t.Errorf("%s: partial %q comparable %v running %v", c.p.Label, got, c.p.Comparable(first), c.p.Running(today))
		}
	}
}
