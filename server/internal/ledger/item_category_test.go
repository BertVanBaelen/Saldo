package ledger_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// The category of a recurring item (plan 0.9.1-3) on reportWorld: Wonen 1, Vrije tijd 3 with the subcategory
// Restaurant 28, Sparen 26 (saving) with Pensioensparen 27, Salaris 7 (income) with Bonus 29. An expense item takes
// an expense category that does not count as saved (a top one or a subcategory), a saving item a saving category,
// nothing else takes one; a stored category that stops fitting is cleared, a named one that does not fit is refused.
func TestRecurringItemCategory(t *testing.T) {
	ctx := context.Background()
	d, s := planningFixture(t)
	create := func(viewer int64, body string) (ledger.Item, error) {
		t.Helper()
		var in ledger.ItemInput
		if err := json.Unmarshal([]byte(body), &in); err != nil {
			t.Fatal(err)
		}
		return s.CreateItem(ctx, viewer, in, reportNow, planning.Key)
	}
	patch := func(id int64, body string) (ledger.Item, error) {
		t.Helper()
		var f ledger.ItemFields
		if err := json.Unmarshal([]byte(body), &f); err != nil {
			t.Fatal(err)
		}
		return s.UpdateItem(ctx, bert, id, f, reportNow)
	}
	item := func(account int64, rest string) string {
		return fmt.Sprintf(`{"accountId":%d,"description":"Huur","counterparty":"Immo Verhaeghe","amount":-100500,"frequency":"monthly","day":1,"kind":"expense"%s}`, account, rest)
	}
	stored := func(id int64) string { // the category as the database holds it, "-" for none
		t.Helper()
		var c sql.NullInt64
		if err := d.QueryRow(`SELECT category_id FROM recurring_items WHERE id = ?`, id).Scan(&c); err != nil {
			t.Fatal(err)
		}
		if !c.Valid {
			return "-"
		}
		return fmt.Sprint(c.Int64)
	}
	const (
		notExpense = "Kies een uitgavencategorie die niet als gespaard telt."
		notSaving  = "Kies een spaarcategorie."
		neither    = "Alleen een uitgave of sparen krijgt een categorie."
	)

	// Refused: every message; nothing is stored.
	for _, c := range []struct {
		account int64
		rest    string
		message string
	}{
		{rwZicht, `,"categoryId":9999`, "Die categorie bestaat niet."},
		{rwZicht, `,"categoryId":26`, notExpense},                // a saving top
		{rwZicht, `,"categoryId":27`, notExpense},                // a subcategory of a saving top
		{rwZicht, `,"categoryId":7`, notExpense},                 // an income top
		{rwZicht, `,"categoryId":29`, notExpense},                // an income subcategory
		{rwZicht, `,"kind":"saving","categoryId":3`, notSaving},  // an expense top
		{rwZicht, `,"kind":"saving","categoryId":28`, notSaving}, // an expense subcategory
		{rwZicht, `,"kind":"saving","categoryId":7`, notSaving},  // an income top
		{rwZicht, `,"kind":"saving","categoryId":9999`, "Die categorie bestaat niet."},
		{rwZicht, `,"kind":"income","amount":100500,"categoryId":7`, neither},
		{rwZicht, `,"kind":"transfer","amount":45000,"categoryId":1`, neither},
		{rwPot, `,"kind":"contribution","amount":45000,"categoryId":1`, neither},
	} {
		_, err := create(bert, item(c.account, c.rest))
		wantInvalid(t, c.rest, err, c.message)
	}
	if n := countRows(t, d, `SELECT COUNT(*) FROM recurring_items`); n != 0 {
		t.Fatalf("%d items after only refused ones", n)
	}

	// Accepted: a top, a subcategory, a saving top and its subcategory for a saving item, null and none.
	made := map[string]ledger.Item{}
	for name, body := range map[string]string{
		"top":    item(rwZicht, `,"categoryId":1`),
		"sub":    item(rwZicht, `,"categoryId":28`),
		"saving": item(rwZicht, `,"kind":"saving","categoryId":26`),
		"subsav": item(rwZicht, `,"kind":"saving","categoryId":27`),
		"null":   item(rwZicht, `,"categoryId":null`),
		"none":   item(rwZicht, ``),
	} {
		it, err := create(bert, body)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		made[name] = it
	}
	for name, want := range map[string]string{"top": "1", "sub": "28", "saving": "26", "subsav": "27", "null": "-", "none": "-"} {
		if got := stored(made[name].ID); got != want {
			t.Errorf("%s: stored %s, want %s", name, got, want)
		}
	}
	if made["sub"].CategoryID == nil || *made["sub"].CategoryID != 28 || made["none"].CategoryID != nil {
		t.Errorf("the answer: %v and %v", made["sub"].CategoryID, made["none"].CategoryID)
	}
	if b, _ := json.Marshal(made["none"]); !strings.Contains(string(b), `"categoryId":null`) {
		t.Errorf("an item without a category answers %s", b)
	}
	items, err := s.PlanningItems(ctx, bert, "persoonlijk")
	if err != nil {
		t.Fatal(err)
	}
	listed := map[int64]*int64{}
	for _, it := range items {
		listed[it.ID] = it.CategoryID
	}
	if c := listed[made["top"].ID]; c == nil || *c != 1 || listed[made["none"].ID] != nil {
		t.Errorf("the list shows %v and %v", c, listed[made["none"].ID])
	}

	// Update: a description keeps it; null clears it; a named one is checked; a refused update changes nothing.
	top := made["top"].ID
	if it, err := patch(top, `{"description":"Huur nieuw"}`); err != nil || it.CategoryID == nil || *it.CategoryID != 1 || stored(top) != "1" {
		t.Errorf("description only: %+v, %v", it, err)
	}
	_, err = patch(top, `{"categoryId":26}`)
	wantInvalid(t, "patch to a saving category", err, notExpense)
	_, err = patch(top, `{"categoryId":9999}`)
	wantInvalid(t, "patch to an unknown category", err, "Die categorie bestaat niet.")
	if stored(top) != "1" {
		t.Error("a refused patch changed the category")
	}
	if it, err := patch(top, `{"categoryId":28}`); err != nil || *it.CategoryID != 28 || stored(top) != "28" {
		t.Errorf("patch to a sub: %+v, %v", it, err)
	}
	if it, err := patch(top, `{"categoryId":null}`); err != nil || it.CategoryID != nil || stored(top) != "-" {
		t.Errorf("patch to null: %+v, %v", it, err)
	}

	// A change of kind or state without a category in the request clears one that no longer fits; with a fitting
	// one it takes the request's; with one that does not fit it is refused and nothing changes. An ignored item
	// never keeps a category, not even a named one, and stays without one when it is confirmed again.
	for _, c := range []struct {
		name, kind, from, body, want, message string
	}{
		{"expense to saving", "expense", "1", `{"kind":"saving"}`, "-", ""},
		{"expense to saving with a saving category", "expense", "1", `{"kind":"saving","categoryId":26}`, "26", ""},
		{"expense to saving with an expense category", "expense", "1", `{"kind":"saving","categoryId":3}`, "1", notSaving},
		{"expense to income", "expense", "1", `{"kind":"income","amount":100500}`, "-", ""},
		{"expense to income with a category", "expense", "1", `{"kind":"income","amount":100500,"categoryId":1}`, "1", neither},
		{"saving to expense", "saving", "26", `{"kind":"expense"}`, "-", ""},
		{"saving to expense with an expense category", "saving", "26", `{"kind":"expense","categoryId":3}`, "3", ""},
		{"expense to ignored", "expense", "1", `{"state":"ignored"}`, "-", ""},
		{"expense to ignored with a category", "expense", "1", `{"state":"ignored","categoryId":3}`, "-", ""},
	} {
		if _, err := d.Exec(`UPDATE recurring_items SET kind = ?, state = 'confirmed', amount = -100500, category_id = ? WHERE id = ?`,
			c.kind, c.from, top); err != nil {
			t.Fatal(err)
		}
		_, err := patch(top, c.body)
		wantInvalid(t, c.name, err, c.message)
		if got := stored(top); got != c.want {
			t.Errorf("%s: stored %s, want %s", c.name, got, c.want)
		}
	}
	if _, err := d.Exec(`UPDATE recurring_items SET kind = 'expense', state = 'ignored', category_id = NULL WHERE id = ?`, top); err != nil {
		t.Fatal(err)
	}
	if it, err := patch(top, `{"state":"confirmed"}`); err != nil || it.CategoryID != nil || stored(top) != "-" {
		t.Errorf("confirmed again: %+v, %v", it, err)
	}
	if it, err := patch(top, `{"categoryId":1}`); err != nil || stored(it.ID) != "1" {
		t.Errorf("named after being confirmed: %+v, %v", it, err)
	}

	// Lezen: the access check comes first.
	shared, err := create(bert, `{"accountId":3,"description":"Energie","counterparty":"Luminus","amount":-14500,"frequency":"monthly","day":3,"kind":"expense","categoryId":1}`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.UpdateItem(ctx, partner, shared.ID, ledger.ItemFields{CategoryID: ledger.Opt[int64]{Set: true, V: 3}}, reportNow)
	wantErr(t, "patch the category with Lezen", err, apperr.ErrForbidden)
	if stored(shared.ID) != "1" {
		t.Error("a Lezen member changed the category")
	}
}

// The category lifecycle of recurring items (plan 0.9.1-3) on the demo: Wonen 1, Vervoer 4, Abonnementen 5 with
// Streaming 24 and Telefoon 25, Overig 6, the saving category Sparen 26. Every case holds a control item that must
// not move.
func TestItemCategoryLifecycle(t *testing.T) {
	ctx := context.Background()
	flag := ledger.Opt[bool]{Set: true, V: true}
	// set puts a category on the demo items by their description; state reads them back as "Netflix=24 Spotify=-".
	setup := func(t *testing.T, categories map[string]int64) (*sql.DB, *ledger.Store, func(names ...string) string) {
		d, s := seeded(t)
		for name, c := range categories {
			if res, err := d.Exec(`UPDATE recurring_items SET category_id = ? WHERE description = ?`, c, name); err != nil {
				t.Fatal(err)
			} else if n, _ := res.RowsAffected(); n != 1 {
				t.Fatalf("%s: %d rows", name, n)
			}
		}
		return d, s, func(names ...string) string {
			t.Helper()
			var out []string
			for _, name := range names {
				var c sql.NullInt64
				if err := d.QueryRow(`SELECT category_id FROM recurring_items WHERE description = ?`, name).Scan(&c); err != nil {
					t.Fatal(err)
				}
				out = append(out, fmt.Sprintf("%s=%s", name, map[bool]string{true: fmt.Sprint(c.Int64), false: "-"}[c.Valid]))
			}
			return strings.Join(out, " ")
		}
	}
	update := func(t *testing.T, s *ledger.Store, id int64, in ledger.CategoryInput) {
		t.Helper()
		if _, err := s.UpdateCategory(ctx, bert, id, in); err != nil {
			t.Fatalf("update %d: %v", id, err)
		}
	}
	newSaving := func(t *testing.T, s *ledger.Store, name string) int64 {
		t.Helper()
		c, err := s.CreateCategory(ctx, bert, ledger.CategoryInput{Name: ledger.Opt[string]{Set: true, V: name},
			Type: ledger.Opt[string]{Set: true, V: "expense"}, Saving: flag})
		if err != nil || !c.Saving {
			t.Fatalf("create %s: %+v, %v", name, c, err)
		}
		return c.ID
	}

	t.Run("delete without a target", func(t *testing.T) {
		_, s, state := setup(t, map[string]int64{"Netflix": 24, "Spotify": 5, "Energie": 1})
		if err := s.RemoveCategory(ctx, 24, 0); err != nil {
			t.Fatal(err)
		}
		if got := state("Netflix", "Spotify", "Energie"); got != "Netflix=- Spotify=5 Energie=1" {
			t.Errorf("after deleting Streaming: %s", got)
		}
	})
	t.Run("merge into an expense category", func(t *testing.T) {
		_, s, state := setup(t, map[string]int64{"Netflix": 24, "Spotify": 25, "Energie": 1})
		if err := s.RemoveCategory(ctx, 24, 4); err != nil {
			t.Fatal(err)
		}
		if got := state("Netflix", "Spotify", "Energie"); got != "Netflix=4 Spotify=25 Energie=1" {
			t.Errorf("after merging Streaming into Vervoer: %s", got)
		}
	})
	t.Run("merge into a saving category", func(t *testing.T) {
		_, s, state := setup(t, map[string]int64{"Netflix": 24, "Spotify": 25, "Energie": 1})
		if err := s.RemoveCategory(ctx, 24, 26); err != nil {
			t.Fatal(err)
		}
		if got := state("Netflix", "Spotify", "Energie"); got != "Netflix=- Spotify=25 Energie=1" {
			t.Errorf("after merging Streaming into Sparen: %s", got)
		}
	})
	t.Run("a saving item follows a merge only into a saving category", func(t *testing.T) {
		d, s, state := setup(t, map[string]int64{"Energie": 1})
		pot, pot2 := newSaving(t, s, "Pot"), newSaving(t, s, "Pot2")
		if _, err := d.Exec(`UPDATE recurring_items SET category_id = ? WHERE description = 'Naar spaarrekening'`, pot); err != nil {
			t.Fatal(err)
		}
		if err := s.RemoveCategory(ctx, pot, 26); err != nil || state("Naar spaarrekening") != "Naar spaarrekening=26" {
			t.Errorf("merge into Sparen: %v, %s", err, state("Naar spaarrekening"))
		}
		if _, err := d.Exec(`UPDATE recurring_items SET category_id = ? WHERE description = 'Naar spaarrekening'`, pot2); err != nil {
			t.Fatal(err)
		}
		if err := s.RemoveCategory(ctx, pot2, 4); err != nil { // Vervoer: the same type, so allowed, but it does not count as saved
			t.Fatal(err)
		}
		if got := state("Naar spaarrekening", "Energie"); got != "Naar spaarrekening=- Energie=1" {
			t.Errorf("merge into Vervoer: %s", got)
		}
	})
	t.Run("the saving flag on a top category", func(t *testing.T) {
		d, s, state := setup(t, map[string]int64{"Netflix": 5, "Spotify": 25, "Energie": 1})
		update(t, s, 5, ledger.CategoryInput{Saving: flag})
		if got := state("Netflix", "Spotify", "Energie"); got != "Netflix=- Spotify=- Energie=1" { // the top's own items and its subcategories'
			t.Errorf("flag on Abonnementen: %s", got)
		}
		// A saving item may now hold it, and loses it when the flag goes off again.
		if _, err := d.Exec(`UPDATE recurring_items SET category_id = 5 WHERE description = 'Naar spaarrekening'`); err != nil {
			t.Fatal(err)
		}
		update(t, s, 5, ledger.CategoryInput{Saving: ledger.Opt[bool]{Set: true, V: false}})
		if got := state("Naar spaarrekening", "Energie"); got != "Naar spaarrekening=- Energie=1" {
			t.Errorf("flag off Abonnementen: %s", got)
		}
	})
	t.Run("a top category turned income", func(t *testing.T) {
		_, s, state := setup(t, map[string]int64{"Familiale verzekering": 6, "Energie": 1})
		update(t, s, 6, ledger.CategoryInput{Type: ledger.Opt[string]{Set: true, V: "income"}})
		if got := state("Familiale verzekering", "Energie"); got != "Familiale verzekering=- Energie=1" {
			t.Errorf("Overig turned income: %s", got)
		}
	})
	t.Run("a subcategory moved", func(t *testing.T) {
		_, s, state := setup(t, map[string]int64{"Netflix": 24, "Spotify": 25, "Energie": 1})
		// Under a saving category it stops fitting; under another expense top it keeps its items (their costs move
		// into the new top's total, documented).
		update(t, s, 24, ledger.CategoryInput{ParentID: ledger.Opt[int64]{Set: true, V: 26}})
		update(t, s, 25, ledger.CategoryInput{ParentID: ledger.Opt[int64]{Set: true, V: 4}})
		if got := state("Netflix", "Spotify", "Energie"); got != "Netflix=- Spotify=25 Energie=1" {
			t.Errorf("after moving Streaming under Sparen and Telefoon under Vervoer: %s", got)
		}
	})
	t.Run("a rename touches nothing", func(t *testing.T) {
		_, s, state := setup(t, map[string]int64{"Netflix": 24, "Energie": 1})
		update(t, s, 24, ledger.CategoryInput{Name: ledger.Opt[string]{Set: true, V: "Video"}})
		if got := state("Netflix", "Energie"); got != "Netflix=24 Energie=1" {
			t.Errorf("after a rename: %s", got)
		}
	})
}
