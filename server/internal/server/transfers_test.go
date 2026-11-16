package server

import (
	"fmt"
	"net/url"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Transfer detection, kinds and overrides (plan 0.6-3), on the two-user
// world of the privacy suite. Every row added here has an amount used
// nowhere else, so the matches are the ones named.

// addRow inserts a transaction and returns its id.
func (w *world) addRow(account, amount int64, date, name, status, currency, iban string) int64 {
	w.t.Helper()
	var ib any
	if iban != "" {
		ib = iban
	}
	return w.int(`INSERT INTO transactions (account_id, amount, currency, booking_date, counterparty_name, counterparty_iban, status, dedupe_key)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, account, amount, currency, date, name, ib, status, "tt-"+name)
}

// seen is the row named name as the viewer sees it, or nil when hidden.
func (w *world) seen(as, name string) *ledger.Transaction {
	w.t.Helper()
	r, _ := w.send(probe{method: "GET", path: "/api/transactions?limit=200&q=" + url.QueryEscape(name)}, as)
	for _, x := range decode[ledger.Page](w.t, r.body).Items {
		if x.Counterparty == name {
			return &x
		}
	}
	return nil
}

func kindOf(x *ledger.Transaction) string {
	if x == nil {
		return "hidden"
	}
	if !x.Transfer {
		if x.TransferKind != nil {
			return "no transfer, kind " + *x.TransferKind
		}
		return "-"
	}
	if x.TransferKind == nil {
		return "transfer without kind"
	}
	return *x.TransferKind
}

// The opposite-amount rule and the kinds, for Bert's own accounts: his
// current account (personal), his manual savings account and the family
// account. No row has a counterparty IBAN, so only rule (b) can match.
func TestOppositeAmountTransfers(t *testing.T) {
	w := newWorld(t)
	rows := []struct {
		account          int64
		amount           int64
		date, name       string
		status, currency string
		want             string
	}{
		// Within 3 days (the edge): to savings is saved, its other side internal.
		{w.bertAcc, -1111, "2026-11-02", "TT naar spaar", "booked", "EUR", "saved"},
		{w.bertManual, 1111, "2026-11-05", "TT van zicht", "booked", "EUR", "internal"},
		// 4 days apart: no match.
		{w.bertAcc, -2222, "2026-11-01", "TT te vroeg", "booked", "EUR", "-"},
		{w.bertManual, 2222, "2026-11-05", "TT te laat", "booked", "EUR", "-"},
		// A pending row matches a booked one; a booked row never matches a pending one.
		{w.bertAcc, -3333, "2026-11-06", "TT pending", "pending", "EUR", "saved"},
		{w.bertManual, 3333, "2026-11-06", "TT tegen pending", "booked", "EUR", "-"},
		// The same account: no match.
		{w.bertAcc, -4444, "2026-11-06", "TT zelfde uit", "booked", "EUR", "-"},
		{w.bertAcc, 4444, "2026-11-06", "TT zelfde in", "booked", "EUR", "-"},
		// Another currency: no match.
		{w.bertAcc, -5555, "2026-11-06", "TT euro", "booked", "EUR", "-"},
		{w.bertManual, 5555, "2026-11-06", "TT dollar", "booked", "USD", "-"},
		// Savings back to current: internal on both sides.
		{w.bertManual, -6666, "2026-11-07", "TT uit spaar", "booked", "EUR", "internal"},
		{w.bertAcc, 6666, "2026-11-07", "TT terug op zicht", "booked", "EUR", "internal"},
		// Personal to shared: "Naar gedeelde rekening"; the shared side internal.
		{w.bertAcc, -7777, "2026-11-08", "TT naar gezin", "booked", "EUR", "shared"},
		{w.shared, 7777, "2026-11-09", "TT van Bert", "booked", "EUR", "internal"},
		// Shared to personal: internal on both sides.
		{w.shared, -8181, "2026-11-08", "TT gezin naar Bert", "booked", "EUR", "internal"},
		{w.bertAcc, 8181, "2026-11-08", "TT van gezin", "booked", "EUR", "internal"},
		// Zero amounts never match.
		{w.bertAcc, 0, "2026-11-08", "TT nul uit", "booked", "EUR", "-"},
		{w.bertManual, 0, "2026-11-08", "TT nul in", "booked", "EUR", "-"},
	}
	for _, r := range rows {
		w.addRow(r.account, r.amount, r.date, r.name, r.status, r.currency, "")
	}
	for _, r := range rows {
		if got := kindOf(w.seen("bert", r.name)); got != r.want {
			t.Errorf("%s: %s, want %s", r.name, got, r.want)
		}
	}
	// Partner sees the family account's rows, but their other sides are on
	// Bert's personal account: no transfer for her.
	for _, name := range []string{"TT van Bert", "TT gezin naar Bert"} {
		if got := kindOf(w.seen("partner", name)); got != "-" {
			t.Errorf("Partner, %s: %s", name, got)
		}
	}
}

// A counterparty IBAN that names another account rules out an opposite-
// amount pair with an account of a different IBAN: Partner's contribution
// to the family account (from her IBAN) is no transfer for Bert, even when
// Bert's own contribution of the same amount leaves his account that day.
func TestOppositeAmountRespectsIBANs(t *testing.T) {
	w := newWorld(t)
	w.addRow(w.shared, 3131, "2026-11-10", "TT bijdrage Partner", "booked", "EUR", ibanPartner)
	w.addRow(w.bertAcc, -3131, "2026-11-10", "TT bijdrage Bert", "booked", "EUR", ibanShared)
	if got := kindOf(w.seen("bert", "TT bijdrage Partner")); got != "-" {
		t.Errorf("Partner's contribution for Bert: %s", got)
	}
	if got := kindOf(w.seen("bert", "TT bijdrage Bert")); got != "shared" {
		t.Errorf("Bert's contribution: %s", got)
	}
	if got := kindOf(w.seen("partner", "TT bijdrage Partner")); got != "internal" {
		t.Errorf("Partner's contribution for her: %s", got)
	}
}

// PUT /api/transactions/{id}/transfer: the viewer's own override, its
// effect on the flag, the kind and the uncategorised list and count.
func TestTransferOverrideRoute(t *testing.T) {
	w := newWorld(t)
	matched := w.addRow(w.bertAcc, -1919, "2026-11-04", "TT gematcht", "booked", "EUR", "")
	w.addRow(w.bertManual, 1919, "2026-11-04", "TT gematcht in", "booked", "EUR", "")
	single := w.addRow(w.bertAcc, -2929, "2026-11-04", "TT los", "booked", "EUR", "")
	uncategorised := func() int {
		r, _ := w.send(probe{method: "GET", path: "/api/transactions?uncategorised=1&limit=1"}, "bert")
		return decode[ledger.Page](t, r.body).Total
	}
	put := func(as string, tx int64, body string, status int) ledger.Transaction {
		t.Helper()
		r, _ := w.send(probe{method: "PUT", path: txPath(tx, "/transfer"), body: body}, as)
		if r.status != status {
			t.Fatalf("PUT %s as %s: %d %s, want %d", body, as, r.status, r.body, status)
		}
		if status != 200 {
			return ledger.Transaction{}
		}
		return decode[ledger.Transaction](t, r.body)
	}
	isTrue, isFalse := true, false
	check := func(x ledger.Transaction, transfer bool, kind string, override *bool) {
		t.Helper()
		if x.Transfer != transfer || kindOf(&x) != kind || (x.TransferOverride == nil) != (override == nil) ||
			(override != nil && *x.TransferOverride != *override) {
			t.Errorf("row %d: transfer %v, kind %s, override %v; want %v %s %v", x.ID, x.Transfer, kindOf(&x), x.TransferOverride, transfer, kind, override)
		}
	}
	before := uncategorised()
	check(*w.seen("bert", "TT gematcht"), true, "saved", nil)
	check(*w.seen("bert", "TT los"), false, "-", nil)

	check(put("bert", matched, `{"transfer":false}`, 200), false, "-", &isFalse)
	check(put("bert", single, `{"transfer":true}`, 200), true, "internal", &isTrue)
	if got := uncategorised(); got != before { // one in, one out
		t.Errorf("uncategorised %d, want %d", got, before)
	}
	r, _ := w.send(probe{method: "GET", path: "/api/transactions?uncategorised=1&limit=200&q=TT"}, "bert")
	page := decode[ledger.Page](t, r.body)
	if len(page.Items) != 1 || page.Items[0].ID != matched {
		t.Errorf("uncategorised TT rows: %s", r.body)
	}
	check(put("bert", matched, `{"transfer":true}`, 200), true, "saved", &isTrue)
	if got := uncategorised(); got != before-1 {
		t.Errorf("uncategorised %d, want %d", got, before-1)
	}
	check(put("bert", single, `{"transfer":null}`, 200), false, "-", nil)
	check(put("bert", matched, `{"transfer":null}`, 200), true, "saved", nil)
	if got := uncategorised(); got != before {
		t.Errorf("uncategorised %d, want %d", got, before)
	}
	if n := w.int(`SELECT COUNT(*) FROM transfer_overrides WHERE transaction_id IN (?, ?)`, matched, single); n != 0 {
		t.Errorf("%d overrides left", n)
	}

	// Bad bodies.
	for _, body := range []string{`{}`, `{"transfer":"ja"}`, `{"transfer":true,"x":1}`, `[]`} {
		put("bert", single, body, 400)
	}
	// Invisible and missing rows: the same 404, nothing written.
	hiddenR, _ := w.send(probe{method: "PUT", path: txPath(w.bertTx, "/transfer"), body: `{"transfer":true}`}, "partner")
	missingR, _ := w.send(probe{method: "PUT", path: txPath(999999, "/transfer"), body: `{"transfer":true}`}, "partner")
	if hiddenR.status != 404 || hiddenR.body != missingR.body {
		t.Errorf("hidden %d %s, missing %d %s", hiddenR.status, hiddenR.body, missingR.status, missingR.body)
	}

	// A read-only member sets her own override; Bert's stays his.
	w.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = ? AND user_id = ?`, w.shared, w.partner)
	check(put("partner", w.sharedTx, `{"transfer":false}`, 200), false, "-", &isFalse)
	if x := w.seen("bert", "Supermarkt"); x == nil || !x.Transfer || x.TransferOverride == nil || !*x.TransferOverride {
		t.Errorf("Bert's override after Partner's: %+v", x)
	}
	put("partner", w.sharedTx, `{"transfer":null}`, 200)
	if n := w.int(`SELECT COUNT(*) FROM transfer_overrides WHERE transaction_id = ? AND user_id = ?`, w.sharedTx, w.bert); n != 1 {
		t.Error("Partner's null removed Bert's override")
	}
}

// GET /api/accounts/{id}/transfers: rows on the viewer's other accounts to
// the account's registered IBAN, newest first, at most 50.
func TestIncomingTransfers(t *testing.T) {
	w := newWorld(t)
	const spaarpot = "BE83363012345615" // Bert's manual savings account
	for i := range 55 {
		w.addRow(w.bertAcc, -100-int64(i), fmt.Sprintf("2026-%02d-%02d", 1+i/28, 1+i%28), fmt.Sprintf("TT sparen %d", i), "booked", "EUR", spaarpot)
	}
	partnerRow := w.addRow(w.partnerAcc, -4242, "2026-11-12", "TT Partner naar spaarpot", "booked", "EUR", spaarpot)
	type item struct {
		ID           int64             `json:"id"`
		BookingDate  string            `json:"bookingDate"`
		Amount       int64             `json:"amount"`
		From         ledger.AccountRef `json:"from"`
		Counterparty string            `json:"counterparty"`
	}
	r := w.ok(w.bert, "GET", "/api/accounts/"+id(w.bertManual)+"/transfers", "", 200)
	list := decode[[]item](t, r.body)
	if len(list) != 50 {
		t.Fatalf("%d rows: %s", len(list), r.body)
	}
	first := list[0]
	if first.BookingDate != "2026-02-27" || first.Amount != -154 || first.From.ID != w.bertAcc || first.Counterparty != "TT sparen 54" {
		t.Errorf("first: %+v", first)
	}
	for i := 1; i < len(list); i++ {
		if list[i].BookingDate > list[i-1].BookingDate || list[i].ID == partnerRow {
			t.Errorf("row %d: %+v after %+v", i, list[i], list[i-1])
		}
	}
	// No IBAN: []. Invisible: 404 as a missing account.
	if r := w.ok(w.partner, "GET", "/api/accounts/"+id(w.partnerManual)+"/transfers", "", 200); r.body != "[]\n" && r.body != "[]" {
		t.Errorf("no IBAN: %q", r.body)
	}
	hiddenR, _ := w.send(probe{method: "GET", path: "/api/accounts/" + id(w.bertManual) + "/transfers"}, "partner")
	missingR, _ := w.send(probe{method: "GET", path: "/api/accounts/" + none + "/transfers"}, "partner")
	if hiddenR.status != 404 || hiddenR.body != missingR.body {
		t.Errorf("hidden %d %s, missing %d %s", hiddenR.status, hiddenR.body, missingR.status, missingR.body)
	}
	// Partner registers the same IBAN on a manual account of her own: she
	// sees her own row to it, never Bert's.
	mine := decode[ledger.Account](t, w.ok(w.partner, "POST", "/api/accounts", `{"name":"Kopie","type":"savings","colour":"teal","iban":"`+spaarpot+`","balance":0}`, 201).body).ID
	got := decode[[]item](t, w.ok(w.partner, "GET", "/api/accounts/"+id(mine)+"/transfers", "", 200).body)
	if len(got) != 1 || got[0].ID != partnerRow {
		t.Errorf("Partner's copy: %+v", got)
	}
}
