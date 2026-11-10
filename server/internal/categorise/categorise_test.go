package categorise

import (
	"context"
	"database/sql"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/db"
)

func openDB(t *testing.T) *sql.DB {
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

func count(t *testing.T, d *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := d.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

func exec(t *testing.T, d *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := d.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func TestSeedDefaults(t *testing.T) {
	ctx := context.Background()
	d := openDB(t)
	if err := SeedDefaults(ctx, d); err != nil {
		t.Fatal(err)
	}
	if n := count(t, d, `SELECT COUNT(*) FROM categories`); n != 25 {
		t.Fatalf("seeded %d categories, want 25", n)
	}
	for _, c := range []struct {
		id        int
		name, typ string
		colour    string
		parent    int
		sortOrder int
	}{
		{1, "Wonen", "expense", "c1", 0, 1}, {6, "Overig", "expense", "c6", 0, 6}, {7, "Salaris", "income", "soft", 0, 7},
		{10, "Overig inkomen", "income", "soft", 0, 10}, {11, "Huur", "expense", "c1", 1, 1}, {14, "Verzekeringen", "expense", "c1", 1, 4},
		{15, "Supermarkt", "expense", "c2", 2, 1}, {22, "Openbaar vervoer", "expense", "c4", 4, 2}, {25, "Telefoon", "expense", "c5", 5, 2},
	} {
		if count(t, d, `SELECT COUNT(*) FROM categories WHERE id = ? AND name = ? AND type = ? AND colour = ? AND COALESCE(parent_id, 0) = ? AND sort_order = ?`,
			c.id, c.name, c.typ, c.colour, c.parent, c.sortOrder) != 1 {
			t.Errorf("category %d %s is not as expected", c.id, c.name)
		}
	}
	if n := count(t, d, `SELECT COUNT(*) FROM categories c JOIN categories p ON p.id = c.parent_id
		WHERE p.parent_id IS NOT NULL OR c.type <> p.type OR c.colour <> p.colour`); n != 0 {
		t.Errorf("%d subcategories deeper than two levels or unlike their parent", n)
	}
	// Idempotent.
	if err := SeedDefaults(ctx, d); err != nil || count(t, d, `SELECT COUNT(*) FROM categories`) != 25 {
		t.Fatalf("second seed: %v", err)
	}
	// A user who removes everything does not get the defaults back.
	exec(t, d, `DELETE FROM categories WHERE parent_id IS NOT NULL`)
	exec(t, d, `DELETE FROM categories`)
	if err := SeedDefaults(ctx, d); err != nil || count(t, d, `SELECT COUNT(*) FROM categories`) != 0 {
		t.Errorf("the defaults came back: %v", err)
	}

	// A database that already has categories (and no marker) only gets the marker.
	d2 := openDB(t)
	exec(t, d2, `INSERT INTO categories (name, type, colour) VALUES ('Eten & Drinken', 'expense', 'c2')`)
	if err := SeedDefaults(ctx, d2); err != nil {
		t.Fatal(err)
	}
	if count(t, d2, `SELECT COUNT(*) FROM categories`) != 1 || count(t, d2, `SELECT COUNT(*) FROM app_settings WHERE key = 'categories_seeded'`) != 1 {
		t.Error("existing categories: want them untouched and the marker written")
	}
}

func TestNormalise(t *testing.T) {
	for in, want := range map[string]string{
		"  Winkel Voorbeeld   Antwerpen ": "winkel voorbeeld antwerpen",
		"Café Ölçer\tBRÛSSEL":             "cafe olcer brussel",
		"Straße & Søn, ŁÓDŹ":              "strasse & son, lodz",
		"":                                "",
	} {
		if got := Normalise(in); got != want {
			t.Errorf("Normalise(%q) = %q, want %q", in, got, want)
		}
	}
}

func i64(v int64) *int64 { return &v }

func TestMatch(t *testing.T) {
	cand := Candidate{Counterparty: "Winkel  Voorbeeld   Antwerpen", CounterpartyIBAN: "BE11000000000071",
		Communication: "Bancontact   Café Centrum 4471", Amount: -2500}
	cases := []struct {
		name string
		rule Rule
		c    Candidate
		want bool
	}{
		{"contains, case and spacing ignored", Rule{Counterparty: "winkel voorbeeld"}, cand, true},
		{"contains, padded rule text", Rule{Counterparty: "  VOORBEELD  "}, cand, true},
		{"exact needs the whole name", Rule{Counterparty: "Winkel Voorbeeld", CounterpartyExact: true}, cand, false},
		{"exact after normalising", Rule{Counterparty: "winkel voorbeeld antwerpen", CounterpartyExact: true}, cand, true},
		{"diacritics folded", Rule{Counterparty: "Café"}, Candidate{Counterparty: "CAFE DE KAAI"}, true},
		{"diacritics folded the other way", Rule{Counterparty: "cafe"}, Candidate{Counterparty: "Café de Kaai"}, true},
		{"no match", Rule{Counterparty: "Bakkerij"}, cand, false},
		{"IBAN equal", Rule{CounterpartyIBAN: "BE11000000000071"}, cand, true},
		{"IBAN differs", Rule{CounterpartyIBAN: "BE11000000000072"}, cand, false},
		{"IBAN on a row without one", Rule{CounterpartyIBAN: "BE11000000000071"}, Candidate{Counterparty: "X"}, false},
		{"communication contains", Rule{Communication: "cafe centrum"}, cand, true},
		{"communication regex, case-insensitive", Rule{Communication: `bancontact café \w+`, CommunicationRegex: true}, cand, true},
		{"regex sees collapsed spaces", Rule{Communication: `^bancontact café`, CommunicationRegex: true}, cand, true},
		{"regex is not diacritic-folded", Rule{Communication: `cafe`, CommunicationRegex: true}, cand, false},
		{"regex alternatives", Rule{Communication: `netflix|spotify`, CommunicationRegex: true}, Candidate{Communication: "Spotify Premium"}, true},
		{"amount inside, absolute", Rule{AmountMin: i64(2000), AmountMax: i64(20000)}, cand, true},
		{"amount inclusive min", Rule{AmountMin: i64(2500)}, cand, true},
		{"amount inclusive max", Rule{AmountMax: i64(2500)}, cand, true},
		{"amount below min", Rule{AmountMin: i64(2501)}, cand, false},
		{"amount above max", Rule{AmountMax: i64(2499)}, cand, false},
		{"income uses the absolute amount too", Rule{AmountMin: i64(100000)}, Candidate{Amount: 150000}, true},
		{"conditions are ANDed: all true", Rule{Counterparty: "winkel", Communication: "centrum", AmountMax: i64(3000)}, cand, true},
		{"conditions are ANDed: one false", Rule{Counterparty: "winkel", Communication: "centrum", AmountMax: i64(2000)}, cand, false},
	}
	for _, c := range cases {
		c.rule.ID, c.rule.CategoryID = 1, 1
		got := Match(Prepare([]Rule{c.rule}), c.c) != nil
		if got != c.want {
			t.Errorf("%s: match %v, want %v", c.name, got, c.want)
		}
	}
}

func TestMatchOrder(t *testing.T) {
	rules := Prepare([]Rule{
		{ID: 1, Priority: 0, Counterparty: "winkel", CategoryID: 10},
		{ID: 2, Priority: 5, Counterparty: "winkel", CategoryID: 20},
		{ID: 3, Priority: 5, Counterparty: "winkel", CategoryID: 30},
		{ID: 4, Priority: 9, Counterparty: "bakker", CategoryID: 40},
	})
	if ids := []int64{rules[0].ID, rules[1].ID, rules[2].ID, rules[3].ID}; !slices.Equal(ids, []int64{4, 3, 2, 1}) {
		t.Errorf("order %v, want priority DESC then id DESC", ids)
	}
	if m := Match(rules, Candidate{Counterparty: "Winkel"}); m == nil || m.ID != 3 {
		t.Errorf("tie: got %+v, want the newest of the highest priority (3)", m)
	}
	if m := Match(rules, Candidate{Counterparty: "Bakker"}); m == nil || m.ID != 4 {
		t.Errorf("got %+v, want 4", m)
	}
	// A stored pattern that no longer compiles never matches.
	if got := Prepare([]Rule{{ID: 9, Communication: "(", CommunicationRegex: true}}); len(got) != 0 {
		t.Errorf("a broken pattern was kept")
	}
}

// RE2 has no catastrophic backtracking, and the communication read is bounded.
func TestPathologicalPatternIsFast(t *testing.T) {
	rules := Prepare([]Rule{{ID: 1, CategoryID: 1, Communication: `(a+)+$`, CommunicationRegex: true},
		{ID: 2, CategoryID: 1, Communication: `(x+x+)+y`, CommunicationRegex: true}})
	c := Candidate{Communication: strings.Repeat("a", 100000) + "!" + strings.Repeat("x", 5000)}
	start := time.Now()
	for range 20 {
		Match(rules, c)
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Errorf("20 matches took %v", d)
	}
}

// A small ledger: user 1 has a personal account 1, user 2 a personal account
// 2, and both hold account 3 (shared). Categories 1 and 2.
func ledgerDB(t *testing.T) *sql.DB {
	d := openDB(t)
	for _, q := range []string{
		`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.com', 'A'), (2, 'b@example.com', 'B')`,
		`INSERT INTO accounts (id, type, source, name) VALUES (1, 'current', 'manual', 'A'), (2, 'current', 'manual', 'B'), (3, 'current', 'manual', 'Samen')`,
		`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 1, 'manager', 'edit'), (2, 2, 'manager', 'edit'),
		    (3, 1, 'manager', 'edit'), (3, 2, 'member', 'edit')`,
		`INSERT INTO categories (id, name, type, colour) VALUES (1, 'Boodschappen', 'expense', 'c2'), (2, 'Overig', 'expense', 'c6'), (3, 'Vrije tijd', 'expense', 'c3')`,
	} {
		exec(t, d, q)
	}
	return d
}

func addTx(t *testing.T, d *sql.DB, id, account int64, name string, category any, origin any) {
	t.Helper()
	exec(t, d, `INSERT INTO transactions (id, account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id, category_origin)
		VALUES (?, ?, -1000, '2026-11-02', ?, 'booked', ?, ?, ?)`, id, account, name, "k"+name, category, origin)
}

func TestRulesFor(t *testing.T) {
	ctx := context.Background()
	d := ledgerDB(t)
	exec(t, d, `INSERT INTO rules (id, user_id, counterparty_match, category_id) VALUES (1, 1, 'a', 1), (2, 2, 'b', 1)`)
	exec(t, d, `INSERT INTO rules (id, account_id, counterparty_match, category_id) VALUES (3, 1, 'c', 1), (4, 3, 'd', 1), (5, 2, 'e', 1)`)
	ids := func(account int64) []int64 {
		rules, err := RulesFor(ctx, d, account)
		if err != nil {
			t.Fatal(err)
		}
		var out []int64
		for _, r := range rules {
			out = append(out, r.ID)
		}
		slices.Sort(out)
		return out
	}
	for account, want := range map[int64][]int64{
		1: {1, 3}, // A's personal account: A's user rule and its own
		2: {2, 5}, // B's: B's user rule, never A's
		3: {4},    // shared: only the account's rule, no user rule of either member
	} {
		if got := ids(account); !slices.Equal(got, want) {
			t.Errorf("account %d: rules %v, want %v", account, got, want)
		}
	}
}

// Precedence: manual > rule > suggestion; import, split and unknown origins
// are never changed automatically.
func TestAssign(t *testing.T) {
	ctx := context.Background()
	d := ledgerDB(t)
	exec(t, d, `INSERT INTO rules (id, account_id, counterparty_match, category_id) VALUES (1, 1, 'x', 1), (2, 1, 'y', 3)`)
	addTx(t, d, 1, 1, "open", nil, nil)
	addTx(t, d, 2, 1, "manual", 2, "manual")
	addTx(t, d, 3, 1, "import", 2, "import")
	addTx(t, d, 4, 1, "unknown", 2, nil)
	addTx(t, d, 5, 1, "split", nil, nil)
	exec(t, d, `INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (5, 1, -600), (5, 2, -400)`)
	addTx(t, d, 6, 1, "suggested", 2, "suggestion")
	addTx(t, d, 7, 1, "ruled", 2, "rule")

	for _, c := range []struct {
		tx, category, rule int64
		origin             string
		want               bool
	}{
		{1, 1, 1, "rule", true},
		{1, 1, 1, "rule", false}, // nothing changes
		{2, 1, 1, "rule", false},
		{3, 1, 1, "rule", false},
		{4, 1, 1, "rule", false},
		{5, 1, 1, "rule", false},
		{6, 1, 1, "rule", true},        // a rule beats a suggestion
		{7, 3, 2, "rule", true},        // another rule may take over
		{7, 1, 0, "suggestion", false}, // a suggestion never replaces a rule
		{2, 1, 0, "suggestion", false},
	} {
		got, err := Assign(ctx, d, c.tx, c.category, c.rule, c.origin)
		if err != nil || got != c.want {
			t.Errorf("Assign(tx %d, %s): %v, %v; want %v", c.tx, c.origin, got, err, c.want)
		}
	}
	if _, err := Assign(ctx, d, 1, 1, 0, "manual"); err == nil {
		t.Error("Assign wrote a manual origin")
	}
	want := "1:1:rule|2:2:manual|3:2:import|4:2:-|5:-:-|6:1:rule|7:3:rule"
	var got string
	exec(t, d, `SELECT 1`)
	if err := d.QueryRow(`SELECT group_concat(id || ':' || COALESCE(category_id, '-') || ':' || COALESCE(category_origin, '-'), '|')
		FROM (SELECT * FROM transactions ORDER BY id)`).Scan(&got); err != nil || got != want {
		t.Errorf("rows %s, want %s (%v)", got, want, err)
	}
}

func TestApplyAccount(t *testing.T) {
	ctx := context.Background()
	d := ledgerDB(t)
	exec(t, d, `INSERT INTO rules (id, account_id, priority, counterparty_match, category_id) VALUES (1, 1, 1, 'winkel', 1)`)
	addTx(t, d, 1, 1, "Winkel Noord", nil, nil)
	addTx(t, d, 2, 1, "Winkel Zuid", 2, "manual")
	addTx(t, d, 3, 1, "Winkel Oost", 2, "import")
	addTx(t, d, 4, 1, "Bakker", nil, nil)
	addTx(t, d, 5, 2, "Winkel West", nil, nil) // another account
	n, err := ApplyAccount(ctx, d, 1)
	if err != nil || n != 1 {
		t.Fatalf("first run: %d, %v; want 1", n, err)
	}
	if n, err := ApplyAccount(ctx, d, 1); err != nil || n != 0 {
		t.Errorf("second run: %d, %v; want 0", n, err)
	}
	// A higher-priority rule for the same counterparty takes the rule rows,
	// never the manual or imported ones.
	exec(t, d, `INSERT INTO rules (id, account_id, priority, counterparty_match, category_id) VALUES (2, 1, 9, 'winkel', 3)`)
	if n, _ := ApplyAccount(ctx, d, 1); n != 1 {
		t.Errorf("after a higher rule: %d changed, want 1", n)
	}
	// Deleting the rules keeps the categories they set.
	exec(t, d, `DELETE FROM rules`)
	if n, _ := ApplyAccount(ctx, d, 1); n != 0 {
		t.Errorf("without rules: %d changed", n)
	}
	want := "1:3:rule:-|2:2:manual:-|3:2:import:-|4:-:-:-|5:-:-:-"
	var got string
	if err := d.QueryRow(`SELECT group_concat(id || ':' || COALESCE(category_id, '-') || ':' || COALESCE(category_origin, '-') || ':' || COALESCE(rule_id, '-'), '|')
		FROM (SELECT * FROM transactions ORDER BY id)`).Scan(&got); err != nil || got != want {
		t.Errorf("rows %s, want %s (%v)", got, want, err)
	}
}
