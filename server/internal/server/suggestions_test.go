package server

import (
	"net/http"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

func (p *pair) suggestion(h func(string, string, string) response, key string) *categorise.Suggestion {
	p.t.Helper()
	r := h("GET", "/api/suggestions", "")
	if r.status != http.StatusOK {
		p.t.Fatalf("suggestions: %d %s", r.status, r.body)
	}
	for _, s := range decode[[]categorise.Suggestion](p.t, r.body) {
		if s.CounterpartyKey == key {
			return &s
		}
	}
	return nil
}

func TestSuggestions(t *testing.T) {
	p := newPair(t)
	const key = "bakkerij graanveld proef"
	var training, echoes []int64
	for range 3 {
		training = append(training, p.addRow(1, "Bakkerij Graanveld Proef", -350, "booked", 16, "manual"))
	}
	training = append(training,
		p.addRow(1, "BAKKERIJ GRAANVELD  PROEF", -350, "booked", 16, "import"),
		p.addRow(4, "bakkerij graanveld proef", -350, "booked", 2, "manual")) // the shared account counts too
	// Echoes of rules and suggestions, and a split row, do not train.
	for range 4 {
		echoes = append(echoes, p.addRow(1, "Bakkerij Graanveld Proef", -350, "booked", 3, "rule"))
	}
	for range 3 {
		echoes = append(echoes, p.addRow(1, "Bakkerij Graanveld Proef", -350, "booked", 3, "suggestion"))
	}
	split := p.addRow(1, "Bakkerij Graanveld Proef", -350, "booked", 3, "manual")
	splitOpen := p.addRow(1, "Bakkerij Graanveld Proef", -350, "booked", nil, nil)
	p.exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, 2, -200), (?, 3, -150), (?, 2, -200), (?, 3, -150)`,
		split, split, splitOpen, splitOpen)
	open := []int64{
		p.addRow(1, "Bakkerij Graanveld Proef", -350, "booked", nil, nil),
		p.addRow(4, "Bakkerij Graanveld Proef", -350, "booked", nil, nil),
		p.addRow(2, "Bakkerij Graanveld proef", -350, "pending", nil, nil), // the newest spelling
	}
	// Partner's own choices on her own account never reach Bert.
	var hers []int64
	for range 10 {
		hers = append(hers, p.addRow(5, "Bakkerij Graanveld Proef", -350, "booked", 5, "manual"))
	}
	herOpen := p.addRow(5, "Bakkerij Graanveld Proef", -350, "booked", nil, nil)
	p.exec(`INSERT INTO category_suggestions (user_id, counterparty_key, category_id, confidence, state) VALUES (2, ?, 16, 80, 'dismissed')`, key)
	p.addRow(1, "Eenmaal Proef", -100, "booked", 6, "manual")
	p.addRow(1, "Eenmaal Proef", -100, "booked", nil, nil)

	before := p.dump()
	got := p.suggestion(p.bert, key)
	want := categorise.Suggestion{CounterpartyKey: key, Counterparty: "Bakkerij Graanveld proef", CategoryID: 16, Confidence: 80, Seen: 5, Open: 3}
	if got == nil || *got != want {
		t.Fatalf("Bert's suggestion %+v, want %+v", got, want)
	}
	if p.suggestion(p.bert, "eenmaal proef") != nil {
		t.Error("a counterparty seen once is offered")
	}
	// Partner: her own choices (and the shared row); open on the accounts she may edit.
	if s := p.suggestion(p.partner, key); s == nil || s.CategoryID != 5 || s.Seen != 11 || s.Confidence != 91 || s.Open != 2 {
		t.Errorf("Partner's suggestion %+v", s)
	}
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	if s := p.suggestion(p.partner, key); s == nil || s.Open != 1 {
		t.Errorf("Partner read-only: %+v", s)
	}
	if p.dump() != before {
		t.Fatal("GET /api/suggestions wrote")
	}

	// Partner confirms hers: only her editable account changes.
	body := `{"counterpartyKey":"` + key + `","categoryId":5}`
	if r := p.partner("POST", "/api/suggestions/confirm", body); r.status != 200 || r.body != "{\"updated\":1}\n" {
		t.Fatalf("Partner's confirm: %d %s", r.status, r.body)
	}
	if p.row(herOpen) != "5:suggestion:-:-" || p.row(open[1]) != "-:-:-:-" {
		t.Errorf("Partner's confirm: hers %s, shared %s", p.row(herOpen), p.row(open[1]))
	}

	protected := map[int64]string{split: p.row(split), splitOpen: p.row(splitOpen)}
	for _, id := range append(append(append([]int64{}, training...), echoes...), hers...) {
		protected[id] = p.row(id)
	}
	// Bert confirms: every open row on his editable accounts, through Assign.
	body = `{"counterpartyKey":"` + key + `","categoryId":16}`
	if r := p.bert("POST", "/api/suggestions/confirm", body); r.status != 200 || r.body != "{\"updated\":3}\n" {
		t.Fatalf("confirm: %d %s", r.status, r.body)
	}
	for _, id := range open {
		if got := p.row(id); got != "16:suggestion:-:-" {
			t.Errorf("open row %d: %s", id, got)
		}
	}
	for id, was := range protected {
		if got := p.row(id); got != was {
			t.Errorf("protected row %d: %s, was %s", id, got, was)
		}
	}
	// Twice: 200 and nothing more; never offered again, also not for a new row.
	after := p.dump()
	if r := p.bert("POST", "/api/suggestions/confirm", body); r.status != 200 || r.body != "{\"updated\":0}\n" || p.dump() != after {
		t.Errorf("second confirm: %d %s", r.status, r.body)
	}
	late := p.addRow(1, "Bakkerij Graanveld Proef", -350, "booked", nil, nil)
	if s := p.suggestion(p.bert, key); s != nil {
		t.Errorf("a confirmed suggestion is offered again: %+v", s)
	}
	if p.row(late) != "-:-:-:-" {
		t.Error("a new row was categorised")
	}
	if p.count(`SELECT COUNT(*) FROM category_suggestions WHERE user_id = 1 AND counterparty_key = ? AND category_id = 16 AND state = 'confirmed'
		AND confidence = 80 AND times_seen = 5`, key) != 1 {
		t.Error("the confirmed state is not stored")
	}

	// Dismiss: stored, idempotent, then gone for confirm too.
	p.addRow(1, "Kiosk Proefplein", -100, "booked", 6, "manual")
	p.addRow(1, "Kiosk Proefplein", -100, "booked", 6, "manual")
	kiosk := p.addRow(1, "Kiosk Proefplein", -100, "booked", nil, nil)
	kb := `{"counterpartyKey":"kiosk proefplein","categoryId":6}`
	if p.suggestion(p.bert, "kiosk proefplein") == nil {
		t.Fatal("kiosk not offered")
	}
	expectError(t, p.partner("POST", "/api/suggestions/dismiss", kb), http.StatusNotFound, "not_found")
	for range 2 {
		if r := p.bert("POST", "/api/suggestions/dismiss", kb); r.status != http.StatusNoContent {
			t.Fatalf("dismiss: %d %s", r.status, r.body)
		}
	}
	if p.suggestion(p.bert, "kiosk proefplein") != nil || p.row(kiosk) != "-:-:-:-" {
		t.Error("a dismissed suggestion is offered or applied")
	}
	for _, path := range []string{"/api/suggestions/confirm", "/api/suggestions/dismiss"} {
		for _, b := range []string{
			`{"counterpartyKey":"bestaat niet","categoryId":6}`,
			`{"counterpartyKey":"kiosk proefplein","categoryId":7}`,
		} {
			r := p.bert("POST", path, b)
			if msg := expectError(t, r, http.StatusNotFound, "not_found"); msg != "Deze suggestie bestaat niet meer." || strings.Contains(r.body, "kiosk") {
				t.Errorf("%s %s: %s", path, b, r.body)
			}
		}
		expectError(t, p.partner("POST", path, kb), http.StatusNotFound, "not_found") // Bert's decision, not hers
		expectError(t, p.bert("POST", path, `{"counterpartyKey":"x","categoryId":6,"extra":1}`), http.StatusBadRequest, "invalid")
	}
	expectError(t, p.bert("POST", "/api/suggestions/confirm", kb), http.StatusNotFound, "not_found")
	if p.row(kiosk) != "-:-:-:-" {
		t.Error("a dismissed suggestion was confirmed")
	}
}
