package server

import (
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Rules screen (phase 0.4-4): preview, apply one rule, reorder.

// dump is every transaction's category fields and every rule, as stored.
func (p *pair) dump() string {
	p.t.Helper()
	var s string
	if err := p.db.QueryRow(`SELECT
		(SELECT group_concat(id || ':' || COALESCE(category_id, '-') || ':' || COALESCE(category_origin, '-') || ':' || COALESCE(rule_id, '-'), ';') FROM transactions) || '|' ||
		(SELECT COALESCE(group_concat(id || ':' || priority || ':' || category_id, ';'), '') FROM rules) || '|' ||
		(SELECT COUNT(*) FROM transaction_splits) || '|' || (SELECT COUNT(*) FROM category_suggestions)`).Scan(&s); err != nil {
		p.t.Fatal(err)
	}
	return s
}

func (p *pair) newRule(h func(string, string, string) response, body string) int64 {
	p.t.Helper()
	r := h("POST", "/api/rules", body)
	if r.status != http.StatusCreated {
		p.t.Fatalf("rule %s: %d %s", body, r.status, r.body)
	}
	return decode[ledger.RuleView](p.t, r.body).ID
}

func (p *pair) preview(h func(string, string, string) response, body string) ledger.RulePreview {
	p.t.Helper()
	r := h("POST", "/api/rules/preview", body)
	if r.status != http.StatusOK {
		p.t.Fatalf("preview %s: %d %s", body, r.status, r.body)
	}
	return decode[ledger.RulePreview](p.t, r.body)
}

type applied struct {
	Updated int                `json:"updated"`
	Skipped categorise.Skipped `json:"skipped"`
}

func rulePath(id int64, suffix string) string {
	return "/api/rules/" + strconv.FormatInt(id, 10) + suffix
}

func (p *pair) applyRule(h func(string, string, string) response, id int64) applied {
	p.t.Helper()
	r := h("POST", rulePath(id, "/apply"), "")
	if r.status != http.StatusOK {
		p.t.Fatalf("apply %d: %d %s", id, r.status, r.body)
	}
	return decode[applied](p.t, r.body)
}

// The preview counts what applying the rule then does, writes nothing, and
// never counts another user's rows or a shared account's for a user rule;
// applying one rule is idempotent and leaves manual, imported and split rows.
func TestRulePreviewThenApply(t *testing.T) {
	p := newPair(t)
	open := []int64{
		p.addRow(1, "Kraam Proefstad", -1000, "booked", nil, nil),
		p.addRow(2, "KRAAM  PRÖEFSTAD", -500, "booked", nil, nil),
		p.addRow(1, "kraam proefstad", -700, "pending", nil, nil),
	}
	m := p.addRow(1, "Kraam Proefstad", -1000, "booked", 3, "manual")
	i := p.addRow(1, "Kraam Proefstad", -1000, "booked", 3, "import")
	s := p.addRow(1, "Kraam Proefstad", -1000, "booked", nil, nil)
	p.exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, 2, -600), (?, 3, -400)`, s, s)
	outranked := p.addRow(1, "Kraam Proefstad Noord", -1000, "booked", nil, nil)
	p.newRule(p.bert, `{"counterparty":"proefstad noord","priority":9,"categoryId":4}`)
	right := p.addRow(1, "Kraam Proefstad", -1000, "booked", 2, "rule")
	shared := p.addRow(4, "Kraam Proefstad", -1000, "booked", nil, nil)
	partners := p.addRow(5, "Kraam Proefstad", -1000, "booked", nil, nil)
	other := p.addRow(1, "Zijstraat Proef", -1000, "booked", nil, nil)
	p.newRule(p.bert, `{"counterparty":"zijstraat","categoryId":5}`) // never runs here
	protected := map[int64]string{}
	for _, id := range []int64{m, i, s, outranked, right, shared, partners, other} {
		protected[id] = p.row(id)
	}

	body := `{"counterparty":"kraam proefstad","categoryId":2}`
	before := p.dump()
	pre := p.preview(p.bert, body)
	want := ledger.RulePreview{Matches: 8, Changes: 3, Skipped: categorise.Skipped{Manual: 1, Import: 1, Split: 1, Rule: 1}}
	if pre != want {
		t.Errorf("preview %+v, want %+v", pre, want)
	}
	// Without a category: the same matches and skips, no changes.
	if got := p.preview(p.bert, `{"counterparty":"kraam proefstad"}`); got.Matches != 8 || got.Changes != 0 || got.Skipped != want.Skipped {
		t.Errorf("preview without a category: %+v", got)
	}
	if p.dump() != before {
		t.Fatal("the preview wrote")
	}

	id := p.newRule(p.bert, body)
	if got := p.preview(p.bert, `{"ruleId":`+strconv.FormatInt(id, 10)+`,"counterparty":"kraam proefstad","categoryId":2}`); got != pre {
		t.Errorf("preview of the stored rule %+v, want %+v", got, pre)
	}
	res := p.applyRule(p.bert, id)
	if res.Updated != pre.Changes || res.Skipped != pre.Skipped {
		t.Errorf("apply %+v, preview %+v", res, pre)
	}
	for _, o := range open {
		if got := p.row(o); got != "2:rule:"+strconv.FormatInt(id, 10)+":-" {
			t.Errorf("row %d: %s", o, got)
		}
	}
	for r, was := range protected {
		if got := p.row(r); got != was {
			t.Errorf("protected row %d: %s, was %s", r, got, was)
		}
	}
	// Twice: nothing more.
	after := p.dump()
	if again := p.applyRule(p.bert, id); again.Updated != 0 || p.dump() != after {
		t.Errorf("second apply: %+v", again)
	}
	if again := p.preview(p.bert, body); again.Changes != 0 {
		t.Errorf("preview after apply: %+v", again)
	}

	// Partner: Bert's rule is hidden; her own preview counts only her rows.
	for _, path := range []string{rulePath(id, "/apply"), "/api/rules/999999/apply", "/api/rules/abc/apply"} {
		expectError(t, p.partner("POST", path, ""), http.StatusNotFound, "not_found")
	}
	if got := p.preview(p.partner, body); got.Matches != 1 || got.Changes != 1 {
		t.Errorf("Partner's preview: %+v", got)
	}
	if p.dump() != after {
		t.Error("Partner changed something")
	}
}

func TestRulePreviewChecks(t *testing.T) {
	p := newPair(t)
	p.addRow(1, "Kraam Proefstad", -1000, "booked", nil, nil)
	big := p.addRow(1, "Lange Mededeling", -1000, "booked", nil, nil)
	p.exec(`UPDATE transactions SET communication = ? WHERE id = ?`, strings.Repeat("x", 5000), big)
	high := p.newRule(p.bert, `{"counterparty":"kraam","priority":10,"categoryId":5}`)
	acc4 := p.newRule(p.bert, `{"accountId":4,"counterparty":"kraam","categoryId":5}`)
	ruleID := strconv.FormatInt(high, 10)

	// The edited rule leaves the competition: without ruleId it outranks the draft.
	if got := p.preview(p.bert, `{"counterparty":"kraam proefstad","categoryId":2}`); got.Changes != 0 || got.Skipped.Rule != 1 {
		t.Errorf("draft against the stored rule: %+v", got)
	}
	if got := p.preview(p.bert, `{"ruleId":`+ruleID+`,"counterparty":"kraam proefstad","categoryId":2}`); got.Changes != 1 || got.Skipped.Rule != 0 {
		t.Errorf("draft in place of the stored rule: %+v", got)
	}
	// A pathological pattern is harmless: RE2 is linear.
	start := time.Now()
	if got := p.preview(p.bert, `{"communication":"(x+x+)+y","communicationRegex":true}`); got.Matches != 0 {
		t.Errorf("pathological pattern: %+v", got)
	}
	if d := time.Since(start); d > 5*time.Second {
		t.Errorf("pathological pattern took %v", d)
	}
	before := p.dump()
	for _, body := range []string{
		`{}`,
		`{"categoryId":2}`,
		`{"communication":"(","communicationRegex":true}`,
		`{"communication":"x{1001}","communicationRegex":true}`,
		`{"counterparty":"x","categoryId":999}`,
		`{"counterparty":"x","categoryId":null,"priority":1001}`,
		`{"counterparty":"x","extra":1}`,
		`{"ruleId":` + ruleID + `,"accountId":4,"counterparty":"x"}`, // another owner
		`{"ruleId":` + strconv.FormatInt(acc4, 10) + `,"counterparty":"x"}`,
	} {
		expectError(t, p.bert("POST", "/api/rules/preview", body), http.StatusBadRequest, "invalid")
	}
	for _, body := range []string{`{"accountId":5,"counterparty":"x"}`, `{"accountId":999,"counterparty":"x"}`, `{"ruleId":999999,"counterparty":"x"}`} {
		expectError(t, p.bert("POST", "/api/rules/preview", body), http.StatusNotFound, "not_found")
	}
	// Partner: Bert's user rule is hidden; read-only on the shared account she
	// may not preview or apply its rules.
	expectError(t, p.partner("POST", "/api/rules/preview", `{"ruleId":`+ruleID+`,"counterparty":"x"}`), http.StatusNotFound, "not_found")
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	for _, body := range []string{`{"accountId":4,"counterparty":"x"}`, `{"ruleId":` + strconv.FormatInt(acc4, 10) + `,"counterparty":"x"}`,
		`{"ruleId":` + strconv.FormatInt(acc4, 10) + `,"accountId":4,"counterparty":"x"}`} {
		expectError(t, p.partner("POST", "/api/rules/preview", body), http.StatusForbidden, "forbidden")
	}
	expectError(t, p.partner("POST", rulePath(acc4, "/apply"), ""), http.StatusForbidden, "forbidden")
	if p.dump() != before {
		t.Error("a refused request wrote")
	}
}

func editableIDs(list []ledger.RuleView) []int64 {
	var ids []int64
	for _, v := range list {
		if v.Permission == "edit" {
			ids = append(ids, v.ID)
		}
	}
	return ids
}

func (p *pair) order(h func(string, string, string) response, ids []int64) []ledger.RuleView {
	p.t.Helper()
	var parts []string
	for _, id := range ids {
		parts = append(parts, strconv.FormatInt(id, 10))
	}
	r := h("PUT", "/api/rules/order", `{"ids":[`+strings.Join(parts, ",")+`]}`)
	if r.status != http.StatusOK {
		p.t.Fatalf("order %v: %d %s", ids, r.status, r.body)
	}
	list := decode[[]ledger.RuleView](p.t, r.body)
	if got := h("GET", "/api/rules", "").body; got != r.body {
		p.t.Errorf("the answer differs from GET /api/rules")
	}
	if got := editableIDs(list); !slices.Equal(got, ids) {
		p.t.Errorf("order %v, want %v", got, ids)
	}
	return list
}

func (p *pair) priorities(list []ledger.RuleView) map[int64]int {
	out := map[int64]int{}
	for _, v := range list {
		out[v.ID] = v.Priority
	}
	return out
}

func TestReorderRules(t *testing.T) {
	p := newPair(t)
	a := p.newRule(p.bert, `{"counterparty":"a","categoryId":2}`)
	b := p.newRule(p.bert, `{"counterparty":"b","categoryId":2}`)
	c := p.newRule(p.bert, `{"counterparty":"c","categoryId":2}`)
	d := p.newRule(p.bert, `{"accountId":4,"counterparty":"d","categoryId":2}`)
	partnerRule := p.newRule(p.partner, `{"counterparty":"p","priority":7,"categoryId":2}`)

	// All priorities equal (0): ties are broken, top first.
	list := p.order(p.bert, []int64{a, b, c, d})
	if got := p.priorities(list); got[a] != 3 || got[b] != 2 || got[c] != 1 || got[d] != 0 {
		t.Errorf("priorities %v", got)
	}
	// Again: a no-op.
	before := p.dump()
	p.order(p.bert, []int64{a, b, c, d})
	if p.dump() != before {
		t.Error("the same order changed priorities")
	}
	// Distinct priorities: a pure permutation of the values.
	p.exec(`UPDATE rules SET priority = CASE id WHEN ? THEN 900 WHEN ? THEN 40 WHEN ? THEN 7 ELSE 5 END WHERE id IN (?, ?, ?, ?)`, a, b, c, a, b, c, d)
	list = p.order(p.bert, []int64{d, c, a, b})
	if got := p.priorities(list); got[d] != 900 || got[c] != 40 || got[a] != 7 || got[b] != 5 {
		t.Errorf("permutation %v", got)
	}
	// A tie among low values: never below 0, the top raised when needed.
	p.exec(`UPDATE rules SET priority = CASE id WHEN ? THEN 3 ELSE 0 END WHERE id IN (?, ?, ?, ?)`, a, a, b, c, d)
	list = p.order(p.bert, []int64{b, a, c, d})
	if got := p.priorities(list); got[b] != 3 || got[a] != 2 || got[c] != 1 || got[d] != 0 {
		t.Errorf("low ties %v", got)
	}
	if p.count(`SELECT priority FROM rules WHERE id = ?`, partnerRule) != 7 {
		t.Error("Bert's order changed Partner's rule")
	}

	// Stale or wrong sets answer 400 and change nothing.
	before = p.dump()
	e := p.newRule(p.bert, `{"counterparty":"e","categoryId":2}`)
	for _, body := range []string{
		`{"ids":[` + join(b, a, c, d) + `]}`,              // e added meanwhile
		`{"ids":[` + join(b, a, c, d, e, e) + `]}`,        // a duplicate
		`{"ids":[` + join(b, a, c, d, partnerRule) + `]}`, // not his
		`{"ids":[` + join(b, a, c, d, 999999) + `]}`,
		`{"ids":[]}`, `{}`, `{"ids":null}`, `{"ids":[1],"x":1}`,
	} {
		expectError(t, p.bert("PUT", "/api/rules/order", body), http.StatusBadRequest, "invalid")
	}
	p.exec(`DELETE FROM rules WHERE id = ?`, e)
	if p.dump() != before {
		t.Error("a refused order changed priorities")
	}
	p.exec(`DELETE FROM rules WHERE id = ?`, c) // c deleted meanwhile
	expectError(t, p.bert("PUT", "/api/rules/order", `{"ids":[`+join(b, a, c, d)+`]}`), http.StatusBadRequest, "invalid")

	// A read-only member orders only her own rules; the shared account's
	// rule keeps its place among them, and Bert's rules stay as they are.
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	p.exec(`UPDATE rules SET priority = 3 WHERE id = ?`, d)
	q := p.newRule(p.partner, `{"counterparty":"q","priority":1,"categoryId":2}`)
	bertsRules := p.query(`SELECT id, priority FROM rules WHERE user_id IS NOT ? ORDER BY id`, 2)
	if got := ids(decode[[]ledger.RuleView](t, p.partner("GET", "/api/rules", "").body)); !slices.Equal(got, []int64{partnerRule, d, q}) {
		t.Fatalf("Partner's list %v", got)
	}
	expectError(t, p.partner("PUT", "/api/rules/order", `{"ids":[`+join(q, d, partnerRule)+`]}`), http.StatusBadRequest, "invalid")
	list = p.order(p.partner, []int64{q, partnerRule})
	if got := ids(list); !slices.Equal(got, []int64{q, d, partnerRule}) {
		t.Errorf("Partner's list after the order %v", got)
	}
	if got := p.priorities(list); got[q] != 7 || got[partnerRule] != 1 || got[d] != 3 {
		t.Errorf("Partner's priorities %v", got)
	}
	if got := p.query(`SELECT id, priority FROM rules WHERE user_id IS NOT ? ORDER BY id`, 2); got != bertsRules {
		t.Errorf("Partner's order changed Bert's rules: %s, was %s", got, bertsRules)
	}
}

func ids(list []ledger.RuleView) []int64 {
	var out []int64
	for _, v := range list {
		out = append(out, v.ID)
	}
	return out
}

func join(ids ...int64) string {
	var parts []string
	for _, id := range ids {
		parts = append(parts, strconv.FormatInt(id, 10))
	}
	return strings.Join(parts, ",")
}

// query renders rows as text.
func (p *pair) query(q string, args ...any) string {
	p.t.Helper()
	rows, err := p.db.Query(q, args...)
	if err != nil {
		p.t.Fatal(err)
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var b strings.Builder
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			p.t.Fatal(err)
		}
		fmt.Fprintln(&b, vals...)
	}
	return b.String()
}
