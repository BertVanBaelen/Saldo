package server

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Planned items without a day (0.8.1-9) on the demo seed, today 2026-11-18: a
// POST or PATCH carries a date or a month, never both; a dayless item answers
// date null, month and wholeMonth true; wholeMonth itself is never a request
// field. The demo holds 4 planned items, so the first new one has id 5.
func TestPlannedWithoutDayRoutes(t *testing.T) {
	p := newPair(t)
	const (
		path  = "/api/planning/planned"
		item  = `{"accountId":1,"amount":-150000,"description":"Dakwerken"` // the body continues with a date or a month
		month = "Kies een maand vanaf deze maand."
	)
	wire := func(id int64, date, month string, whole bool) string {
		return fmt.Sprintf(`{"id":%d,"accountId":1,"date":%s,"month":%q,"wholeMonth":%t,"amount":-150000,"description":"Dakwerken"}`, id, date, month, whole)
	}
	for _, c := range []struct{ name, body, message string }{
		{"month in the past", item + `,"month":"2026-10"}`, month},
		{"month too far ahead", item + `,"month":"2028-12"}`, "Kies een maand binnen 24 maanden."},
		{"month that is no month", item + `,"month":"juli"}`, "Kies een maand als JJJJ-MM."},
		{"date and month", item + `,"date":"2026-12-24","month":"2026-12"}`, "Kies een dag of alleen een maand."},
		{"neither", item + `}`, "Kies een datum vanaf vandaag."},
		{"wholeMonth is output only", item + `,"month":"2026-12","wholeMonth":true}`, "De gegevens kloppen niet."},
	} {
		if msg := expectError(t, p.bert("POST", path, c.body), http.StatusBadRequest, "invalid"); msg != c.message {
			t.Errorf("%s: %q, want %q", c.name, msg, c.message)
		}
	}

	// A dayless item: date null, month set, wholeMonth true; the running month is allowed.
	r := p.bert("POST", path, item+`,"month":"2027-07"}`)
	if r.status != http.StatusCreated {
		t.Fatalf("create dayless: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, wire(5, "null", "2027-07", true))
	if n := p.count(`SELECT COUNT(*) FROM planned_items WHERE id = 5 AND date = '2027-07-01' AND whole_month = 1`); n != 1 {
		t.Error("a dayless item is not stored as the month's 1st with whole_month = 1")
	}
	if r := p.bert("POST", path, `{"accountId":1,"month":"2026-11","amount":-1,"description":"deze maand"}`); r.status != http.StatusCreated {
		t.Errorf("running month: %d %s", r.status, r.body)
	}
	found := false
	for _, it := range decode[map[string][]map[string]any](t, p.bert("GET", path, "").body)["planned"] {
		if it["description"] == "Dakwerken" {
			found = true
			if date, ok := it["date"]; !ok || date != nil || it["month"] != "2027-07" || it["wholeMonth"] != true {
				t.Errorf("listed dayless item: %v", it)
			}
		} else if it["month"] == nil || (it["date"] == nil) != (it["wholeMonth"] == true) { // a date exactly when not wholeMonth
			t.Errorf("listed item: %v", it)
		}
	}
	if !found {
		t.Error("the dayless item is not listed")
	}

	// A dated item switches to a month and back; the answers follow.
	r = p.bert("POST", path, `{"accountId":1,"date":"2026-12-24","amount":-150000,"description":"Dakwerken"}`)
	if r.status != http.StatusCreated {
		t.Fatalf("create dated: %d %s", r.status, r.body)
	}
	id := decode[ledger.Planned](t, r.body).ID
	equalJSON(t, r.body, wire(id, `"2026-12-24"`, "2026-12", false))
	one := fmt.Sprintf("%s/%d", path, id)
	r = p.bert("PATCH", one, `{"month":"2026-12"}`)
	if r.status != http.StatusOK {
		t.Fatalf("patch date to month: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, wire(id, "null", "2026-12", true))
	r = p.bert("PATCH", one, `{"date":"2026-12-25"}`)
	if r.status != http.StatusOK {
		t.Fatalf("patch month to date: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, wire(id, `"2026-12-25"`, "2026-12", false))
	if msg := expectError(t, p.bert("PATCH", one, `{"date":"2026-12-25","month":"2026-12"}`), http.StatusBadRequest, "invalid"); msg != "Kies een dag of alleen een maand." {
		t.Errorf("patch both: %q", msg)
	}
	if msg := expectError(t, p.bert("PATCH", one, `{"month":"2026-10"}`), http.StatusBadRequest, "invalid"); msg != month {
		t.Errorf("patch to a past month: %q", msg)
	}
	expectError(t, p.partner("PATCH", one, `{"month":"2026-12"}`), http.StatusNotFound, "not_found")
}

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
