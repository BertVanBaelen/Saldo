package ledger

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

var undoNow = time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)

// Undo removes the rows of the batch with their splits and notes, and only
// those: synced, manual and other batches' rows stay, the batch row stays
// marked undone. The preview counts what the user changed after the import.
func TestUndoRemovesOnlyTheBatch(t *testing.T) {
	d := importDB(t)
	s := New(d)
	ctx := context.Background()
	if err := categorise.SeedDefaults(ctx, d); err != nil {
		t.Fatal(err)
	}
	syncFetch(t, d, withRef(csvRow("2026-11-01", -900, "Synchroon"), "R1"))
	if _, err := d.Exec(`INSERT INTO transactions (account_id, amount, booking_date, status, dedupe_key) VALUES (1, -100, '2026-11-02', 'booked', 'manual-1')`); err != nil {
		t.Fatal(err)
	}
	elders := file(2, csvRow("2026-11-03", -500, "Elders"))
	elders.FileHash = "elders"
	importBoth(t, s, elders)
	b, _ := importBoth(t, s, file(1, csvRow("2026-11-10", -350, "Koffiebar"), csvRow("2026-11-11", -1230, "Bakkerij"), csvRow("2026-11-12", 150000, "Werkgever")))
	id := func(name string) int64 {
		return int64(count(t, d, `SELECT id FROM transactions WHERE counterparty_name = ?`, name))
	}
	for _, q := range []string{
		`UPDATE transactions SET category_id = 2, category_origin = 'manual' WHERE counterparty_name = 'Koffiebar'`,
		`UPDATE transactions SET note = 'Brood voor het weekend' WHERE counterparty_name = 'Bakkerij'`,
		`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (` + strconv.FormatInt(id("Werkgever"), 10) + `, 2, 100000), (` + strconv.FormatInt(id("Werkgever"), 10) + `, 3, 50000)`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}

	p, err := s.UndoPreview(ctx, 1, b.ID, false)
	if err != nil || p != (UndoPreview{Batches: 1, Rows: 3, Changed: 2, Categorised: 1}) {
		t.Fatalf("preview %+v %v", p, err)
	}
	if n := count(t, d, `SELECT COUNT(*) FROM transactions`); n != 6 {
		t.Fatalf("the preview changed the data: %d rows", n)
	}

	batches, removed, err := s.Undo(ctx, 1, b.ID, false, undoNow)
	if err != nil || batches != 1 || removed != 3 {
		t.Fatalf("undo: %d %d %v", batches, removed, err)
	}
	if n := count(t, d, `SELECT COUNT(*) FROM transactions`); n != 3 {
		t.Errorf("%d rows left, want the synced, the manual and the other batch's row", n)
	}
	if n := count(t, d, `SELECT COUNT(*) FROM transaction_splits`); n != 0 {
		t.Errorf("%d splits left", n)
	}
	list, _ := s.Batches(ctx, 1)
	for _, x := range list {
		if undone := x.UndoneAt != nil; undone != (x.ID == b.ID) {
			t.Errorf("batch %d undoneAt %v", x.ID, x.UndoneAt)
		}
	}
	if len(list) != 2 {
		t.Errorf("the history lost a batch: %d", len(list))
	}
}

// Only a viewer who may edit the batch's account undoes it, and only once;
// a batch that brought nothing has nothing to undo.
func TestUndoAccessAndState(t *testing.T) {
	d := importDB(t)
	s := New(d)
	ctx := context.Background()
	coffee := csvRow("2026-11-10", -350, "Koffiebar")
	b, _ := importBoth(t, s, file(1, coffee))
	again, _ := importBoth(t, s, file(1, coffee)) // an identical file: a batch with 0 new rows
	if again.Imported != 0 {
		t.Fatalf("again: %+v", again)
	}
	for _, c := range []struct {
		viewer, batch int64
		want          error
	}{{3, b.ID, apperr.ErrNotFound}, {2, b.ID, apperr.ErrForbidden}, {1, 99, apperr.ErrNotFound}} {
		for _, run := range []bool{false, true} {
			if _, err := s.UndoPreview(ctx, c.viewer, c.batch, run); !errors.Is(err, c.want) {
				t.Errorf("preview user %d batch %d: %v", c.viewer, c.batch, err)
			}
			if _, _, err := s.Undo(ctx, c.viewer, c.batch, run, undoNow); !errors.Is(err, c.want) {
				t.Errorf("undo user %d batch %d: %v", c.viewer, c.batch, err)
			}
		}
	}
	if n := count(t, d, `SELECT COUNT(*) FROM transactions`); n != 1 {
		t.Fatalf("a refused undo removed rows: %d left", n)
	}
	var invalid *apperr.InvalidError
	if _, _, err := s.Undo(ctx, 1, again.ID, false, undoNow); !errors.As(err, &invalid) || invalid.Message != msgNothingToDo {
		t.Errorf("0-row batch: %v", err)
	}
	if _, _, err := s.Undo(ctx, 1, b.ID, false, undoNow); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Undo(ctx, 1, b.ID, false, undoNow); !errors.As(err, &invalid) || invalid.Message != msgUndone {
		t.Errorf("twice: %v", err)
	}
}

// A file over several accounts is one run: the history gives its batches
// one Run, and undoing the run removes all of them or, when one account is not
// the viewer's to edit, none.
func TestUndoRun(t *testing.T) {
	d := importDB(t)
	s := New(d)
	ctx := context.Background()
	two, _, err := s.ImportFiles(ctx, 1, []ImportFile{file(1, csvRow("2026-11-10", -350, "Koffiebar")), file(2, csvRow("2026-11-11", -1230, "Bakkerij"))}, nil, ImportOptions{}, false)
	if err != nil {
		t.Fatal(err)
	}
	list, _ := s.Batches(ctx, 1)
	if len(list) != 2 || list[0].Run == 0 || list[0].Run != list[1].Run {
		t.Fatalf("run in the history: %+v", list)
	}
	// Account 1 stops being editable for the viewer: the run is refused whole.
	if _, err := d.Exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 1 AND user_id = 1`); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Undo(ctx, 1, two[1].ID, true, undoNow); !errors.Is(err, apperr.ErrForbidden) || count(t, d, `SELECT COUNT(*) FROM transactions`) != 2 {
		t.Fatalf("partial undo of a run: %v", err)
	}
	if _, err := d.Exec(`UPDATE account_access SET permission = 'edit' WHERE account_id = 1 AND user_id = 1`); err != nil {
		t.Fatal(err)
	}
	batches, removed, err := s.Undo(ctx, 1, two[1].ID, true, undoNow)
	if err != nil || batches != 2 || removed != 2 {
		t.Fatalf("undo run: %d %d %v", batches, removed, err)
	}
}

// Import, undo and re-import leave the data exactly as before the first
// import plus the file once; (the rows are gone, so the sync rule has nothing of the file to count).
func TestReimportAfterUndo(t *testing.T) {
	d := importDB(t)
	s := New(d)
	ctx := context.Background()
	syncFetch(t, d, withRef(csvRow("2026-11-01", -900, "Synchroon"), "R1"))
	before := dump(t, d)
	coffee, bread := csvRow("2026-11-10", -350, "Koffiebar"), csvRow("2026-11-11", -1230, "Bakkerij")
	f := file(1, coffee, bread)

	first, _ := importBoth(t, s, f)
	if _, _, err := s.Undo(ctx, 1, first.ID, false, undoNow); err != nil {
		t.Fatal(err)
	}
	if got := dump(t, d); got != before {
		t.Fatalf("after the undo:\n%s\nwant:\n%s", got, before)
	}
	again, _ := importBoth(t, s, f)
	if again.Imported != 2 || again.Present != 0 {
		t.Errorf("re-import: %+v", again)
	}
	if n := count(t, d, `SELECT COUNT(*) FROM transactions WHERE import_batch_id = ?`, again.ID); n != 2 {
		t.Errorf("%d rows of the new batch", n)
	}
	if n := count(t, d, `SELECT COUNT(*) FROM transactions`); n != 3 {
		t.Errorf("%d rows, want the synced one and the file once", n)
	}
}
