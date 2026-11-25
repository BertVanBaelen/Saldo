package receipt

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// demoNow is the demo date in the evening, after the 04:02 sync (as in the ledger tests).
var demoNow = time.Date(2026, 11, 18, 20, 0, 0, 0, clock.Brussels)

func seeded(t *testing.T) (*sql.DB, *ledger.Store) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	ctx := context.Background()
	if _, err := db.Migrate(ctx, d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := demo.Seed(ctx, d, fake.Provider{}, nil); err != nil {
		t.Fatal(err)
	}
	return d, ledger.New(d)
}

func build(t *testing.T, d *sql.DB, s *ledger.Store, viewer int64, q Query) Model {
	t.Helper()
	m, err := Build(context.Background(), d, s, viewer, q)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func rowsSum(rows []Row) (n int64) {
	for _, r := range rows {
		n += r.Amount
	}
	return n
}

// checkModel tests the identities every model holds against the report it was built from.
func checkModel(t *testing.T, label string, m Model, rep ledger.RangeReport, prev *ledger.RangeReport) {
	t.Helper()
	var exp int64
	for _, v := range rep.Expenses {
		exp += v
	}
	if m.Income.Total != rep.Income || m.Saved.Total != rep.Saved || m.Expenses.Total != exp {
		t.Errorf("%s: totals %d %d %d, report %d %d %d", label, m.Income.Total, m.Saved.Total, m.Expenses.Total, rep.Income, rep.Saved, exp)
	}
	if m.Result.Total != m.Income.Total-m.Expenses.Total-m.Saved.Total {
		t.Errorf("%s: result %d", label, m.Result.Total)
	}
	if rowsSum(m.Income.Rows) != m.Income.Total || rowsSum(m.Saved.Rows) != m.Saved.Total || rowsSum(m.Expenses.Groups) != m.Expenses.Total {
		t.Errorf("%s: rows do not add up to the totals", label)
	}
	if len(m.Expenses.Groups) != len(rep.Expenses) {
		t.Errorf("%s: %d groups, report keys %v", label, len(m.Expenses.Groups), rep.Expenses)
	}
	for i, g := range m.Expenses.Groups {
		if g.Amount == 0 || g.Amount != rep.Expenses[g.Key] {
			t.Errorf("%s: group %s %d, report %d", label, g.Key, g.Amount, rep.Expenses[g.Key])
		}
		if i > 0 && m.Expenses.Groups[i-1].Amount < g.Amount {
			t.Errorf("%s: groups not largest first at %s", label, g.Key)
		}
		if (prev == nil) != (g.Prev == nil) || (prev != nil && *g.Prev != prev.Expenses[g.Key]) {
			t.Errorf("%s: group %s prev %v", label, g.Key, g.Prev)
		}
	}
	for _, rows := range [][]Row{m.Income.Rows, m.Saved.Rows, m.Expenses.Groups} {
		for _, r := range rows {
			if r.Children == nil {
				continue
			}
			if len(r.Children) < 2 || rowsSum(r.Children) != r.Amount {
				t.Errorf("%s: children of %s (%d) sum %d", label, r.Key, r.Amount, rowsSum(r.Children))
			}
			for i, c := range r.Children {
				if i > 0 && r.Children[i-1].Amount < c.Amount {
					t.Errorf("%s: children of %s not largest first", label, r.Key)
				}
			}
		}
	}
	if prev == nil {
		if m.Income.Prev != nil || m.Expenses.Prev != nil || m.Saved.Prev != nil || m.Result.Prev != nil || m.Expenses.Trend != nil {
			t.Errorf("%s: a comparison without a previous period", label)
		}
	} else {
		var pe int64
		for _, v := range prev.Expenses {
			pe += v
		}
		if *m.Income.Prev != prev.Income || *m.Saved.Prev != prev.Saved || *m.Expenses.Prev != pe || *m.Result.Prev != prev.Income-pe-prev.Saved {
			t.Errorf("%s: prev totals", label)
		}
	}
	// No colour or verdict in the model (risk 16).
	b, _ := json.Marshal(m)
	for _, word := range []string{"colour", "color", "warn", "over", "verdict", "tone"} {
		if strings.Contains(strings.ToLower(string(b)), `"`+word+`":`) {
			t.Errorf("%s: the model holds %q: %s", label, word, b)
		}
	}
}

func rangeOf(t *testing.T, s *ledger.Store, viewer int64, scope string, account int64, p Period) ledger.RangeReport {
	t.Helper()
	r, err := s.ReportRange(context.Background(), viewer, scope, account, p.From, p.To, true)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// The October month in every selection: the identities, the comparison with
// September, and the budgets read as GET /api/reports/budgets reads them.
func TestBuildMonth(t *testing.T) {
	d, s := seeded(t)
	oct := Month(day("2026-10-01"))
	for _, c := range []struct {
		viewer  int64
		scope   string
		account int64
	}{{demo.Bert, "", 0}, {demo.Bert, "persoonlijk", 0}, {demo.Bert, "gedeeld", 0}, {demo.Bert, "", 1}, {demo.Partner, "alles", 0}} {
		m := build(t, d, s, c.viewer, Query{Period: oct, Scope: c.scope, AccountID: c.account, Now: demoNow})
		prev := rangeOf(t, s, c.viewer, c.scope, c.account, oct.Previous())
		label := oct.Label + " " + c.scope
		checkModel(t, label, m, rangeOf(t, s, c.viewer, c.scope, c.account, oct), &prev)
		if m.Running || m.PartialFrom != nil || m.Empty || len(m.Notes) != 0 || m.Period != "maand" || m.Label != "Oktober 2026" {
			t.Errorf("%s: %+v", label, m)
		}
		// The budget of each group is the sum of the selection's references of that category in October.
		want := map[string]int64{}
		for _, id := range rangeOf(t, s, c.viewer, c.scope, c.account, oct).Accounts {
			ref, err := planning.LoadBudgetReference(context.Background(), d, s, c.viewer, id, "2026-11-18", demoNow)
			if err != nil {
				t.Fatal(err)
			}
			for _, r := range ref.In("2026-10") {
				want[itoa(r.CategoryID)] += r.Reference
			}
		}
		for _, g := range m.Expenses.Groups {
			if w, ok := want[g.Key]; ok != (g.Budget != nil) || (ok && g.Budget.Amount != w) {
				t.Errorf("%s: group %s budget %+v, references %d", label, g.Key, g.Budget, w)
			}
			// October has no budget row yet: every reference is an average.
			if g.Budget != nil && (g.Budget.Kind != "average" || g.Budget.Pct == nil || *g.Budget.Pct != jsRound(float64(g.Amount)/float64(g.Budget.Amount)*100)) {
				t.Errorf("%s: group %s budget %+v", label, g.Key, g.Budget)
			}
		}
	}
	if m := build(t, d, s, demo.Bert, Query{Period: oct, Now: demoNow}); m.Scope != "alles" || m.ScopeLabel != "Alle rekeningen samen · ter info" {
		t.Errorf("scope %q %q", m.Scope, m.ScopeLabel)
	}
	if m := build(t, d, s, demo.Bert, Query{Period: oct, AccountID: 1, Now: demoNow}); m.ScopeLabel != "Zichtrekening" {
		t.Errorf("one account: %q", m.ScopeLabel)
	}
}

// November is running on 18 November; it still compares with the whole of
// October (decision 3) and reads the budget rows that start in November, the
// references of GET /api/reports/budgets (TestReportBudgetsDemo).
func TestBuildRunningMonth(t *testing.T) {
	d, s := seeded(t)
	nov := Month(day("2026-11-18"))
	m := build(t, d, s, demo.Bert, Query{Period: nov, AccountID: 1, Now: demoNow})
	prev := rangeOf(t, s, demo.Bert, "", 1, nov.Previous())
	checkModel(t, "November", m, rangeOf(t, s, demo.Bert, "", 1, nov), &prev)
	if !m.Running || len(m.Notes) != 1 || m.Notes[0] != "Loopt nog, tot wo 18 nov: de bank geeft de transacties van vandaag pas morgen door." {
		t.Errorf("running: %v %q", m.Running, m.Notes)
	}
	for _, g := range m.Expenses.Groups {
		if g.Key == "3" && (g.Budget == nil || g.Budget.Amount != 35000 || g.Budget.Kind != "budget") {
			t.Errorf("Vrije tijd: %+v", g.Budget)
		}
	}
	all := build(t, d, s, demo.Bert, Query{Period: nov, Now: demoNow})
	for _, g := range all.Expenses.Groups {
		if g.Key == "2" && (g.Budget == nil || g.Budget.Amount != 55000 || g.Budget.Kind != "budget") {
			t.Errorf("Boodschappen in Alles: %+v", g.Budget)
		}
	}
}

// A week: no budget, the comparison with the previous full week while the week runs.
func TestBuildWeek(t *testing.T) {
	d, s := seeded(t)
	for _, p := range []Period{Week(day("2026-11-18")), Week(day("2026-11-10")), Week(day("2026-10-28"))} {
		m := build(t, d, s, demo.Bert, Query{Period: p, Now: demoNow})
		prev := rangeOf(t, s, demo.Bert, "", 0, p.Previous())
		checkModel(t, p.Label, m, rangeOf(t, s, demo.Bert, "", 0, p), &prev)
		for _, g := range m.Expenses.Groups {
			if g.Budget != nil {
				t.Errorf("%s: a budget on a week: %s", p.Label, g.Key)
			}
		}
		if m.Running != (p.To >= "2026-11-18") || m.Period != "week" {
			t.Errorf("%s: running %v", p.Label, m.Running)
		}
	}
}

// The history starts on Saturday 1 November 2025: that week is a partial first
// period (no comparison, a note), the week before it is empty, and November 2025
// starts on its 1st but has no previous month to compare with.
func TestBuildHistoryStart(t *testing.T) {
	d, s := seeded(t)
	w := Week(day("2025-11-01"))
	m := build(t, d, s, demo.Bert, Query{Period: w, Now: demoNow})
	checkModel(t, w.Label, m, rangeOf(t, s, demo.Bert, "", 0, w), nil)
	if m.PartialFrom == nil || *m.PartialFrom != "2025-11-01" || len(m.Notes) != 1 || m.Notes[0] != "Je geschiedenis begint op 1 nov." {
		t.Errorf("partial week: %v %q", m.PartialFrom, m.Notes)
	}
	if m.Empty {
		t.Error("the first week is not empty")
	}
	before := build(t, d, s, demo.Bert, Query{Period: w.Previous(), Now: demoNow})
	if !before.Empty || before.Income.Rows == nil || before.Expenses.Groups == nil || before.PartialFrom != nil || len(before.Notes) != 0 {
		t.Errorf("before the history: %+v", before)
	}
	first := Month(day("2025-11-01"))
	fm := build(t, d, s, demo.Bert, Query{Period: first, Now: demoNow})
	checkModel(t, first.Label, fm, rangeOf(t, s, demo.Bert, "", 0, first), nil)
	if fm.PartialFrom != nil || len(fm.Notes) != 0 {
		t.Errorf("first month: %v %q", fm.PartialFrom, fm.Notes)
	}
}

// A week after the last sync: a bank account of the selection that went stale
// is named; a period wholly before its last sync is not.
func TestBuildStaleNote(t *testing.T) {
	d, s := seeded(t)
	later := time.Date(2026, 11, 30, 19, 0, 0, 0, clock.Brussels)
	m := build(t, d, s, demo.Bert, Query{Period: Week(day("2026-11-18")), Now: later})
	var stale []string
	for _, n := range m.Notes {
		if strings.HasPrefix(n, "Niet volledig: ") {
			stale = append(stale, n)
		}
	}
	if len(stale) == 0 {
		t.Fatalf("no stale note: %q", m.Notes)
	}
	for _, n := range stale {
		if !strings.Contains(n, " is niet bijgewerkt sinds ") {
			t.Errorf("note %q", n)
		}
	}
	t.Logf("notes: %q", m.Notes)
	if oct := build(t, d, s, demo.Bert, Query{Period: Month(day("2026-10-01")), Now: later}); len(oct.Notes) != 0 {
		t.Errorf("October after a later sync: %q", oct.Notes)
	}
}

func TestBuildErrors(t *testing.T) {
	d, s := seeded(t)
	ctx := context.Background()
	p := Month(day("2026-10-01"))
	if _, err := Build(ctx, d, s, demo.Bert, Query{Period: p, AccountID: 2, Now: demoNow}); err == nil || err.Error() != apperr.Invalid("Kies een betaalrekening.").Error() {
		t.Errorf("savings account: %v", err)
	}
	// Partner's own account and an unknown one answer the same.
	_, hidden := Build(ctx, d, s, demo.Bert, Query{Period: p, AccountID: 5, Now: demoNow})
	_, unknown := Build(ctx, d, s, demo.Bert, Query{Period: p, AccountID: 999, Now: demoNow})
	if hidden == nil || unknown == nil || hidden.Error() != unknown.Error() {
		t.Errorf("hidden %v, unknown %v", hidden, unknown)
	}
}

// The subcategories on the demo: one October Boodschappen row moved to
// Supermarkt and one moved back onto Boodschappen itself, and an income row
// booked in a new sub of Salaris, so group 2 and income 7 each hold the own
// part and a sub. The children add up to their row, largest first, with the
// own part named as Overzicht's breakdown names it.
func TestBuildChildren(t *testing.T) {
	d, s := seeded(t)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := d.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	var super int64
	if err := d.QueryRow(`SELECT id FROM categories WHERE name = 'Supermarkt' AND parent_id = 2`).Scan(&super); err != nil {
		t.Fatal(err)
	}
	var ids []int64
	rows, err := d.Query(`SELECT t.id FROM transactions t JOIN categories c ON c.id = t.category_id
		WHERE t.status = 'booked' AND t.booking_date LIKE '2026-10-%' AND t.amount < 0 AND COALESCE(c.parent_id, c.id) = 2
		AND NOT EXISTS (SELECT 1 FROM transaction_splits sp WHERE sp.transaction_id = t.id) ORDER BY t.id LIMIT 2`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id int64
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) != 2 {
		t.Fatalf("October Boodschappen rows: %v", ids)
	}
	exec(`UPDATE transactions SET category_id = ? WHERE id = ?`, super, ids[0])
	exec(`UPDATE transactions SET category_id = 2 WHERE id = ?`, ids[1])
	res, err := d.Exec(`INSERT INTO categories (name, parent_id, type, colour, sort_order) VALUES ('Premie', 7, 'income', 'soft', 99)`)
	if err != nil {
		t.Fatal(err)
	}
	premie, _ := res.LastInsertId()
	exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id)
		VALUES (1, 10000, '2026-10-20', 'Premie', 'booked', 'receipt-test-premie', ?)`, premie)

	oct := Month(day("2026-10-01"))
	m := build(t, d, s, demo.Bert, Query{Period: oct, Now: demoNow})
	prev := rangeOf(t, s, demo.Bert, "", 0, oct.Previous())
	checkModel(t, "October with subs", m, rangeOf(t, s, demo.Bert, "", 0, oct), &prev)
	find := func(rows []Row, key string) Row {
		for _, r := range rows {
			if r.Key == key {
				return r
			}
		}
		t.Fatalf("no row %s in %+v", key, rows)
		return Row{}
	}
	names := func(r Row) (out []string) {
		for _, c := range r.Children {
			out = append(out, c.Name)
		}
		return out
	}
	g := find(m.Expenses.Groups, "2")
	if len(g.Children) < 2 || !slices.Contains(names(g), "Boodschappen zelf") || !slices.Contains(names(g), "Supermarkt") {
		t.Errorf("Boodschappen children: %+v", g.Children)
	}
	inc := find(m.Income.Rows, "7")
	if len(inc.Children) != 2 || !slices.Contains(names(inc), "Salaris zelf") || !slices.Contains(names(inc), "Premie") {
		t.Errorf("Salaris children: %+v", inc.Children)
	}
	t.Logf("Boodschappen %d: %+v; Salaris %d: %+v", g.Amount, g.Children, inc.Amount, inc.Children)
}

// children on a hand-built tree: the own part as "<top> zelf", largest first,
// ties by id, nothing for a single entry.
func TestChildren(t *testing.T) {
	two := int64(2)
	tr := tree{[]ledger.TreeCategory{{ID: 2, Name: "Boodschappen"}, {ID: 11, Name: "Supermarkt", ParentID: &two}, {ID: 12, Name: "Bakker", ParentID: &two}}}
	got := tr.children("2", map[string]int64{"2": 12200, "11": 52000})
	if len(got) != 2 || fmt.Sprint(got) != fmt.Sprint([]Row{{Key: "11", Name: "Supermarkt", Amount: 52000}, {Key: "2", Name: "Boodschappen zelf", Amount: 12200}}) {
		t.Errorf("children: %+v", got)
	}
	if got := tr.children("2", map[string]int64{"11": 500, "12": 500, "2": 0}); len(got) != 2 || got[0].Key != "11" || got[1].Key != "12" {
		t.Errorf("tie: %+v", got)
	}
	if got := tr.children("2", map[string]int64{"11": 500, "12": 0}); got != nil {
		t.Errorf("one entry: %+v", got)
	}
	// breakdown rolls subs up to their top and names a savings account.
	rows := tr.breakdown(map[string]int64{"11": 300, "2": 100, "account-7": 50}, "gespaard", []ledger.Account{{ID: 7, Name: "Spaarpot"}})
	if len(rows) != 2 || rows[0].Key != "2" || rows[0].Amount != 400 || len(rows[0].Children) != 2 || rows[1].Name != "Naar Spaarpot" {
		t.Errorf("breakdown: %+v", rows)
	}
}

// November in Alles: a group's budget is mixed exactly when the accounts'
// references of it differ in source. A Wonen budget on the Zichtrekening only
// (the Gedeelde rekening keeps its average) makes one.
func TestBuildMixedBudget(t *testing.T) {
	d, s := seeded(t)
	if _, err := d.Exec(`INSERT INTO budgets (account_id, category_id, monthly_amount, from_month) VALUES (1, 1, 100000, '2026-11')`); err != nil {
		t.Fatal(err)
	}
	nov := Month(day("2026-11-18"))
	m := build(t, d, s, demo.Bert, Query{Period: nov, Now: demoNow})
	sources := map[string]map[string]bool{}
	for _, id := range []int64{1, 4} {
		ref, err := planning.LoadBudgetReference(context.Background(), d, s, demo.Bert, id, "2026-11-18", demoNow)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range ref.In("2026-11") {
			k := itoa(r.CategoryID)
			if sources[k] == nil {
				sources[k] = map[string]bool{}
			}
			sources[k][r.Source] = true
		}
	}
	mixed := 0
	for _, g := range m.Expenses.Groups {
		set := sources[g.Key]
		if (g.Budget == nil) != (set == nil) {
			t.Errorf("group %s: budget %+v, sources %v", g.Key, g.Budget, set)
			continue
		}
		if g.Budget == nil {
			continue
		}
		if want := len(set) > 1; (g.Budget.Kind == "mixed") != want {
			t.Errorf("group %s: kind %s, sources %v", g.Key, g.Budget.Kind, set)
		}
		if g.Budget.Kind == "mixed" {
			mixed++
		}
	}
	if mixed == 0 {
		t.Error("no mixed group")
	}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

// The trend of lib/reports.ts: JavaScript's rounding, the ±5 thresholds, new and none.
func TestTrend(t *testing.T) {
	p := func(n int64) *int64 { return &n }
	for _, c := range []struct {
		v    int64
		prev *int64
		want string
	}{
		{100, nil, ""}, {0, p(100), ""}, {-5, p(100), ""},
		{100, p(0), "new"}, {100, p(-10), "new"},
		{1025, p(1000), "3 flat"}, // 2.5 rounds up
		{975, p(1000), "-2 flat"}, // −2.5 rounds toward +∞, as Math.round
		{1050, p(1000), "5 flat"}, // 5 is not above 5
		{1060, p(1000), "6 up"},
		{940, p(1000), "-6 down"},
		{1000, p(1000), "0 flat"},
	} {
		got := ""
		if tr := trend(c.v, c.prev); tr != nil {
			got = tr.Kind
			if tr.Pct != nil {
				got = itoa(int64(*tr.Pct)) + " " + tr.Kind
			}
		}
		if got != c.want {
			t.Errorf("trend(%d, %v) = %q, want %q", c.v, c.prev, got, c.want)
		}
	}
}

// monthsSum is income, saved and spent of GET /api/reports/months over from..to (YYYY-MM).
func monthsSum(t *testing.T, s *ledger.Store, viewer int64, scope string, account int64, from, to string) (income, saved, spent int64) {
	t.Helper()
	rep, err := s.ReportMonths(context.Background(), viewer, ledger.ReportQuery{Scope: scope, AccountID: account, From: from, To: to, Now: demoNow})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range rep.Months {
		income, saved = income+m.Income, saved+m.Saved
		for _, v := range m.Expenses {
			spent += v
		}
	}
	return income, saved, spent
}

// A quarter, a year and custom ranges in every selection: the identities of
// checkModel against ReportRange, the comparison the rules give (never
// hand-fitted: from Comparable on the selection's own first date), no
// budgets, and totals equal to the sum of the months of GET /api/reports/months
// (up to the running month: ReportMonths answers no later month).
func TestBuildLongerPeriods(t *testing.T) {
	d, s := seeded(t)
	periods := []Period{
		Quarter(day("2026-08-15")), Quarter(day("2026-11-18")), Quarter(day("2025-11-20")), Quarter(day("2026-02-01")),
		Year(day("2025-06-01")), Year(day("2026-11-18")),
		Custom(day("2026-05-20"), day("2026-10-03")), Custom(day("2025-11-30"), day("2026-10-01")),
		Custom(day("2025-08-01"), day("2026-11-30")), Custom(day("2026-10-05"), day("2026-10-20")),
	}
	for _, c := range []struct {
		viewer  int64
		scope   string
		account int64
	}{{demo.Bert, "", 0}, {demo.Bert, "persoonlijk", 0}, {demo.Bert, "gedeeld", 0}, {demo.Bert, "", 1}, {demo.Partner, "alles", 0}} {
		for _, p := range periods {
			label := fmt.Sprintf("%s %d %q %d", p.Label, c.viewer, c.scope, c.account)
			m := build(t, d, s, c.viewer, Query{Period: p, Scope: c.scope, AccountID: c.account, Now: demoNow})
			cur := rangeOf(t, s, c.viewer, c.scope, c.account, p)
			first := ""
			if cur.FirstDate != nil {
				first = *cur.FirstDate
			}
			var prev *ledger.RangeReport
			if p.Comparable(first) {
				r := rangeOf(t, s, c.viewer, c.scope, c.account, p.Previous())
				prev = &r
			}
			checkModel(t, label, m, cur, prev)
			if m.Period != p.Kind || m.From != p.From || m.To != p.To || m.Running != (p.To >= "2026-11-18") {
				t.Errorf("%s: %s %s..%s running %v", label, m.Period, m.From, m.To, m.Running)
			}
			if pf := p.PartialFrom(first); (pf == "") != (m.PartialFrom == nil) || m.Label != p.LabelFrom(pf) {
				t.Errorf("%s: partial %v, label %q", label, m.PartialFrom, m.Label)
			}
			for _, g := range m.Expenses.Groups {
				if g.Budget != nil {
					t.Errorf("%s: a budget outside a month: %s", label, g.Key)
				}
			}
			to := min(p.To[:7], "2026-11")
			inc, sav, spent := monthsSum(t, s, c.viewer, c.scope, c.account, p.From[:7], to)
			if m.Income.Total != inc || m.Saved.Total != sav || m.Expenses.Total != spent {
				t.Errorf("%s: receipt %d/%d/%d, months %d/%d/%d", label, m.Income.Total, m.Expenses.Total, m.Saved.Total, inc, spent, sav)
			}
		}
	}

	// What the rules give for Bert in Alles (history from 1 November 2025).
	at := func(p Period) Model { return build(t, d, s, demo.Bert, Query{Period: p, Now: demoNow}) }
	running := "Loopt nog, tot wo 18 nov: de bank geeft de transacties van vandaag pas morgen door."
	if y := at(Year(day("2025-06-01"))); y.Label != "Jaar 2025 · vanaf 1 nov" || y.PartialFrom == nil || *y.PartialFrom != "2025-11-01" ||
		y.Income.Prev != nil || y.Running || !slices.Equal(y.Notes, []string{"Je geschiedenis begint op 1 nov."}) || y.Empty {
		t.Errorf("2025: %+v", y)
	}
	// 2026 would compare with 2025, which starts before the history: no comparison.
	if y := at(Year(day("2026-11-18"))); y.Label != "Jaar 2026" || y.PartialFrom != nil || y.Income.Prev != nil || !y.Running ||
		!slices.Equal(y.Notes, []string{running}) {
		t.Errorf("2026: %+v", y)
	}
	// The running quarter compares with the whole third quarter.
	if q := at(Quarter(day("2026-11-18"))); q.Label != "4e kwartaal 2026 · okt–dec" || q.Income.Prev == nil || q.Expenses.Trend == nil || !q.Running {
		t.Errorf("Q4 2026: %+v", q)
	}
	if q := at(Quarter(day("2025-11-20"))); q.Label != "4e kwartaal 2025 · okt–dec" || q.PartialFrom == nil || q.Income.Prev != nil ||
		!slices.Equal(q.Notes, []string{"Je geschiedenis begint op 1 nov."}) {
		t.Errorf("Q4 2025: %+v", q)
	}
	if e := at(Custom(day("2026-05-20"), day("2026-10-03"))); e.Label != "Mei – oktober 2026" || e.Period != "eigen" || e.Income.Prev == nil {
		t.Errorf("May-October: %+v", e)
	}
	// A custom range before the history: empty, no comparison.
	if e := at(Custom(day("1976-02-01"), day("2025-10-31"))); !e.Empty || e.Income.Prev != nil || len(e.Notes) != 0 {
		t.Errorf("before the history: %+v", e)
	}
	// Over 50 years: ReportRange's 400.
	if _, err := Build(context.Background(), d, s, demo.Bert, Query{Period: Custom(day("1976-01-01"), day("2026-01-01")), Now: demoNow}); err == nil ||
		err.Error() != apperr.Invalid("Kies een periode van hooguit 50 jaar.").Error() {
		t.Errorf("601 months: %v", err)
	}
}
