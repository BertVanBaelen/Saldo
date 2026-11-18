package server

import (
	"net/http"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// The planning routes (0.8-1) on the demo seed: Bert holds 7 items on the
// Zichtrekening (1) and manages the Gedeelde rekening (4) with its 4 items;
// the budgets are 3 + 1 and the planned items 4 (all on 1); Partner holds 4
// and her own account 5, which has none. The rules themselves are tested in
// ledger (TestRecurringItemCRUD, TestBudgets, TestPlannedItems).
func TestPlanningRoutes(t *testing.T) {
	p := newPair(t)
	const (
		gas    = `{"accountId":1,"description":"Gas","counterparty":"Eneco","amount":-5000,"frequency":"monthly","day":5,"kind":"expense"}`
		budget = `{"accountId":4,"categoryId":6,"fromMonth":"2026-12","amount":20000}`
		diner  = `{"accountId":4,"date":"2026-12-24","amount":-4000,"description":"Kerstdiner"}`
	)
	listed := func(r response, key string) int {
		t.Helper()
		if r.status != http.StatusOK {
			t.Fatalf("list: %d %s", r.status, r.body)
		}
		return len(decode[map[string][]map[string]any](t, r.body)[key])
	}

	// Lists: per scope and viewer; an unknown scope is 400.
	for _, c := range []struct {
		path        string
		key         string
		bert, other int
	}{
		{"/api/planning/items", "items", 11, 4}, {"/api/planning/items?scope=persoonlijk", "items", 7, 0}, {"/api/planning/items?scope=gedeeld", "items", 4, 4},
		{"/api/planning/budgets", "budgets", 4, 1}, {"/api/planning/budgets?scope=gedeeld", "budgets", 1, 1},
		{"/api/planning/planned", "planned", 4, 0}, {"/api/planning/planned?scope=persoonlijk", "planned", 4, 0},
	} {
		if n := listed(p.bert("GET", c.path, ""), c.key); n != c.bert {
			t.Errorf("Bert %s: %d, want %d", c.path, n, c.bert)
		}
		if n := listed(p.partner("GET", c.path, ""), c.key); n != c.other {
			t.Errorf("Partner %s: %d, want %d", c.path, n, c.other)
		}
	}
	if msg := expectError(t, p.bert("GET", "/api/planning/items?scope=iedereen", ""), http.StatusBadRequest, "invalid"); msg != "Kies alles, persoonlijk of gedeeld." {
		t.Errorf("scope: %q", msg)
	}
	equalJSON(t, p.bert("GET", "/api/planning/items?scope=gedeeld", "").body, `{"items": [
		{"id": 8, "accountId": 4, "description": "Bijdrage Bert", "counterparty": "Bert", "amount": 45000, "amountRule": "fixed", "frequency": "monthly", "day": 1, "month": null, "endDate": null, "kind": "contribution", "state": "confirmed"},
		{"id": 9, "accountId": 4, "description": "Bijdrage Partner", "counterparty": "Partner", "amount": 45000, "amountRule": "fixed", "frequency": "monthly", "day": 1, "month": null, "endDate": null, "kind": "contribution", "state": "confirmed"},
		{"id": 10, "accountId": 4, "description": "Energie", "counterparty": "Luminus", "amount": -14500, "amountRule": "fixed", "frequency": "monthly", "day": 3, "month": null, "endDate": null, "kind": "expense", "state": "confirmed"},
		{"id": 11, "accountId": 4, "description": "Internet en tv", "counterparty": "Proximus", "amount": -4298, "amountRule": "fixed", "frequency": "monthly", "day": 9, "month": null, "endDate": null, "kind": "expense", "state": "confirmed"}]}`)
	if b := p.bert("GET", "/api/planning/budgets?scope=gedeeld", "").body; !strings.Contains(b, `"amount":55000`) || !strings.Contains(b, `"fromMonth":"2026-11"`) {
		t.Errorf("shared budget: %s", b)
	}

	// Writes: 201 and 204, the answers, the not-found of a hidden account or item, 403 on Lezen.
	r := p.bert("POST", "/api/planning/items", gas)
	if r.status != http.StatusCreated || strings.Contains(strings.ToLower(r.body), "iban") {
		t.Fatalf("create item: %d %s", r.status, r.body)
	}
	if item := decode[ledger.Item](t, r.body); item.ID != 12 || item.AccountID != 1 || item.State != "confirmed" || item.AmountRule != "fixed" {
		t.Errorf("created item: %+v", item)
	}
	const path = "/api/planning/items/12"
	if r := p.bert("PATCH", path, `{"amount":-5500,"endDate":"2027-06-30"}`); r.status != http.StatusOK || !strings.Contains(r.body, `"amount":-5500`) || !strings.Contains(r.body, `"endDate":"2027-06-30"`) {
		t.Errorf("patch item: %d %s", r.status, r.body)
	}
	expectError(t, p.partner("PATCH", path, `{"amount":-1}`), http.StatusNotFound, "not_found")
	expectError(t, p.partner("DELETE", path, ""), http.StatusNotFound, "not_found")
	expectError(t, p.partner("POST", "/api/planning/items", gas), http.StatusNotFound, "not_found")
	if msg := expectError(t, p.bert("PATCH", path, `{"accountId":4}`), http.StatusBadRequest, "invalid"); msg != "De gegevens kloppen niet." {
		t.Errorf("patch with accountId: %q", msg)
	}
	if msg := expectError(t, p.bert("PATCH", path, `{"kind":"contribution"}`), http.StatusBadRequest, "invalid"); msg != "Een bijdrage hoort bij een gedeelde rekening." {
		t.Errorf("contribution on a personal account: %q", msg)
	}
	expectError(t, p.bert("POST", "/api/planning/items", ""), http.StatusUnsupportedMediaType, "unsupported_media_type")
	if r := p.bert("DELETE", path, ""); r.status != http.StatusNoContent || r.body != "" {
		t.Errorf("delete item: %d %s", r.status, r.body)
	}
	expectError(t, p.bert("DELETE", path, ""), http.StatusNotFound, "not_found")
	expectError(t, p.bert("DELETE", "/api/planning/items/abc", ""), http.StatusNotFound, "not_found")

	if r := p.partner("PUT", "/api/planning/budgets", budget); r.status != http.StatusOK || !strings.Contains(r.body, `{"budgets":[{"id":`) || !strings.Contains(r.body, `"fromMonth":"2026-12","amount":20000`) {
		t.Errorf("put budget: %d %s", r.status, r.body)
	}
	if msg := expectError(t, p.bert("PUT", "/api/planning/budgets", `{"accountId":1,"categoryId":26,"fromMonth":"2026-12","amount":1}`), http.StatusBadRequest, "invalid"); msg != "Voor een spaarcategorie stel je geen budget in." {
		t.Errorf("saving category: %q", msg)
	}
	expectError(t, p.bert("PUT", "/api/planning/budgets", `{"accountId":5,"categoryId":6,"fromMonth":"2026-12","amount":1}`), http.StatusNotFound, "not_found")

	r = p.partner("POST", "/api/planning/planned", diner)
	if planned := decode[ledger.Planned](t, r.body); r.status != http.StatusCreated || planned.ID != 5 || planned.Description != "Kerstdiner" {
		t.Fatalf("create planned: %d %s", r.status, r.body)
	}
	if n := p.count(`SELECT COUNT(*) FROM planned_items WHERE id = 5 AND created_by = 2`); n != 1 {
		t.Error("created_by is not Partner")
	}
	if r := p.bert("PATCH", "/api/planning/planned/5", `{"date":"2026-12-25"}`); r.status != http.StatusOK || !strings.Contains(r.body, `"date":"2026-12-25"`) {
		t.Errorf("patch planned: %d %s", r.status, r.body)
	}
	if msg := expectError(t, p.bert("POST", "/api/planning/planned", `{"accountId":1,"date":"2026-11-17","amount":-1,"description":"x"}`), http.StatusBadRequest, "invalid"); msg != "Kies een datum vanaf vandaag." {
		t.Errorf("past date: %q", msg)
	}
	expectError(t, p.partner("PATCH", "/api/planning/planned/1", `{"amount":-1}`), http.StatusNotFound, "not_found")
	if r := p.bert("DELETE", "/api/planning/planned/5", ""); r.status != http.StatusNoContent {
		t.Errorf("delete planned: %d %s", r.status, r.body)
	}
	expectError(t, p.bert("DELETE", "/api/planning/planned/5", ""), http.StatusNotFound, "not_found")

	// Lezen: reads stay open, every write is 403.
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	if n := listed(p.partner("GET", "/api/planning/items", ""), "items"); n != 4 {
		t.Errorf("Partner on Lezen reads %d items", n)
	}
	for _, c := range []struct{ method, path, body string }{
		{"POST", "/api/planning/items", `{"accountId":4,"description":"x","amount":-1,"frequency":"monthly","day":1,"kind":"expense"}`},
		{"PATCH", "/api/planning/items/10", `{"amount":-1}`}, {"DELETE", "/api/planning/items/10", ""},
		{"PUT", "/api/planning/budgets", budget}, {"POST", "/api/planning/planned", diner},
	} {
		expectError(t, p.partner(c.method, c.path, c.body), http.StatusForbidden, "forbidden")
	}
}
