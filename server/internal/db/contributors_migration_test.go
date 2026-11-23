package db

import (
	"context"
	"io/fs"
	"path/filepath"
	"slices"
	"testing"
	"testing/fstest"
)

// 0020 adds contributors (0.8.1-7): an 0.8.0 database (0001-0017) migrates
// with every row kept and no contributor; one IBAN per account; the rows go
// with their account, a deleted user leaves them with NULL.
func TestMigration0020AddsContributorsWithoutTouchingRows(t *testing.T) {
	ctx := context.Background()
	db, err := Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	full := Migrations()
	old := fstest.MapFS{}
	entries, err := fs.ReadDir(full, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() < "0018" {
			b, err := fs.ReadFile(full, e.Name())
			if err != nil {
				t.Fatal(err)
			}
			old[e.Name()] = &fstest.MapFile{Data: b}
		}
	}
	backups := filepath.Join(t.TempDir(), "backups")
	if _, err := Migrate(ctx, db, old, backups, nil); err != nil {
		t.Fatal(err)
	}
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.com', 'A'), (2, 'b@example.com', 'B')`)
	exec(`INSERT INTO accounts (id, type, source, iban, name, shared) VALUES (1, 'current', 'bank', 'BE68539007547034', 'Gezin', 1)`)
	exec(`INSERT INTO account_access (account_id, user_id, role, permission, contribution_share) VALUES (1, 1, 'manager', 'edit', 60), (1, 2, 'member', 'edit', 40)`)
	exec(`INSERT INTO contribution_senders (account_id, user_id, iban) VALUES (1, 2, 'BE62510007547061')`)
	dump := func() string {
		t.Helper()
		var s string
		if err := db.QueryRow(`SELECT (SELECT group_concat(user_id || ':' || contribution_share, ' ') FROM account_access) || ' / ' ||
			(SELECT group_concat(user_id || ':' || iban, ' ') FROM contribution_senders)`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := dump()
	applied, err := Migrate(ctx, db, full, backups, nil)
	if err != nil || !slices.Contains(applied, 20) {
		t.Fatalf("applied %v, %v", applied, err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM contributors`).Scan(&n); err != nil || n != 0 || dump() != before {
		t.Errorf("contributors %d (%v); rows %s, was %s", n, err, dump(), before)
	}
	exec(`INSERT INTO contributors (account_id, name, iban, share, created_by, link_user) VALUES (1, 'Mama', 'BE37000000007193', 20, 1, 2)`)
	for name, q := range map[string]string{
		"same IBAN twice": `INSERT INTO contributors (account_id, name, iban) VALUES (1, 'Oma', 'BE37000000007193')`,
		"empty name":      `INSERT INTO contributors (account_id, name, iban) VALUES (1, '', 'BE09000000000303')`,
		"share 101":       `INSERT INTO contributors (account_id, name, iban, share) VALUES (1, 'Oma', 'BE09000000000303', 101)`,
		"no IBAN":         `INSERT INTO contributors (account_id, name) VALUES (1, 'Oma')`,
		"unknown account": `INSERT INTO contributors (account_id, name, iban) VALUES (9, 'Oma', 'BE09000000000303')`,
	} {
		if _, err := db.Exec(q); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	exec(`DELETE FROM users WHERE id = 2`)
	var link, creator any
	if err := db.QueryRow(`SELECT link_user, created_by FROM contributors`).Scan(&link, &creator); err != nil || link != nil || creator != int64(1) {
		t.Errorf("after deleting user 2: link %v, creator %v (%v)", link, creator, err)
	}
	exec(`DELETE FROM accounts WHERE id = 1`)
	if err := db.QueryRow(`SELECT COUNT(*) FROM contributors`).Scan(&n); err != nil || n != 0 {
		t.Errorf("%d contributors outlive their account (%v)", n, err)
	}
	if again, err := Migrate(ctx, db, full, backups, nil); err != nil || len(again) != 0 {
		t.Errorf("second run applied %v, %v", again, err)
	}
}
