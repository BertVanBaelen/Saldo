package ledger

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// Tests of the sync's import clause (importAllowance, checkImported). All
// data is invented.

// storeFetchBefore is StoreFetch as it was before the import clause (commit
// e18ec31), kept to prove that accounts the clause does not apply to sync
// exactly as before.
func storeFetchBefore(ctx context.Context, tx *sql.Tx, accountID, connectionID int64, from string, rows []NewTransaction) (int, error) {
	type slot struct {
		key string
		occ int
	}
	reported := map[slot]bool{}
	refs := map[string]bool{}
	for _, r := range rows {
		switch {
		case r.Status == bank.StatusPending:
			reported[slot{r.DedupeKey, r.Occurrence}] = true
		case r.EntryReference != "":
			refs[r.EntryReference] = true
		}
	}
	q, err := tx.QueryContext(ctx, `SELECT id, dedupe_key, occurrence FROM transactions
		WHERE account_id = ? AND source_connection_id = ? AND status = 'pending' AND booking_date >= ?`,
		accountID, connectionID, from)
	if err != nil {
		return 0, err
	}
	var stale []int64
	for q.Next() {
		var id int64
		var s slot
		if err := q.Scan(&id, &s.key, &s.occ); err != nil {
			q.Close()
			return 0, err
		}
		if !reported[s] {
			stale = append(stale, id)
		}
	}
	q.Close()
	if err := q.Err(); err != nil {
		return 0, err
	}
	for _, id := range stale {
		if _, err := tx.ExecContext(ctx, `DELETE FROM transactions WHERE id = ?`, id); err != nil {
			return 0, err
		}
	}
	keep := make([]NewTransaction, 0, len(rows))
	for _, r := range rows {
		if r.Status != bank.StatusBooked || r.EntryReference == "" {
			keep = append(keep, r)
			continue
		}
		skip, err := checkReference(ctx, tx, &r, refs)
		if err != nil {
			return 0, err
		}
		if !skip {
			keep = append(keep, r)
		}
	}
	return InsertTransactions(ctx, tx, keep)
}

type storeFunc func(context.Context, *sql.Tx, int64, int64, string, []NewTransaction) (int, error)

func fetchWith(t *testing.T, d *sql.DB, store storeFunc, txs ...bank.Transaction) int {
	t.Helper()
	ctx := context.Background()
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	n, err := store(ctx, tx, 1, 1, "", Keyed(1, testIBAN, 1, txs))
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return n
}

// dump is every transaction row but its creation time.
func dump(t *testing.T, d *sql.DB) string {
	t.Helper()
	rows, err := d.Query(`SELECT id || '|' || account_id || '|' || amount || '|' || booking_date || '|' || counterparty_name || '|' ||
		communication || '|' || status || '|' || COALESCE(external_id, '-') || '|' || dedupe_key || '|' || occurrence || '|' ||
		COALESCE(source_connection_id, 0) || '|' || COALESCE(import_batch_id, 0)
		FROM transactions ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var row string
		if err := rows.Scan(&row); err != nil {
			t.Fatal(err)
		}
		out = append(out, row)
	}
	return strings.Join(out, "\n")
}

// TestSyncUnchangedWithoutImports runs one script of fetches (duplicates,
// references, pending rows, a re-referenced row, a reused reference) through
// StoreFetch and through the code before the import clause, and wants the
// same rows after every fetch: for an account without imports, and for one
// whose imports are of other content (another day).
func TestSyncUnchangedWithoutImports(t *testing.T) {
	coffee := csvRow("2026-11-10", -350, "Koffiebar")
	bread := csvRow("2026-11-10", -1230, "Bakkerij")
	tea := csvRow("2026-11-10", -280, "Theehuis")
	pendingTea := tea
	pendingTea.Status = bank.StatusPending
	reused := withRef(csvRow("2026-11-11", -999, "Winkel"), "R1") // R1 again, another date and amount
	script := [][]bank.Transaction{
		{withRef(coffee, "R1"), withRef(coffee, "R2"), bread, bread, pendingTea},
		{withRef(coffee, "R1"), withRef(coffee, "R2b"), bread, bread, withRef(tea, "R3")},
		{withRef(coffee, "R1"), withRef(coffee, "R2b"), withRef(coffee, "R4"), bread, bread, bread, withRef(tea, "R3"), reused},
		{withRef(coffee, "R1"), withRef(coffee, "R2b"), withRef(coffee, "R4"), bread, bread, bread, withRef(tea, "R3"), reused},
	}
	for _, c := range []struct {
		name   string
		before func(*testing.T, *sql.DB)
	}{
		{"no imports at all", func(*testing.T, *sql.DB) {}},
		{"imports on another account", func(t *testing.T, d *sql.DB) { importBoth(t, New(d), file(2, coffee, bread)) }},
		{"imports of other content on this account", func(t *testing.T, d *sql.DB) {
			importBoth(t, New(d), file(1, csvRow("2026-11-01", -350, "Koffiebar")))
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			now, old := importDB(t), importDB(t)
			c.before(t, now)
			c.before(t, old)
			for i, fetch := range script {
				n, o := fetchWith(t, now, StoreFetch, fetch...), fetchWith(t, old, storeFetchBefore, fetch...)
				if a, b := dump(t, now), dump(t, old); n != o || a != b {
					t.Fatalf("fetch %d: %d new, before %d\nnow:\n%s\nbefore:\n%s", i, n, o, a, b)
				}
			}
			if dump(t, now) == "" {
				t.Fatal("nothing stored")
			}
		})
	}
}

func coffees(t *testing.T, d *sql.DB) int {
	return count(t, d, `SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Koffiebar' AND status = 'booked'`)
}

// TestSyncNextToAnImport: a bank row a CSV import already brought is not
// stored again, in either order, however often the sync repeats, while a
// real further purchase of the same content still goes in.
func TestSyncNextToAnImport(t *testing.T) {
	coffee := csvRow("2026-11-10", -350, "Koffiebar")
	coffee.Communication = "Bancontact"

	t.Run("sync after the import, with references", func(t *testing.T) {
		d := importDB(t)
		importBoth(t, New(d), file(1, coffee, coffee)) // two real coffees
		for range 3 {
			syncFetch(t, d, withRef(coffee, "R1"), withRef(coffee, "R2"))
			if n := coffees(t, d); n != 2 {
				t.Fatalf("%d coffees", n)
			}
		}
		// A third coffee that day: stored once, and stable.
		for range 2 {
			syncFetch(t, d, withRef(coffee, "R1"), withRef(coffee, "R2"), withRef(coffee, "R3"))
			if n := coffees(t, d); n != 3 {
				t.Fatalf("third coffee: %d", n)
			}
		}
		// The bank re-references one: still three.
		syncFetch(t, d, withRef(coffee, "R1"), withRef(coffee, "R2x"), withRef(coffee, "R3"))
		if n := coffees(t, d); n != 3 {
			t.Fatalf("re-referenced: %d", n)
		}
	})
	t.Run("sync after the import, without references", func(t *testing.T) {
		d := importDB(t)
		importBoth(t, New(d), file(1, coffee))
		for range 3 {
			syncFetch(t, d, coffee, coffee) // a second coffee the file did not have
			if n := coffees(t, d); n != 2 {
				t.Fatalf("%d coffees", n)
			}
		}
	})
	t.Run("import between two syncs", func(t *testing.T) {
		d := importDB(t)
		syncFetch(t, d, withRef(coffee, "R1"))
		// The file, exported later, has a second coffee: it is new.
		if b, _ := importBoth(t, New(d), file(1, coffee, coffee)); b.Imported != 1 || b.Present != 1 {
			t.Fatalf("import %+v", b)
		}
		for range 3 {
			syncFetch(t, d, withRef(coffee, "R1"), withRef(coffee, "R2"))
			if n := coffees(t, d); n != 2 {
				t.Fatalf("%d coffees", n)
			}
		}
		if n := count(t, d, `SELECT COUNT(*) FROM transactions WHERE import_batch_id IS NOT NULL`); n != 1 {
			t.Errorf("imported rows: %d", n)
		}
	})
	t.Run("other content in the same account is untouched", func(t *testing.T) {
		d := importDB(t)
		importBoth(t, New(d), file(1, coffee))
		bread := csvRow("2026-11-10", -1230, "Bakkerij")
		syncFetch(t, d, withRef(coffee, "R1"), withRef(bread, "B1"), withRef(bread, "B2"), bread)
		if n := count(t, d, `SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Bakkerij'`); n != 3 || coffees(t, d) != 1 {
			t.Errorf("%d breads, %d coffees", n, coffees(t, d))
		}
	})
	t.Run("pending rows are untouched", func(t *testing.T) {
		d := importDB(t)
		importBoth(t, New(d), file(1, coffee))
		p := coffee
		p.Status = bank.StatusPending
		// Occurrence 1 meets the imported row's key (as before the clause);
		// occurrence 2 is stored: the clause does not count pending rows.
		syncFetch(t, d, p, p)
		if n := count(t, d, `SELECT COUNT(*) FROM transactions WHERE status = 'pending'`); n != 1 {
			t.Errorf("%d pending rows", n)
		}
	})
	t.Run("a sync never deletes imported rows", func(t *testing.T) {
		d := importDB(t)
		importBoth(t, New(d), file(1, coffee, coffee))
		syncFetch(t, d, withRef(coffee, "R1"))
		syncFetch(t, d)
		if n := count(t, d, `SELECT COUNT(*) FROM transactions WHERE import_batch_id IS NOT NULL`); n != 2 || coffees(t, d) != 2 {
			t.Errorf("%d imported, %d coffees", n, coffees(t, d))
		}
	})
}
