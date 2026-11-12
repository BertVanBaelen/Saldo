package server

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Overlap and duplicates of a Bilance import (0.5-4): an exact match is
// dropped, a fuzzy one is a probable duplicate that is skipped unless the user
// includes its line, rows on or after a cutoff are skipped and counted, a
// skipped duplicate hands its category to a stored row that has none, and
// none of it applies to a generic CSV file.
func TestImportDuplicatesAndCutoff(t *testing.T) {
	e := newBankEnv(t)
	if err := categorise.SeedDefaults(context.Background(), e.db); err != nil {
		t.Fatal(err)
	}
	account := decode[ledger.Account](t, e.as(e.bert, "POST", "/api/accounts", `{"name":"Zicht","type":"current"}`).body).ID
	cat := func(name string) int64 { return int64(e.count(`SELECT id FROM categories WHERE name = ?`, name)) }
	streaming, boodschappen := cat("Streaming"), cat("Boodschappen")
	if _, err := e.db.Exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, status) VALUES (1, ?, 'fake', 'Argenta', 'active')`, e.bert); err != nil {
		t.Fatal(err)
	}
	n := 0
	stored := func(date string, amount int64, name string, synced bool, category int64, origin string) int64 {
		t.Helper()
		n++
		var conn, cid, org any
		if synced {
			conn = 1
		}
		if category != 0 {
			cid, org = category, origin
		}
		res, err := e.db.Exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, source_connection_id, category_id, category_origin)
			VALUES (?, ?, ?, ?, 'booked', ?, ?, ?, ?)`, account, amount, date, name, fmt.Sprint("k", n), conn, cid, org)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	stored("2026-11-01", -100500, "Immo Verhaeghe", true, 0, "")                         // exact: line 2
	spotify := stored("2026-11-05", -1199, "Spotify", true, 0, "")                       // a day off, similar name, no category: line 3
	bakker := stored("2026-11-07", -3000, "Bakkerij Test", true, boodschappen, "manual") // similar, the user's own category: line 4
	kiosk := stored("2026-11-08", -500, "Kiosk Zuid Gent", true, 0, "")                  // matches line 5 only, not line 6
	stored("2026-11-09", -350, "Koffiehuis", false, 0, "")                               // for the generic file

	file := bilanceHead +
		bilanceRow("2026-11-01", "-1005.00", "Wonen", "Huur, hypotheek", "Immo Verhaeghe") +
		bilanceRow("2026-11-06", "-11.99", "Abonnementen", "Streaming", "SPOTIFY AB") +
		bilanceRow("2026-11-07", "-30.00", "Eten & Drinken", "Boodschappen", "Bakkerij Test Gent") +
		bilanceRow("2026-11-08", "-5.00", "Winkelen", "Overig", "Kiosk Zuid") +
		bilanceRow("2026-11-09", "-5.00", "Winkelen", "Overig", "Kiosk Zuid") +
		bilanceRow("2026-01-10", "-9.00", "Winkelen", "Overig", "Oude winkel")
	choices := `[{"category":"Wonen","subcategory":"Huur, hypotheek","action":"skip"},
		{"category":"Abonnementen","subcategory":"Streaming","action":"map","categoryId":` + fmt.Sprint(streaming) + `},
		{"category":"Eten & Drinken","subcategory":"Boodschappen","action":"map","categoryId":` + fmt.Sprint(boodschappen) + `},
		{"category":"Winkelen","subcategory":"Overig","action":"skip"}]`
	send := func(path string, extra ...formPart) response {
		t.Helper()
		parts := append(importForm(file, account, bilanceMap), formPart{"categories", "", choices})
		parts[0].fileName = "bilance.csv"
		return e.upload(e.bert, path, append(parts, extra...)...)
	}
	preview := func(extra ...formPart) previewBody {
		t.Helper()
		r := send("/api/imports/preview", extra...)
		if r.status != http.StatusOK {
			t.Fatalf("preview: %d %s", r.status, r.body)
		}
		return decode[previewBody](t, r.body)
	}
	include := func(lines string) formPart { return formPart{"duplicates", "", `{"include":[` + lines + `]}`} }
	cutoff := func(date string) formPart { return formPart{"cutoffs", "", fmt.Sprintf(`{"%d":%s}`, account, date)} }
	existingCategory := func(id int64) string {
		var g string
		if err := e.db.QueryRow(`SELECT COALESCE(category_id, 0) || '|' || COALESCE(category_origin, '-') FROM transactions WHERE id = ?`, id).Scan(&g); err != nil {
			t.Fatal(err)
		}
		return g
	}

	// No options: the exact row is present, three rows are probable duplicates (each
	// stored row matched by one incoming row only), and the first synced date is suggested.
	p := preview()
	if c := p.Counts; c == nil || c.Rows != 6 || c.New != 2 || c.Present != 1 || c.Probable != 3 || c.AfterCutoff != 0 || c.CategoryTaken != 1 {
		t.Fatalf("counts: %+v", c)
	}
	if p.Duplicates == nil || p.Duplicates.Total != 3 || len(p.Duplicates.Items) != 3 || len(p.Cutoffs) != 1 || p.Cutoffs[0].Suggested == nil || *p.Cutoffs[0].Suggested != "2026-11-01" {
		t.Fatalf("duplicates or cutoffs: %+v %+v", p.Duplicates, p.Cutoffs)
	}
	d := p.Duplicates.Items
	if d[0].Line != 3 || d[0].Counterparty != "SPOTIFY AB" || d[0].Existing.Counterparty != "Spotify" || d[0].Existing.Date != "2026-11-05" || d[0].Existing.Category != nil ||
		d[0].Category == nil || d[0].Category.Name != "Streaming" || !d[0].Takes || d[0].Source != [2]string{"Abonnementen", "Streaming"} {
		t.Errorf("first duplicate: %+v", d[0])
	}
	if d[1].Line != 4 || d[1].Takes || d[1].Existing.Category == nil || d[1].Existing.Category.Name != "Boodschappen" || d[2].Line != 5 || d[2].Takes {
		t.Errorf("other duplicates: %+v %+v", d[1], d[2])
	}
	if raw := send("/api/imports/preview").body; strings.Contains(raw, "raw") || existingCategory(spotify) != "0|-" {
		t.Error("the preview shows a raw row or wrote a category")
	}

	// Including a line imports it as a normal row; a line that is no duplicate is ignored.
	if c := preview(include("5, 9999")).Counts; c.New != 3 || c.Probable != 2 || c.CategoryTaken != 1 {
		t.Errorf("include: %+v", c)
	}
	if c := preview(include("3")).Counts; c.New != 3 || c.Probable != 2 || c.CategoryTaken != 0 {
		t.Errorf("include the one that takes: %+v", c)
	}
	// A cutoff skips the rows on or after it, before any matching; they are counted.
	if c := preview(cutoff(`"2026-11-08"`)).Counts; c.New != 1 || c.Present != 1 || c.Probable != 2 || c.AfterCutoff != 2 {
		t.Errorf("cutoff: %+v", c)
	}
	if c := preview(cutoff(`null`)).Counts; c.AfterCutoff != 0 || c.Probable != 3 {
		t.Errorf("no cutoff: %+v", c)
	}

	// The import: line 5 imported anyway; the skipped Spotify duplicate hands its category
	// to the stored row, the stored row with a manual category keeps it, the rest is untouched.
	r := send("/api/imports", include("5"))
	got := decode[importBody](t, r.body)
	if r.status != http.StatusCreated || got.Batches[0].Imported != 3 || got.Batches[0].Present != 1 || got.Probable != 2 || got.CategoryTaken != 1 || got.AfterCutoff != 0 {
		t.Fatalf("import: %d %s", r.status, r.body)
	}
	for id, want := range map[int64]string{spotify: fmt.Sprintf("%d|import", streaming), bakker: fmt.Sprintf("%d|manual", boodschappen), kiosk: "0|-"} {
		if g := existingCategory(id); g != want {
			t.Errorf("stored row %d: %s, want %s", id, g, want)
		}
	}
	if e.count(`SELECT COUNT(*) FROM transactions WHERE import_batch_id = ?`, got.Batches[0].ID) != 3 ||
		e.count(`SELECT COUNT(*) FROM transactions WHERE import_batch_id = ? AND counterparty_name = 'Kiosk Zuid'`, got.Batches[0].ID) != 2 {
		t.Error("the batch does not hold the new rows and the included duplicate")
	}

	// A generic CSV file: no fuzzy rule (a near-equal row is new), no cutoff, no choice of duplicates.
	generic := importForm(csvHeader+"09/11/2026;09/11/2026;-3,50;Koffiehuis Test;;Bancontact\n", account, csvMapping)
	if c := decode[previewBody](t, e.upload(e.bert, "/api/imports/preview", generic...).body); c.Counts == nil || c.Counts.New != 1 || c.Counts.Probable != 0 || c.Duplicates != nil || len(c.Cutoffs) != 0 {
		t.Errorf("generic preview: %+v", c)
	}
	for _, extra := range []formPart{cutoff(`"2026-11-08"`), include("2")} {
		expectError(t, e.upload(e.bert, "/api/imports", append(generic, extra)...), http.StatusBadRequest, "invalid")
	}

	// Input that is refused at the boundary.
	for name, extra := range map[string]formPart{
		"cutoff not a date":    cutoff(`"2026-13-45"`),
		"cutoff key not an id": {"cutoffs", "", `{"x":"2026-11-08"}`},
		"cutoff other account": {"cutoffs", "", `{"99999":"2026-11-08"}`},
		"line zero":            include("0"),
		"line not a number":    include(`"a"`),
		"unknown key":          {"duplicates", "", `{"all":true}`},
	} {
		t.Run(name, func(t *testing.T) {
			expectError(t, send("/api/imports/preview", extra), http.StatusBadRequest, "invalid")
		})
	}
}
