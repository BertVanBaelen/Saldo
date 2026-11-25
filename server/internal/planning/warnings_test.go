package planning_test

import (
	"slices"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// wnIndex is the index of a month in the forecast, -1 when absent.
func wnIndex(f planning.AccountForecast, month string) int {
	return slices.IndexFunc(f.Months, func(m planning.Month) bool { return m.Month == month })
}

// wnCheck checks the relations of planning.Warnings(f, look): the months lie
// inside the look-ahead and follow the month-end rule, the buffer warning
// comes before the red one, the red-from date starts the red run that ends
// the month, the low is the month's low and the cause is the month's largest
// outgoing recurring or planned item.
func wnCheck(t *testing.T, name string, f planning.AccountForecast, look int) planning.AccountWarnings {
	t.Helper()
	w := planning.Warnings(f, look)
	months := f.Months[:min(look+1, len(f.Months))]
	firstRed := slices.IndexFunc(months, func(m planning.Month) bool { return m.End < 0 })
	switch {
	case firstRed < 0 && w.Red != nil, firstRed >= 0 && (w.Red == nil || w.Red.Month != months[firstRed].Month):
		t.Errorf("%s look %d: red %+v, first red month index %d", name, look, w.Red, firstRed)
	}
	before := months
	if firstRed >= 0 {
		before = months[:firstRed]
	}
	firstBuf := slices.IndexFunc(before, func(m planning.Month) bool { return m.End < f.Buffer })
	switch {
	case firstBuf < 0 && w.Buffer != nil, firstBuf >= 0 && (w.Buffer == nil || w.Buffer.Month != before[firstBuf].Month):
		t.Errorf("%s look %d: buffer %+v, first buffer month index %d", name, look, w.Buffer, firstBuf)
	}
	if w.Red != nil && w.Buffer != nil && w.Buffer.Month >= w.Red.Month {
		t.Errorf("%s look %d: buffer %s not before red %s", name, look, w.Buffer.Month, w.Red.Month)
	}
	for _, x := range []*planning.Warning{w.Red, w.Buffer} {
		if x == nil {
			continue
		}
		m := f.Months[wnIndex(f, x.Month)]
		if x.End != m.End || x.Buffer != f.Buffer || x.UnderBuffer != f.Buffer-m.End || x.LowDate != m.Low.Date || x.LowBalance != m.Low.Balance {
			t.Errorf("%s look %d %s: %+v, month %+v", name, look, x.Month, *x, m)
		}
		days := f.Days[x.Month]
		for _, d := range days {
			if d.Balance < x.LowBalance {
				t.Errorf("%s %s: %s at %d is below the low %d", name, x.Month, d.Date, d.Balance, x.LowBalance)
			}
		}
		wnCause(t, name, x, days)
	}
	if w.Buffer != nil && w.Buffer.RedFrom != "" {
		t.Errorf("%s: a buffer warning with a red-from date %s", name, w.Buffer.RedFrom)
	}
	if r := w.Red; r != nil && len(f.Days[r.Month]) > 0 {
		days := f.Days[r.Month]
		i := slices.IndexFunc(days, func(d planning.Day) bool { return d.Date == r.RedFrom })
		if i < 0 {
			t.Fatalf("%s: red-from %q is not a day of %s", name, r.RedFrom, r.Month)
		}
		for _, d := range days[i:] {
			if d.Balance >= 0 {
				t.Errorf("%s: %s at %d is not red, after red-from %s", name, d.Date, d.Balance, r.RedFrom)
			}
		}
		if i > 0 && days[i-1].Balance < 0 {
			t.Errorf("%s: the day before red-from %s is red", name, r.RedFrom)
		}
		// The low is on or after red-from, or a day at or above 0 lies between them.
		if r.LowDate < r.RedFrom && days[i-1].Balance < 0 {
			t.Errorf("%s: low %s before red-from %s without a recovery", name, r.LowDate, r.RedFrom)
		}
	}
	return w
}

// wnCause checks the cause against the month's days: the parts of the cause
// add up to it, and no other recurring or planned item has a lower total.
func wnCause(t *testing.T, name string, x *planning.Warning, days []planning.Day) {
	t.Helper()
	type key struct {
		planned bool
		id      int64
	}
	totals := map[key]int64{}
	labels := map[key]string{}
	for _, d := range days {
		for _, it := range d.Items {
			if it.Kind == "recurring" || it.Kind == "late" || it.Kind == "planned" {
				k := key{it.Kind == "planned", it.ID}
				totals[k] += it.Amount
				labels[k] = it.Label
			}
		}
	}
	lowest := int64(0)
	for _, v := range totals {
		lowest = min(lowest, v)
	}
	c := x.Cause
	if lowest == 0 {
		if c != nil {
			t.Errorf("%s %s: a cause %+v in a month without outgoing items", name, x.Month, *c)
		}
		return
	}
	k := key{c != nil && c.Kind == "planned", 0}
	if c != nil {
		k.id = c.ID
	}
	if c == nil || c.Amount != lowest || totals[k] != c.Amount || labels[k] != c.Label || c.Kind == "late" {
		t.Errorf("%s %s: cause %+v, the lowest total is %d", name, x.Month, c, lowest)
	}
}

func TestWarningsDemo(t *testing.T) {
	d := fcDemo(t)
	f := fcForecast(t, d, 1, fcToday, 6)
	all := wnCheck(t, "demo", f, 6)
	if all.Red == nil || all.Red.Month != "2027-02" || all.Buffer == nil || all.Buffer.Month != "2027-01" {
		t.Fatalf("demo look 6: %+v %+v", all.Red, all.Buffer)
	}
	if all.Red.RedFrom != "2027-02-10" || all.Red.Cause == nil || all.Buffer.Cause == nil {
		t.Errorf("demo red: %+v, buffer %+v", *all.Red, *all.Buffer)
	}
	t.Logf("red %+v cause %+v; buffer %+v cause %+v", *all.Red, *all.Red.Cause, *all.Buffer, *all.Buffer.Cause)

	// look cuts the horizon: each warning of look 6 survives exactly when its month lies within look.
	for _, look := range []int{0, 1, 2, 3, 4, 5, 6} {
		w := wnCheck(t, "demo", f, look)
		for _, c := range []struct {
			name      string
			got, full *planning.Warning
		}{{"red", w.Red, all.Red}, {"buffer", w.Buffer, all.Buffer}} {
			if keep := wnIndex(f, c.full.Month) <= look; keep != (c.got != nil) || keep && c.got.Month != c.full.Month {
				t.Errorf("look %d %s: %+v", look, c.name, c.got)
			}
		}
	}
	if w := planning.Warnings(f, 1); w.Red != nil || w.Buffer != nil {
		t.Errorf("look 1: %+v", w)
	}
	if w := planning.Warnings(f, 3); w.Red == nil || w.Red.Month != "2027-02" || w.Buffer == nil || w.Buffer.Month != "2027-01" {
		t.Errorf("look 3: %+v", w)
	}

	// Partner's account and the shared account: whatever they give follows the relations.
	for _, id := range []int64{4, 5} {
		g := fcForecast(t, d, id, fcToday, 6)
		for _, look := range []int{1, 3, 6} {
			wnCheck(t, "demo account", g, look)
		}
	}
	// A higher buffer: November ends in the buffer.
	if _, err := d.Exec(`UPDATE accounts SET buffer = 150000 WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	h := fcForecast(t, d, 1, fcToday, 6)
	if w := wnCheck(t, "demo buffer 1500", h, 3); w.Buffer == nil || w.Buffer.Month != "2026-11" || w.Buffer.UnderBuffer != 150000-h.Months[0].End {
		t.Errorf("buffer 1500: %+v", w.Buffer)
	}
}

func TestWarningsWorld(t *testing.T) {
	w := planningWorld(t)
	f := fcForecast(t, w.db, w.W1, fcToday, 6)
	for _, look := range []int{1, 3, 6} {
		wnCheck(t, "world", f, look)
	}
	// A large one-off in January and a dayless one in February: W1 goes red
	// in January; the dayless one is spread over February, its parts add up.
	if _, err := w.db.Exec(`INSERT INTO planned_items (account_id, date, amount, description) VALUES (?, '2027-01-03', -400000, 'Auto')`, w.W1); err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Exec(`INSERT INTO planned_items (account_id, date, amount, description, whole_month) VALUES (?, '2027-02-01', -280000, 'Verbouwing', 1)`, w.W1); err != nil {
		t.Fatal(err)
	}
	f = fcForecast(t, w.db, w.W1, fcToday, 6)
	got := wnCheck(t, "world red", f, 6)
	if got.Red == nil || got.Red.Month != "2027-01" || got.Red.Cause == nil || got.Red.Cause.Label != "Auto" || got.Red.Cause.Amount != -400000 {
		t.Fatalf("world red: %+v", got.Red)
	}
	// February (still red): the spread item is one cause with the whole amount.
	feb := planning.Warnings(planning.AccountForecast{Buffer: f.Buffer, Months: f.Months[3:], Days: f.Days}, 0)
	if feb.Red == nil || feb.Red.Month != "2027-02" || feb.Red.Cause == nil || feb.Red.Cause.Label != "Verbouwing" || feb.Red.Cause.Amount != -280000 {
		t.Errorf("world February: %+v", feb.Red)
	}
	wnCheck(t, "world February", planning.AccountForecast{Buffer: f.Buffer, Months: f.Months[3:], Days: f.Days}, 0)
}

// TestWarningsHandBuilt: a dip on the 1st that recovers does not set red-from;
// a red month without outgoing items has no cause; months without days have
// no red-from and no cause.
func TestWarningsHandBuilt(t *testing.T) {
	day := func(date string, balance int64, items ...planning.Item) planning.Day {
		return planning.Day{Date: date, Balance: balance, Items: items}
	}
	days := []planning.Day{
		day("2026-11-01", -500, planning.Item{Kind: "booked", Label: "Huur", Amount: -900, ID: 1}),
		day("2026-11-02", 100, planning.Item{Kind: "booked", Label: "Loon", Amount: 600, ID: 2}),
		day("2026-11-03", -50, planning.Item{Kind: "variable", Label: planning.VariableLabel, Amount: -150}),
		day("2026-11-04", -80, planning.Item{Kind: "pending", Label: "Winkel", Amount: -30, ID: 3}),
	}
	f := planning.AccountForecast{Buffer: 100, Days: map[string][]planning.Day{"2026-11": days},
		Months: []planning.Month{{Month: "2026-11", End: -80, Low: days[0]}}}
	w := wnCheck(t, "dip", f, 3)
	if w.Red == nil || w.Red.RedFrom != "2026-11-03" || w.Red.LowDate != "2026-11-01" || w.Red.Cause != nil || w.Buffer != nil {
		t.Errorf("dip: %+v", w.Red)
	}
	// Planned and recurring items: the largest total wins, late counts as recurring.
	days[2].Items = append(days[2].Items, planning.Item{Kind: "late", Label: "Krant", Amount: -40, ID: 7})
	days[3].Items = append(days[3].Items, planning.Item{Kind: "planned", Label: "Cadeau", Amount: -30, ID: 7},
		planning.Item{Kind: "recurring", Label: "Krant", Amount: -40, ID: 7}, planning.Item{Kind: "recurring", Label: "Toelage", Amount: 500, ID: 9})
	w = wnCheck(t, "items", f, 3)
	if c := w.Red.Cause; c == nil || *c != (planning.Item{Kind: "recurring", Label: "Krant", Amount: -80, ID: 7}) {
		t.Errorf("items: cause %+v", c)
	}
	// No days: the month rule still holds, without red-from and cause.
	g := planning.AccountForecast{Buffer: 100, Months: []planning.Month{{Month: "2026-11", End: 50}, {Month: "2026-12", End: -1}}}
	w = wnCheck(t, "no days", g, 3)
	if w.Red == nil || w.Red.RedFrom != "" || w.Red.Cause != nil || w.Buffer == nil || w.Buffer.Month != "2026-11" || w.Buffer.UnderBuffer != 50 {
		t.Errorf("no days: %+v %+v", w.Red, w.Buffer)
	}
	if w := planning.Warnings(planning.AccountForecast{}, 3); w.Red != nil || w.Buffer != nil {
		t.Errorf("no months: %+v", w)
	}
}
