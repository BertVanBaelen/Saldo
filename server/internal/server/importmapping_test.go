package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

const (
	bilanceHead = "Titel, Datum, Bedrag, Categorie, Subcategorie, Tag(s), Betalingskenmerk, Handelaar, Rekening(en), Notitie\n"
	// No account name column: the rows go to the account the viewer picks.
	bilanceMap = `{"date":1,"amount":2,"counterparty":7,"communication":6,"category":3,"subcategory":4}`
)

func bilanceRow(date, amount, cat, sub, who string) string {
	return `"` + who + `", ` + date + ` 00:00:00.000, ` + amount + `€, "` + cat + `", "` + sub + `", , "", "` + who + `", "Zichtrekening", ` + "\n"
}

// Mapping of the categories of an import (0.5-3): choices set category and
// origin "import", a created category is part of the import's transaction,
// the choices are saved per user and source and reused, and a re-apply
// rewrites only what the import itself categorised.
func TestImportCategoryMapping(t *testing.T) {
	e := newBankEnv(t)
	if err := categorise.SeedDefaults(context.Background(), e.db); err != nil {
		t.Fatal(err)
	}
	account := decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"Zicht","type":"current"}`).body).ID
	cat := func(name string) int64 {
		return int64(e.count(`SELECT id FROM categories WHERE name = ?`, name))
	}
	huur, energie, boodschappen, verzekeringen := cat("Huur"), cat("Energie"), cat("Boodschappen"), cat("Verzekeringen")
	id := strconv.FormatInt

	file1 := bilanceHead +
		bilanceRow("2026-11-02", "-1005.00", "Wonen", "Huur, hypotheek", "Immo A") +
		bilanceRow("2026-11-03", "-1005.00", "Wonen", "Huur, hypotheek", "Immo B") +
		bilanceRow("2026-11-04", "-80.00", "Wonen", "Onderhoud woning", "Loodgieter") +
		bilanceRow("2026-11-05", "-12.00", "Eten & Drinken", "Boodschappen", "Markt") +
		bilanceRow("2026-11-06", "-40.00", "Winkelen", "Overig", "Zara") +
		bilanceRow("2026-11-07", "+2850.00", "Inkomen", "Loon", "Werkgever")
	send := func(path, file, choices string, user int64) response {
		t.Helper()
		parts := append(importForm(file, account, bilanceMap), formPart{"categories", "", choices})
		if choices == "" {
			parts = parts[:len(parts)-1]
		}
		parts[0].fileName = "bilance.csv"
		return e.upload(user, path, parts...)
	}

	// Preview before any choice: a name-based suggestion, nothing saved.
	p := decode[previewBody](t, send("/api/imports/preview", file1, "", e.bert).body)
	if len(p.Categories) != 5 {
		t.Fatalf("pairs: %+v", p.Categories)
	}
	for _, c := range p.Categories {
		if c.Saved != nil {
			t.Errorf("saved before any import: %+v", c)
		}
		if c.Category == "Wonen" && c.Subcategory == "Huur, hypotheek" && (c.Suggestion == nil || *c.Suggestion != huur) {
			t.Errorf("suggestion for Huur, hypotheek: %+v", c)
		}
	}

	// Choices that are refused, each leaving nothing behind.
	pair := func(top, sub, rest string) string {
		return `{"category":"` + top + `","subcategory":"` + sub + `",` + rest + `}`
	}
	for name, choices := range map[string]string{
		"unknown action":  `[` + pair("Wonen", "Huur, hypotheek", `"action":"merge"`) + `]`,
		"missing id":      `[` + pair("Wonen", "Huur, hypotheek", `"action":"map","categoryId":99999`) + `]`,
		"pair twice":      `[` + pair("Wonen", "Onderhoud woning", `"action":"skip"`) + `,` + pair("Wonen", "Onderhoud woning", `"action":"skip"`) + `]`,
		"create no name":  `[` + pair("Winkelen", "Overig", `"action":"create","new":{"name":"  "}`) + `]`,
		"create bad icon": `[` + pair("Winkelen", "Overig", `"action":"create","new":{"name":"Winkelen","icon":"nope","parentId":`+id(boodschappen, 10)+`}`) + `]`,
		"unknown field":   `[` + pair("Winkelen", "Overig", `"action":"skip","x":1`) + `]`,
	} {
		t.Run(name, func(t *testing.T) {
			for _, path := range []string{"/api/imports/preview", "/api/imports"} {
				expectError(t, send(path, file1, choices, e.bert), http.StatusBadRequest, "invalid")
			}
		})
	}
	// Choices for a file without category columns.
	expectError(t, e.upload(e.bert, "/api/imports", append(importForm(csvHeader+csvCoffee, account, csvMapping), formPart{"categories", "", `[` + pair("a", "b", `"action":"skip"`) + `]`})...),
		http.StatusBadRequest, "invalid")
	if e.count(`SELECT COUNT(*) FROM import_batches`)+e.count(`SELECT COUNT(*) FROM category_mappings`) != 0 {
		t.Fatal("a refused import left a batch or a mapping")
	}

	// A created category rolls back with an import that fails after it: Partner
	// may not import into Bert's account.
	create := `[` + pair("Eten & Drinken", "Boodschappen", `"action":"create","new":{"name":"Markt","icon":"cart","parentId":`+id(boodschappen, 10)+`}`) + `]`
	expectError(t, send("/api/imports", file1, create, e.partner), http.StatusNotFound, "not_found")
	if e.count(`SELECT COUNT(*) FROM categories WHERE name = 'Markt'`) != 0 {
		t.Fatal("a failed import left its new category")
	}

	// The preview counts what the choices do, and changes nothing.
	choices := `[` + strings.Join([]string{
		pair("Wonen", "Huur, hypotheek", `"action":"map","categoryId":`+id(huur, 10)),
		pair("Wonen", "Onderhoud woning", `"action":"map","categoryId":`+id(huur, 10)), // merged into Huur
		pair("Eten & Drinken", "Boodschappen", `"action":"create","new":{"name":"Markt","icon":"cart","parentId":`+id(boodschappen, 10)+`}`),
		pair("Winkelen", "Overig", `"action":"skip"`),
	}, ",") + `]`
	p = decode[previewBody](t, send("/api/imports/preview", file1, choices, e.bert).body)
	if p.Counts == nil || p.Counts.New != 6 || p.Counts.Categorised != 4 {
		t.Fatalf("preview counts: %+v", p.Counts)
	}
	if e.count(`SELECT COUNT(*) FROM categories WHERE name = 'Markt'`)+e.count(`SELECT COUNT(*) FROM category_mappings`) != 0 {
		t.Fatal("the preview kept a category or a mapping")
	}

	// The import: category and origin, the created category, the saved mapping.
	r := send("/api/imports", file1, choices, e.bert)
	if r.status != http.StatusCreated {
		t.Fatalf("import: %d %s", r.status, r.body)
	}
	got := decode[importBody](t, r.body)
	if got.Categorised != 4 || got.Batches[0].Imported != 6 {
		t.Fatalf("import: %s", r.body)
	}
	markt := cat("Markt")
	row := func(who string) string {
		var g string
		if err := e.db.QueryRow(`SELECT COALESCE(category_id, '-') || '|' || COALESCE(category_origin, '-') || '|' || COALESCE(import_category, '-') || '|' || COALESCE(import_subcategory, '-')
			FROM transactions WHERE counterparty_name = ?`, who).Scan(&g); err != nil {
			t.Fatal(err)
		}
		return g
	}
	for who, want := range map[string]string{
		"Immo A":     id(huur, 10) + "|import|Wonen|Huur, hypotheek",
		"Immo B":     id(huur, 10) + "|import|Wonen|Huur, hypotheek",
		"Loodgieter": id(huur, 10) + "|import|Wonen|Onderhoud woning",
		"Markt":      id(markt, 10) + "|import|Eten & Drinken|Boodschappen",
		"Zara":       "-|-|Winkelen|Overig", // skipped: no category, no origin
		"Werkgever":  "-|-|Inkomen|Loon",    // no choice: the same
	} {
		if g := strings.TrimSpace(row(who)); g != want {
			t.Errorf("%s: %q, want %q", who, g, want)
		}
	}
	if e.count(`SELECT COUNT(*) FROM categories WHERE id = ? AND parent_id = ? AND icon = 'cart' AND colour = (SELECT colour FROM categories WHERE id = ?)`,
		markt, boodschappen, boodschappen) != 1 {
		t.Error("the created category is not a subcategory with its parent's colour and the chosen icon")
	}
	if e.count(`SELECT COUNT(*) FROM category_mappings WHERE user_id = ? AND source = 'bilance'`, e.bert) != 4 ||
		e.count(`SELECT COUNT(*) FROM category_mappings WHERE category_id IS NULL AND source_category = 'Winkelen' AND source_subcategory = 'Overig'`) != 1 {
		t.Error("the choices were not saved per pair, the skip as null")
	}

	// Reuse: a second file shows every known pair as saved and the new one as not.
	file2 := bilanceHead +
		bilanceRow("2026-11-08", "-1005.00", "Wonen", "Huur, hypotheek", "Immo C") +
		bilanceRow("2026-11-09", "-12.00", "Eten & Drinken", "Boodschappen", "Markt Zuid") +
		bilanceRow("2026-11-10", "-30.00", "Wonen", "Verzekering", "Verzekeraar")
	p = decode[previewBody](t, send("/api/imports/preview", file2, "", e.bert).body)
	for _, c := range p.Categories {
		switch c.Subcategory {
		case "Huur, hypotheek":
			if c.Saved == nil || c.Saved.CategoryID == nil || *c.Saved.CategoryID != huur {
				t.Errorf("Huur not saved: %+v", c)
			}
		case "Boodschappen":
			if c.Saved == nil || c.Saved.CategoryID == nil || *c.Saved.CategoryID != markt {
				t.Errorf("Boodschappen not saved: %+v", c)
			}
		case "Verzekering":
			if c.Saved != nil || c.Suggestion == nil || *c.Suggestion != verzekeringen {
				t.Errorf("the new pair: %+v", c)
			}
		}
	}

	// The mapping is the viewer's own: Partner reads none of it, and her
	// changes reach only her.
	if r := e.as(e.partner, "GET", "/api/imports/mappings?source=bilance", ""); r.body != "[]\n" {
		t.Errorf("Partner reads Bert's mapping: %s", r.body)
	}
	if r := e.as(e.partner, "PUT", "/api/imports/mappings?source=bilance", `[{"category":"Wonen","subcategory":"Huur, hypotheek","categoryId":`+id(energie, 10)+`}]`); r.status != 200 {
		t.Fatalf("Partner's PUT: %d %s", r.status, r.body)
	}
	if e.count(`SELECT COUNT(*) FROM category_mappings WHERE user_id = ? AND category_id = ?`, e.bert, huur) != 2 {
		t.Error("Partner changed Bert's mapping")
	}
	expectError(t, e.as(e.partner, "PUT", "/api/imports/mappings?source=bilance", `[{"category":"a","subcategory":"b","categoryId":99999}]`), http.StatusBadRequest, "invalid")
	expectError(t, e.as(e.bert, "GET", "/api/imports/mappings?source=nope", ""), http.StatusBadRequest, "invalid")
	expectError(t, e.as(e.partner, "POST", "/api/imports/"+id(got.Batches[0].ID, 10)+"/reapply-categories", ""), http.StatusNotFound, "not_found")

	// Re-apply: Bert changes the mapping; a row he categorised himself stays.
	if _, err := e.db.Exec(`UPDATE transactions SET category_id = ?, category_origin = 'manual' WHERE counterparty_name = 'Immo B'`, boodschappen); err != nil {
		t.Fatal(err)
	}
	r = e.as(e.bert, "PUT", "/api/imports/mappings?source=bilance", `[{"category":"Wonen","subcategory":"Huur, hypotheek","categoryId":`+id(energie, 10)+
		`},{"category":"Winkelen","subcategory":"Overig","categoryId":`+id(boodschappen, 10)+`}]`)
	if r.status != 200 || len(decode[[]ledger.SavedMapping](t, r.body)) != 4 {
		t.Fatalf("Bert's PUT: %d %s", r.status, r.body)
	}
	r = e.as(e.bert, "POST", "/api/imports/"+id(got.Batches[0].ID, 10)+"/reapply-categories", "")
	if r.status != 200 || strings.TrimSpace(r.body) != `{"changed":2}` {
		t.Fatalf("reapply: %d %s", r.status, r.body)
	}
	for who, want := range map[string]string{
		"Immo A":     id(energie, 10) + "|import",      // changed
		"Immo B":     id(boodschappen, 10) + "|manual", // his own choice stays
		"Zara":       id(boodschappen, 10) + "|import", // was skipped, now mapped
		"Loodgieter": id(huur, 10) + "|import",         // its pair did not change
	} {
		if g := strings.TrimSpace(row(who)); !strings.HasPrefix(g, want) {
			t.Errorf("after reapply %s: %q, want %q", who, g, want)
		}
	}
}
