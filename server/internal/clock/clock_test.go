package clock

import (
	"testing"
	"time"
)

func TestOverrideKeepsTimeOfDay(t *testing.T) {
	c, err := New("2026-11-18")
	if err != nil {
		t.Fatal(err)
	}
	if got := c.Today(); got != "2026-11-18" {
		t.Errorf("Today() = %s", got)
	}
	if c.Now().Location() != Brussels {
		t.Errorf("Now() is not in Brussels")
	}
	if _, err := New("18/11/2026"); err == nil {
		t.Error("want an error for a bad date")
	}
}

func TestFixedAndBrusselsDate(t *testing.T) {
	// 23:30 UTC on 30 November is already 1 December in Brussels.
	c := Fixed(time.Date(2026, 11, 30, 23, 30, 0, 0, time.UTC))
	if got := c.Today(); got != "2026-12-01" {
		t.Errorf("Today() = %s, want 2026-12-01", got)
	}
}

func TestDaysBetween(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"2026-11-18", "2026-11-30", 12},
		{"2026-11-18", "2026-12-02", 14},
		{"2026-11-18", "2026-11-18", 0},
		{"2026-11-18", "2026-11-10", -8},
		{"2026-03-28", "2026-03-30", 2}, // across the DST change
	}
	for _, tt := range tests {
		got, err := DaysBetween(tt.a, tt.b)
		if err != nil || got != tt.want {
			t.Errorf("DaysBetween(%s, %s) = %d, %v; want %d", tt.a, tt.b, got, err, tt.want)
		}
	}
}
