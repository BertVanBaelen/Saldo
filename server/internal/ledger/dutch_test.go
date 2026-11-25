package ledger

import "testing"

func TestEur0(t *testing.T) {
	for cents, want := range map[int64]string{0: "€ 0", 49: "€ 0", 50: "€ 1", 63493: "€ 635", 99999: "€ 1.000", -113403: "−€ 1.134", 123456789: "€ 1.234.568"} {
		if got := Eur0(cents); got != want {
			t.Errorf("Eur0(%d) = %q, want %q", cents, got, want)
		}
	}
}

func TestMonthLabel(t *testing.T) {
	for _, c := range []struct{ month, want string }{
		{"2026-11", "november"}, {"2027-10", "oktober"}, {"2027-11", "november 2027"}, {"2028-01", "januari 2028"},
	} {
		if got := MonthLabel(c.month, "2026-11"); got != c.want {
			t.Errorf("MonthLabel(%s) = %q, want %q", c.month, got, c.want)
		}
	}
}
