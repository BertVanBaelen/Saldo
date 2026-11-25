// Package receipt builds the overview receipt of a week, a month, a quarter,
// a year or a custom range of months (plan 0.9-3c):
// one model of what came in and went out in a period, built once in Go so the
// e-mail of 0.9-3e and the page of 0.9-3d show the same numbers. It reads the
// report rule of ledger and the budget reference of planning; neither imports
// it.
package receipt

import (
	"fmt"
	"strings"
	"time"
)

// The Dutch short names of the web's format.ts (MONTHS_SHORT, DAYS_SHORT) and
// of mail.dutchTime. They are local because ledger/dutch.go and mail belong to
// other steps of this wave; a later step may merge them into ledger/dutch.go.
var (
	shortMonths = [...]string{"jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"}
	shortDays   = [...]string{"zo", "ma", "di", "wo", "do", "vr", "za"}
	months      = [...]string{"Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli",
		"Augustus", "September", "Oktober", "November", "December"}
)

// Period kinds, as the route's periode takes them (Overzicht's Maand,
// Kwartaal, Jaar and Eigen, and the week of the notifications).
const (
	KindWeek    = "week"
	KindMonth   = "maand"
	KindQuarter = "kwartaal"
	KindYear    = "jaar"
	KindCustom  = "eigen"
)

// Period is one ISO week (Monday to Sunday), one calendar month, quarter or
// year, or a custom range of whole months, as Brussels dates. ISOYear and
// ISOWeek are set for weeks only: around New Year a week belongs to the ISO
// week-year, not to the year of its Monday.
type Period struct {
	Kind     string
	From, To string // YYYY-MM-DD, both inclusive
	Label    string // "Week 47 · 16–22 nov 2026", "Oktober 2026", "3e kwartaal 2026 · jul–sep", "Jaar 2026", "Mei – oktober 2026"
	ISOYear  int
	ISOWeek  int
}

// civil is the calendar date of t, at midnight UTC, so date arithmetic never
// meets a daylight-saving hour. The caller passes a Brussels date.
func civil(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// Week is the ISO week holding day.
func Week(day time.Time) Period {
	d := civil(day)
	mon := d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
	sun := mon.AddDate(0, 0, 6)
	year, week := mon.ISOWeek()
	return Period{Kind: KindWeek, From: mon.Format(time.DateOnly), To: sun.Format(time.DateOnly),
		Label: fmt.Sprintf("Week %d · %s", week, span(mon, sun)), ISOYear: year, ISOWeek: week}
}

// Month is the calendar month holding day.
func Month(day time.Time) Period {
	d := civil(day)
	first := time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1)
	return Period{Kind: KindMonth, From: first.Format(time.DateOnly), To: last.Format(time.DateOnly),
		Label: fmt.Sprintf("%s %d", months[d.Month()-1], d.Year())}
}

// Quarter is the calendar quarter holding day (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec).
func Quarter(day time.Time) Period {
	d := civil(day)
	q := (int(d.Month()) - 1) / 3
	first := time.Date(d.Year(), time.Month(q*3+1), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 3, -1)
	return Period{Kind: KindQuarter, From: first.Format(time.DateOnly), To: last.Format(time.DateOnly),
		Label: fmt.Sprintf("%de kwartaal %d · %s–%s", q+1, d.Year(), shortMonths[q*3], shortMonths[q*3+2])}
}

// Year is the calendar year holding day.
func Year(day time.Time) Period {
	y := civil(day).Year()
	return Period{Kind: KindYear, From: fmt.Sprintf("%d-01-01", y), To: fmt.Sprintf("%d-12-31", y),
		Label: fmt.Sprintf("Jaar %d", y)}
}

// Custom is the range of whole months from from's month to to's month (the
// 1st of the one to the last day of the other), Overzicht's Eigen. The
// caller checks that to is not before from. One month is labelled as Month
// labels it; the same year "Mei – oktober 2026", across years "Nov 2025 – okt 2026".
func Custom(from, to time.Time) Period {
	a, b := Month(from), Month(to)
	p := Period{Kind: KindCustom, From: a.From, To: b.To, Label: a.Label}
	fa, fb := civil(from), civil(to)
	switch {
	case fa.Year() != fb.Year():
		p.Label = fmt.Sprintf("%s %d – %s %d", capital(shortMonths[fa.Month()-1]), fa.Year(), shortMonths[fb.Month()-1], fb.Year())
	case fa.Month() != fb.Month():
		p.Label = fmt.Sprintf("%s – %s %d", months[fa.Month()-1], strings.ToLower(months[fb.Month()-1]), fb.Year())
	}
	return p
}

// capital is s with its first letter upper case ("nov" → "Nov"; ASCII month names).
func capital(s string) string { return strings.ToUpper(s[:1]) + s[1:] }

// monthsIn is the number of calendar months from p.From's to p.To's, both counted.
func (p Period) monthsIn() int {
	a, _ := time.Parse(time.DateOnly, p.From)
	b, _ := time.Parse(time.DateOnly, p.To)
	return (b.Year()-a.Year())*12 + int(b.Month()-a.Month()) + 1
}

// span is "16–22 nov 2026", "26 okt – 1 nov 2026" or "29 dec 2025 – 4 jan 2026":
// the year once, the month once when both ends share it.
func span(a, b time.Time) string {
	switch {
	case a.Year() != b.Year():
		return fmt.Sprintf("%s %d – %s %d", dayMonth(a), a.Year(), dayMonth(b), b.Year())
	case a.Month() != b.Month():
		return fmt.Sprintf("%s – %s %d", dayMonth(a), dayMonth(b), b.Year())
	}
	return fmt.Sprintf("%d–%d %s %d", a.Day(), b.Day(), shortMonths[b.Month()-1], b.Year())
}

// dayMonth is "16 nov" (format.ts dateShort).
func dayMonth(t time.Time) string { return fmt.Sprintf("%d %s", t.Day(), shortMonths[t.Month()-1]) }

// dateShort is dayMonth of a YYYY-MM-DD date; dayShort adds the weekday ("ma 16 nov").
func dateShort(date string) string {
	t, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return date
	}
	return dayMonth(t)
}

func dayShort(date string) string {
	t, err := time.Parse(time.DateOnly, date)
	if err != nil {
		return date
	}
	return shortDays[t.Weekday()] + " " + dayMonth(t)
}

// Previous is the period of the same kind just before p: last week, month,
// quarter or calendar year; for a custom range the range of as many whole
// months that ends the day before it starts.
func (p Period) Previous() Period {
	from, _ := time.Parse(time.DateOnly, p.From)
	switch p.Kind {
	case KindWeek:
		return Week(from.AddDate(0, 0, -7))
	case KindQuarter:
		return Quarter(from.AddDate(0, 0, -1))
	case KindYear:
		return Year(from.AddDate(0, 0, -1))
	case KindCustom:
		return Custom(from.AddDate(0, -p.monthsIn(), 0), from.AddDate(0, 0, -1))
	}
	return Month(from.AddDate(0, 0, -1))
}

// Running says the period is not over: its last day is today (Brussels) or
// later. At 19:00 on the Sunday or the month's last day it still is, and the
// bank sends that day's rows only the next morning.
func (p Period) Running(today string) bool { return p.To >= today }

// PartialFrom is first (the selection's first booked date) when the history
// starts inside the period after its first day: the "vanaf" period that the
// history only partly covers; "" otherwise.
func (p Period) PartialFrom(first string) string {
	if first > p.From && first <= p.To {
		return first
	}
	return ""
}

// PartialLabel is the head of a partial first period: "vanaf 19 nov".
func PartialLabel(first string) string { return "vanaf " + dateShort(first) }

// LabelFrom is the label of p when the history starts on partialFrom inside
// it (PartialFrom): a year that the history only partly covers is "Jaar 2025
// · vanaf 1 nov"; every other kind keeps its label (the partialFrom field and
// the note say it).
func (p Period) LabelFrom(partialFrom string) string {
	if p.Kind == KindYear && partialFrom != "" {
		return p.Label + " · " + PartialLabel(partialFrom)
	}
	return p.Label
}

// Comparable says the previous period lies wholly inside the history, the
// rule of monthBase in lib/reports.ts: no comparison with a period before the
// history or with a partial first one, which also leaves a partial current
// period without one.
func (p Period) Comparable(first string) bool {
	return first != "" && first <= p.Previous().From
}
