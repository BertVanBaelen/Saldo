package planning_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

func fcPoints(p []planning.Point) string {
	var b []string
	for _, x := range p {
		b = append(b, fmt.Sprintf("%s %d", x.Date, x.Balance))
	}
	return strings.Join(b, ", ")
}

// TestPastBalances pins rules 1 and 2 on hand-built rows.
func TestPastBalances(t *testing.T) {
	rows := []planning.DayAmount{{"2026-10-20", -500}, {"2026-11-03", -200}, {"2026-11-03", 50}, {"2026-11-10", 1000}, {"2026-11-20", -9999}}
	for _, c := range []struct {
		name, snapDate, from, first, want string
		rows                              []planning.DayAmount
	}{
		// snapshot 10000 on 2026-11-18: the rows up to it are already in it.
		{"days with rows only", "2026-11-18", "2026-11-01", "2026-01-01", "2026-10-31 9150, 2026-11-03 9000, 2026-11-10 10000", rows},
		{"no rows", "2026-11-18", "2026-11-01", "2026-01-01", "2026-10-31 10000", nil},
		{"a missing row shifts the past", "2026-11-18", "2026-11-01", "2026-01-01", "2026-10-31 9000, 2026-11-10 10000", rows[3:]},
		{"snapshot older than from", "2026-10-01", "2026-11-01", "2026-01-01", "2026-10-31 9500, 2026-11-03 9350, 2026-11-10 10350", rows},
		{"snapshot newer than from", "2026-11-18", "2026-10-01", "2026-01-01", "2026-09-30 9650, 2026-10-20 9150, 2026-11-03 9000, 2026-11-10 10000", rows},
		{"no line before the first booked row", "2026-11-18", "2026-10-01", "2026-11-03", "2026-11-03 9000, 2026-11-10 10000", rows},
		{"no booked row ever", "2026-11-18", "2026-11-01", "", "", nil},
	} {
		now := planning.BalanceOn(10000, c.snapDate, c.rows, fcToday)
		got := planning.FromFirstBooked(planning.PastBalances(now, c.rows, c.from, fcToday), c.first)
		fcCompare(t, c.name, fcPoints(got), c.want)
	}
}

// TestLoadHistory: the demo and planningWorld lines, and identity with
// Project's past days and the running month's Start.
func TestLoadHistory(t *testing.T) {
	ctx := context.Background()
	d := fcDemo(t)
	w := planningWorld(t)
	hist := func(db *sql.DB, account int64, from string) []planning.Point {
		t.Helper()
		h, err := planning.LoadHistory(ctx, db, account, from, fcToday)
		if err != nil {
			t.Fatal(err)
		}
		return h.Points
	}
	zicht := hist(d, 1, "2026-11-01")
	fcCompare(t, "zicht nov", fcPoints(zicht),
		"2026-10-31 102355, 2026-11-01 -43145, 2026-11-02 241855, 2026-11-08 236615, 2026-11-12 235216, 2026-11-13 233381, 2026-11-14 227131, 2026-11-15 223281, 2026-11-16 205131, 2026-11-17 196882")
	shared := hist(d, 4, "2026-11-01")
	fcCompare(t, "shared nov first", fcPoints(shared[:3]), "2026-10-31 52927, 2026-11-01 142927, 2026-11-03 128427")
	fcCompare(t, "shared last", fmt.Sprint(shared[len(shared)-1].Balance), "94608")
	// W1: the 17 Nov row after the snapshot date (100000 on 16 Nov) counts.
	fcCompare(t, "W1 nov", fcPoints(hist(w.db, w.W1, "2026-11-01")), "2026-10-31 184000, 2026-11-01 104000, 2026-11-03 100000, 2026-11-17 98500")

	// Observed for the lead: the October line of the demo Zichtrekening.
	oct := hist(d, 1, "2026-10-01")
	low := oct[0]
	for _, p := range oct {
		if p.Date >= "2026-10-01" && p.Date <= "2026-10-31" && p.Balance < low.Balance {
			low = p
		}
	}
	under, i := 0, 0
	for day := 1; day <= 31; day++ {
		date := fmt.Sprintf("2026-10-%02d", day)
		for i+1 < len(oct) && oct[i+1].Date <= date {
			i++
		}
		if oct[i].Balance < 90000 {
			under++
		}
	}
	t.Logf("zicht October: first %v low %v under buffer %d days, points %d", oct[0], low, under, len(oct))

	// Identity: the running month's points equal Project's past days.
	for _, c := range []struct {
		db      *sql.DB
		account int64
	}{{d, 1}, {d, 4}, {w.db, w.W1}, {w.db, w.W2}} {
		f := fcForecast(t, c.db, c.account, fcToday, 3)
		pts := hist(c.db, c.account, "2026-11-01")
		if pts[0].Date != "2026-10-31" || pts[0].Balance != f.Months[0].Start {
			t.Errorf("account %d: first %v, Start %d", c.account, pts[0], f.Months[0].Start)
		}
		for _, p := range pts[1:] {
			n := 0
			fmt.Sscanf(p.Date[8:], "%d", &n)
			if got := f.Days["2026-11"][n-1].Balance; got != p.Balance {
				t.Errorf("account %d %s: history %d, Project %d", c.account, p.Date, p.Balance, got)
			}
		}
	}

	if _, err := planning.LoadHistory(ctx, w.db, w.W3, "2026-11-01", fcToday); !errors.Is(err, planning.ErrNoBalance) {
		t.Errorf("W3: %v, want ErrNoBalance", err)
	}
}
