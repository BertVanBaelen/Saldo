package planning_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// world is the synthetic fixture of plan 0.8-3: the cases the demo never
// exercises. W1 Zicht (manual, snapshot dated before its newest row), W2
// Gedeeld (bank, shared, no items), W3 Nieuw (no snapshot), W4 Spaar.
type world struct {
	db             *sql.DB
	W1, W2, W3, W4 int64
	cat            map[string]int64
}

func planningWorld(t *testing.T) *world {
	t.Helper()
	d := fcOpen(t)
	ctx := context.Background()
	exec := func(q string, args ...any) int64 {
		t.Helper()
		res, err := d.Exec(q, args...)
		if err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
		id, _ := res.LastInsertId()
		return id
	}
	exec(`INSERT INTO users (id, email, display_name) VALUES (1, 'bert@x.be', 'Bert'), (2, 'partner@x.be', 'Partner')`)
	if err := categorise.SeedDefaults(ctx, d); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO categories (name, type, saving) VALUES ('Sparen', 'expense', 1)`)
	w := &world{db: d, cat: fcCategoryIDs(t, d)}
	account := func(name, typ, source string, buffer int64, members ...int64) int64 {
		id := exec(`INSERT INTO accounts (type, source, name, buffer) VALUES (?, ?, ?, ?)`, typ, source, name, buffer)
		for _, u := range members {
			exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, ?, 'manager', 'edit')`, id, u)
		}
		return id
	}
	w.W1 = account("Zicht", "current", "manual", 50000, 1)
	w.W2 = account("Gedeeld", "current", "bank", 0, 1, 2)
	w.W3 = account("Nieuw", "current", "manual", 0, 1)
	w.W4 = account("Spaar", "savings", "manual", 0, 1)
	exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name) VALUES (1, 1, 'fake', 'Bank')`)
	exec(`INSERT INTO account_sources (account_id, connection_id, priority, status, last_sync_at) VALUES (?, 1, 'primary', 'ok', '2026-11-18T03:02:00Z')`, w.W2)
	exec(`INSERT INTO balance_snapshots (account_id, balance, date, origin) VALUES (?, 100000, '2026-11-16', 'manual'), (?, 20000, '2026-11-18', 'bank'),
		(?, 500000, '2026-11-01', 'manual')`, w.W1, w.W2, w.W4)

	n := 0
	tx := func(account int64, date string, amount int64, name, iban, cat string, pending bool) int64 {
		n++
		status := map[bool]string{false: "booked", true: "pending"}[pending]
		var category any
		if cat != "" {
			category = w.cat[cat]
		}
		return exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, counterparty_iban, status, dedupe_key, category_id)
			VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?)`, account, amount, date, name, iban, status, fmt.Sprint("k", n), category)
	}
	b := func(date string, amount int64, name, cat string) int64 {
		return tx(w.W1, date, amount, name, "", cat, false)
	}
	b("2026-09-15", -3000, "Colruyt", "Boodschappen")
	b("2026-09-08", 20000, "Toelage", "Overig inkomen")
	b("2026-10-08", 20000, "Toelage", "Overig inkomen")
	b("2026-09-25", 150000, "Werkgever", "Salaris")
	b("2026-10-25", 150000, "Werkgever", "Salaris")
	b("2026-10-01", -80000, "Huurbaas", "Wonen")
	b("2026-10-05", -6000, "Colruyt", "Boodschappen")
	b("2026-10-20", 1000, "Colruyt", "Boodschappen")
	b("2026-10-10", -2000, "Spaarpot", "Sparen")
	b("2026-10-14", -2500, "Gym", "Vrije tijd")
	b("2026-11-01", -80000, "Huurbaas", "Wonen")
	split := b("2026-11-03", -4000, "Hema", "")
	exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, -3000), (?, ?, -1000)`,
		split, w.cat["Boodschappen"], split, w.cat["Vrije tijd"])
	b("2026-11-17", -1500, "Colruyt", "Boodschappen")
	tx(w.W1, "2026-11-18", -700, "Delhaize", "", "Boodschappen", true)

	item := func(account int64, desc, cp string, amount int64, rule, freq string, day int, month any, end any, kind string) {
		exec(`INSERT INTO recurring_items (account_id, description, counterparty, amount, amount_rule, frequency, expected_day, expected_month, end_date, kind, state)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`, account, desc, cp, amount, rule, freq, day, month, end, kind)
	}
	item(w.W1, "Huur", "Huurbaas", -80000, "fixed", "monthly", 1, nil, nil, "expense")
	item(w.W1, "Salaris", "Werkgever", 150000, "fixed", "monthly", 25, nil, nil, "income")
	item(w.W1, "Gym", "Gym", -2000, "average", "monthly", 14, nil, nil, "expense")
	item(w.W1, "Krant", "Krant", -1000, "fixed", "monthly", 5, nil, nil, "expense")
	item(w.W1, "Toelage", "Toelage", 20000, "fixed", "monthly", 8, nil, nil, "income")
	item(w.W1, "Verzekering", "", -30000, "fixed", "yearly", 31, 2, nil, "expense")
	item(w.W1, "Water", "Water", -4500, "fixed", "quarterly", 20, 12, "2027-06-30", "expense")
	exec(`INSERT INTO recurring_items (account_id, description, counterparty, amount, frequency, expected_day, kind, state)
		VALUES (?, 'Genegeerd', 'Colruyt', -1500, 'monthly', 17, 'expense', 'ignored')`, w.W1)
	exec(`INSERT INTO budgets (account_id, category_id, monthly_amount, from_month) VALUES (?, ?, 10000, '2026-11'), (?, ?, NULL, '2027-01'),
		(?, ?, 99999, '2026-11'), (?, ?, 99999, '2026-11')`, w.W1, w.cat["Boodschappen"], w.W1, w.cat["Boodschappen"],
		w.W1, w.cat["Supermarkt"], w.W1, w.cat["Sparen"]) // the last two: a subcategory and a saving category, ignored by the loader
	exec(`INSERT INTO planned_items (account_id, date, amount, description) VALUES (?, '2026-11-18', -5000, 'Cadeau'), (?, '2026-12-24', -10000, 'Feest')`, w.W1, w.W1)

	for m := 5; m <= 11; m++ {
		tx(w.W2, fmt.Sprintf("2026-%02d-01", m), 30000, "Bert", "X1", "", false)
		tx(w.W2, fmt.Sprintf("2026-%02d-01", m), 30000, "Partner", "XP", "", false)
		if m <= 10 {
			id := tx(w.W2, fmt.Sprintf("2026-%02d-10", m), -20000, "Colruyt", "", "Boodschappen", false)
			if m == 10 {
				exec(`INSERT INTO transfer_overrides (user_id, transaction_id, is_transfer) VALUES (2, ?, 1)`, id)
			}
		}
	}
	tx(w.W2, "2026-10-15", -5000, "Partner", "XP", "", false)
	tx(w.W2, "2026-11-10", -8000, "Colruyt", "", "Boodschappen", false)
	return w
}

func fcCategoryIDs(t testing.TB, d *sql.DB) map[string]int64 {
	out := map[string]int64{}
	for id, name := range fcCategories(t, d) {
		out[name] = id
	}
	return out
}

// TestWorld pins the planningWorld table of plan 0.8-3.
func TestWorld(t *testing.T) {
	w := planningWorld(t)
	names := fcCategories(t, w.db)
	w1, w2 := fcForecast(t, w.db, w.W1, fcToday, 24), fcForecast(t, w.db, w.W2, fcToday, 24)
	nov, dec := w1.Months[0], w1.Months[1]
	months := func(f planning.AccountForecast, label string) string { // the days an item with this label is on
		var b []string
		for _, m := range f.Months {
			for _, d := range f.Days[m.Month] {
				for _, it := range d.Items {
					if it.Label == label && it.Kind != "booked" {
						b = append(b, d.Date)
					}
				}
			}
		}
		return strings.Join(b, " ")
	}
	missed := func(f planning.AccountForecast) string {
		var b []string
		for _, m := range f.Missed {
			b = append(b, fmt.Sprintf("%s %s %d", m.Label, m.Date, m.Amount))
		}
		return strings.Join(b, ", ")
	}
	var states []string
	for _, m := range w1.Months {
		for _, d := range w1.Days[m.Month] {
			if d.State != "ok" {
				states = append(states, d.Date)
			}
		}
	}
	facts, err := planning.LoadFacts(context.Background(), w.db, w.W1, fcToday)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ name, got, want string }{
		{"W1 start", fmt.Sprint(w1.Balance, " ", w1.BalanceDate, " ", w1.DataDate), "98500 2026-11-16 2026-11-17"},
		{"W1 averages", fcAverages(t, w.db, w.W1, fcToday), "Boodschappen 5000/0/5000 average"},
		{"W1 budgets read", fmt.Sprint(len(facts.Budgets), " ", len(facts.Items)), "2 7"},
		{"W1 missed", missed(w1), "Krant 2026-11-05 -1000, Toelage 2026-11-08 20000"},
		{"W1 missed days", fcItems(w1.Days["2026-11"][4]) + "; " + fcItems(w1.Days["2026-11"][7]), "missed Krant -1000; missed Toelage 20000"},
		{"W1 nov budgets", fcBudgets(nov, names), "Boodschappen 10000/5200/4800 budget, Vrije tijd 0/1000/0 average"},
		{"W1 19 nov", fcDays(w1, "2026-11", 19) + ": " + fcItems(w1.Days["2026-11"][18]),
			"19 89900 ok: late Gym -2500, pending Delhaize -700, planned Cadeau -5000, variable Dagelijkse uitgaven (schatting) -400"},
		{"W1 nov", fmt.Sprintf("%d/%d/%d/%d/%d", nov.Start, nov.End, nov.Income, nov.Out, nov.Saved), "184000/235500/150000/98500/0"},
		{"W1 nov lines", fcLines(nov), "today 98500 | recurringIn 150000[Salaris] | recurringOut -2500[Gym] | pending -700[Delhaize] | planned -5000[Cadeau] | " +
			"variable -4800 | saving 0 | end 235500 | buffer -50000 | free 185500 | missed 0[Krant,Toelage]"},
		{"W1 dec lines", fcLines(dec), "start 235500 | recurringIn 170000[Toelage,Salaris] | recurringOut -88000[Huur,Krant,Gym,Water] | pending 0 | " +
			"planned -10000[Feest] | variable -10000 | saving 0 | end 297500 | buffer -50000 | free 247500"},
		{"W1 dec spread", fcItems(w1.Days["2026-12"][1]) + "; " + fcItems(w1.Days["2026-12"][30]),
			"variable Dagelijkse uitgaven (schatting) -322; variable Dagelijkse uitgaven (schatting) -340"},
		{"W1 dec low", fmt.Sprint(dec.Low.Date, " ", dec.Low.Balance, "; ", fcDays(w1, "2026-12", 1)), "2026-12-24 149772; 01 155178 ok"},
		{"W1 ends", fcEnds(w1)[:93], "2026-11 235500 ok, 2026-12 297500 ok, 2027-01 379000 ok, 2027-02 430500 ok, 2027-03 507500 ok"},
		{"W1 jan budgets", fcBudgets(w1.Months[2], names), "Boodschappen 5000/0/5000 average"},
		{"W1 Verzekering", months(w1, "Verzekering"), "2027-02-28 2028-02-29"},
		{"W1 Water", months(w1, "Water"), "2026-12-20 2027-03-20 2027-06-20"},
		{"W1 states", strings.Join(states, " "), ""},
		{"W2 averages", fcAverages(t, w.db, w2.AccountID, fcToday), "Boodschappen 20000/0/20000 average"},
		{"W2 nov", fcBudgets(w2.Months[0], names) + "; " + fcDays(w2, "2026-11", 19, 30), "Boodschappen 20000/8000/12000 average; 19 19000 ok, 30 8000 ok"},
		{"W2 dec", fcDays(w2, "2026-12", 12, 13, 31) + "; " + fcLines(w2.Months[1]),
			"12 260 ok, 13 -385 red, 31 -12000 red; start 8000 | recurringIn 0 | recurringOut 0 | pending 0 | planned 0 | variable -20000 | saving 0 | end -12000 | buffer 0 | free -12000"},
		{"W2 need", fmt.Sprintf("%+v %+v", w2.Months[0].Need, w2.Months[1].Need),
			"{Amount:52000 Costs:20000 OtherIncome:0 BufferGap:32000} {Amount:20000 Costs:20000 OtherIncome:0 BufferGap:0}"},
	} {
		fcCompare(t, c.name, c.got, c.want)
	}

	// W3 has no balance; W4 (savings) is the caller's to refuse.
	if _, err := planning.Forecast(context.Background(), w.db, w.W3, fcToday, 3); !errors.Is(err, planning.ErrNoBalance) {
		t.Errorf("W3: %v, want ErrNoBalance", err)
	}

	// A late payment clears "Verwacht, niet gezien"; once the next date has
	// passed the old occurrence is forgotten.
	if _, err := w.db.Exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id)
		VALUES (?, 20000, '2026-11-17', 'Toelage', 'booked', 'late', ?)`, w.W1, w.cat["Overig inkomen"]); err != nil {
		t.Fatal(err)
	}
	fcCompare(t, "W1 late Toelage", missed(fcForecast(t, w.db, w.W1, fcToday, 3)), "Krant 2026-11-05 -1000")
	fcCompare(t, "W1 on 9 December", missed(fcForecast(t, w.db, w.W1, "2026-12-09", 3)), "Gym 2026-11-14 -2500") // Toelage and Krant: their next date passed
}

// TestWorldDayless is rule 6b (plan 0.8.1-9): a one-off without a day spread
// over its month. Each case adds one dayless item to W1 and compares with W1
// without it on the same day: the ends move by the item from its month on.
func TestWorldDayless(t *testing.T) {
	spread := func(f planning.AccountForecast, month string) string { // "day amount" of every Zomer item in the month
		var b []string
		for _, d := range f.Days[month] {
			for i, it := range d.Items {
				if it.Label == "Zomer" {
					if it.Kind != "planned" || i != len(d.Items)-1 {
						t.Errorf("%s: %s %d is not the day's last planned item: %s", d.Date, it.Kind, i, fcItems(d))
					}
					b = append(b, fmt.Sprintf("%s %d", d.Date[8:], it.Amount))
				}
			}
		}
		return strings.Join(b, " ")
	}
	deltas := func(with, without planning.AccountForecast) string { // per month "m:end/need" deltas, need = Costs - OtherIncome
		var b []string
		for i, m := range with.Months[:5] {
			o := without.Months[i]
			b = append(b, fmt.Sprintf("%s:%d/%d", m.Month[2:], m.End-o.End, m.Need.Costs-m.Need.OtherIncome-(o.Need.Costs-o.Need.OtherIncome)))
		}
		return strings.Join(b, " ")
	}
	zomer := func(d planning.Day) string {
		for _, it := range d.Items {
			if it.Label == "Zomer" {
				return fmt.Sprintf("%s %d", it.Kind, it.Amount)
			}
		}
		return ""
	}
	var december []string
	for d := 1; d <= 31; d++ {
		december = append(december, fmt.Sprintf("%02d -100", d))
	}
	for _, c := range []struct {
		name, today, month string
		amount             int64
		check              func(with, without planning.AccountForecast) string
		want               string
	}{
		{"December, 31 days", fcToday, "2026-12", -3100, func(with, without planning.AccountForecast) string {
			return spread(with, "2026-12") + "; " + fcLines(with.Months[1]) + "; " + deltas(with, without)
		}, strings.Join(december, " ") + "; start 235500 | recurringIn 170000[Toelage,Salaris] | recurringOut -88000[Huur,Krant,Gym,Water] | " +
			"pending 0 | planned -13100[Zomer,Feest] | variable -10000 | saving 0 | end 294400 | buffer -50000 | free 244400; " +
			"26-11:0/0 26-12:-3100/3100 27-01:-3100/0 27-02:-3100/0 27-03:-3100/0"},
		{"running month, after today", fcToday, "2026-11", -1300, func(with, without planning.AccountForecast) string {
			return spread(with, "2026-11") + "; " + fmt.Sprint(fcLine(with.Months[0], "planned")) + "; " + deltas(with, without)
		}, "19 -108 20 -108 21 -108 22 -108 23 -108 24 -108 25 -108 26 -108 27 -108 28 -108 29 -108 30 -112; -6300; " +
			"26-11:-1300/1300 26-12:-1300/0 27-01:-1300/0 27-02:-1300/0 27-03:-1300/0"},
		{"running month's last day: tomorrow", "2026-11-30", "2026-11", 5000, func(with, without planning.AccountForecast) string {
			return "[" + spread(with, "2026-11") + "] " + zomer(with.Days["2026-12"][0]) + "; " +
				fmt.Sprint(fcLine(with.Months[1], "planned")-fcLine(without.Months[1], "planned")) + "; " + deltas(with, without)
		}, "[] planned 5000; 5000; 26-11:0/-5000 26-12:5000/0 27-01:5000/0 27-02:5000/0 27-03:5000/0"},
		{"past month: not counted", fcToday, "2026-10", -1000, func(with, without planning.AccountForecast) string {
			return "[" + spread(with, "2026-10") + spread(with, "2026-11") + "] " + deltas(with, without)
		}, "[] 26-11:0/0 26-12:0/0 27-01:0/0 27-02:0/0 27-03:0/0"},
	} {
		without := planningWorld(t)
		with := planningWorld(t)
		if _, err := with.db.Exec(`INSERT INTO planned_items (account_id, date, amount, description, whole_month) VALUES (?, ?, ?, 'Zomer', 1)`,
			with.W1, c.month+"-01", c.amount); err != nil {
			t.Fatal(err)
		}
		a, b := fcForecast(t, with.db, with.W1, c.today, 24), fcForecast(t, without.db, without.W1, c.today, 24)
		fcCompare(t, c.name, c.check(a, b), c.want)
		t.Logf("%s: %s", c.name, fcEnds(a)[:93])
	}

	// The cents: signed integer division, the last day takes the rest; the
	// whole amount is in the month's need (rule 12).
	f := fcFacts("2026-11-27", nil)
	f.Planned = []planning.FactPlanned{{ID: 6, Date: "2026-10-01", Amount: -1000, Description: "Oud", WholeMonth: true}, // past month: not counted
		{ID: 7, Date: "2026-11-01", Amount: -1000, Description: "Zomer", WholeMonth: true}}
	p := planning.Project(f, "2026-11-27", 3)
	fcIdentities(t, p)
	fcCompare(t, "sign", spread(p, "2026-11")+fmt.Sprint("; ", p.Months[0].End, " ", p.Months[0].Need.Costs, " ", p.Days["2026-11"][27].Items[0].ID),
		"28 -333 29 -333 30 -334; 99000 1000 7")
}

// totalWorld is planningWorld plus what TestWorldTotal adds (plan 0.9.1-4): on
// W1 a Vrije tijd budget of 3000 from 2026-11; on W2 a Boodschappen budget of
// 25000 from 2026-11 and the confirmed expense item Energie (-5000 monthly on
// the 3rd, Luminus). With assign the items sit on their categories: Gym on Sport
// (a sub of Vrije tijd), Verzekering on Vrije tijd, Krant on Supermarkt (a sub of
// Boodschappen), Water on Boodschappen, Huur on Wonen, Energie on Boodschappen.
// Without it the fixture is the baseline of the identity check.
func totalWorld(t *testing.T, assign bool) *world {
	t.Helper()
	w := planningWorld(t)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := w.db.Exec(q, args...); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
	}
	exec(`INSERT INTO budgets (account_id, category_id, monthly_amount, from_month) VALUES (?, ?, 3000, '2026-11'), (?, ?, 25000, '2026-11')`,
		w.W1, w.cat["Vrije tijd"], w.W2, w.cat["Boodschappen"])
	exec(`INSERT INTO recurring_items (account_id, description, counterparty, amount, frequency, expected_day, kind, state)
		VALUES (?, 'Energie', 'Luminus', -5000, 'monthly', 3, 'expense', 'confirmed')`, w.W2)
	if assign {
		for _, a := range []struct {
			account        int64
			item, category string
		}{{w.W1, "Gym", "Sport"}, {w.W1, "Verzekering", "Vrije tijd"}, {w.W1, "Krant", "Supermarkt"}, {w.W1, "Water", "Boodschappen"},
			{w.W1, "Huur", "Wonen"}, {w.W2, "Energie", "Boodschappen"}} {
			exec(`UPDATE recurring_items SET category_id = ? WHERE account_id = ? AND description = ?`, w.cat[a.category], a.account, a.item)
		}
	}
	return w
}

// TestWorldTotal is the budget as a total (plan 0.9.1-4): the budget of a top
// category is the month's total, its assigned recurring items are part of it
// and the forecast plans only the extra, max(0, total - recurring), on top.
//
// Where a number comes from: the budget entries of W1 (November, December,
// January, February) and the variable lines of November and December, W2's
// budget entries and the Costs of its need (25000 with the assignment, 30000
// without) are the hand-derived numbers of the phase file. Everything else is
// asserted by a rule, never pasted from the engine: the recurring, plan and
// rest of every month of the horizon by the rules of the phase file; the
// variable line is minus the sum of the month's Rest; month ends move between
// two forecasts of the same facts by the cumulative difference of their
// variable lines (the only line that differs); Amount = max(0, Costs -
// OtherIncome + BufferGap) and BufferGap = max(0, Buffer - Start); the ends of
// November and December are anchored to what TestWorld pins on the same facts.
func TestWorldTotal(t *testing.T) {
	plain, base, with := planningWorld(t), totalWorld(t, false), totalWorld(t, true)
	names := fcCategories(t, with.db)
	forecast := func(w *world, account int64) planning.AccountForecast {
		return fcForecast(t, w.db, account, fcToday, 24)
	}
	p1, b1, w1 := forecast(plain, plain.W1), forecast(base, base.W1), forecast(with, with.W1)
	p2, b2, w2 := forecast(plain, plain.W2), forecast(base, base.W2), forecast(with, with.W2)
	if len(w1.Months) != 25 || len(w2.Months) != 25 {
		t.Fatalf("months: %d and %d, want 25", len(w1.Months), len(w2.Months))
	}

	// What the loader assigns: the top category of every confirmed expense item that has one.
	facts, err := planning.LoadFacts(context.Background(), with.db, with.W1, fcToday)
	if err != nil {
		t.Fatal(err)
	}
	var assigned []string
	for _, it := range facts.Items {
		if it.Category != 0 {
			assigned = append(assigned, it.Description+"="+names[it.Category])
		}
	}
	fcCompare(t, "W1 assigned tops", strings.Join(assigned, ", "), "Huur=Wonen, Gym=Vrije tijd, Krant=Boodschappen, Verzekering=Vrije tijd, Water=Boodschappen")

	// total/recurring/plan/spent/rest per category, by name.
	render := func(m planning.Month) string {
		var out []string
		for _, b := range m.Budgets {
			out = append(out, fmt.Sprintf("%s %d/%d/%d/%d/%d %s", names[b.CategoryID], b.Total, b.Recurring, b.Plan, b.Spent, b.Rest, b.Source))
		}
		slices.Sort(out)
		return strings.Join(out, ", ")
	}
	for _, c := range []struct{ name, got, want string }{
		// The phase file.
		{"W1 nov budgets", render(w1.Months[0]), "Boodschappen 10000/1000/9000/5200/3800 budget, Vrije tijd 3000/2500/500/1000/0 budget, Wonen 0/80000/0/0/0 average"},
		{"W1 dec budgets", render(w1.Months[1]), "Boodschappen 10000/5500/4500/0/4500 budget, Vrije tijd 3000/2500/500/0/500 budget, Wonen 0/80000/0/0/0 average"},
		{"W1 jan budgets", render(w1.Months[2]), "Boodschappen 0/1000/5000/0/5000 average, Vrije tijd 3000/2500/500/0/500 budget, Wonen 0/80000/0/0/0 average"},
		{"W1 feb budgets", render(w1.Months[3]), "Boodschappen 0/1000/5000/0/5000 average, Vrije tijd 3000/32500/0/0/0 budget, Wonen 0/80000/0/0/0 average"},
		{"W1 variable nov and dec", fmt.Sprint(fcLine(w1.Months[0], "variable"), " ", fcLine(w1.Months[1], "variable")), "-3800 -5000"},
		{"W2 nov budgets", render(w2.Months[0]), "Boodschappen 25000/5000/20000/8000/12000 budget"},
		{"W2 dec budgets", render(w2.Months[1]), "Boodschappen 25000/5000/20000/0/20000 budget"},
		// The baseline: nothing assigned, the plan is the total (TestWorld's Boodschappen plus the added budgets).
		{"W1 baseline nov", render(b1.Months[0]), "Boodschappen 10000/0/10000/5200/4800 budget, Vrije tijd 3000/0/3000/1000/2000 budget"},
		{"W2 baseline nov and dec", render(b2.Months[0]) + "; " + render(b2.Months[1]),
			"Boodschappen 25000/0/25000/8000/17000 budget; Boodschappen 25000/0/25000/0/25000 budget"},
		// Decision 19: a missed occurrence counts in recurring (Energie, 3 November: no Luminus row) and not in the balance.
		{"W2 missed", fmt.Sprintf("%+v", w2.Missed), fmt.Sprintf("[{ItemID:%d Label:Energie Date:2026-11-03 Amount:-5000}]", w2Item(t, with, "Energie"))},
	} {
		fcCompare(t, c.name, c.got, c.want)
	}
	if got := w1.Months[0].End - p1.Months[0].End; got != 1000 { // the phase file: the November end +1000 against TestWorld
		t.Errorf("W1 November end is %d above TestWorld's, want 1000", got)
	}

	// Every month of the horizon, by the rules of the phase file.
	water := map[string]bool{"2026-12": true, "2027-03": true, "2027-06": true} // quarterly from December, ends 2027-06-30: none after
	for i, m := range w1.Months {
		got := map[string]planning.Budget{}
		for _, b := range m.Budgets {
			got[names[b.CategoryID]] = b
		}
		boodschappen, vrijeTijd := int64(1000), int64(2500) // Krant; Gym at its average
		if water[m.Month] {
			boodschappen += 4500
		}
		if m.Month[5:] == "02" {
			vrijeTijd += 30000 // Verzekering, yearly in February
		}
		type want struct{ total, recurring, plan int64 }
		wants := map[string]want{"Wonen": {0, 80000, 0}, "Vrije tijd": {3000, vrijeTijd, max(0, 3000-vrijeTijd)}}
		if m.Month < "2027-01" {
			wants["Boodschappen"] = want{10000, boodschappen, max(0, 10000-boodschappen)}
		} else {
			wants["Boodschappen"] = want{0, boodschappen, 5000} // the null row of January: the variable average
		}
		if len(got) != len(wants) {
			t.Errorf("W1 %s: %d budgets, want %d: %s", m.Month, len(got), len(wants), render(m))
		}
		for name, w := range wants {
			b, rest := got[name], w.plan
			if i == 0 {
				rest = max(0, w.plan-b.Spent)
			}
			if b.Total != w.total || b.Recurring != w.recurring || b.Plan != w.plan || b.Rest != rest || (b.Source == "budget") != (w.total > 0) {
				t.Errorf("W1 %s %s: %+v, want total %d recurring %d plan %d rest %d", m.Month, name, b, w.total, w.recurring, w.plan, rest)
			}
		}
	}

	// The variable line is what the budgets leave to spend, and the month ends move with it.
	for name, f := range map[string]planning.AccountForecast{"W1 plain": p1, "W1 baseline": b1, "W1 with": w1, "W2 plain": p2, "W2 baseline": b2, "W2 with": w2} {
		for _, m := range f.Months {
			var rest int64
			for _, b := range m.Budgets {
				rest += b.Rest
			}
			if got := fcLine(m, "variable"); got != -rest {
				t.Errorf("%s %s: variable line %d, want minus the Rest of the budgets, %d", name, m.Month, got, -rest)
			}
		}
	}
	chain := func(name string, a, b planning.AccountForecast) { // a differs from b only by its variable line
		t.Helper()
		var cum int64
		for i, m := range a.Months {
			o := b.Months[i]
			for _, k := range []string{"recurringIn", "recurringOut", "pending", "planned", "saving"} {
				if fcLine(m, k) != fcLine(o, k) {
					t.Errorf("%s %s: line %s is %d, the other forecast has %d", name, m.Month, k, fcLine(m, k), fcLine(o, k))
				}
			}
			cum += fcLine(m, "variable") - fcLine(o, "variable")
			if got := m.End - o.End; got != cum {
				t.Errorf("%s %s: the ends differ by %d, the variable lines so far by %d", name, m.Month, got, cum)
			}
		}
	}
	chain("W1 baseline against TestWorld", b1, p1) // only the Vrije tijd budget differs
	chain("W1 with against baseline", w1, b1)      // only the assignments differ
	chain("W2 with against baseline", w2, b2)

	// Identity of the fixture (review finding 4): against the baseline only the categories that hold an assigned item and
	// have a budget differ, by Plan = max(0, total - recurring) instead of the total; the others are equal but for Recurring.
	assignedTo := map[int64]bool{with.cat["Boodschappen"]: true, with.cat["Vrije tijd"]: true, with.cat["Wonen"]: true}
	for name, pair := range map[string][2]planning.AccountForecast{"W1": {w1, b1}, "W2": {w2, b2}} {
		for i, m := range pair[0].Months {
			baseOf := map[int64]planning.Budget{}
			for _, b := range pair[1].Months[i].Budgets {
				baseOf[b.CategoryID] = b
			}
			seen := map[int64]bool{}
			for _, x := range m.Budgets {
				y, inBase := baseOf[x.CategoryID]
				seen[x.CategoryID] = true
				switch {
				case inBase && y.Source == "budget" && assignedTo[x.CategoryID]:
					rest := x.Plan
					if i == 0 {
						rest = max(0, x.Plan-x.Spent)
					}
					if y.Plan != y.Total || y.Recurring != 0 || x.Source != "budget" || x.Total != y.Total || x.Spent != y.Spent || x.Average != y.Average ||
						x.Plan != max(0, y.Total-x.Recurring) || x.Rest != rest {
						t.Errorf("%s %s %s: %+v against the baseline %+v", name, m.Month, names[x.CategoryID], x, y)
					}
				default: // not budgeted (Wonen is not even listed in the baseline; Boodschappen from January is on the average)
					if !inBase {
						y = planning.Budget{CategoryID: x.CategoryID, Source: "average"}
					}
					x.Recurring = 0
					if !reflect.DeepEqual(x, y) {
						t.Errorf("%s %s %s: %+v, want the baseline's %+v", name, m.Month, names[x.CategoryID], x, y)
					}
				}
			}
			for c := range baseOf {
				if !seen[c] {
					t.Errorf("%s %s: %s is in the baseline and not in the forecast with assignments", name, m.Month, names[c])
				}
			}
		}
	}

	// The need of the shared account (rule 12): Costs = plan + every occurrence of the month, so a budgeted category
	// with an assigned item costs max(total, recurring) instead of total + recurring: 5000 less here, every month.
	// Amount = max(0, Costs - OtherIncome + BufferGap) and BufferGap = max(0, Buffer - Start).
	for i := range w2.Months {
		for _, c := range []struct {
			name  string
			f     planning.AccountForecast
			costs int64
		}{{"with", w2, 25000}, {"baseline", b2, 30000}} {
			m := c.f.Months[i]
			n := m.Need
			if n.Costs != c.costs || n.OtherIncome != 0 || n.BufferGap != max(0, c.f.Buffer-m.Start) || n.Amount != max(0, n.Costs-n.OtherIncome+n.BufferGap) {
				t.Errorf("W2 %s %s: need %+v (start %d), want costs %d, no other income, gap max(0, buffer - start), amount max(0, costs - income + gap)",
					c.name, m.Month, n, m.Start, c.costs)
			}
		}
	}
	if got := w2.Months[0].Need.BufferGap; got != 32000 || got != p2.Months[0].Need.BufferGap { // TestWorld pins the same gap
		t.Errorf("W2 November BufferGap %d, want 32000 as in TestWorld", got)
	}
	// W2's extra (20000) is TestWorld's average: November ends as there (Energie is missed on the 3rd, nothing in the
	// balance); December pays Energie (-5000) on top.
	if w2.Months[0].End != p2.Months[0].End || w2.Months[1].End != p2.Months[1].End-5000 {
		t.Errorf("W2 ends %d and %d, want TestWorld's %d and %d less 5000", w2.Months[0].End, w2.Months[1].End, p2.Months[0].End, p2.Months[1].End)
	}
	t.Logf("W1 ends with: %s", fcEnds(w1)[:93])
	t.Logf("W1 ends baseline: %s", fcEnds(b1)[:93])
	t.Logf("W2 need November with %+v, baseline %+v; December with %+v, baseline %+v", w2.Months[0].Need, b2.Months[0].Need, w2.Months[1].Need, b2.Months[1].Need)

	t.Run("a pending matched occurrence counts", func(t *testing.T) {
		w := totalWorld(t, true)
		if _, err := w.db.Exec(`INSERT INTO recurring_items (account_id, description, counterparty, amount, frequency, expected_day, kind, state, category_id)
			VALUES (?, 'Delhaize', 'Delhaize', -700, 'monthly', 18, 'expense', 'confirmed', ?)`, w.W1, w.cat["Boodschappen"]); err != nil {
			t.Fatal(err)
		}
		f := fcForecast(t, w.db, w.W1, fcToday, 24)
		// The occurrence matches the pending row of 18 November: it is the pending line (once, tomorrow) and counts in
		// recurring; the row is no longer variable spending, so spent drops by 700 and rest stays 3800.
		fcCompare(t, "nov budgets", render(f.Months[0]), "Boodschappen 10000/1700/8300/4500/3800 budget, Vrije tijd 3000/2500/500/1000/0 budget, Wonen 0/80000/0/0/0 average")
		fcCompare(t, "dec budgets", render(f.Months[1]), "Boodschappen 10000/6200/3800/0/3800 budget, Vrije tijd 3000/2500/500/0/500 budget, Wonen 0/80000/0/0/0 average")
		if line := fcLines(f.Months[0]); !strings.Contains(line, "pending -700[Delhaize]") {
			t.Errorf("pending line: %s", line)
		}
		if tomorrow := fcItems(f.Days["2026-11"][18]); strings.Count(tomorrow, "pending Delhaize -700") != 1 {
			t.Errorf("19 November: %s", tomorrow)
		}
	})

	t.Run("Water after its end date", func(t *testing.T) {
		// Water (quarterly from December, assigned to Boodschappen) ends 2027-06-30: its last occurrence is 20 June, the
		// September one is past the end date, so from 2027-07 on Boodschappen holds Krant only.
		w := totalWorld(t, true)
		f := fcForecast(t, w.db, w.W1, fcToday, 24)
		recurring := map[string]int64{}
		for _, m := range f.Months {
			for _, b := range m.Budgets {
				if names[b.CategoryID] == "Boodschappen" {
					recurring[m.Month] = b.Recurring
				}
			}
		}
		if recurring["2027-06"] != 5500 {
			t.Errorf("June 2027: %d, want Krant and Water, 5500", recurring["2027-06"])
		}
		for _, m := range f.Months {
			if m.Month >= "2027-07" && recurring[m.Month] != 1000 {
				t.Errorf("%s: recurring %d, want Krant only, 1000", m.Month, recurring[m.Month])
			}
		}
	})

	t.Run("an assigned saving item changes nothing", func(t *testing.T) {
		build := func(category string) (*world, planning.AccountForecast) {
			w := totalWorld(t, true)
			var c any
			if category != "" {
				c = w.cat[category]
			}
			if _, err := w.db.Exec(`INSERT INTO recurring_items (account_id, description, counterparty, amount, frequency, expected_day, kind, state, category_id)
				VALUES (?, 'Spaarpot', 'Spaarpot', -2000, 'monthly', 10, 'saving', 'confirmed', ?)`, w.W1, c); err != nil {
				t.Fatal(err)
			}
			return w, fcForecast(t, w.db, w.W1, fcToday, 24)
		}
		_, without := build("")
		w, assigned := build("Sparen")
		for i, m := range assigned.Months {
			if !reflect.DeepEqual(m.Budgets, without.Months[i].Budgets) || m.End != without.Months[i].End {
				t.Errorf("%s: budgets or end changed by the category of a saving item", m.Month)
			}
		}
		if got := fcLine(assigned.Months[1], "saving"); got != -2000 { // the item is in the forecast, so the comparison is not empty
			t.Errorf("December saving line %d, want -2000", got)
		}
		// A stale row never counts either: an expense item on a saving category, a saving item on any.
		if _, err := w.db.Exec(`UPDATE recurring_items SET category_id = ? WHERE description = 'Krant'`, w.cat["Sparen"]); err != nil {
			t.Fatal(err)
		}
		f, err := planning.LoadFacts(context.Background(), w.db, w.W1, fcToday)
		if err != nil {
			t.Fatal(err)
		}
		for _, it := range f.Items {
			if (it.Description == "Krant" || it.Description == "Spaarpot") && it.Category != 0 {
				t.Errorf("%s carries category %d, want 0", it.Description, it.Category)
			}
		}
	})
}

// w2Item is the id of the item with this description on W2.
func w2Item(t *testing.T, w *world, description string) int64 {
	t.Helper()
	var id int64
	if err := w.db.QueryRow(`SELECT id FROM recurring_items WHERE account_id = ? AND description = ?`, w.W2, description).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// TestBudgetOfZeroIsListed (plan 0.9.1-4, README decision 22): a budget row of
// 0 with nothing spent and nothing assigned is an entry with plan 0 in every
// month; before 0.9.1 it was left out of the forecast.
func TestBudgetOfZeroIsListed(t *testing.T) {
	zero := int64(0)
	f := fcFacts(fcToday, nil)
	f.Budgets = []planning.FactBudget{{Category: 2, From: "2026-11", Amount: &zero}}
	p := planning.Project(f, fcToday, 3)
	fcIdentities(t, p)
	want := []planning.Budget{{CategoryID: 2, Source: "budget"}} // plan 0, spent 0, rest 0, total 0, recurring 0, average 0
	for _, m := range p.Months {
		if !reflect.DeepEqual(m.Budgets, want) {
			t.Errorf("%s: budgets %+v, want %+v", m.Month, m.Budgets, want)
		}
	}
}
