package mail

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// nb turns the "~" of a test string into a no-break space, so the expected
// texts stay readable.
func nb(s string) string { return strings.ReplaceAll(s, "~", nbsp) }

func TestMoneyIsDutchWithNoBreakSpaces(t *testing.T) {
	for _, c := range []struct {
		cents              int64
		euro, amount, auto string
	}{
		{103347, "€~1.033,47", "1.033,47", "€~1.033,47"},
		{-103347, "−€~1.033,47", "−1.033,47", "−€~1.033,47"},
		{0, "€~0,00", "0,00", "€~0"},
		{5, "€~0,05", "0,05", "€~0,05"},
		{-5, "−€~0,05", "−0,05", "−€~0,05"},
		{43600, "€~436,00", "436,00", "€~436"},
		{-200000, "−€~2.000,00", "−2.000,00", "−€~2.000"},
		{123456789, "€~1.234.567,89", "1.234.567,89", "€~1.234.567,89"},
		{100000000, "€~1.000.000,00", "1.000.000,00", "€~1.000.000"},
		{99900, "€~999,00", "999,00", "€~999"},
	} {
		if got := euro(c.cents); got != nb(c.euro) {
			t.Errorf("euro(%d) = %q, want %q", c.cents, got, nb(c.euro))
		}
		if got := amount(c.cents); got != c.amount {
			t.Errorf("amount(%d) = %q, want %q", c.cents, got, c.amount)
		}
		if got := euroAuto(c.cents); got != nb(c.auto) {
			t.Errorf("euroAuto(%d) = %q, want %q", c.cents, got, nb(c.auto))
		}
	}
	// The U+2212 minus, never a hyphen; no ordinary space after the symbol.
	if s := euro(-100); strings.Contains(s, "-") || strings.Contains(s, "€ ") {
		t.Errorf("euro(-100) = %q uses a hyphen or a breaking space", s)
	}
	// The most negative amount must not overflow.
	if s := euro(math.MinInt64); !strings.HasPrefix(s, minus+"€") {
		t.Errorf("euro(MinInt64) = %q", s)
	}
}

func TestDutchNamesAndDates(t *testing.T) {
	for in, want := range map[string]string{
		"Partner": "Partners", "Bert": "Berts", "Anna": "Anna's", "Marie": "Maries", "Thomas": "Thomas'",
		"Max": "Max'", "Liz": "Liz'", "Joy": "Joy's", "": "", "Bert\r\nBcc: ab": "Bert Bcc: abs",
	} {
		if got := possessive(in); got != want {
			t.Errorf("possessive(%q) = %q, want %q", in, got, want)
		}
	}
	if monthName(time.February) != "februari" || monthName(0) != "" || monthName(13) != "" {
		t.Error("monthName")
	}
	sunday := time.Date(2026, 11, 22, 19, 0, 0, 0, clock.Brussels)
	if got := StandLine(sunday); got != "Stand zondag 22 nov, 19:00" {
		t.Errorf("StandLine = %q", got)
	}
	// The line is the Brussels time whatever zone the instant arrives in.
	if got := StandLine(sunday.UTC()); got != "Stand zondag 22 nov, 19:00" {
		t.Errorf("StandLine(UTC) = %q", got)
	}
}

func TestSoftBreakOnlyTouchesLongRuns(t *testing.T) {
	if got := softBreak("Gedeelde rekening van Bert en Partner", 16); got != "Gedeelde rekening van Bert en Partner" {
		t.Errorf("normal text changed: %q", got)
	}
	long := strings.Repeat("a", 50)
	got := softBreak("x "+long+" y", 16)
	if strings.ReplaceAll(got, zwsp, "") != "x "+long+" y" {
		t.Error("softBreak lost characters")
	}
	for _, tok := range strings.FieldsFunc(got, func(r rune) bool { return r == ' ' || r == '​' }) {
		if len([]rune(tok)) > 16 {
			t.Errorf("run of %d runes left", len([]rune(tok)))
		}
	}
	// An existing break opportunity restarts the count.
	if got := softBreak(strings.Repeat("b", 10)+zwsp+strings.Repeat("b", 10), 16); strings.Count(got, zwsp) != 1 {
		t.Errorf("added a break where one existed: %q", got)
	}
}

func TestTrendAndBudgetText(t *testing.T) {
	for _, c := range []struct {
		in   OverviewTrend
		want string
	}{
		{OverviewTrend{"up", 12}, "+12~%"}, {OverviewTrend{"down", -7}, "−7~%"}, {OverviewTrend{"flat", 0}, "=~0~%"},
		{OverviewTrend{"flat", 3}, "+3~%"}, {OverviewTrend{"flat", -4}, "−4~%"}, {OverviewTrend{"new", 0}, "nieuw"},
		{OverviewTrend{"new", 100}, "nieuw"}, {OverviewTrend{}, ""},
	} {
		if got := trendText(c.in); got != nb(c.want) {
			t.Errorf("trendText(%+v) = %q, want %q", c.in, got, nb(c.want))
		}
	}
	if got := budgetText(OverviewBudget{"budget", 55000, 117}); got != nb("budget 550,00 · 117~%") {
		t.Errorf("budget line %q", got)
	}
	if got := budgetText(OverviewBudget{"average", 52000, 54}); got != nb("gemiddeld 520,00 · 54~%") {
		t.Errorf("average line %q", got)
	}
	if got := budgetText(OverviewBudget{"mixed", 52000, 54}); got != nb("budget en gemiddelde 520,00 · 54~%") {
		t.Errorf("mixed line %q", got)
	}
}
