package planning_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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
