package db

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
)

// 0022 (0.9.1-3) adds recurring_items.category_id: a database of 0.9.0 (0001 to
// 0021) that holds items migrates with every row kept and no category, after
// a backup; from then on the column refers to a category, and deleting the
// category sets it back to NULL.
func TestMigration0022AddsTheItemCategoryWithoutTouchingRows(t *testing.T) {
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
		if e.Name() < "0022" {
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
	exec(`INSERT INTO accounts (id, type, source, name) VALUES (1, 'current', 'manual', 'Zicht')`)
	exec(`INSERT INTO categories (id, name, type) VALUES (1, 'Wonen', 'expense')`)
	exec(`INSERT INTO recurring_items (id, account_id, counterparty, counterparty_iban, description, amount, frequency, expected_day, kind, state)
		VALUES (1, 1, 'Immo', 'BE68539007547034', 'Huur', -100500, 'monthly', 1, 'expense', 'confirmed'),
		       (2, 1, 'Werkgever', NULL, 'Salaris', 285000, 'monthly', 2, 'income', 'confirmed')`)
	dump := func() string {
		t.Helper()
		var s string
		if err := db.QueryRow(`SELECT group_concat(id || ':' || description || ':' || amount || ':' || kind || ':' || state || ':' ||
			COALESCE(counterparty_iban, '-'), ' ') FROM recurring_items`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := dump()

	applied, err := Migrate(ctx, db, full, backups, nil)
	if err != nil || !slices.Equal(applied, []int{22}) {
		t.Fatalf("applied %v, %v; want [22]", applied, err)
	}
	if files, err := os.ReadDir(backups); err != nil || len(files) != 1 || !strings.Contains(files[0].Name(), "before-0022") {
		t.Errorf("backup before 0022: %v, %v", files, err)
	}
	var withCategory int
	if err := db.QueryRow(`SELECT COUNT(*) FROM recurring_items WHERE category_id IS NOT NULL`).Scan(&withCategory); err != nil || withCategory != 0 || dump() != before {
		t.Errorf("after 0022: %d items with a category (%v); rows %s, was %s", withCategory, err, dump(), before)
	}

	// The column refers to a category (a missing one is refused) and goes back to NULL with it.
	if _, err := db.Exec(`UPDATE recurring_items SET category_id = 99 WHERE id = 1`); err == nil {
		t.Error("an item took a category that does not exist")
	}
	exec(`UPDATE recurring_items SET category_id = 1 WHERE id = 1`)
	exec(`DELETE FROM categories WHERE id = 1`)
	if err := db.QueryRow(`SELECT COUNT(*) FROM recurring_items WHERE category_id IS NOT NULL`).Scan(&withCategory); err != nil || withCategory != 0 || dump() != before {
		t.Errorf("after deleting the category: %d items with one (%v); rows %s", withCategory, err, dump())
	}
	if again, err := Migrate(ctx, db, full, backups, nil); err != nil || len(again) != 0 {
		t.Errorf("second run applied %v, %v", again, err)
	}
}
