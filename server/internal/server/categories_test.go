package server

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// pair is the demo database seen by Bert and by Partner.
type pair struct {
	t               *testing.T
	db              *sql.DB
	bertH, partnerH http.Handler
}

func newPair(t *testing.T) *pair {
	t.Helper()
	h, d := demoServer(t)
	return &pair{t: t, db: d, bertH: h, partnerH: New(Options{DB: d, Version: "test", Demo: true, Clock: demoClock,
		Viewer: func(*http.Request) (int64, bool) { return demo.Partner, true }})}
}

func (p *pair) bert(method, path, body string) response {
	p.t.Helper()
	return do(p.t, p.bertH, method, path, body)
}

func (p *pair) partner(method, path, body string) response {
	p.t.Helper()
	return do(p.t, p.partnerH, method, path, body)
}

func (p *pair) count(q string, args ...any) int {
	p.t.Helper()
	var n int
	if err := p.db.QueryRow(q, args...).Scan(&n); err != nil {
		p.t.Fatalf("%s: %v", q, err)
	}
	return n
}

func (p *pair) exec(q string, args ...any) {
	p.t.Helper()
	if _, err := p.db.Exec(q, args...); err != nil {
		p.t.Fatalf("%s: %v", q, err)
	}
}

func (p *pair) created(r response) ledger.TreeCategory {
	p.t.Helper()
	if r.status != http.StatusCreated {
		p.t.Fatalf("create: %d %s", r.status, r.body)
	}
	return decode[ledger.TreeCategory](p.t, r.body)
}

func TestCategoriesList(t *testing.T) {
	p := newPair(t)
	list := decode[[]ledger.TreeCategory](t, p.bert("GET", "/api/categories", "").body)
	var order []string
	for _, c := range list {
		order = append(order, strconv.FormatInt(c.ID, 10))
	}
	want := "1 11 12 13 14 2 15 16 3 17 18 19 20 4 21 22 23 5 24 25 6 7 8 9 10"
	if got := strings.Join(order, " "); got != want {
		t.Fatalf("tree order %s, want %s", got, want)
	}
	if c := list[1]; c.Name != "Huur" || c.Type != "expense" || c.Colour != "c1" || c.ParentID == nil || *c.ParentID != 1 {
		t.Errorf("Huur: %+v", c)
	}
	if c := list[21]; c.Name != "Salaris" || c.Type != "income" || c.Colour != "soft" || c.ParentID != nil {
		t.Errorf("Salaris: %+v", c)
	}
	// count: the viewer's own transactions only; a split row counts under
	// its parts' categories (0.4-3), not its own.
	shared := p.count(`SELECT MIN(id) FROM transactions WHERE account_id = 4 AND status = 'booked' AND category_id = 2`)
	amount := p.count(`SELECT amount FROM transactions WHERE id = ?`, shared)
	p.exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, 5, ?), (?, 5, ?), (?, 6, ?)`,
		shared, amount/2, shared, amount/4, shared, amount-amount/2-amount/4)
	for _, who := range []struct {
		h    func(string, string, string) response
		user int64
	}{{p.bert, demo.Bert}, {p.partner, demo.Partner}} {
		for _, c := range decode[[]ledger.TreeCategory](t, who.h("GET", "/api/categories", "").body) {
			want := p.count(`SELECT COUNT(*) FROM transactions t JOIN account_access me ON me.account_id = t.account_id AND me.user_id = ?1
				WHERE t.category_id = ?2 AND t.id <> ?3`, who.user, c.ID, shared)
			if c.ID == 5 || c.ID == 6 {
				want++
			}
			if c.Count != want {
				t.Errorf("user %d, %s: count %d, want %d", who.user, c.Name, c.Count, want)
			}
		}
	}
	// Bert's personal salary (category 7) is not in Partner's count.
	bertSalary := p.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 1 AND category_id = 7`)
	all := p.count(`SELECT COUNT(*) FROM transactions WHERE category_id = 7`)
	for _, c := range decode[[]ledger.TreeCategory](t, p.partner("GET", "/api/categories", "").body) {
		if c.ID == 7 && (bertSalary == 0 || c.Count != all-bertSalary) {
			t.Errorf("Partner's Salaris count %d, all %d, Bert's %d", c.Count, all, bertSalary)
		}
	}
}

func TestCategoryCreateAndUpdate(t *testing.T) {
	p := newPair(t)
	top := p.created(p.bert("POST", "/api/categories", `{"name":"  Eten   &  Drinken ","type":"expense"}`))
	if top.Name != "Eten & Drinken" || top.Colour != "c6" || top.ParentID != nil || top.Count != 0 {
		t.Errorf("top: %+v", top)
	}
	sub := p.created(p.partner("POST", "/api/categories", `{"name":"Energie, nutsvoorzieningen","parentId":1}`))
	if sub.Name != "Energie, nutsvoorzieningen" || sub.Type != "expense" || sub.Colour != "c1" || *sub.ParentID != 1 {
		t.Errorf("sub: %+v", sub)
	}
	if p.count(`SELECT sort_order FROM categories WHERE id = ?`, sub.ID) != 5 {
		t.Error("a new subcategory goes last under its parent")
	}
	inc := p.created(p.bert("POST", "/api/categories", `{"name":"Huurinkomsten","type":"income"}`))
	if inc.Colour != "soft" || inc.Type != "income" {
		t.Errorf("income: %+v", inc)
	}
	// The same name under another parent is fine; a name with "/" and quotes is data.
	p.created(p.bert("POST", "/api/categories", `{"name":"Huur","parentId":4}`))
	p.created(p.bert("POST", "/api/categories", `{"name":"Kleding / \"schoenen\"","parentId":2}`))

	id := func(c ledger.TreeCategory) string { return strconv.FormatInt(c.ID, 10) }
	bad := []struct{ method, path, body string }{
		{"POST", "/api/categories", `{"name":"huur","parentId":1}`},                  // duplicate, case-insensitive
		{"POST", "/api/categories", `{"name":"eten & drinken","type":"expense"}`},    // duplicate top
		{"POST", "/api/categories", `{"name":"x","parentId":11}`},                    // under a subcategory
		{"POST", "/api/categories", `{"name":"x","parentId":999}`},                   // unknown parent
		{"POST", "/api/categories", `{"name":"x","parentId":1,"colour":"c2"}`},       // colour on a sub
		{"POST", "/api/categories", `{"name":"x","parentId":1,"type":"income"}`},     // type on a sub
		{"POST", "/api/categories", `{"name":"x","type":"income","colour":"c1"}`},    // income is green
		{"POST", "/api/categories", `{"name":"x","type":"expense","colour":"soft"}`}, // not an expense colour
		{"POST", "/api/categories", `{"name":"x","type":"savings"}`},                 // no such type
		{"POST", "/api/categories", `{"name":"x"}`},                                  // no type
		{"POST", "/api/categories", `{"name":"   ","type":"expense"}`},               // empty
		{"POST", "/api/categories", `{"name":"` + strings.Repeat("é", 61) + `","type":"expense"}`},
		{"POST", "/api/categories", `{"name":"a\u0007b","type":"expense"}`},
		{"POST", "/api/categories", `{"name":"x","type":"expense","extra":1}`},
		{"PATCH", "/api/categories/1", `{"parentId":2}`},            // Wonen has subcategories
		{"PATCH", "/api/categories/1", `{"type":"income"}`},         // a type change with subcategories
		{"PATCH", "/api/categories/11", `{"type":"income"}`},        // a sub cannot change type alone
		{"PATCH", "/api/categories/11", `{"colour":"c3"}`},          // a sub takes its parent's colour
		{"PATCH", "/api/categories/11", `{"parentId":11}`},          // under itself
		{"PATCH", "/api/categories/11", `{"parentId":12}`},          // under a sub
		{"PATCH", "/api/categories/11", `{"name":"Energie"}`},       // a sibling's name
		{"PATCH", "/api/categories/7", `{"colour":"c2"}`},           // income stays green
		{"PATCH", "/api/categories/" + id(top), `{"name":"Wonen"}`}, // a top's name
	}
	for _, c := range bad {
		expectError(t, p.bert(c.method, c.path, c.body), http.StatusBadRequest, "invalid")
	}
	for _, path := range []string{"/api/categories/999", "/api/categories/abc", "/api/categories/0"} {
		expectError(t, p.bert("PATCH", path, `{"name":"x"}`), http.StatusNotFound, "not_found")
	}

	patch := func(path, body string) ledger.TreeCategory {
		t.Helper()
		r := p.bert("PATCH", path, body)
		if r.status != http.StatusOK {
			t.Fatalf("PATCH %s %s: %d %s", path, body, r.status, r.body)
		}
		return decode[ledger.TreeCategory](t, r.body)
	}
	if c := patch("/api/categories/11", `{"name":"Huur, hypotheek"}`); c.Name != "Huur, hypotheek" || *c.ParentID != 1 {
		t.Errorf("rename: %+v", c)
	}
	// Recolouring a top recolours its subcategories.
	patch("/api/categories/1", `{"colour":"c3"}`)
	if p.count(`SELECT COUNT(*) FROM categories WHERE (id = 1 OR parent_id = 1) AND colour <> 'c3'`) != 0 {
		t.Error("the subcategories of Wonen kept their old colour")
	}
	// Moving a sub adopts the new parent's type and colour.
	if c := patch("/api/categories/12", `{"parentId":4}`); c.Colour != "c4" || *c.ParentID != 4 {
		t.Errorf("moved: %+v", c)
	}
	// A sub becomes an income top: green.
	if c := patch("/api/categories/13", `{"parentId":null,"type":"income"}`); c.ParentID != nil || c.Type != "income" || c.Colour != "soft" {
		t.Errorf("to an income top: %+v", c)
	}
	// An income top without subcategories becomes an expense one.
	if c := patch("/api/categories/"+id(inc), `{"type":"expense","colour":"c5"}`); c.Type != "expense" || c.Colour != "c5" {
		t.Errorf("retyped: %+v", c)
	}
	// Moving an income top under an expense top adopts expense.
	if c := patch("/api/categories/10", `{"parentId":6}`); c.Type != "expense" || c.Colour != "c6" {
		t.Errorf("income top moved under Overig: %+v", c)
	}
	// Everything still two levels, subs like their parents.
	if n := p.count(`SELECT COUNT(*) FROM categories c JOIN categories p ON p.id = c.parent_id
		WHERE p.parent_id IS NOT NULL OR c.type <> p.type OR c.colour <> p.colour`); n != 0 {
		t.Errorf("%d categories break the tree rules", n)
	}
}

func TestRemoveCategory(t *testing.T) {
	p := newPair(t)
	from := p.created(p.bert("POST", "/api/categories", `{"name":"Weg","parentId":3}`))
	to := p.created(p.bert("POST", "/api/categories", `{"name":"Hier","parentId":3}`))
	f, g := from.ID, to.ID
	// Bert's manual row, Partner's rule row, a split part, rules, budgets, a mapping, a suggestion.
	p.exec(`INSERT INTO rules (id, user_id, counterparty_match, category_id) VALUES (900, 2, 'Lidl', ?)`, f)
	p.exec(`UPDATE transactions SET category_id = ?, category_origin = 'manual' WHERE account_id = 1 AND counterparty_name = 'Kinepolis'`, f)
	p.exec(`UPDATE transactions SET category_id = ?, category_origin = 'rule', rule_id = 900 WHERE account_id = 5 AND counterparty_name = 'Lidl'`, f)
	split := p.count(`SELECT MIN(id) FROM transactions WHERE account_id = 1 AND counterparty_name = 'Decathlon'`)
	p.exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, -2000), (?, 6, -2290)`, split, f, split)
	p.exec(`INSERT INTO budgets (account_id, category_id, monthly_amount, from_month) VALUES (1, ?, 1000, '2026-01'), (1, ?, 2000, '2026-02'), (1, ?, 3000, '2026-02')`, f, f, g)
	p.exec(`INSERT INTO category_mappings (user_id, source, source_category, source_subcategory, category_id) VALUES (1, 'bilance', 'Vrije tijd & entertainment', 'Weg', ?)`, f)
	p.exec(`INSERT INTO category_suggestions (user_id, counterparty_key, category_id, confidence) VALUES (1, 'kinepolis', ?, 80)`, f)
	kine := p.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Kinepolis'`)
	lidl := p.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Lidl'`)

	path := "/api/categories/" + strconv.FormatInt(f, 10)
	for _, q := range []string{"", "?moveTo=", "?moveTo=abc", "?moveTo=0", "?moveTo=-3",
		"?moveTo=" + strconv.FormatInt(f, 10), "?moveTo=7", "?moveTo=999", "?moveTo=none"} {
		expectError(t, p.bert("DELETE", path+q, ""), http.StatusBadRequest, "invalid")
	}
	expectError(t, p.bert("DELETE", "/api/categories/3?moveTo=6", ""), http.StatusBadRequest, "invalid") // has subcategories
	expectError(t, p.bert("DELETE", "/api/categories/999?moveTo=none", ""), http.StatusNotFound, "not_found")

	// Atomic: a failure on the last step leaves everything as it was.
	p.exec(`CREATE TRIGGER fail BEFORE DELETE ON categories BEGIN SELECT RAISE(ABORT, 'boom'); END`)
	if r := p.bert("DELETE", path+"?moveTo="+strconv.FormatInt(g, 10), ""); r.status != http.StatusInternalServerError {
		t.Fatalf("with the trigger: %d %s", r.status, r.body)
	}
	if p.count(`SELECT COUNT(*) FROM transactions WHERE category_id = ?`, f) != kine+lidl || p.count(`SELECT COUNT(*) FROM rules WHERE category_id = ?`, f) != 1 ||
		p.count(`SELECT COUNT(*) FROM budgets WHERE category_id = ?`, f) != 2 || p.count(`SELECT COUNT(*) FROM transaction_splits WHERE category_id = ?`, f) != 1 {
		t.Fatal("a failed removal changed data")
	}
	p.exec(`DROP TRIGGER fail`)

	// Partner removes it for everyone; Bert's rows follow.
	if r := p.partner("DELETE", path+"?moveTo="+strconv.FormatInt(g, 10), ""); r.status != http.StatusNoContent || r.body != "" {
		t.Fatalf("remove: %d %s", r.status, r.body)
	}
	checks := []struct {
		name string
		q    string
		want int
	}{
		{"category gone", `SELECT COUNT(*) FROM categories WHERE id = ?1`, 0},
		{"Bert's rows moved, still manual", `SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Kinepolis' AND category_id = ?2 AND category_origin = 'manual'`, kine},
		{"Partner's rows moved, rule kept", `SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Lidl' AND category_id = ?2 AND category_origin = 'rule' AND rule_id = 900`, lidl},
		{"split part moved", `SELECT COUNT(*) FROM transaction_splits WHERE category_id = ?2`, 1},
		{"rule moved", `SELECT COUNT(*) FROM rules WHERE id = 900 AND category_id = ?2`, 1},
		{"budget of another month moved", `SELECT COUNT(*) FROM budgets WHERE category_id = ?2 AND from_month = '2026-01' AND monthly_amount = 1000`, 1},
		{"budget clash keeps the target's", `SELECT COUNT(*) FROM budgets WHERE category_id = ?2 AND from_month = '2026-02' AND monthly_amount = 3000`, 1},
		{"no budget left behind", `SELECT COUNT(*) FROM budgets WHERE category_id = ?1`, 0},
		{"mapping moved", `SELECT COUNT(*) FROM category_mappings WHERE category_id = ?2`, 1},
		{"suggestion moved", `SELECT COUNT(*) FROM category_suggestions WHERE category_id = ?2`, 1},
		{"audit, ids only", `SELECT COUNT(*) FROM audit_log WHERE event = 'category_removed' AND user_id = 2 AND detail = 'category=' || ?1 || ' moveTo=' || ?2`, 1},
	}
	for _, c := range checks {
		if got := p.count(c.q, f, g); got != c.want {
			t.Errorf("%s: %d, want %d", c.name, got, c.want)
		}
	}

	// To "none": refused while a split part uses it, then everything lets go.
	gp := "/api/categories/" + strconv.FormatInt(g, 10)
	expectError(t, p.bert("DELETE", gp+"?moveTo=none", ""), http.StatusBadRequest, "invalid")
	p.exec(`DELETE FROM transaction_splits`)
	if r := p.bert("DELETE", gp+"?moveTo=none", ""); r.status != http.StatusNoContent {
		t.Fatalf("remove to none: %d %s", r.status, r.body)
	}
	for _, c := range []struct {
		name string
		q    string
		want int
	}{
		{"rows uncategorised, origin and rule cleared", `SELECT COUNT(*) FROM transactions WHERE counterparty_name IN ('Kinepolis', 'Lidl')
			AND category_id IS NULL AND category_origin IS NULL AND rule_id IS NULL`, kine + lidl},
		{"its rules deleted", `SELECT COUNT(*) FROM rules WHERE id = 900`, 0},
		{"its budgets deleted", `SELECT COUNT(*) FROM budgets WHERE account_id = 1`, 0},
		{"its mapping left uncategorised", `SELECT COUNT(*) FROM category_mappings WHERE category_id IS NULL`, 1},
		{"its suggestions dropped", `SELECT COUNT(*) FROM category_suggestions`, 0},
	} {
		if got := p.count(c.q); got != c.want {
			t.Errorf("%s: %d, want %d", c.name, got, c.want)
		}
	}
}

func TestRulesAPI(t *testing.T) {
	p := newPair(t)
	r := p.bert("POST", "/api/rules", `{"counterparty":"  Winkel   Voorbeeld ","counterpartyIban":"be11 0000 0000 0071","categoryId":2}`)
	if r.status != http.StatusCreated {
		t.Fatalf("user rule: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"id":1,"accountId":null,"priority":0,"counterparty":"Winkel Voorbeeld","counterpartyExact":false,
		"counterpartyIban":"BE11 •••• •••• 0071","communication":null,"communicationRegex":false,"amountMin":null,"amountMax":null,
		"categoryId":2,"permission":"edit"}`)
	r = p.bert("POST", "/api/rules", `{"accountId":4,"priority":7,"communication":"netflix|spotify","communicationRegex":true,"amountMin":100,"amountMax":2000,"categoryId":24}`)
	if r.status != http.StatusCreated {
		t.Fatalf("account rule: %d %s", r.status, r.body)
	}
	shared := decode[ledger.RuleView](t, r.body)
	if p.count(`SELECT COUNT(*) FROM rules WHERE id = ? AND communication_regex = 'netflix|spotify' AND communication_contains IS NULL AND account_id = 4 AND user_id IS NULL`, shared.ID) != 1 {
		t.Error("the account rule is not stored as sent")
	}
	if p.count(`SELECT COUNT(*) FROM transactions WHERE rule_id IS NOT NULL`) != 0 {
		t.Error("creating a rule applied it")
	}

	// Lists: Bert sees both, priority first; Partner only the shared account's.
	list := decode[[]ledger.RuleView](t, p.bert("GET", "/api/rules", "").body)
	if len(list) != 2 || list[0].ID != shared.ID || list[1].ID != 1 {
		t.Errorf("Bert's rules: %+v", list)
	}
	pr := p.partner("GET", "/api/rules", "")
	if pl := decode[[]ledger.RuleView](t, pr.body); len(pl) != 1 || pl[0].ID != shared.ID || pl[0].Permission != "edit" {
		t.Errorf("Partner's rules: %s", pr.body)
	}
	if strings.Contains(pr.body, "Winkel") {
		t.Error("Partner sees Bert's user rule")
	}

	// PATCH: left out keeps, "" and null clear.
	r = p.bert("PATCH", "/api/rules/1", `{"counterparty":null,"priority":3}`)
	if v := decode[ledger.RuleView](t, r.body); r.status != 200 || v.Counterparty != nil || v.CounterpartyIBAN == nil || v.Priority != 3 {
		t.Errorf("patch: %d %s", r.status, r.body)
	}
	expectError(t, p.bert("PATCH", "/api/rules/1", `{"counterpartyIban":""}`), http.StatusBadRequest, "invalid") // no condition left
	expectError(t, p.bert("PATCH", "/api/rules/1", `{"accountId":1}`), http.StatusBadRequest, "invalid")
	r = p.bert("PATCH", "/api/rules/1", `{"communication":"Café  Centrum","counterpartyIban":""}`)
	if v := decode[ledger.RuleView](t, r.body); r.status != 200 || v.CounterpartyIBAN != nil || *v.Communication != "Café Centrum" {
		t.Errorf("patch to a communication: %d %s", r.status, r.body)
	}
	r = p.bert("PATCH", "/api/rules/1", `{"communicationRegex":true}`)
	if r.status != 200 || p.count(`SELECT COUNT(*) FROM rules WHERE id = 1 AND communication_regex = 'Café Centrum' AND communication_contains IS NULL`) != 1 {
		t.Errorf("switch to a pattern: %d %s", r.status, r.body)
	}

	// Validation.
	for _, body := range []string{
		`{"categoryId":2}`,
		`{"counterparty":"   ","categoryId":2}`,
		`{"counterparty":"x"}`,
		`{"counterparty":"x","categoryId":999}`,
		`{"counterparty":"x","categoryId":null}`,
		`{"counterparty":"` + strings.Repeat("a", 141) + `","categoryId":2}`,
		`{"communication":"` + strings.Repeat("a", 201) + `","categoryId":2}`,
		`{"communication":"` + strings.Repeat("a", 201) + `","communicationRegex":true,"categoryId":2}`,
		`{"communication":"(unclosed","communicationRegex":true,"categoryId":2}`,
		`{"communication":"a(?<=b)","communicationRegex":true,"categoryId":2}`,
		`{"amountMin":500,"amountMax":100,"categoryId":2}`,
		`{"amountMin":-1,"categoryId":2}`,
		`{"counterparty":"x","priority":1001,"categoryId":2}`,
		`{"counterparty":"x","priority":-1,"categoryId":2}`,
		`{"counterpartyIban":"12345678","categoryId":2}`,
		`{"counterpartyIban":"BE1","categoryId":2}`,
		`{"counterpartyIban":"BE` + strings.Repeat("1", 33) + `","categoryId":2}`,
		`{"counterparty":"a\u0000b","categoryId":2}`,
		`{"counterparty":"x","categoryId":2,"name":"x"}`,
		`{"counterparty":"x","categoryId":"2"}`,
	} {
		expectError(t, p.bert("POST", "/api/rules", body), http.StatusBadRequest, "invalid")
	}
	// An IBAN of 8 characters is a condition (no check digits are checked).
	if r := p.bert("POST", "/api/rules", `{"counterpartyIban":"BE123456","categoryId":2}`); r.status != 201 || !strings.Contains(r.body, `"••••"`) {
		t.Errorf("short IBAN: %d %s", r.status, r.body)
	}

	// Owners: someone else's account is hidden, a read-only one forbidden.
	expectError(t, p.bert("POST", "/api/rules", `{"accountId":5,"counterparty":"x","categoryId":2}`), http.StatusNotFound, "not_found")
	expectError(t, p.bert("POST", "/api/rules", `{"accountId":999,"counterparty":"x","categoryId":2}`), http.StatusNotFound, "not_found")
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	if pl := decode[[]ledger.RuleView](t, p.partner("GET", "/api/rules", "").body); len(pl) != 1 || pl[0].Permission != "read" {
		t.Errorf("read-only member: %+v", pl)
	}
	sid := "/api/rules/" + strconv.FormatInt(shared.ID, 10)
	expectError(t, p.partner("PATCH", sid, `{"priority":1}`), http.StatusForbidden, "forbidden")
	expectError(t, p.partner("DELETE", sid, ""), http.StatusForbidden, "forbidden")
	expectError(t, p.partner("POST", "/api/rules", `{"accountId":4,"counterparty":"x","categoryId":2}`), http.StatusForbidden, "forbidden")
	expectError(t, p.partner("PATCH", "/api/rules/1", `{"priority":1}`), http.StatusNotFound, "not_found")
	expectError(t, p.partner("DELETE", "/api/rules/1", ""), http.StatusNotFound, "not_found")
	expectError(t, p.bert("DELETE", "/api/rules/999", ""), http.StatusNotFound, "not_found")

	// At most 200 rules per owner.
	for range 200 - p.count(`SELECT COUNT(*) FROM rules WHERE user_id = 1`) {
		p.exec(`INSERT INTO rules (user_id, counterparty_match, category_id) VALUES (1, 'x', 2)`)
	}
	expectError(t, p.bert("POST", "/api/rules", `{"counterparty":"x","categoryId":2}`), http.StatusBadRequest, "invalid")
	if r := p.bert("POST", "/api/rules", `{"accountId":1,"counterparty":"x","categoryId":2}`); r.status != 201 {
		t.Errorf("another owner is not capped: %d %s", r.status, r.body)
	}

	if r := p.bert("DELETE", sid, ""); r.status != http.StatusNoContent {
		t.Errorf("delete: %d %s", r.status, r.body)
	}
	// The full IBAN never appears.
	if b := p.bert("GET", "/api/rules", "").body; strings.Contains(b, "BE11000000000071") || strings.Contains(b, "0000 0000") {
		t.Error("a rule's IBAN is shown in full")
	}
}

func TestRulesApply(t *testing.T) {
	p := newPair(t)
	apply := func(h func(string, string, string) response) int {
		t.Helper()
		r := h("POST", "/api/rules/apply", "")
		if r.status != http.StatusOK {
			t.Fatalf("apply: %d %s", r.status, r.body)
		}
		return decode[map[string]int](t, r.body)["updated"]
	}
	post := func(h func(string, string, string) response, body string) int64 {
		t.Helper()
		r := h("POST", "/api/rules", body)
		if r.status != http.StatusCreated {
			t.Fatalf("rule %s: %d %s", body, r.status, r.body)
		}
		return decode[ledger.RuleView](t, r.body).ID
	}
	state := func() string {
		t.Helper()
		var s string
		if err := p.db.QueryRow(`SELECT group_concat(id || ':' || COALESCE(category_id, '-') || ':' || COALESCE(category_origin, '-') || ':' || COALESCE(rule_id, '-'), ',')
			FROM (SELECT * FROM transactions ORDER BY id)`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	imported := p.count(`SELECT COUNT(*) FROM transactions WHERE category_origin = 'import'`)
	// An open row on the shared account.
	p.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key)
		VALUES (4, -1234, '2026-11-17', 'Colruyt Laagste Prijzen', 'booked', 'test-open')`)

	bakker := post(p.bert, `{"counterparty":"bakkerij de graankorrel","categoryId":16}`)
	post(p.bert, `{"accountId":1,"counterparty":"Bol.com","counterpartyExact":true,"priority":5,"categoryId":6}`)
	post(p.bert, `{"counterparty":"colruyt","categoryId":15}`)    // a user rule: never on the shared account
	post(p.partner, `{"counterparty":"apotheek","categoryId":6}`) // Partner's: never on Bert's account
	post(p.partner, `{"counterparty":"Frituur","categoryId":6}`)  // likewise
	if n := apply(p.partner); n != 0 {
		t.Errorf("Partner's apply changed %d rows", n)
	}
	if n := apply(p.bert); n != 2 { // Bakkerij and the pending Bol.com
		t.Errorf("Bert's apply changed %d rows, want 2", n)
	}
	if p.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Bakkerij De Graankorrel' AND category_id = 16 AND category_origin = 'rule' AND rule_id = ?`, bakker) != 1 ||
		p.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Bol.com' AND status = 'pending' AND category_id = 6 AND category_origin = 'rule'`) != 1 {
		t.Error("the rules did not categorise Bert's open rows")
	}
	if p.count(`SELECT COUNT(*) FROM transactions WHERE category_origin = 'import'`) != imported {
		t.Error("an imported category changed")
	}
	if p.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name IN ('Apotheek Van Damme', 'Frituur ''t Pleintje') AND category_id IS NULL`) != 2 ||
		p.count(`SELECT COUNT(*) FROM transactions WHERE dedupe_key = 'test-open' AND category_id IS NULL`) != 1 {
		t.Error("a user rule reached another user's or a shared account")
	}
	before := state()
	if n := apply(p.bert); n != 0 || state() != before {
		t.Errorf("the second apply changed %d rows", n)
	}

	// A manual choice survives a higher priority, another rule for the same
	// counterparty, and the rule's removal.
	p.exec(`UPDATE transactions SET category_id = 3, category_origin = 'manual', rule_id = NULL WHERE counterparty_name = 'Bakkerij De Graankorrel'`)
	if r := p.bert("PATCH", "/api/rules/"+strconv.FormatInt(bakker, 10), `{"priority":1000,"categoryId":15}`); r.status != 200 {
		t.Fatalf("patch: %d %s", r.status, r.body)
	}
	post(p.bert, `{"accountId":1,"counterparty":"Bakkerij","priority":999,"categoryId":2}`)
	apply(p.bert)
	if p.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Bakkerij De Graankorrel' AND category_id = 3 AND category_origin = 'manual'`) != 1 {
		t.Error("a manual choice was overwritten")
	}
	// Deleting a rule keeps what it set.
	bol := decode[[]ledger.RuleView](t, p.bert("GET", "/api/rules", "").body)
	for _, v := range bol {
		if v.Counterparty != nil && *v.Counterparty == "Bol.com" {
			if r := p.bert("DELETE", "/api/rules/"+strconv.FormatInt(v.ID, 10), ""); r.status != 204 {
				t.Fatalf("delete: %d", r.status)
			}
		}
	}
	if p.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Bol.com' AND status = 'pending' AND category_id = 6 AND category_origin = 'rule' AND rule_id IS NULL`) != 1 {
		t.Error("deleting the rule changed the category it set")
	}
	// A read-only member's apply leaves the account alone; an account rule
	// applies for its members.
	post(p.partner, `{"accountId":4,"counterparty":"Colruyt","categoryId":15}`)
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	if apply(p.partner) != 0 {
		t.Error("a read-only member applied rules")
	}
	if apply(p.bert) != 1 || p.count(`SELECT COUNT(*) FROM transactions WHERE dedupe_key = 'test-open' AND category_id = 15`) != 1 {
		t.Error("the shared account's rule did not apply")
	}
}

// The sync and the CSV import tag new rows with the first matching rule;
// stored rows are never re-evaluated by them.
func TestRulesOnSyncAndImport(t *testing.T) {
	e := newBankEnv(t)
	if err := categorise.SeedDefaults(context.Background(), e.db); err != nil {
		t.Fatal(err)
	}
	e.saveCredentials(e.bert)
	e.link(e.bert, "")
	personal := e.count(`SELECT id FROM accounts WHERE iban = ?`, ibanPersonal)
	rule := func(user int64, body string) {
		t.Helper()
		if r := e.as(user, "POST", "/api/rules", body); r.status != http.StatusCreated {
			t.Fatalf("rule %s: %d %s", body, r.status, r.body)
		}
	}
	rule(e.bert, `{"accountId":`+strconv.Itoa(personal)+`,"counterparty":"koffie","categoryId":17}`)
	rule(e.bert, `{"counterparty":"Supermarkt","counterpartyExact":true,"categoryId":15}`) // the shared account has one member here
	rule(e.partner, `{"counterparty":"bakkerij","categoryId":16}`)
	state := func() string {
		return e.query(`SELECT counterparty_name, status, COALESCE(category_id, '-'), COALESCE(category_origin, '-') FROM transactions ORDER BY id`)
	}
	sync := func() {
		t.Helper()
		e.now = e.now.Add(16 * time.Minute)
		if r := e.as(e.bert, "POST", "/api/sync", ""); r.status != http.StatusAccepted {
			t.Fatalf("sync: %d %s", r.status, r.body)
		}
	}
	if e.count(`SELECT COUNT(*) FROM transactions WHERE category_id IS NOT NULL`) != 0 {
		t.Fatal("rows were categorised before any rule existed")
	}
	e.bank.set(func(b *testBank) {
		b.txs[ibanPersonal] = append(b.txs[ibanPersonal],
			bank.Transaction{EntryReference: "ref-3", BookingDate: "2026-11-16", Amount: -380, CounterpartyName: "Koffiebar", Status: bank.StatusBooked},
			bank.Transaction{EntryReference: "ref-4", BookingDate: "2026-11-16", Amount: -990, CounterpartyName: "Bakkerij Voorbeeld", Status: bank.StatusBooked})
		b.txs[ibanShared] = append(b.txs[ibanShared],
			bank.Transaction{EntryReference: "ref-10", BookingDate: "2026-11-16", Amount: -4321, CounterpartyName: "Supermarkt", Status: bank.StatusBooked})
	})
	sync()
	for _, c := range []struct {
		name string
		q    string
		want int
	}{
		{"new coffee by the account rule", `SELECT COUNT(*) FROM transactions WHERE external_id = 'ref-3' AND category_id = 17 AND category_origin = 'rule' AND rule_id = 1`, 1},
		{"stored pending coffee not re-evaluated", `SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Koffiebar' AND status = 'pending' AND category_id IS NULL`, 1},
		{"stored supermarket not re-evaluated", `SELECT COUNT(*) FROM transactions WHERE external_id = 'ref-9' AND category_id IS NULL`, 1},
		{"new supermarket by Bert's user rule", `SELECT COUNT(*) FROM transactions WHERE external_id = 'ref-10' AND category_id = 15`, 1},
		{"Partner's rule never on Bert's rows", `SELECT COUNT(*) FROM transactions WHERE counterparty_name LIKE 'Bakkerij%' AND category_id IS NOT NULL`, 0},
	} {
		if got := e.count(c.q); got != c.want {
			t.Errorf("%s: %d, want %d", c.name, got, c.want)
		}
	}
	before := state()
	rule(e.bert, `{"counterparty":"werkgever","categoryId":7}`)
	sync()
	if got := state(); got != before {
		t.Errorf("a repeated sync, after a new rule, changed stored rows:\n%s\nwant\n%s", got, before)
	}

	// The import: new rows tagged, a preview stores nothing.
	rule(e.bert, `{"counterparty":"Koffiehuis","categoryId":17}`)
	e.importOK(e.bert, int64(personal), csvHeader+csvCoffee)
	if e.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Koffiehuis Test' AND category_id = 17 AND category_origin = 'rule' AND import_batch_id IS NOT NULL`) != 1 {
		t.Error("the import did not tag the new row")
	}
	if r := e.upload(e.bert, "/api/imports/preview", importForm(csvHeader+"10/11/2026;10/11/2026;-4,50;Koffiehuis Ander;;x\n", int64(personal), csvMapping)...); r.status != 200 {
		t.Fatalf("preview: %d %s", r.status, r.body)
	}
	if e.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Koffiehuis Ander'`) != 0 {
		t.Error("the preview stored a row")
	}
}

// The new writes are guarded like every other unsafe request.
func TestCategoryAndRuleWritesRefuseCrossOrigin(t *testing.T) {
	e := newBankEnv(t)
	if err := categorise.SeedDefaults(context.Background(), e.db); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ method, path, body string }{
		{"POST", "/api/categories", `{"name":"x","type":"expense"}`},
		{"PATCH", "/api/categories/1", `{"name":"x"}`},
		{"DELETE", "/api/categories/11?moveTo=none", ""},
		{"POST", "/api/rules", `{"counterparty":"x","categoryId":1}`},
		{"POST", "/api/rules/apply", ""},
		{"POST", "/api/rules/preview", `{"counterparty":"x"}`},
		{"POST", "/api/rules/1/apply", ""},
		{"PUT", "/api/rules/order", `{"ids":[]}`},
		{"POST", "/api/suggestions/confirm", `{"counterpartyKey":"x","categoryId":1}`},
		{"POST", "/api/suggestions/dismiss", `{"counterpartyKey":"x","categoryId":1}`},
		{"POST", "/api/suggestions/backfill", `{"items":[{"counterpartyKey":"x","categoryId":1}]}`},
	} {
		r := e.do(call{method: c.method, path: c.path, body: c.body, header: map[string]string{
			"X-Test-User": strconv.FormatInt(e.bert, 10), "Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example.org"}})
		expectError(t, r, http.StatusForbidden, "forbidden")
	}
	if e.count(`SELECT COUNT(*) FROM categories`) != 25 || e.count(`SELECT COUNT(*) FROM rules`) != 0 ||
		e.count(`SELECT COUNT(*) FROM categories WHERE name = 'x'`) != 0 {
		t.Error("a cross-origin request changed data")
	}
}

// CAT-6: the icon is a name of the fixed list; null or "" clears it, leaving
// it out of a change keeps it, and a sub category may carry one.
func TestCategoryIcons(t *testing.T) {
	p := newPair(t)
	list := decode[[]ledger.TreeCategory](t, p.bert("GET", "/api/categories", "").body)
	if list[0].Icon == nil || *list[0].Icon != "home" || list[1].Icon == nil || *list[1].Icon != "home" {
		t.Errorf("seeded icons: %v, %v", list[0].Icon, list[1].Icon)
	}
	top := p.created(p.bert("POST", "/api/categories", `{"name":"Huisdieren","type":"expense","icon":"paw"}`))
	if top.Icon == nil || *top.Icon != "paw" {
		t.Fatalf("created: %+v", top)
	}
	sub := p.created(p.bert("POST", "/api/categories", `{"name":"Voeding","parentId":`+strconv.FormatInt(top.ID, 10)+`}`))
	if sub.Icon != nil {
		t.Errorf("no icon sent: %v", *sub.Icon)
	}
	path := "/api/categories/" + strconv.FormatInt(top.ID, 10)
	expectError(t, p.bert("PATCH", path, `{"icon":"unicorn"}`), http.StatusBadRequest, "invalid")
	expectError(t, p.bert("POST", "/api/categories", `{"name":"x","type":"expense","icon":"Paw"}`), http.StatusBadRequest, "invalid")
	if c := decode[ledger.TreeCategory](t, p.bert("PATCH", path, `{"name":"Dieren"}`).body); c.Icon == nil || *c.Icon != "paw" {
		t.Errorf("icon left out of a change must stay: %+v", c)
	}
	if c := decode[ledger.TreeCategory](t, p.bert("PATCH", path, `{"icon":"bag"}`).body); c.Icon == nil || *c.Icon != "bag" {
		t.Errorf("changed: %+v", c)
	}
	for _, body := range []string{`{"icon":null}`, `{"icon":""}`} {
		p.bert("PATCH", path, `{"icon":"bag"}`)
		if c := decode[ledger.TreeCategory](t, p.bert("PATCH", path, body).body); c.Icon != nil {
			t.Errorf("%s did not clear: %v", body, *c.Icon)
		}
	}
}
