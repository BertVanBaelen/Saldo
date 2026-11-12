package server

import (
	"net/http"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

func (p *pair) backfill(h func(string, string, string) response) ledger.BackfillPreview {
	p.t.Helper()
	r := h("GET", "/api/suggestions/backfill", "")
	if r.status != http.StatusOK {
		p.t.Fatalf("backfill preview: %d %s", r.status, r.body)
	}
	return decode[ledger.BackfillPreview](p.t, r.body)
}

func (p *pair) backfillGroup(pv ledger.BackfillPreview, key string) *ledger.BackfillGroup {
	for i := range pv.Groups {
		if pv.Groups[i].CounterpartyKey == key {
			return &pv.Groups[i]
		}
	}
	return nil
}

// The backfill previews what the learning proposes for the rows that wait and
// applies the groups the viewer picks, never over a category or a split, and
// only for pairs that still match.
func TestBackfill(t *testing.T) {
	p := newPair(t)
	const high, low = "backfill winkel proef", "backfill kiosk proef"
	for range 16 { // 16 of 18 training rows (two other-category ones below) is 16 / 20 = 80 %: high
		p.addRow(1, "Backfill Winkel Proef", -350, "booked", 16, "manual")
	}
	for range 3 {
		p.addRow(1, "Backfill Kiosk Proef", -100, "booked", 6, "import")
	}
	var open []int64
	for i := range 4 { // more than the three examples
		open = append(open, p.addRow(1, "Backfill Winkel Proef", int64(-1000-i), "booked", nil, nil))
	}
	open = append(open,
		p.addRow(1, "backfill  winkel proef", -350, "pending", nil, nil), // a pending row waits and counts like the others
		p.addRow(4, "Backfill Winkel Proef", -350, "booked", nil, nil))   // the shared account Bert may edit
	kiosk := p.addRow(1, "Backfill Kiosk Proef", -100, "booked", nil, nil)
	// Rows that never change: a category of any origin, a split row, another user's row.
	protected := []int64{
		p.addRow(1, "Backfill Winkel Proef", -350, "booked", 3, "manual"),
		p.addRow(1, "Backfill Winkel Proef", -350, "booked", 3, "rule"),
		p.addRow(1, "Backfill Winkel Proef", -350, "booked", 3, "import"),
		p.addRow(5, "Backfill Winkel Proef", -350, "booked", nil, nil),
	}
	split := p.addRow(1, "Backfill Winkel Proef", -350, "booked", nil, nil)
	p.exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, 2, -200), (?, 3, -150)`, split, split)
	protected = append(protected, split)
	was := map[int64]string{}
	for _, id := range protected {
		was[id] = p.row(id)
	}

	before := p.dump()
	pv := p.backfill(p.bert)
	if p.dump() != before {
		t.Fatal("the preview wrote")
	}
	g := p.backfillGroup(pv, high)
	if g == nil || g.Level != "high" || g.Rows != 6 || g.Category.ID != 16 || g.Category.Name == "" || len(g.Examples) != 3 || g.Examples[0].Amount != -350 {
		t.Fatalf("group %+v", g)
	}
	k := p.backfillGroup(pv, low)
	if k == nil || k.Level != "low" || k.Rows != 1 || k.Confidence != 60 || len(k.Examples) != 1 {
		t.Fatalf("group %+v", k)
	}
	waiting := p.count(`SELECT COUNT(*) FROM transactions t JOIN account_access me ON me.account_id = t.account_id AND me.user_id = 1 AND me.permission = 'edit'
		WHERE t.category_id IS NULL AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)`)
	if pv.Rows+pv.Left != waiting || pv.Limit != ledger.BackfillMaxRows {
		t.Errorf("totals %d + %d, %d rows wait", pv.Rows, pv.Left, waiting)
	}
	if g := p.backfillGroup(p.backfill(p.partner), high); g != nil {
		t.Errorf("Partner is offered Bert's learning: %+v", g)
	}

	// Apply: the high group, a wrong category, an unknown counterparty, the same pair twice.
	body := `{"items":[{"counterpartyKey":"` + high + `","categoryId":16},{"counterpartyKey":"` + high + `","categoryId":16},
		{"counterpartyKey":"` + low + `","categoryId":7},{"counterpartyKey":"bestaat niet","categoryId":16}]}`
	// Partner's pairs are not Bert's: nothing of his changes.
	partnerBefore := p.dump()
	if r := p.partner("POST", "/api/suggestions/backfill", body); r.status != 200 || decode[ledger.BackfillResult](t, r.body) != (ledger.BackfillResult{Stale: 3}) {
		t.Errorf("Partner: %d %s", r.status, r.body)
	}
	if p.dump() != partnerBefore {
		t.Error("Partner's backfill changed rows")
	}
	r := p.bert("POST", "/api/suggestions/backfill", body)
	if got := decode[ledger.BackfillResult](t, r.body); r.status != 200 || got != (ledger.BackfillResult{Categorised: 6, Groups: 1, Stale: 2}) {
		t.Fatalf("apply: %d %s", r.status, r.body)
	}
	for _, id := range open {
		if got := p.row(id); got != "16:suggestion:-:-" {
			t.Errorf("open row %d: %s", id, got)
		}
	}
	for id, w := range was {
		if got := p.row(id); got != w {
			t.Errorf("protected row %d: %s, was %s", id, got, w)
		}
	}
	if p.row(kiosk) != "-:-:-:-" {
		t.Error("a group that was not chosen changed")
	}
	// Again: nothing waits any more, so the pair is stale.
	if r := p.bert("POST", "/api/suggestions/backfill", body); decode[ledger.BackfillResult](t, r.body) != (ledger.BackfillResult{Stale: 3}) {
		t.Errorf("second apply: %s", r.body)
	}
	if p.count(`SELECT COUNT(*) FROM category_suggestions WHERE counterparty_key IN (?, ?)`, high, low) != 0 || p.count(`SELECT COUNT(*) FROM rules`) != 0 {
		t.Error("a backfill stored a decision or a rule")
	}

	for _, b := range []string{`{"items":[]}`, `{}`, `{"items":[{"counterpartyKey":"","categoryId":1}]}`, `{"items":[{"counterpartyKey":"x","categoryId":0}]}`, `{"items":[],"x":1}`} {
		expectError(t, p.bert("POST", "/api/suggestions/backfill", b), http.StatusBadRequest, "invalid")
	}
}

// One apply categorises at most BackfillMaxRows rows: more is refused as a whole.
func TestBackfillRowCap(t *testing.T) {
	p := newPair(t)
	p.addRow(1, "Massa Proef", -100, "booked", 6, "manual")
	p.addRow(1, "Massa Proef", -100, "booked", 6, "manual")
	p.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i <= ?)
		INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key)
		SELECT 1, -100, '2026-11-16', 'Massa Proef', 'booked', 'massa-' || i FROM n`, ledger.BackfillMaxRows)
	before := p.dump()
	expectError(t, p.bert("POST", "/api/suggestions/backfill", `{"items":[{"counterpartyKey":"massa proef","categoryId":6}]}`), http.StatusBadRequest, "invalid")
	if p.dump() != before {
		t.Error("a refused backfill wrote")
	}
}
