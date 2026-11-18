package planning_test

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

const fcToday = "2026-11-18"

// fcOpen is an empty migrated database.
func fcOpen(t testing.TB) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	return d
}

// fcDemo is the seeded demo database.
func fcDemo(t testing.TB) *sql.DB {
	t.Helper()
	d := fcOpen(t)
	if _, err := demo.Seed(context.Background(), d, fake.Provider{}, nil); err != nil {
		t.Fatal(err)
	}
	return d
}

func fcForecast(t testing.TB, d *sql.DB, account int64, today string, horizon int) planning.AccountForecast {
	t.Helper()
	f, err := planning.Forecast(context.Background(), d, account, today, horizon)
	if err != nil {
		t.Fatal(err)
	}
	fcIdentities(t, f)
	return f
}

// fcIdentities checks what holds for every month of every forecast: free to
// spend is End - Buffer, the totals and the lines add up to End, the last day
// ends the month and the next month starts there.
func fcIdentities(t testing.TB, f planning.AccountForecast) {
	t.Helper()
	for i, m := range f.Months {
		var lines int64
		for _, l := range m.Lines {
			switch l.Key {
			case "end", "buffer", "free", "missed":
			default:
				lines += l.Amount
			}
		}
		days := f.Days[m.Month]
		switch {
		case m.Left != m.End-f.Buffer:
			t.Errorf("%s: Left %d != End %d - Buffer %d", m.Month, m.Left, m.End, f.Buffer)
		case m.Start+m.Income-m.Out-m.Saved != m.End:
			t.Errorf("%s: %d + %d - %d - %d != End %d", m.Month, m.Start, m.Income, m.Out, m.Saved, m.End)
		case lines != m.End, days[len(days)-1].Balance != m.End:
			t.Errorf("%s: lines %d or last day %d != End %d", m.Month, lines, days[len(days)-1].Balance, m.End)
		case i > 0 && m.Start != f.Months[i-1].End:
			t.Errorf("%s: Start %d != previous End %d", m.Month, m.Start, f.Months[i-1].End)
		}
	}
	if run := f.Months[0]; fcLine(run, "today") != f.Balance {
		t.Errorf("today line %d != Balance %d", fcLine(run, "today"), f.Balance)
	}
}

func fcLine(m planning.Month, key string) int64 {
	for _, l := range m.Lines {
		if l.Key == key {
			return l.Amount
		}
	}
	return -1 << 62
}

// fcLines renders a month's lines as "key amount[labels]" joined by " | ".
func fcLines(m planning.Month) string {
	var b []string
	for _, l := range m.Lines {
		s := fmt.Sprintf("%s %d", l.Key, l.Amount)
		if len(l.Labels) > 0 {
			s += "[" + strings.Join(l.Labels, ",") + "]"
		}
		b = append(b, s)
	}
	return strings.Join(b, " | ")
}

// fcEnds renders the month ends as "2026-11 120685 ok, …".
func fcEnds(f planning.AccountForecast) string {
	var b []string
	for _, m := range f.Months {
		b = append(b, fmt.Sprintf("%s %d %s", m.Month, m.End, m.State))
	}
	return strings.Join(b, ", ")
}

// fcDays renders the balances of the given dates as "01 -43145 red, …".
func fcDays(f planning.AccountForecast, month string, days ...int) string {
	var b []string
	for _, d := range days {
		day := f.Days[month][d-1]
		b = append(b, fmt.Sprintf("%02d %d %s", d, day.Balance, day.State))
	}
	return strings.Join(b, ", ")
}

func fcMonth(t testing.TB, f planning.AccountForecast, month string) planning.Month {
	t.Helper()
	for _, m := range f.Months {
		if m.Month == month {
			return m
		}
	}
	t.Fatalf("no month %s", month)
	return planning.Month{}
}

// fcItems renders a day's items as "kind label amount".
func fcItems(d planning.Day) string {
	var b []string
	for _, it := range d.Items {
		b = append(b, fmt.Sprintf("%s %s %d", it.Kind, it.Label, it.Amount))
	}
	return strings.Join(b, ", ")
}

// fcBudgets renders a month's budgets as "name plan/spent/rest source".
func fcBudgets(m planning.Month, names map[int64]string) string {
	var b []string
	for _, x := range m.Budgets {
		b = append(b, fmt.Sprintf("%s %d/%d/%d %s", names[x.CategoryID], x.Plan, x.Spent, x.Rest, x.Source))
	}
	return strings.Join(b, ", ")
}

func fcCategories(t testing.TB, d *sql.DB) map[int64]string {
	t.Helper()
	rows, err := d.Query(`SELECT id, name FROM categories`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[int64]string{}
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			t.Fatal(err)
		}
		out[id] = name
	}
	return out
}

// fcAverages are the plans without any budget row: the history averages.
func fcAverages(t testing.TB, d *sql.DB, account int64, today string) string {
	t.Helper()
	f, err := planning.LoadFacts(context.Background(), d, account, today)
	if err != nil {
		t.Fatal(err)
	}
	f.Budgets = nil
	return fcBudgets(planning.Project(f, today, 3).Months[1], fcCategories(t, d))
}

func fcCompare(t testing.TB, name, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s:\n got %s\nwant %s", name, got, want)
	}
}

// TestForecastDemo pins the golden numbers of plan 0.8-3 for the seeded demo
// story (viewer-free) and that a member's transfer override changes nothing.
func TestForecastDemo(t *testing.T) {
	d := fcDemo(t)
	names := fcCategories(t, d)
	zicht, shared := fcForecast(t, d, 1, fcToday, 24), fcForecast(t, d, 4, fcToday, 24)
	nov, sNov := zicht.Months[0], shared.Months[0]
	feb := fcMonth(t, zicht, "2027-02")
	low := func(m planning.Month) string { return fmt.Sprintf("%s %d", m.Low.Date, m.Low.Balance) }
	totals := func(m planning.Month) string { return fmt.Sprintf("%d/%d/%d/%d", m.Start, m.Income, m.Out, m.Saved) }
	need := func(m planning.Month) string { return fmt.Sprintf("%+v", m.Need) }
	for _, c := range []struct{ name, got, want string }{
		{"zicht balance", fmt.Sprint(zicht.Balance, " ", zicht.BalanceDate, " ", zicht.DataDate, " ", len(zicht.Missed)), "196882 2026-11-18 2026-11-18 0"},
		{"zicht averages", fcAverages(t, d, 1, fcToday), "Vrije tijd 4028/0/4028 average, Vervoer 12900/0/12900 average, Overig 900/0/900 average"},
		{"zicht nov days", fcDays(zicht, "2026-11", 1, 2, 8, 12, 16, 17, 18, 19, 29, 30),
			"01 -43145 red, 02 241855 ok, 08 236615 ok, 12 235216 ok, 16 205131 ok, 17 196882 ok, 18 196882 ok, 19 188242 ok, 29 126832 ok, 30 120685 ok"},
		{"zicht nov lines", fcLines(nov), "today 196882 | recurringIn 0 | recurringOut 0 | pending -2499[Bol.com] | planned 0 | variable -73698 | saving 0 | end 120685 | buffer -90000 | free 30685 | missed 0"},
		{"zicht nov budgets", fcBudgets(nov, names), "Vrije tijd 35000/6690/28310 budget, Vervoer 30000/13410/16590 budget, Overig 28798/0/28798 budget"},
		{"zicht nov totals", totals(nov) + " " + low(nov), "102355/286850/248520/20000 2026-11-01 -43145"},
		{"zicht 19 nov", fcItems(zicht.Days["2026-11"][18]), "pending Bol.com -2499, variable Dagelijkse uitgaven (schatting) -6141"},
		{"zicht ends", fcEnds(zicht), "2026-11 120685 ok, 2026-12 108789 ok, 2027-01 63493 buffer, 2027-02 -113403 red, 2027-03 -90299 red, " +
			"2027-04 -67195 red, 2027-05 -44091 red, 2027-06 -20987 red, 2027-07 -147883 red, 2027-08 -56779 red, 2027-09 -33675 red, " +
			"2027-10 -10571 red, 2027-11 12533 buffer, 2027-12 35637 buffer, 2028-01 -9659 red, 2028-02 13445 buffer, 2028-03 36549 buffer, " +
			"2028-04 59653 buffer, 2028-05 82757 buffer, 2028-06 105861 ok, 2028-07 128965 ok, 2028-08 152069 ok, 2028-09 175173 ok, " +
			"2028-10 198277 ok, 2028-11 221381 ok"},
		{"zicht free", fmt.Sprint(nov.Left, fcMonth(t, zicht, "2026-12").Left, fcMonth(t, zicht, "2027-01").Left, feb.Left), "30685 18789 -26507 -203403"},
		{"zicht lows", low(fcMonth(t, zicht, "2026-12")) + ", " + low(fcMonth(t, zicht, "2027-01")), "2026-12-01 -27840, 2027-01-01 -39736"},
		{"zicht feb days", fcDays(zicht, "2027-02", 1, 9, 10, 28), "01 -85356 red, 09 172852 ok, 10 -30497 red, 28 -113403 red"},
		{"zicht feb lines", fcLines(feb), "start 63493 | recurringIn 285000[Salaris] | recurringOut -148098[Huur,Naar gedeelde rekening,Netflix,Spotify] | " +
			"pending 0 | planned -200000[Autoherstelling] | variable -93798 | saving -20000[Naar spaarrekening] | end -113403 | buffer -90000 | free -203403"},
		{"zicht feb totals", totals(feb), "63493/285000/441896/20000"},
		{"zicht jan out", fmt.Sprint(fcLine(fcMonth(t, zicht, "2027-01"), "recurringOut")), "-216498"},
		{"shared averages", fcAverages(t, d, 4, fcToday), "Boodschappen 26821/0/26821 average, Overig 6247/0/6247 average"},
		{"shared nov days", fcDays(shared, "2026-11", 1, 3, 18, 19, 30), "01 142927 ok, 03 128427 ok, 18 94608 ok, 19 91965 ok, 30 62882 ok"},
		{"shared nov lines", fcLines(sNov), "today 94608 | recurringIn 0 | recurringOut 0 | pending 0 | planned 0 | variable -31726 | saving 0 | end 62882 | buffer -60000 | free 2882 | missed 0"},
		{"shared nov budgets", fcBudgets(sNov, names), "Boodschappen 55000/29521/25479 budget, Overig 6247/0/6247 average"},
		{"shared nov totals", totals(sNov) + " " + low(sNov), "52927/90000/80045/0 2026-11-30 62882"},
		{"shared ends", fcEnds(shared)[:70], "2026-11 62882 ok, 2026-12 72837 ok, 2027-01 82792 ok, 2027-02 92747 ok"},
		{"shared last", fmt.Sprint(shared.Months[24].End, " ", fcLines(shared.Months[1])),
			"301802 start 62882 | recurringIn 90000[Bijdrage Bert,Bijdrage Partner] | recurringOut -18798[Energie,Internet en tv] | pending 0 | planned 0 | variable -61247 | saving 0 | end 72837 | buffer -60000 | free 12837"},
		{"shared need", need(sNov) + " " + need(shared.Months[1]) + " " + need(shared.Months[3]),
			"{Amount:87118 Costs:80045 OtherIncome:0 BufferGap:7073} {Amount:80045 Costs:80045 OtherIncome:0 BufferGap:0} {Amount:80045 Costs:80045 OtherIncome:0 BufferGap:0}"},
	} {
		fcCompare(t, c.name, c.got, c.want)
	}
	for _, f := range []planning.AccountForecast{zicht, shared} {
		for _, m := range f.Months {
			for _, day := range f.Days[m.Month] {
				red := day.State == "red"
				switch {
				case f.AccountID == 4 && day.State != "ok":
					t.Errorf("shared %s: %s", day.Date, day.State)
				case f.AccountID == 1 && m.Month == "2027-02" && red != (day.Date == "2027-02-01" || day.Date >= "2027-02-10"):
					t.Errorf("zicht %s: %s", day.Date, day.State)
				}
			}
		}
	}

	// Viewer independence: Partner's override on a shared row changes nothing.
	if res, err := d.Exec(`INSERT INTO transfer_overrides (user_id, transaction_id, is_transfer)
		SELECT ?, id, 1 FROM transactions WHERE account_id = 4 AND booking_date = '2026-10-26'`, demo.Partner); err != nil {
		t.Fatal(err)
	} else if n, _ := res.RowsAffected(); n != 1 {
		t.Fatalf("override rows %d, want 1", n)
	}
	if again := fcForecast(t, d, 4, fcToday, 24); !reflect.DeepEqual(again, shared) {
		t.Error("the shared forecast changed after Partner's override")
	}
}

// TestForecastLoaderReadsNoUserData pins that the loader reads no per-user
// table, so every member gets the same forecast.
func TestForecastLoaderReadsNoUserData(t *testing.T) {
	for _, q := range planning.ForecastQueries {
		for _, bad := range []string{"transfer_overrides", "account_access", "user_id", "visibleTx", "vis "} {
			if strings.Contains(q, bad) {
				t.Errorf("loader query reads %q:\n%s", bad, q)
			}
		}
	}
}

// TestForecastSpeed: both demo accounts at horizon 24 well under 50 ms.
func TestForecastSpeed(t *testing.T) {
	if testing.Short() {
		t.Skip("speed")
	}
	d := fcDemo(t)
	start := time.Now()
	const runs = 10
	for range runs {
		for _, a := range []int64{1, 4} {
			if _, err := planning.Forecast(context.Background(), d, a, fcToday, 24); err != nil {
				t.Fatal(err)
			}
		}
	}
	took := time.Since(start) / runs
	t.Logf("two accounts, horizon 24: %v", took)
	if took > 250*time.Millisecond { // measured ~1.3 ms; loose on purpose: CI's race run and busy runners are many times slower
		t.Errorf("forecast took %v", took)
	}
}

// fcR is a booked row in top category cat (0: uncategorised; else variable).
func fcR(id int64, date string, amount int64, name string, cat int64) planning.FactRow {
	return planning.FactRow{ID: id, Date: date, Amount: amount, Name: name,
		Parts: []planning.FactPart{{Category: cat, Amount: amount, Variable: cat != 0}}}
}

// fcI is a monthly recurring item, income or expense by its sign.
func fcI(id int64, desc, counterparty string, amount int64, day int) planning.FactItem {
	kind := "expense"
	if amount > 0 {
		kind = "income"
	}
	return planning.FactItem{ID: id, Description: desc, Counterparty: counterparty, Amount: amount, Frequency: "monthly", Day: day, Kind: kind}
}

func fcFacts(today string, items []planning.FactItem, rows ...planning.FactRow) planning.Facts {
	return planning.Facts{AccountID: 1, Balance: 100000, BalanceDate: today, DataDate: today, FirstBooked: "2026-01-01", Items: items, Rows: rows}
}

func fcPending(r planning.FactRow) planning.FactRow { r.Pending = true; return r }

// TestProjectEdges are the edge cases of plan 0.8-3 (review of 18 Nov 2026)
// on hand-built facts; every result also passes fcIdentities.
func TestProjectEdges(t *testing.T) {
	day := func(m, d int) func(planning.AccountForecast) string {
		return func(f planning.AccountForecast) string { return fcItems(f.Days[f.Months[m].Month][d-1]) }
	}
	needs := func(f planning.AccountForecast) string { return fmt.Sprint(f.Months[1].Need.Amount) }
	missed := func(f planning.AccountForecast) string { return fmt.Sprintf("%+v", f.Missed) }
	plans := func(f planning.AccountForecast) string {
		return fcBudgets(f.Months[1], map[int64]string{1: "Wonen", 2: "Boodschappen"})
	}
	shareName := []planning.FactItem{
		{ID: 1, Description: "Naar gedeelde rekening", Counterparty: "BERT VAN BAELEN", IBAN: "XS", Amount: -45000, Frequency: "monthly", Day: 1, Kind: "transfer"},
		{ID: 2, Description: "Naar spaarrekening", Counterparty: "BERT VAN BAELEN", IBAN: "XV", Amount: -20000, Frequency: "monthly", Day: 1, Kind: "saving"},
	}
	xv, xs := fcR(1, "2026-10-31", -20000, "BERT VAN BAELEN", 0), fcR(2, "2026-11-03", -45000, "BERT VAN BAELEN", 0)
	xv.IBAN, xs.IBAN = "XV", "XS"
	insurance := planning.FactItem{ID: 1, Description: "Familiale verzekering", Amount: -68400, Frequency: "yearly", Month: 1, Day: 15, Kind: "expense"}
	stale := fcFacts("2026-11-18", []planning.FactItem{fcI(1, "Salaris", "Werkgever", 250000, 10)})
	stale.DataDate = "2026-11-05"
	keyless := fcFacts("2026-03-10", []planning.FactItem{insurance}, fcR(1, "2026-01-14", -68400, "AG Insurance", 1), fcR(2, "2026-02-05", -1000, "Eneco", 1))
	keyless.FirstBooked = "2025-12-01"
	var gap []planning.FactRow
	for i, m := range []string{"01", "02", "03", "08", "09", "10", "11"} {
		gap = append(gap, fcR(int64(i+1), "2026-"+m+"-05", -1000, "Shop", 2))
	}
	gapFacts := fcFacts("2026-11-18", nil, gap...)
	gapFacts.FirstBooked = "2026-01-05"
	budget := int64(10000)
	lastDay := fcFacts("2026-11-30", nil, fcPending(fcR(1, "2026-11-30", -500, "Shop", 2)))
	lastDay.Budgets = []planning.FactBudget{{Category: 2, From: "2026-11", Amount: &budget}}
	need := func(extra ...planning.FactItem) planning.Facts {
		f := fcFacts("2026-11-18", append([]planning.FactItem{fcI(1, "Lening", "Bank", -50000, 3)}, extra...))
		f.Planned = []planning.FactPlanned{{ID: 1, Date: "2026-12-20", Amount: -5000, Description: "Cadeau"}}
		return f
	}
	// Basic-Fit with its IBAN on the item: six booked rows (May-Oct) and a pending November row,
	// first without an IBAN (Bilance), then with it. Both must give the same forecast.
	gym := func(iban string) planning.Facts {
		it := fcI(1, "Basic-Fit", "Basic-Fit", -10000, 15)
		it.IBAN = "XG"
		var rs []planning.FactRow
		for i, m := range []string{"05", "06", "07", "08", "09", "10", "11"} {
			rs = append(rs, fcR(int64(i+1), "2026-"+m+"-15", -10000, "Basic-Fit", 2))
			rs[i].IBAN = iban
		}
		rs[6].Pending = true
		f := fcFacts("2026-11-18", []planning.FactItem{it}, rs...)
		f.FirstBooked = "2026-05-15"
		return f
	}
	gymSum := func(f planning.AccountForecast) string {
		return fmt.Sprint(f.Months[0].End, " ", f.Months[1].Out, " ", day(0, 19)(f))
	}
	contribution := fcI(3, "Bijdrage", "Partner", 10000, 1)
	contribution.Kind = "contribution"
	for _, c := range []struct {
		name  string
		today string
		facts planning.Facts
		check func(planning.AccountForecast) string
		want  string
	}{
		{"early payment across months", "2026-10-31", fcFacts("2026-10-31", []planning.FactItem{fcI(1, "Huur", "Huurbaas", -100500, 1)},
			fcR(1, "2026-10-01", -100500, "Huurbaas", 0), fcR(2, "2026-10-30", -100500, "Huurbaas", 0)),
			func(f planning.AccountForecast) string {
				return fmt.Sprint(fcLine(f.Months[1], "recurringOut"), " ", fcLine(f.Months[2], "recurringOut"), " ", day(0, 30)(f))
			}, "0 -100500 booked Huur -100500"},
		{"late across months", "2026-11-01", fcFacts("2026-11-01", []planning.FactItem{fcI(1, "Salaris", "Werkgever", 250000, 31)}),
			func(f planning.AccountForecast) string {
				return day(0, 2)(f) + "; " + day(0, 30)(f) + fmt.Sprint("; ", f.Months[0].Income)
			},
			"late Salaris 250000; recurring Salaris 250000; 500000"},
		{"pending on the due day", "2026-11-12", fcFacts("2026-11-12", []planning.FactItem{fcI(1, "Netflix", "Netflix", -1399, 12)},
			fcPending(fcR(1, "2026-11-12", -1399, "NETFLIX 4471", 0))), day(0, 13), "pending Netflix -1399"},
		{"old pending and a future booked row", "2026-11-18", fcFacts("2026-11-18", nil,
			fcPending(fcR(1, "2026-10-01", -5000, "Oud", 0)), fcR(2, "2026-11-20", -7000, "Later", 0)),
			func(f planning.AccountForecast) string {
				return fmt.Sprint(f.Balance, " ", f.Months[0].End, " [", day(0, 19)(f), day(0, 20)(f), "]")
			},
			"100000 100000 []"},
		{"key-less item claims its own payment", "2026-03-10", keyless, plans, "Wonen 500/0/500 average"},
		{"shared name, two IBANs", "2026-11-18", fcFacts("2026-11-18", shareName, xv, xs),
			func(f planning.AccountForecast) string { return day(0, 3)(f) + " [" + day(0, 19)(f) + "] " + missed(f) },
			"booked Naar gedeelde rekening -45000 [] []"},
		{"IBAN item, rows without IBAN", "2026-11-18", gym(""), func(f planning.AccountForecast) string {
			return gymSum(f) + " | " + gymSum(planning.Project(gym("XG"), "2026-11-18", 3))
		}, "90000 10000 pending Basic-Fit -10000 | 90000 10000 pending Basic-Fit -10000"},
		{"stale data: late, not missed", "2026-11-18", stale, day(0, 19), "late Salaris 250000"},
		{"fresh data: missed", "2026-11-18", fcFacts("2026-11-18", stale.Items), func(f planning.AccountForecast) string { return missed(f) + " " + day(0, 10)(f) },
			"[{ItemID:1 Label:Salaris Date:2026-11-10 Amount:250000}] missed Salaris 250000"},
		{"history gap: n = 3", "2026-11-18", gapFacts, plans, "Boodschappen 1000/0/1000 average"},
		{"last day: pending on the 1st, rest dropped", "2026-11-30", lastDay,
			func(f planning.AccountForecast) string {
				return fmt.Sprint(fcLine(f.Months[0], "variable"), " ", f.Months[0].End, " ", day(1, 1)(f))
			}, "0 100000 pending Shop -500, variable Dagelijkse uitgaven (schatting) -322"},
		{"matched 6 days early", "2026-11-15", fcFacts("2026-11-15", []planning.FactItem{fcI(1, "Gas", "Gas", -3000, 20)}, fcR(1, "2026-11-14", -3000, "Gas", 0)),
			func(f planning.AccountForecast) string { return "[" + day(0, 20)(f) + "]" }, "[]"},
		{"two occurrences, one row", "2026-11-20", fcFacts("2026-11-20", []planning.FactItem{fcI(1, "Gym A", "Gym", -2000, 14), fcI(2, "Gym B", "Gym", -2000, 16)},
			fcR(1, "2026-11-15", -2000, "Gym", 0)), day(0, 21), "late Gym B -2000"},
		{"8 days is no match", "2026-11-05", fcFacts("2026-11-05", []planning.FactItem{fcI(1, "Water", "Water", -1000, 10)}, fcR(1, "2026-11-02", -1000, "Water", 0)),
			day(0, 10), "recurring Water -1000"},
		{"need: expense and planned", "2026-11-18", need(), needs, "55000"},
		{"need: income lowers it", "2026-11-18", need(fcI(2, "Loon", "Werkgever", 10000, 2)), needs, "45000"},
		{"need: contribution does not", "2026-11-18", need(contribution), needs, "55000"},
		{"need: never below 0", "2026-11-18", need(fcI(2, "Loon", "Werkgever", 999999, 2)), needs, "0"},
	} {
		f := planning.Project(c.facts, c.today, 3)
		fcIdentities(t, f)
		fcCompare(t, c.name, c.check(f), c.want)
	}
}
