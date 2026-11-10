package db

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"testing/fstest"
)

// tables are the v1 tables from analysis section 8.
var tables = []string{
	"users", "devices", "user_tokens", "login_codes", "audit_log", "provider_connections",
	"accounts", "account_access", "account_sources", "transactions", "transaction_splits",
	"balance_snapshots", "categories", "category_mappings", "category_suggestions",
	"import_batches", "rules", "recurring_items", "budgets", "planned_items",
	"transfer_overrides", "notification_prefs", "push_subscriptions", "notification_log",
	"app_settings", "schema_migrations",
}

func TestMigrationsApplyToEmptyDatabaseAndAreIdempotent(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "saldo.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	all, err := list(Migrations())
	if err != nil {
		t.Fatal(err)
	}
	if len(all) == 0 || all[0].version != 1 {
		t.Fatalf("want migrations starting at 0001, got %+v", all)
	}
	for i, m := range all {
		if m.version != i+1 {
			t.Fatalf("migration versions must be consecutive: %+v", all)
		}
	}

	backups := filepath.Join(t.TempDir(), "backups")
	applied, err := Migrate(ctx, db, Migrations(), backups, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != len(all) {
		t.Fatalf("applied %v, want %d migrations", applied, len(all))
	}
	if _, err := os.Stat(backups); !os.IsNotExist(err) {
		t.Errorf("an empty database needs no backup")
	}

	for _, name := range tables {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&n); err != nil || n != 1 {
			t.Errorf("table %s missing (%v)", name, err)
		}
	}

	again, err := Migrate(ctx, db, Migrations(), backups, nil)
	if err != nil || len(again) != 0 {
		t.Fatalf("second run applied %v, %v; want nothing", again, err)
	}
	var recorded int
	db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&recorded)
	if recorded != len(all) {
		t.Errorf("schema_migrations has %d rows, want %d", recorded, len(all))
	}

	// Reopening the file finds the schema in place.
	db.Close()
	db2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	if again, err := Migrate(ctx, db2, Migrations(), backups, nil); err != nil || len(again) != 0 {
		t.Fatalf("after reopen applied %v, %v", again, err)
	}
}

func TestPragmas(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var fk int
	var mode string
	var busy int
	db.QueryRow(`PRAGMA foreign_keys`).Scan(&fk)
	db.QueryRow(`PRAGMA journal_mode`).Scan(&mode)
	db.QueryRow(`PRAGMA busy_timeout`).Scan(&busy)
	if fk != 1 || mode != "wal" || busy != 5000 {
		t.Errorf("foreign_keys=%d journal_mode=%s busy_timeout=%d", fk, mode, busy)
	}
}

func TestSchemaConstraints(t *testing.T) {
	ctx := context.Background()
	db, err := Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := Migrate(ctx, db, Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	mustExec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	mustExec(`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.org', 'A')`)
	mustExec(`INSERT INTO accounts (id, type, source, iban, name) VALUES (1, 'current', 'bank', 'BE00000000000001', 'X')`)

	bad := []struct{ name, q string }{
		{"foreign key", `INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 99, 'manager', 'edit')`},
		{"duplicate bank IBAN", `INSERT INTO accounts (type, source, iban, name) VALUES ('current', 'bank', 'BE00000000000001', 'Y')`},
		{"unknown colour", `INSERT INTO accounts (type, source, name, colour) VALUES ('current', 'manual', 'Y', 'red')`},
		{"negative buffer", `INSERT INTO accounts (type, source, name, buffer) VALUES ('current', 'manual', 'Y', -1)`},
		{"rule with two owners", `INSERT INTO categories (id, name, type) VALUES (1, 'C', 'expense'); INSERT INTO rules (account_id, user_id, category_id) VALUES (1, 1, 1)`},
	}
	for _, b := range bad {
		if _, err := db.Exec(b.q); err == nil {
			t.Errorf("%s: want a constraint error", b.name)
		}
	}
	// A manual account may repeat a bank IBAN (it is only used to recognise transfers).
	mustExec(`INSERT INTO accounts (type, source, iban, name) VALUES ('savings', 'manual', 'BE00000000000001', 'Y')`)
}

func TestMigrateBacksUpBeforeAPendingMigration(t *testing.T) {
	ctx := context.Background()
	db, err := Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	first := fstest.MapFS{"0001_first.sql": {Data: []byte(`CREATE TABLE a (id INTEGER PRIMARY KEY);`)}}
	if _, err := Migrate(ctx, db, first, t.TempDir(), nil); err != nil {
		t.Fatal(err)
	}
	both := fstest.MapFS{
		"0001_first.sql":  first["0001_first.sql"],
		"0002_second.sql": {Data: []byte(`ALTER TABLE a ADD COLUMN b TEXT; CREATE TABLE c (id INTEGER PRIMARY KEY);`)},
	}
	backups := t.TempDir()
	applied, err := Migrate(ctx, db, both, backups, nil)
	if err != nil || len(applied) != 1 || applied[0] != 2 {
		t.Fatalf("applied %v, %v", applied, err)
	}
	files, _ := filepath.Glob(filepath.Join(backups, "saldo-*-before-0002.db"))
	if len(files) != 1 {
		t.Errorf("want one backup, got %v", files)
	}
}

func TestFailedMigrationRollsBack(t *testing.T) {
	ctx := context.Background()
	db, err := Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	broken := fstest.MapFS{"0001_broken.sql": {Data: []byte(`CREATE TABLE a (id INTEGER); CREATE TABLE oops (;`)}}
	if _, err := Migrate(ctx, db, broken, "", nil); err == nil {
		t.Fatal("want an error")
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'a'`).Scan(&n)
	if n != 0 {
		t.Error("a failed migration must leave no tables behind")
	}
}

func TestMigrationNames(t *testing.T) {
	bad := []fstest.MapFS{
		{"1_init.sql": {}},
		{"0001_a.sql": {}, "0001_b.sql": {}},
	}
	for _, fsys := range bad {
		if _, err := list(fsys); err == nil {
			t.Errorf("want an error for %v", fsys)
		}
	}
}

// Migration 0003 collapses balance snapshots of the same account, date and
// origin to the newest one, and nothing else. A real database that synced
// twice in a day has such duplicates; the copy before the migration is the way back.
func TestMigration0003KeepsTheNewestSnapshotOfADay(t *testing.T) {
	ctx := context.Background()
	db, err := Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	full := Migrations()
	old := fstest.MapFS{}
	for _, name := range []string{"0001_init.sql", "0002_login_challenge.sql"} {
		b, err := fs.ReadFile(full, name)
		if err != nil {
			t.Fatal(err)
		}
		old[name] = &fstest.MapFile{Data: b}
	}
	backups := filepath.Join(t.TempDir(), "backups")
	if _, err := Migrate(ctx, db, old, backups, nil); err != nil {
		t.Fatal(err)
	}

	mustExec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`INSERT INTO accounts (id, type, source, name) VALUES (1, 'current', 'bank', 'A'), (2, 'current', 'bank', 'B')`)
	snap := `INSERT INTO balance_snapshots (id, account_id, balance, date, origin) VALUES (?, ?, ?, ?, ?)`
	mustExec(snap, 1, 1, 100, "2026-11-04", "bank")
	mustExec(snap, 2, 1, 150, "2026-11-04", "bank")  // same day, synced again: this one stays
	mustExec(snap, 3, 1, 90, "2026-11-03", "bank")   // another day
	mustExec(snap, 4, 1, 80, "2026-11-04", "manual") // another origin
	mustExec(snap, 5, 2, 70, "2026-11-04", "bank")   // another account

	if _, err := Migrate(ctx, db, full, backups, nil); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`SELECT id FROM balance_snapshots ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		got = append(got, id)
	}
	if want := []int{2, 3, 4, 5}; !slices.Equal(got, want) {
		t.Fatalf("snapshots after the migration = %v, want %v", got, want)
	}
	if _, err := db.Exec(snap, 6, 1, 1, "2026-11-04", "bank"); err == nil {
		t.Error("a second bank snapshot of the same account and day was accepted")
	}
	if files, _ := filepath.Glob(filepath.Join(backups, "*before-0003*")); len(files) != 1 {
		t.Errorf("want one backup before 0003, found %v", files)
	}
}

// Migration 0005 only adds columns to rules: on a populated database at
// version 4 every row stays as it was, the new columns get their defaults,
// a second run changes nothing, and the backup is written first.
func TestMigration0005KeepsEveryRow(t *testing.T) {
	ctx := context.Background()
	db, err := Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	full := Migrations()
	old := fstest.MapFS{}
	for _, name := range []string{"0001_init.sql", "0002_login_challenge.sql", "0003_sync_engine.sql", "0004_notification_connection.sql"} {
		b, err := fs.ReadFile(full, name)
		if err != nil {
			t.Fatal(err)
		}
		old[name] = &fstest.MapFile{Data: b}
	}
	backups := filepath.Join(t.TempDir(), "backups")
	if _, err := Migrate(ctx, db, old, backups, nil); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.com', 'A')`,
		`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, status) VALUES (1, 1, 'fake', 'Testbank', 'active')`,
		`INSERT INTO accounts (id, type, source, iban, name) VALUES (1, 'current', 'bank', 'BE00TEST0000001', 'Rekening')`,
		`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 1, 'manager', 'edit')`,
		`INSERT INTO account_sources (account_id, connection_id, priority) VALUES (1, 1, 'primary')`,
		`INSERT INTO balance_snapshots (account_id, balance, date, origin) VALUES (1, 12345, '2026-11-01', 'bank')`,
		`INSERT INTO categories (id, name, type, colour) VALUES (1, 'Energie, nutsvoorzieningen', 'expense', 'c1')`,
		`INSERT INTO rules (id, user_id, priority, counterparty_match, communication_regex, category_id) VALUES (1, 1, 3, 'Winkel', 'abc|def', 1)`,
		`INSERT INTO transactions (id, account_id, amount, booking_date, counterparty_name, status, external_id, dedupe_key,
		     source_connection_id, category_id, category_origin, rule_id)
		 VALUES (1, 1, -1250, '2026-11-02', 'Winkel Test', 'booked', 'ref-1', 'ref:x:ref-1', 1, 1, 'rule', 1),
		        (2, 1, -999, '2026-11-03', 'Kraam', 'pending', NULL, 'hash:abc', 1, NULL, NULL, NULL)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	dump := func() string {
		t.Helper()
		var out string
		for _, q := range []string{
			`SELECT group_concat(id || '|' || account_id || '|' || amount || '|' || booking_date || '|' || counterparty_name || '|' || status || '|' ||
			     COALESCE(category_id, '-') || '|' || COALESCE(category_origin, '-') || '|' || COALESCE(rule_id, '-'), ';') FROM transactions`,
			`SELECT group_concat(account_id || '|' || balance || '|' || date, ';') FROM balance_snapshots`,
			`SELECT group_concat(id || '|' || name || '|' || iban, ';') FROM accounts`,
			`SELECT group_concat(id || '|' || status, ';') FROM provider_connections`,
			`SELECT group_concat(id || '|' || name, ';') FROM categories`,
			`SELECT group_concat(id || '|' || user_id || '|' || priority || '|' || counterparty_match || '|' || communication_regex || '|' || category_id, ';') FROM rules`,
		} {
			var s string
			if err := db.QueryRow(q).Scan(&s); err != nil {
				t.Fatal(err)
			}
			out += s + "\n"
		}
		return out
	}
	before := dump()
	applied, err := Migrate(ctx, db, full, backups, nil)
	if err != nil || !slices.Contains(applied, 5) {
		t.Fatalf("applied %v, %v", applied, err)
	}
	if after := dump(); after != before {
		t.Errorf("rows changed by the migration:\nbefore %s\nafter  %s", before, after)
	}
	var exact int
	var contains *string
	if err := db.QueryRow(`SELECT counterparty_exact, communication_contains FROM rules WHERE id = 1`).Scan(&exact, &contains); err != nil {
		t.Fatal(err)
	}
	if exact != 0 || contains != nil {
		t.Errorf("new columns: exact %d, contains %v; want 0 and NULL", exact, contains)
	}
	if _, err := db.Exec(`UPDATE rules SET counterparty_exact = 2 WHERE id = 1`); err == nil {
		t.Error("counterparty_exact accepted 2")
	}
	if again, err := Migrate(ctx, db, full, backups, nil); err != nil || len(again) != 0 {
		t.Errorf("second run applied %v, %v", again, err)
	}
	if after := dump(); after != before {
		t.Error("the second run changed rows")
	}
	if files, _ := filepath.Glob(filepath.Join(backups, "*before-0005*")); len(files) != 1 {
		t.Errorf("want one backup before 0005, found %v", files)
	}
}

// Migration 0006 merges duplicate decisions on suggestions (keeping the
// lowest id) and makes them unique per user, key and category: on a
// populated database at version 5 every other row stays, account-owned
// suggestions are untouched, a second run changes nothing, and the backup
// is written first.
func TestMigration0006MergesDuplicateSuggestions(t *testing.T) {
	ctx := context.Background()
	db, err := Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	full := Migrations()
	old := fstest.MapFS{}
	for _, name := range []string{"0001_init.sql", "0002_login_challenge.sql", "0003_sync_engine.sql",
		"0004_notification_connection.sql", "0005_rules_engine.sql"} {
		b, err := fs.ReadFile(full, name)
		if err != nil {
			t.Fatal(err)
		}
		old[name] = &fstest.MapFile{Data: b}
	}
	backups := filepath.Join(t.TempDir(), "backups")
	if _, err := Migrate(ctx, db, old, backups, nil); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.com', 'A'), (2, 'b@example.com', 'B')`,
		`INSERT INTO accounts (id, type, source, name) VALUES (1, 'current', 'manual', 'Rekening')`,
		`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 1, 'manager', 'edit')`,
		`INSERT INTO categories (id, name, type, colour) VALUES (1, 'Eten & Drinken', 'expense', 'c1'), (2, 'Energie, nutsvoorzieningen', 'expense', 'c2')`,
		`INSERT INTO rules (id, user_id, priority, counterparty_match, category_id) VALUES (1, 1, 3, 'Winkel', 1)`,
		`INSERT INTO transactions (id, account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id, category_origin)
		 VALUES (1, 1, -1250, '2026-11-02', 'Winkel Test', 'booked', 'x1', 1, 'manual'), (2, 1, -999, '2026-11-03', 'Kraam', 'pending', 'x2', NULL, NULL)`,
		`INSERT INTO category_suggestions (id, user_id, account_id, counterparty_key, category_id, confidence, times_seen, state) VALUES
		    (10, 1, NULL, 'winkel test', 1, 80, 5, 'dismissed'),
		    (11, 1, NULL, 'winkel test', 1, 90, 6, 'confirmed'),
		    (12, 1, NULL, 'winkel test', 1, 70, 2, 'open'),
		    (13, 1, NULL, 'winkel test', 2, 60, 3, 'confirmed'),
		    (14, 2, NULL, 'winkel test', 1, 50, 2, 'dismissed'),
		    (15, NULL, 1, 'kraam', 1, 40, 2, 'open'),
		    (16, NULL, 1, 'kraam', 1, 40, 2, 'open')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	dump := func(q string) string {
		t.Helper()
		var s string
		if err := db.QueryRow(q).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	const others = `SELECT (SELECT group_concat(id || '|' || amount || '|' || counterparty_name || '|' || COALESCE(category_id, '-') || '|' || COALESCE(category_origin, '-'), ';') FROM transactions)
		|| '#' || (SELECT group_concat(id || '|' || name, ';') FROM categories) || '#' || (SELECT group_concat(id || '|' || priority || '|' || counterparty_match, ';') FROM rules)`
	const suggestions = `SELECT group_concat(id || '|' || COALESCE(user_id, '-') || '|' || COALESCE(account_id, '-') || '|' || counterparty_key || '|' ||
		category_id || '|' || confidence || '|' || times_seen || '|' || state, ';') FROM (SELECT * FROM category_suggestions ORDER BY id)`
	before := dump(others)
	applied, err := Migrate(ctx, db, full, backups, nil)
	if err != nil || !slices.Contains(applied, 6) {
		t.Fatalf("applied %v, %v", applied, err)
	}
	if after := dump(others); after != before {
		t.Errorf("rows changed by the migration:\nbefore %s\nafter  %s", before, after)
	}
	want := "10|1|-|winkel test|1|80|5|dismissed;13|1|-|winkel test|2|60|3|confirmed;14|2|-|winkel test|1|50|2|dismissed;" +
		"15|-|1|kraam|1|40|2|open;16|-|1|kraam|1|40|2|open"
	if got := dump(suggestions); got != want {
		t.Errorf("suggestions after the migration:\n%s\nwant\n%s", got, want)
	}
	if _, err := db.Exec(`INSERT INTO category_suggestions (user_id, counterparty_key, category_id, confidence) VALUES (1, 'winkel test', 1, 10)`); err == nil {
		t.Error("a duplicate decision was accepted")
	}
	if again, err := Migrate(ctx, db, full, backups, nil); err != nil || len(again) != 0 || dump(suggestions) != want {
		t.Errorf("second run applied %v, %v", again, err)
	}
	if files, _ := filepath.Glob(filepath.Join(backups, "*before-0006*")); len(files) != 1 {
		t.Errorf("want one backup before 0006, found %v", files)
	}
}
