package server

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// addRow stores an invented row on an account of the demo and returns its id.
func (p *pair) addRow(account int64, name string, amount int64, status string, category, origin any) int64 {
	p.t.Helper()
	var id int64
	if err := p.db.QueryRow(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id, category_origin)
		VALUES (?, ?, '2026-11-16', ?, ?, 'test-' || (SELECT COUNT(*) FROM transactions), ?, ?) RETURNING id`,
		account, amount, name, status, category, origin).Scan(&id); err != nil {
		p.t.Fatal(err)
	}
	return id
}

func (p *pair) tx(h func(string, string, string) response, method, path, body string) ledger.Transaction {
	p.t.Helper()
	r := h(method, path, body)
	if r.status != http.StatusOK {
		p.t.Fatalf("%s %s %s: %d %s", method, path, body, r.status, r.body)
	}
	return decode[ledger.Transaction](p.t, r.body)
}

// row is one row's category, origin, rule and note as stored.
func (p *pair) row(id int64) string {
	p.t.Helper()
	var s string
	if err := p.db.QueryRow(`SELECT COALESCE(category_id, '-') || ':' || COALESCE(category_origin, '-') || ':' || COALESCE(rule_id, '-') || ':' || COALESCE(note, '-')
		FROM transactions WHERE id = ?`, id).Scan(&s); err != nil {
		p.t.Fatal(err)
	}
	return s
}

func txPath(id int64, suffix string) string {
	return "/api/transactions/" + strconv.FormatInt(id, 10) + suffix
}

func TestPatchTransaction(t *testing.T) {
	p := newPair(t)
	bol := p.addRow(1, "Webwinkel Proef", -2499, "pending", nil, nil)
	path := txPath(bol, "")

	// A pending row may be categorised; the same category again is a no-op.
	got := p.tx(p.bert, "PATCH", path, `{"categoryId":6}`)
	if got.Category == nil || got.Category.ID != 6 || *got.CategoryOrigin != "manual" || got.RuleID != nil || got.Note != nil || got.Splits != nil {
		t.Fatalf("categorised: %+v", got)
	}
	p.tx(p.bert, "PATCH", path, `{"categoryId":6}`)
	if p.row(bol) != "6:manual:-:-" {
		t.Errorf("row %s", p.row(bol))
	}
	// A rule's category picked by hand becomes manual and loses the rule.
	p.exec(`INSERT INTO rules (id, user_id, counterparty_match, category_id) VALUES (700, 1, 'webwinkel', 5)`)
	p.exec(`UPDATE transactions SET category_id = 5, category_origin = 'rule', rule_id = 700 WHERE id = ?`, bol)
	p.tx(p.bert, "PATCH", path, `{"categoryId":5}`)
	if p.row(bol) != "5:manual:-:-" {
		t.Errorf("rule category picked by hand: %s", p.row(bol))
	}

	// Notes: cleaned, at most 200 characters, cleared by "" or null.
	if n := p.tx(p.bert, "PATCH", path, `{"note":"  verjaardag \n  cadeau  "}`); n.Note == nil || *n.Note != "verjaardag cadeau" {
		t.Errorf("note: %+v", n.Note)
	}
	p.tx(p.bert, "PATCH", path, `{"note":"`+strings.Repeat("é", 200)+`"}`)
	for _, body := range []string{
		`{"note":"` + strings.Repeat("é", 201) + `"}`,
		`{"note":"a\u0007b"}`,
		`{}`,
		`{"categoryId":999}`,
		`{"categoryId":null}`,
		`{"categoryId":"6"}`,
		`{"categoryId":6,"extra":1}`,
	} {
		expectError(t, p.bert("PATCH", path, body), http.StatusBadRequest, "invalid")
	}
	if p.row(bol) != "5:manual:-:"+strings.Repeat("é", 200) {
		t.Error("a refused PATCH changed the row")
	}
	for _, body := range []string{`{"note":""}`, `{"note":null}`} {
		p.tx(p.bert, "PATCH", path, `{"note":"x"}`)
		if n := p.tx(p.bert, "PATCH", path, body); n.Note != nil {
			t.Errorf("%s: note %v", body, *n.Note)
		}
	}
	// Both at once.
	if n := p.tx(p.bert, "PATCH", path, `{"categoryId":2,"note":"boodschappen"}`); n.Category.ID != 2 || *n.Note != "boodschappen" {
		t.Errorf("both: %+v", n)
	}
	// The list shows the same.
	page := decode[ledger.Page](t, p.bert("GET", "/api/transactions?q=Webwinkel", "").body)
	if len(page.Items) != 1 || *page.Items[0].Note != "boodschappen" || *page.Items[0].CategoryOrigin != "manual" {
		t.Errorf("list: %+v", page.Items)
	}

	// Hidden: another user's row, unknown and malformed ids.
	for _, path := range []string{path, txPath(999999, ""), "/api/transactions/abc", "/api/transactions/0"} {
		expectError(t, p.partner("PATCH", path, `{"note":"x"}`), http.StatusNotFound, "not_found")
	}
}

// The rule that set a category is shown only to who can see that rule.
func TestRuleIDVisibility(t *testing.T) {
	p := newPair(t)
	shared := p.addRow(4, "Gedeelde Proef", -500, "booked", nil, nil)
	own := p.addRow(1, "Eigen Proef", -500, "booked", nil, nil)
	p.exec(`INSERT INTO rules (id, user_id, counterparty_match, category_id) VALUES (801, 1, 'proef', 2)`)
	p.exec(`INSERT INTO rules (id, account_id, counterparty_match, category_id) VALUES (802, 4, 'proef', 3)`)
	// A user rule of Bert that set a category on an account Partner sees too
	// (a personal account that became shared).
	p.exec(`UPDATE transactions SET category_id = 2, category_origin = 'rule', rule_id = 801 WHERE id IN (?, ?)`, shared, own)
	ruleOf := func(h func(string, string, string) response, id int64) *int64 {
		t.Helper()
		for _, it := range decode[ledger.Page](t, h("GET", "/api/transactions?q=Proef", "").body).Items {
			if it.ID == id {
				return it.RuleID
			}
		}
		t.Fatalf("row %d not listed", id)
		return nil
	}
	if r := ruleOf(p.bert, shared); r == nil || *r != 801 {
		t.Errorf("Bert's own rule: %v", r)
	}
	if r := ruleOf(p.partner, shared); r != nil {
		t.Errorf("Partner sees Bert's rule id %d", *r)
	}
	if b := p.partner("GET", "/api/transactions?q=Proef", "").body; strings.Contains(b, "801") || strings.Contains(b, "Eigen Proef") {
		t.Errorf("Partner's list: %s", b)
	}
	p.exec(`UPDATE transactions SET rule_id = 802 WHERE id = ?`, shared)
	if r := ruleOf(p.partner, shared); r == nil || *r != 802 {
		t.Errorf("an account rule of a shared account: %v", r)
	}
	p.exec(`DELETE FROM rules WHERE id = 802`)
	if r := ruleOf(p.bert, shared); r != nil {
		t.Errorf("a deleted rule: %v", *r)
	}
}

func TestSimilar(t *testing.T) {
	p := newPair(t)
	clicked := p.addRow(1, "Winkel Proef", -1000, "booked", nil, nil)
	a1 := p.addRow(1, "  WINKEL   PRÓEF Gent", -1500, "booked", nil, nil)
	a2 := p.addRow(1, "winkel proef", -700, "pending", nil, nil)
	a3 := p.addRow(2, "Winkel Proef", -100, "booked", nil, nil) // Bert's other personal account
	m := p.addRow(1, "Winkel Proef", -1000, "booked", 3, "manual")
	i := p.addRow(1, "Winkel Proef", -1000, "booked", 3, "import")
	s := p.addRow(1, "Winkel Proef", -1000, "booked", nil, nil)
	p.exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, 2, -600), (?, 3, -400)`, s, s)
	r := p.addRow(1, "Winkel Proef Noord", -1000, "booked", nil, nil)
	p.exec(`INSERT INTO rules (user_id, priority, counterparty_match, category_id) VALUES (1, 5, 'proef noord', 4)`)
	e := p.addRow(1, "Winkel Proef", -1000, "booked", 2, "rule") // already right
	x := p.addRow(4, "Winkel Proef", -1000, "booked", nil, nil)  // shared: not for a user rule
	q := p.addRow(5, "Winkel Proef", -1000, "booked", nil, nil)  // Partner's
	protected := map[int64]string{m: p.row(m), i: p.row(i), s: p.row(s), r: p.row(r), x: p.row(x), q: p.row(q)}

	expectError(t, p.bert("GET", txPath(clicked, "/similar"), ""), http.StatusBadRequest, "invalid") // no category yet
	p.tx(p.bert, "PATCH", txPath(clicked, ""), `{"categoryId":2}`)
	preview := func(id int64) ledger.Similar {
		t.Helper()
		r := p.bert("GET", txPath(id, "/similar"), "")
		if r.status != http.StatusOK {
			t.Fatalf("preview: %d %s", r.status, r.body)
		}
		return decode[ledger.Similar](t, r.body)
	}
	apply := func(id int64, body string) ledger.SimilarResult {
		t.Helper()
		r := p.bert("POST", txPath(id, "/similar"), body)
		if r.status != http.StatusOK {
			t.Fatalf("apply: %d %s", r.status, r.body)
		}
		return decode[ledger.SimilarResult](t, r.body)
	}
	pre := preview(clicked)
	want := ledger.Similar{Counterparty: "Winkel Proef", Scope: "user", Count: 3, Skipped: categorise.Skipped{Manual: 1, Import: 1, Split: 1, Rule: 1}}
	if pre != want {
		t.Errorf("preview %+v, want %+v", pre, want)
	}
	rules := p.count(`SELECT COUNT(*) FROM rules`)
	res := apply(clicked, "")
	if !res.RuleCreated || res.Updated != pre.Count || res.Skipped != pre.Skipped {
		t.Errorf("apply: %+v", res)
	}
	if v := res.Rule; v.AccountID != nil || *v.Counterparty != "Winkel Proef" || v.CounterpartyExact || v.Priority != 0 || v.CategoryID != 2 ||
		v.CounterpartyIBAN != nil || v.Communication != nil || v.AmountMin != nil || v.AmountMax != nil || v.Permission != "edit" {
		t.Errorf("rule: %+v", v)
	}
	if res.Transaction.ID != clicked || *res.Transaction.CategoryOrigin != "manual" || res.Transaction.Category.ID != 2 {
		t.Errorf("transaction: %+v", res.Transaction)
	}
	ruleID := strconv.FormatInt(res.Rule.ID, 10)
	for _, id := range []int64{a1, a2, a3} {
		if got := p.row(id); got != "2:rule:"+ruleID+":-" {
			t.Errorf("row %d: %s", id, got)
		}
	}
	for id, was := range protected {
		if got := p.row(id); got != was {
			t.Errorf("protected row %d: %s, was %s", id, got, was)
		}
	}
	// Idempotent: the same rule, nothing more.
	if again := apply(clicked, "{}"); again.RuleCreated || again.Updated != 0 || again.Rule.ID != res.Rule.ID ||
		p.count(`SELECT COUNT(*) FROM rules`) != rules+1 {
		t.Errorf("second apply: %+v", again)
	}
	if again := preview(clicked); again.Count != 0 {
		t.Errorf("preview after apply: %+v", again)
	}
	expectError(t, p.bert("POST", txPath(clicked, "/similar"), `{"x":1}`), http.StatusBadRequest, "invalid")

	// The repair path: another category with the checkbox on reuses the rule.
	p.tx(p.bert, "PATCH", txPath(clicked, ""), `{"categoryId":5}`)
	pre = preview(clicked)
	res = apply(clicked, "")
	if res.RuleCreated || res.Rule.ID != mustInt(t, ruleID) || res.Rule.CategoryID != 5 || res.Updated != 4 || pre.Count != 4 {
		t.Errorf("repair: preview %+v, apply %+v", pre, res)
	}
	if p.row(e) != "5:rule:"+ruleID+":-" || p.row(a1) != "5:rule:"+ruleID+":-" {
		t.Errorf("repaired rows: %s %s", p.row(e), p.row(a1))
	}
	for id, was := range protected {
		if got := p.row(id); got != was {
			t.Errorf("protected row %d after repair: %s, was %s", id, got, was)
		}
	}

	// A shared account makes an account rule, which covers that account only.
	p.tx(p.bert, "PATCH", txPath(x, ""), `{"categoryId":3}`)
	other := p.addRow(4, "winkel proef", -300, "booked", nil, nil)
	if pre := preview(x); pre.Scope != "account" || pre.Count != 1 {
		t.Errorf("shared preview: %+v", pre)
	}
	res = apply(x, "")
	if res.Rule.AccountID == nil || *res.Rule.AccountID != 4 || res.Updated != 1 || !res.RuleCreated {
		t.Errorf("shared apply: %+v", res)
	}
	if p.row(other) != "3:rule:"+strconv.FormatInt(res.Rule.ID, 10)+":-" || p.row(q) != protected[q] || p.row(a1) != "5:rule:"+ruleID+":-" {
		t.Errorf("shared apply reached the wrong rows: %s %s %s", p.row(other), p.row(q), p.row(a1))
	}

	// No counterparty name: no basis.
	blank := p.addRow(1, "   ", -100, "booked", 2, "manual")
	if pre := preview(blank); pre != (ledger.Similar{Scope: "user"}) {
		t.Errorf("blank preview: %+v", pre)
	}
	expectError(t, p.bert("POST", txPath(blank, "/similar"), ""), http.StatusBadRequest, "invalid")
	// A split row has no single category.
	expectError(t, p.bert("GET", txPath(s, "/similar"), ""), http.StatusBadRequest, "invalid")
	expectError(t, p.bert("POST", txPath(s, "/similar"), ""), http.StatusBadRequest, "invalid")

	// 200 rules: creating is refused and nothing changes; reusing still works.
	for range 200 - p.count(`SELECT COUNT(*) FROM rules WHERE user_id = 1`) {
		p.exec(`INSERT INTO rules (user_id, counterparty_match, category_id) VALUES (1, 'vul', 2)`)
	}
	fresh := p.addRow(1, "Nieuwe Winkel", -100, "booked", 6, "rule")
	before := p.row(fresh)
	expectError(t, p.bert("POST", txPath(fresh, "/similar"), ""), http.StatusBadRequest, "invalid")
	if p.row(fresh) != before {
		t.Errorf("a refused apply changed the row: %s", p.row(fresh))
	}
	if res := apply(clicked, ""); res.RuleCreated {
		t.Error("reuse at the limit created a rule")
	}

	// Hidden and read-only.
	for _, id := range []int64{clicked, 999999} {
		expectError(t, p.partner("GET", txPath(id, "/similar"), ""), http.StatusNotFound, "not_found")
		expectError(t, p.partner("POST", txPath(id, "/similar"), ""), http.StatusNotFound, "not_found")
	}
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	expectError(t, p.partner("GET", txPath(x, "/similar"), ""), http.StatusForbidden, "forbidden")
	expectError(t, p.partner("POST", txPath(x, "/similar"), ""), http.StatusForbidden, "forbidden")
}

func mustInt(t *testing.T, s string) int64 {
	t.Helper()
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSplit(t *testing.T) {
	p := newPair(t)
	row := p.addRow(1, "Warenhuis Proef", -8642, "booked", 2, "import")
	path := txPath(row, "/split")
	countOf := func(category int64) int {
		t.Helper()
		for _, c := range decode[[]ledger.TreeCategory](t, p.bert("GET", "/api/categories", "").body) {
			if c.ID == category {
				return c.Count
			}
		}
		t.Fatalf("no category %d", category)
		return 0
	}
	before2, before3, before6 := countOf(2), countOf(3), countOf(6)

	got := p.tx(p.bert, "PUT", path, `{"parts":[{"categoryId":3,"amount":-6492},{"categoryId":6,"amount":-1150},{"categoryId":6,"amount":-1000}]}`)
	if got.Category != nil || got.CategoryOrigin != nil || got.RuleID != nil || len(got.Splits) != 3 ||
		got.Splits[0] != (ledger.Split{Category: ledger.Category{ID: 3, Name: "Vrije tijd", Colour: "c3"}, Amount: -6492}) || got.Splits[2].Amount != -1000 {
		t.Fatalf("split: %+v", got)
	}
	if p.row(row) != "2:import:-:-" {
		t.Errorf("the row's own category changed: %s", p.row(row))
	}
	// Counts: once under each part's category, no longer under its own.
	if countOf(2) != before2-1 || countOf(3) != before3+1 || countOf(6) != before6+1 {
		t.Errorf("counts %d %d %d, were %d %d %d", countOf(2), countOf(3), countOf(6), before2, before3, before6)
	}

	pending := p.addRow(1, "Pending Proef", -1000, "pending", nil, nil)
	income := p.addRow(1, "Inkomen Proef", 1000, "booked", nil, nil)
	for _, c := range []struct {
		path, body string
	}{
		{path, `{"parts":[{"categoryId":3,"amount":-8642}]}`}, // one part
		{path, `{"parts":[]}`},                                // none
		{path, `{}`},                                          // none
		{path, `{"parts":[` + strings.Repeat(`{"categoryId":3,"amount":-1},`, 10) + `{"categoryId":3,"amount":-8632}]}`}, // 11 parts
		{path, `{"parts":[{"categoryId":3,"amount":-8000},{"categoryId":6,"amount":-641}]}`},                             // sum
		{path, `{"parts":[{"categoryId":3,"amount":-8743},{"categoryId":6,"amount":101}]}`},                              // sign
		{path, `{"parts":[{"categoryId":3,"amount":-8642},{"categoryId":6,"amount":0}]}`},                                // zero
		{path, `{"parts":[{"categoryId":3,"amount":-9223372036854775807},{"categoryId":6,"amount":-9223372036854775807}]}`},
		{path, `{"parts":[{"categoryId":999,"amount":-8000},{"categoryId":6,"amount":-642}]}`},     // unknown category
		{path, `{"parts":[{"categoryId":3,"amount":-8000},{"categoryId":6,"amount":-642,"x":1}]}`}, // unknown field
		{txPath(pending, "/split"), `{"parts":[{"categoryId":3,"amount":-500},{"categoryId":6,"amount":-500}]}`},
		{txPath(income, "/split"), `{"parts":[{"categoryId":7,"amount":-500},{"categoryId":8,"amount":1500}]}`},
	} {
		expectError(t, p.bert("PUT", c.path, c.body), http.StatusBadRequest, "invalid")
	}
	if got := p.tx(p.bert, "PUT", txPath(income, "/split"), `{"parts":[{"categoryId":7,"amount":500},{"categoryId":8,"amount":500}]}`); len(got.Splits) != 2 {
		t.Errorf("income split: %+v", got)
	}
	// Replace.
	if got := p.tx(p.bert, "PUT", path, `{"parts":[{"categoryId":4,"amount":-4321},{"categoryId":5,"amount":-4321}]}`); len(got.Splits) != 2 || got.Splits[0].Category.ID != 4 {
		t.Errorf("replace: %+v", got)
	}
	if p.count(`SELECT COUNT(*) FROM transaction_splits WHERE transaction_id = ?`, row) != 2 {
		t.Error("the earlier parts stayed")
	}

	// A split row: no manual category, no automatic writer, never "uncategorised".
	expectError(t, p.bert("PATCH", txPath(row, ""), `{"categoryId":6}`), http.StatusBadRequest, "invalid")
	if n := p.tx(p.bert, "PATCH", txPath(row, ""), `{"note":"gedeeld"}`); *n.Note != "gedeeld" {
		t.Error("a split row takes a note")
	}
	p.exec(`UPDATE transactions SET category_id = NULL, category_origin = NULL WHERE id = ?`, row)
	if r := p.bert("POST", "/api/rules", `{"counterparty":"warenhuis","categoryId":6}`); r.status != 201 {
		t.Fatal(r.body)
	}
	p.bert("POST", "/api/rules/apply", "")
	if p.row(row) != "-:-:-:gedeeld" {
		t.Errorf("rules touched a split row: %s", p.row(row))
	}
	for _, it := range decode[ledger.Page](t, p.bert("GET", "/api/transactions?uncategorised=1&limit=200", "").body).Items {
		if it.ID == row {
			t.Error("a split row counts as uncategorised")
		}
	}
	p.exec(`UPDATE transactions SET category_id = 2, category_origin = 'import' WHERE id = ?`, row)

	// A category with split parts cannot be removed to "none" (0.4-1).
	cat := p.created(p.bert("POST", "/api/categories", `{"name":"Proefdeel","parentId":3}`))
	p.tx(p.bert, "PUT", path, `{"parts":[{"categoryId":`+strconv.FormatInt(cat.ID, 10)+`,"amount":-4321},{"categoryId":5,"amount":-4321}]}`)
	expectError(t, p.bert("DELETE", "/api/categories/"+strconv.FormatInt(cat.ID, 10)+"?moveTo=none", ""), http.StatusBadRequest, "invalid")

	// Read-only members read the parts and the note, and change nothing.
	shared := p.addRow(4, "Gedeeld Proef", -2000, "booked", 2, "manual")
	p.tx(p.bert, "PUT", txPath(shared, "/split"), `{"parts":[{"categoryId":3,"amount":-1000},{"categoryId":6,"amount":-1000}]}`)
	p.tx(p.bert, "PATCH", txPath(shared, ""), `{"note":"samen betaald"}`)
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	var seen ledger.Transaction
	for _, it := range decode[ledger.Page](t, p.partner("GET", "/api/transactions?q=Gedeeld", "").body).Items {
		if it.ID == shared {
			seen = it
		}
	}
	if seen.Note == nil || *seen.Note != "samen betaald" || len(seen.Splits) != 2 {
		t.Errorf("read-only member sees %+v", seen)
	}
	for _, c := range []struct{ method, path, body string }{
		{"PATCH", txPath(shared, ""), `{"note":"x"}`},
		{"PATCH", txPath(shared, ""), `{"categoryId":3}`},
		{"PUT", txPath(shared, "/split"), `{"parts":[{"categoryId":3,"amount":-1500},{"categoryId":6,"amount":-500}]}`},
		{"DELETE", txPath(shared, "/split"), ""},
	} {
		expectError(t, p.partner(c.method, c.path, c.body), http.StatusForbidden, "forbidden")
	}
	// Another user's row is hidden.
	for _, id := range []int64{row, 999999} {
		expectError(t, p.partner("PUT", txPath(id, "/split"), `{"parts":[]}`), http.StatusNotFound, "not_found")
		expectError(t, p.partner("DELETE", txPath(id, "/split"), ""), http.StatusNotFound, "not_found")
	}

	// Undo: the earlier category is back; again is fine.
	for range 2 {
		got := p.tx(p.bert, "DELETE", path, "")
		if got.Splits != nil || got.Category == nil || got.Category.ID != 2 || *got.CategoryOrigin != "import" {
			t.Errorf("undo: %+v", got)
		}
	}
	if countOf(2) != before2 {
		t.Errorf("count after undo %d, was %d", countOf(2), before2)
	}
}

// The invariant of version 0.4: no automatic writer ever changes a manual
// category, an imported one or a split. Every writer runs over such rows.
func TestManualNeverOverwritten(t *testing.T) {
	e := newBankEnv(t)
	if err := categorise.SeedDefaults(context.Background(), e.db); err != nil {
		t.Fatal(err)
	}
	winkel := func(ref, date string, status string) bank.Transaction {
		return bank.Transaction{EntryReference: ref, BookingDate: date, ValueDate: date, Amount: -1000, CounterpartyName: "Winkel Proef", Status: status}
	}
	e.bank.set(func(b *testBank) {
		b.txs[ibanPersonal] = append(b.txs[ibanPersonal],
			winkel("ref-20", "2026-11-14", bank.StatusBooked), winkel("ref-21", "2026-11-14", bank.StatusBooked),
			winkel("ref-22", "2026-11-14", bank.StatusBooked), winkel("ref-23", "2026-11-15", bank.StatusBooked),
			winkel("", "2026-11-16", bank.StatusPending))
	})
	e.saveCredentials(e.bert)
	e.link(e.bert, "")
	personal := e.count(`SELECT id FROM accounts WHERE iban = ?`, ibanPersonal)
	id := func(ref string) int64 {
		return int64(e.count(`SELECT id FROM transactions WHERE external_id = ?`, ref))
	}
	pendingID := int64(e.count(`SELECT id FROM transactions WHERE status = 'pending' AND counterparty_name = 'Winkel Proef'`))
	ok := func(r response) response {
		t.Helper()
		if r.status != http.StatusOK && r.status != http.StatusCreated && r.status != http.StatusAccepted {
			t.Fatalf("%d %s", r.status, r.body)
		}
		return r
	}
	ok(e.as(e.bert, "PATCH", txPath(id("ref-20"), ""), `{"categoryId":3,"note":"geheime notitie 4821"}`))
	e.db.Exec(`UPDATE transactions SET category_id = 3, category_origin = 'import' WHERE id = ?`, id("ref-21"))
	ok(e.as(e.bert, "PUT", txPath(id("ref-22"), "/split"), `{"parts":[{"categoryId":3,"amount":-600},{"categoryId":6,"amount":-400}]}`))
	// The pending row is chosen by hand too; it is booked later (not by this fetch).
	ok(e.as(e.bert, "PATCH", txPath(pendingID, ""), `{"categoryId":4}`))
	state := func() string {
		return e.query(fmt.Sprintf(`SELECT id, COALESCE(category_id, '-'), COALESCE(category_origin, '-'), COALESCE(rule_id, '-'),
			(SELECT group_concat(category_id || '/' || amount) FROM transaction_splits s WHERE s.transaction_id = t.id)
			FROM transactions t WHERE id IN (%d, %d, %d) ORDER BY id`, id("ref-20"), id("ref-21"), id("ref-22")))
	}
	before := state()
	writers := []struct {
		name string
		run  func()
	}{
		{"rule created and applied", func() {
			ok(e.as(e.bert, "POST", "/api/rules", `{"counterparty":"winkel","priority":1000,"categoryId":15}`))
			ok(e.as(e.bert, "POST", "/api/rules/apply", ""))
		}},
		{"apply to similar", func() {
			ok(e.as(e.bert, "PATCH", txPath(id("ref-23"), ""), `{"categoryId":16}`))
			ok(e.as(e.bert, "POST", txPath(id("ref-23"), "/similar"), ""))
		}},
		{"a sync that fetches them again", func() {
			e.now = e.now.Add(16 * time.Minute)
			ok(e.as(e.bert, "POST", "/api/sync", ""))
		}},
		{"a CSV import of the same and of new rows", func() {
			e.importOK(e.bert, int64(personal), csvHeader+"14/11/2026;14/11/2026;-10,00;Winkel Proef;;\n13/11/2026;13/11/2026;-10,00;Winkel Proef;;\n")
		}},
		{"pending to booked", func() {
			e.bank.set(func(b *testBank) {
				txs := b.txs[ibanPersonal][:0]
				for _, t := range b.txs[ibanPersonal] {
					if t.Status != bank.StatusPending || t.CounterpartyName != "Winkel Proef" {
						txs = append(txs, t)
					}
				}
				b.txs[ibanPersonal] = append(txs, winkel("ref-24", "2026-11-17", bank.StatusBooked))
			})
			e.now = e.now.Add(16 * time.Minute)
			ok(e.as(e.bert, "POST", "/api/sync", ""))
			if e.count(`SELECT COUNT(*) FROM transactions WHERE external_id = 'ref-24' AND category_id = 4 AND category_origin = 'manual'`) != 1 {
				t.Error("the pending row's manual category did not reach its booked row")
			}
		}},
	}
	for _, w := range writers {
		w.run()
		if got := state(); got != before {
			t.Errorf("%s changed a protected row:\n%s\nwas\n%s", w.name, got, before)
		}
	}
	if strings.Contains(e.logs.String(), "geheime notitie") {
		t.Error("a note is in the log")
	}
}

func TestTransactionWritesRefuseCrossOrigin(t *testing.T) {
	e := newBankEnv(t)
	for _, c := range []struct{ method, path, body string }{
		{"PATCH", "/api/transactions/1", `{"note":"x"}`},
		{"POST", "/api/transactions/1/similar", ""},
		{"PUT", "/api/transactions/1/split", `{"parts":[]}`},
		{"DELETE", "/api/transactions/1/split", ""},
	} {
		r := e.do(call{method: c.method, path: c.path, body: c.body, header: map[string]string{
			"X-Test-User": strconv.FormatInt(e.bert, 10), "Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example.org"}})
		expectError(t, r, http.StatusForbidden, "forbidden")
	}
}
