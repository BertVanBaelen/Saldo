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
