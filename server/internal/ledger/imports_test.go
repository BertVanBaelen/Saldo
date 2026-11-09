package ledger

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
)

// testIBAN is account 1's IBAN, a documentation example; otherIBAN is
// another valid invented IBAN. All data here is invented.
const (
	testIBAN  = "BE68539007547034"
	otherIBAN = "BE71096123456769"
)

// importDB has user 1 (edit) and user 2 (read) on bank account 1, fed by
// connection 1, and user 1's manual account 2 (no IBAN).
func importDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.com', 'A'), (2, 'b@example.com', 'B'), (3, 'c@example.com', 'C')`,
		`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, status) VALUES (1, 1, 'fake', 'Argenta', 'active')`,
		`INSERT INTO accounts (id, type, source, iban, name) VALUES (1, 'current', 'bank', '` + testIBAN + `', 'Zicht')`,
		`INSERT INTO accounts (id, type, source, name) VALUES (2, 'savings', 'manual', 'Spaarpot')`,
		`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 1, 'manager', 'edit'), (1, 2, 'member', 'read'), (2, 1, 'manager', 'edit')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return d
}

func count(t *testing.T, d *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := d.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func csvRow(date string, amount int64, name string) bank.Transaction {
	return bank.Transaction{BookingDate: date, Amount: amount, Currency: "EUR", CounterpartyName: name,
		Status: bank.StatusBooked, Raw: []byte(`{"Bedrag":"x"}`)}
}

// file is an import of txs into account, lines from 2, no file account.
func file(account int64, txs ...bank.Transaction) ImportFile {
	f := ImportFile{AccountID: account, Source: "csv", FileName: "a.csv", FileHash: "h"}
	for i, t := range txs {
		f.Rows = append(f.Rows, ImportRow{Line: i + 2, Tx: t})
	}
	return f
}

// importBoth runs a dry run and then the import, and fails unless both
// give the same counts and errors.
func importBoth(t *testing.T, s *Store, f ImportFile) (Batch, []LineError) {
	t.Helper()
	ctx := context.Background()
	dry, dryErrs, err := s.Import(ctx, 1, f, true)
	if err != nil {
		t.Fatal(err)
	}
	b, errs, err := s.Import(ctx, 1, f, false)
	if err != nil {
		t.Fatal(err)
	}
	if dry.Imported != b.Imported || dry.Present != b.Present || dry.Invalid != b.Invalid || dry.Overlap != b.Overlap || !slices.Equal(dryErrs, errs) {
		t.Fatalf("dry run %+v %v, import %+v %v", dry, dryErrs, b, errs)
	}
	return b, errs
}

// syncFetch stores one fetch of account 1 from connection 1.
func syncFetch(t *testing.T, d *sql.DB, txs ...bank.Transaction) {
	t.Helper()
	ctx := context.Background()
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := StoreFetch(ctx, tx, 1, 1, "", Keyed(1, testIBAN, 1, txs)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func withRef(t bank.Transaction, ref string) bank.Transaction { t.EntryReference = ref; return t }

func TestImport(t *testing.T) {
	d := importDB(t)
	s := New(d)
	ctx := context.Background()
	coffee := csvRow("2026-11-10", -350, "Koffiebar")
	bread := csvRow("2026-11-11", -1230, "Bakkerij")
	f := file(1, coffee, coffee, bread)
	f.Invalid = 1

	// The dry run gives the real numbers and writes nothing.
	dry, _, err := s.Import(ctx, 1, f, true)
	if err != nil {
		t.Fatal(err)
	}
	if count(t, d, `SELECT COUNT(*) FROM transactions`)+count(t, d, `SELECT COUNT(*) FROM import_batches`) != 0 {
		t.Fatal("the dry run wrote")
	}
	b, errs, err := s.Import(ctx, 1, f, false)
	if err != nil {
		t.Fatal(err)
	}
	if b.Imported != 3 || b.Present != 0 || b.Invalid != 1 || dry.Imported != b.Imported || dry.Present != b.Present || b.CreatedAt == "" || len(errs) != 0 {
		t.Errorf("import %+v, dry run %+v", b, dry)
	}
	if count(t, d, `SELECT COUNT(*) FROM transactions WHERE import_batch_id = ? AND source_connection_id IS NULL
		AND status = 'booked' AND category_id IS NULL AND raw_payload IS NOT NULL`, b.ID) != 3 {
		t.Error("imported rows lack the batch, or have a connection or category")
	}

	// Again, plus one new row: only that one goes in; a dry run agrees.
	f.Rows = append(f.Rows, ImportRow{Line: 9, Tx: csvRow("2026-11-12", 150000, "Werkgever")})
	b, _ = importBoth(t, s, f)
	if b.Imported != 1 || b.Present != 3 {
		t.Errorf("overlap: %+v", b)
	}
	if n := count(t, d, `SELECT rows_imported * 100 + rows_duplicate * 10 + rows_skipped FROM import_batches WHERE id = ?`, b.ID); n != 131 {
		t.Errorf("batch row counts %d", n)
	}
	list, err := s.Batches(ctx, 2) // read-only member sees them
	if err != nil || len(list) != 2 || list[0].ID != b.ID {
		t.Errorf("batches: %+v %v", list, err)
	}
	if list, _ := s.Batches(ctx, 3); len(list) != 0 {
		t.Errorf("a stranger sees %d batches", len(list))
	}

	for _, c := range []struct {
		viewer, account int64
		want            error
	}{{2, 1, apperr.ErrForbidden}, {3, 1, apperr.ErrNotFound}, {2, 2, apperr.ErrNotFound}, {1, 99, apperr.ErrNotFound}} {
		g := f
		g.AccountID = c.account
		for _, dry := range []bool{true, false} {
			if _, _, err := s.Import(ctx, c.viewer, g, dry); !errors.Is(err, c.want) {
				t.Errorf("user %d account %d dry %v: %v", c.viewer, c.account, dry, err)
			}
		}
	}
	var invalid *apperr.InvalidError
	if _, _, err := s.Import(ctx, 1, ImportFile{AccountID: 2, Source: "csv", FileName: "x", FileHash: "h", Invalid: 3}, false); !errors.As(err, &invalid) ||
		!strings.Contains(invalid.Message, "Geen enkele regel") {
		t.Errorf("no readable rows: %v", err)
	}
	if count(t, d, `SELECT COUNT(*) FROM import_batches WHERE account_id = 2`) != 0 {
		t.Error("a batch without rows was stored")
	}
}

// TestImportContentRule covers dropPresent: k equal rows in the file against
// m stored booked rows keep k-m, whatever source stored them.
func TestImportContentRule(t *testing.T) {
	coffee := csvRow("2026-11-10", -350, "Koffiebar")
	coffee.Communication = "Bancontact"
	t.Run("file against synced rows with references", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		syncFetch(t, d, withRef(coffee, "R1"), withRef(coffee, "R2"))
		// Three in the file, two stored: one is new.
		if b, _ := importBoth(t, s, file(1, coffee, coffee, coffee)); b.Imported != 1 || b.Present != 2 {
			t.Errorf("first: %+v", b)
		}
		if b, _ := importBoth(t, s, file(1, coffee, coffee, coffee)); b.Imported != 0 || b.Present != 3 {
			t.Errorf("again: %+v", b)
		}
		if n := count(t, d, `SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Koffiebar'`); n != 3 {
			t.Errorf("%d coffees", n)
		}
	})
	t.Run("file against synced rows without references", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		syncFetch(t, d, coffee) // stored as hash occurrence 1
		// The kept row has occurrence 2: no clash with the stored one, so it
		// goes in and is not refused by the unique key.
		if b, _ := importBoth(t, s, file(1, coffee, coffee)); b.Imported != 1 || b.Present != 1 {
			t.Errorf("first: %+v", b)
		}
		if n := count(t, d, `SELECT COUNT(*) FROM transactions WHERE import_batch_id IS NOT NULL AND occurrence = 2`); n != 1 {
			t.Errorf("kept occurrence: %d", n)
		}
	})
	t.Run("file against an earlier import", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		importBoth(t, s, file(1, coffee))
		// Two identical purchases on one day: the second is new.
		if b, _ := importBoth(t, s, file(1, coffee, coffee)); b.Imported != 1 || b.Present != 1 {
			t.Errorf("two coffees: %+v", b)
		}
		if b, _ := importBoth(t, s, file(1, coffee, coffee)); b.Imported != 0 || b.Present != 2 {
			t.Errorf("again: %+v", b)
		}
	})
	t.Run("only equal content matches, case and spaces aside", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		syncFetch(t, d, withRef(coffee, "R1"))
		loud := coffee
		loud.CounterpartyName, loud.Communication = "  KOFFIEBAR ", "bancontact"
		otherName, otherText, otherDay, otherAmount := coffee, coffee, coffee, coffee
		otherName.CounterpartyName = "Koffiebar Zuid"
		otherText.Communication = "Bancontact 2"
		otherDay.BookingDate = "2026-11-11"
		otherAmount.Amount = -351
		b, _ := importBoth(t, s, file(1, loud, otherName, otherText, otherDay, otherAmount))
		if b.Imported != 4 || b.Present != 1 {
			t.Errorf("%+v", b)
		}
	})
	t.Run("a pending row does not block its booked twin", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		p := coffee
		p.Status = bank.StatusPending
		syncFetch(t, d, p)
		// Not dropped by content (pending rows do not count), and stored next
		// to the pending row instead of being refused by its key.
		if b, _ := importBoth(t, s, file(1, coffee)); b.Imported != 1 || b.Present != 0 {
			t.Errorf("%+v", b)
		}
		if coffees(t, d) != 1 || count(t, d, `SELECT COUNT(*) FROM transactions WHERE status = 'pending'`) != 1 {
			t.Errorf("want pending + booked:\n%s", dump(t, d))
		}
		// Again: the booked row counts, nothing is added.
		if b, _ := importBoth(t, s, file(1, coffee)); b.Imported != 0 || b.Present != 1 {
			t.Errorf("re-import %+v", b)
		}
		// The bank books it: the pending row goes, no second booked row.
		for _, booked := range []bank.Transaction{coffee, withRef(coffee, "R1")} {
			syncFetch(t, d, booked)
			if n := count(t, d, `SELECT COUNT(*) FROM transactions`); n != 1 || coffees(t, d) != 1 {
				t.Errorf("after the booking sync:\n%s", dump(t, d))
			}
		}
		// Two coffees that day in a later file: one more, above the moved slot.
		if b, _ := importBoth(t, s, file(1, coffee, coffee)); b.Imported != 1 || b.Present != 1 || coffees(t, d) != 2 {
			t.Errorf("overlapping file %+v\n%s", b, dump(t, d))
		}
	})
	t.Run("import, then pending, then booked", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		p := coffee
		p.Status = bank.StatusPending
		importBoth(t, s, file(1, coffee))
		syncFetch(t, d, p)
		syncFetch(t, d, coffee)
		if n := count(t, d, `SELECT COUNT(*) FROM transactions`); n != 1 || coffees(t, d) != 1 {
			t.Errorf("\n%s", dump(t, d))
		}
	})
	t.Run("synced rows are not changed", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		syncFetch(t, d, withRef(coffee, "R1"), withRef(coffee, "R2"))
		snapshot := func() string {
			rows, _ := d.Query(`SELECT id || dedupe_key || occurrence || amount || COALESCE(import_batch_id, '-') FROM transactions WHERE source_connection_id = 1 ORDER BY id`)
			defer rows.Close()
			var out []string
			for rows.Next() {
				var row string
				rows.Scan(&row)
				out = append(out, row)
			}
			return strings.Join(out, ",")
		}
		before := snapshot()
		importBoth(t, s, file(1, coffee, coffee, coffee))
		if after := snapshot(); after != before || before == "" {
			t.Errorf("synced rows %q → %q", before, after)
		}
	})
}

// TestImportAccountGuard checks the file's own account column against the
// chosen account.
func TestImportAccountGuard(t *testing.T) {
	d := importDB(t)
	s := New(d)
	ctx := context.Background()
	coffee := csvRow("2026-11-10", -350, "Koffiebar")
	bread := csvRow("2026-11-11", -1230, "Bakkerij")
	salary := csvRow("2026-11-12", 150000, "Werkgever")
	f := file(1, coffee, bread, salary)
	f.Rows[0].Account = testIBAN
	f.Rows[1].Account = otherIBAN // line 3: another account
	f.Invalid = 2                 // two unreadable rows from the parser

	b, errs := importBoth(t, s, f)
	want := []LineError{{3, "Rekening BE71 •••• •••• 6769 in het bestand is niet de gekozen rekening."}}
	if b.Imported != 2 || b.Invalid != 3 || !slices.Equal(errs, want) {
		t.Errorf("import %+v errors %v", b, errs)
	}
	if strings.Contains(errs[0].Message, otherIBAN) || strings.Contains(errs[0].Message, "0961") || strings.Contains(errs[0].Message, "1230") {
		t.Errorf("message shows too much: %q", errs[0].Message)
	}
	if count(t, d, `SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Bakkerij'`) != 0 {
		t.Error("the other account's row was imported")
	}
	if count(t, d, `SELECT rows_skipped FROM import_batches WHERE id = ?`, b.ID) != 3 {
		t.Error("batch rows_skipped")
	}

	// A manual account without an IBAN cannot check a file of one account.
	one := file2(f)
	one.Rows = slices.Clone(f.Rows)
	one.Rows[1].Account = testIBAN
	if b, errs := importBoth(t, s, one); b.Imported != 3 || b.Invalid != 2 || len(errs) != 0 {
		t.Errorf("manual account %+v %v", b, errs)
	}

	// Every readable row of another account: the import refuses it without a
	// batch; the preview counts it all as invalid.
	all := file(1, coffee, bread)
	for i := range all.Rows {
		all.Rows[i].Account = otherIBAN
	}
	batches := count(t, d, `SELECT COUNT(*) FROM import_batches`)
	var invalid *apperr.InvalidError
	if _, _, err := s.Import(ctx, 1, all, false); !errors.As(err, &invalid) || invalid.Message != "Dit bestand hoort bij een andere rekening dan de gekozen rekening." {
		t.Errorf("all of another account: %v", err)
	}
	if count(t, d, `SELECT COUNT(*) FROM import_batches`) != batches {
		t.Error("a batch was stored")
	}
	dry, errs, err := s.Import(ctx, 1, all, true)
	if err != nil || dry.Imported != 0 || dry.Invalid != 2 || len(errs) != 2 || errs[1].Line != 3 {
		t.Errorf("dry run %+v %v %v", dry, errs, err)
	}
}

// TestImportMixedFile: a file of several own accounts into an account
// without an IBAN is refused whole, whatever the row order.
func TestImportMixedFile(t *testing.T) {
	d := importDB(t)
	s := New(d)
	ctx := context.Background()
	f := file(2, csvRow("2026-11-10", -350, "Koffiebar"), csvRow("2026-11-11", -1230, "Bakkerij"), csvRow("2026-11-12", 150000, "Werkgever"))
	f.Rows[0].Account = testIBAN
	f.Rows[2].Account = otherIBAN // line 3 has no account; the parser skipped one more row
	f.Invalid = 1
	reversed := f
	reversed.Rows = slices.Clone(f.Rows)
	slices.Reverse(reversed.Rows)
	for _, g := range []ImportFile{f, reversed} {
		dry, errs, err := s.Import(ctx, 1, g, true)
		if err != nil || dry.Imported != 0 || dry.Present != 0 || dry.Invalid != 4 || dry.Overlap != 0 || len(errs) != 3 {
			t.Fatalf("dry run %+v %v %v", dry, errs, err)
		}
		for _, e := range errs {
			if e.Message != msgMixedRow {
				t.Errorf("row error %+v", e)
			}
		}
		var invalid *apperr.InvalidError
		if _, _, err := s.Import(ctx, 1, g, false); !errors.As(err, &invalid) || invalid.Message != msgMixedFile {
			t.Errorf("import: %v", err)
		}
	}
	if n := count(t, d, `SELECT COUNT(*) FROM import_batches`) + count(t, d, `SELECT COUNT(*) FROM transactions`); n != 0 {
		t.Errorf("a refused file stored %d rows", n)
	}
	// Into an account with an IBAN only the other account's row is refused.
	f.AccountID = 1
	if b, errs := importBoth(t, s, f); b.Imported != 2 || b.Invalid != 2 || len(errs) != 1 || errs[0].Line != 4 {
		t.Errorf("IBAN account %+v %v", b, errs)
	}
}

// TestImportOverlap: Overlap counts the new rows dated from the account's
// earliest synced booked row on.
func TestImportOverlap(t *testing.T) {
	coffee := csvRow("2026-11-05", -350, "Koffiebar")
	before, after := csvRow("2026-11-04", -100, "Bakkerij"), csvRow("2026-11-06", -200, "Slager")
	t.Run("from the earliest synced booked row", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		early := csvRow("2026-11-01", -1, "Wacht")
		early.Status = bank.StatusPending // pending rows do not start the period
		syncFetch(t, d, withRef(coffee, "R1"), withRef(csvRow("2026-11-07", -5, "Bus"), "R2"), early)
		atD := csvRow("2026-11-05", -999, "Apotheek")
		// coffee is present: not new, so not counted.
		b, _ := importBoth(t, s, file(1, before, atD, after, coffee))
		if b.Imported != 3 || b.Present != 1 || b.Invalid != 0 || b.Overlap != 2 {
			t.Errorf("%+v", b)
		}
		if b, _ := importBoth(t, s, file(1, before, atD, after, coffee)); b.Imported != 0 || b.Overlap != 0 {
			t.Errorf("again %+v", b)
		}
	})
	t.Run("no synced rows", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		if b, _ := importBoth(t, s, file(2, before, coffee, after)); b.Imported != 3 || b.Overlap != 0 {
			t.Errorf("%+v", b)
		}
	})
	t.Run("an earlier import is not synced", func(t *testing.T) {
		d := importDB(t)
		s := New(d)
		importBoth(t, s, file(1, before))
		if b, _ := importBoth(t, s, file(1, coffee, after)); b.Imported != 2 || b.Overlap != 0 {
			t.Errorf("%+v", b)
		}
	})
}

// file2 is f for the manual account 2.
func file2(f ImportFile) ImportFile {
	f.AccountID = 2
	return f
}

// An import does not touch synced rows, and a sync's pending cleanup does
// not touch imported rows (they have no connection).
func TestImportNextToTheSync(t *testing.T) {
	d := importDB(t)
	s := New(d)
	coffee := csvRow("2026-11-10", -350, "Koffiebar")
	pending := coffee
	pending.Status = bank.StatusPending
	synced := bank.Transaction{EntryReference: "R1", BookingDate: "2026-11-09", Amount: -999, CounterpartyName: "Winkel", Status: bank.StatusBooked}
	syncFetch(t, d, synced)
	before := count(t, d, `SELECT COUNT(*) FROM transactions WHERE source_connection_id = 1 AND external_id = 'R1' AND amount = -999`)
	asCSV := synced
	asCSV.EntryReference = ""
	if b, _ := importBoth(t, s, file(1, coffee, asCSV)); b.Imported != 1 || b.Present != 1 {
		t.Errorf("import %+v", b)
	}
	if before != 1 || count(t, d, `SELECT COUNT(*) FROM transactions WHERE source_connection_id = 1 AND external_id = 'R1' AND amount = -999`) != 1 {
		t.Error("the import changed a synced row")
	}
	// A fetch that reports nothing pending in the window deletes only this
	// connection's pending rows; the bank then reporting the coffee pending
	// meets the imported row's key and is not added.
	syncFetch(t, d, pending)
	syncFetch(t, d)
	if n := count(t, d, `SELECT COUNT(*) FROM transactions WHERE import_batch_id IS NOT NULL AND counterparty_name = 'Koffiebar'`); n != 1 ||
		count(t, d, `SELECT COUNT(*) FROM transactions`) != 2 {
		t.Errorf("imported rows left: %d", n)
	}
	if n := count(t, d, `SELECT COUNT(*) FROM balance_snapshots`) + count(t, d, `SELECT COUNT(*) FROM account_sources`); n != 0 {
		t.Errorf("the import wrote %d balance or source rows", n)
	}
}
