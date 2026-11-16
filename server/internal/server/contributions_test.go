package server

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Contributions (0.6-5) on the demo pair: Bert (1) holds 1 (bank, IBAN
// ...4821), 2 (manual savings, IBAN ...1196) and 3 (manual, no IBAN) and
// manages the shared account 4; Partner (2) holds 5 (bank, IBAN ...5038) and
// is a member of 4. On the first of every month 4 receives 45000 from 1 and
// 45000 from 5.

const (
	contribPath  = "/api/accounts/4/contributions"
	sendersPath  = "/api/accounts/4/contribution-senders"
	sharesPath   = "/api/accounts/4/contribution-shares"
	outsideIBAN  = "BE11000000000071" // a sender that is no account in Saldo
	msgNotSender = "Dit is geen afzender die je zelf kunt kiezen. Kies je eigen rekening."
)

func (p *pair) claim(h func(string, string, string) response, body string) ledger.Sender {
	p.t.Helper()
	r := h("POST", sendersPath, body)
	if r.status != http.StatusCreated {
		p.t.Fatalf("claim %s: %d %s", body, r.status, r.body)
	}
	return decode[ledger.Sender](p.t, r.body)
}

func (p *pair) contributions(h func(string, string, string) response, month string) ledger.Contributions {
	p.t.Helper()
	path := contribPath
	if month != "" {
		path += "?month=" + month
	}
	r := h("GET", path, "")
	if r.status != http.StatusOK {
		p.t.Fatalf("contributions %s: %d %s", month, r.status, r.body)
	}
	return decode[ledger.Contributions](p.t, r.body)
}

// received is each member's figure of a month as Bert and as Partner see it;
// the two must be identical.
func (p *pair) received(month string) map[int64]int64 {
	p.t.Helper()
	out := map[int64]int64{}
	for _, m := range p.contributions(p.bert, month).Members {
		out[m.UserID] = m.Received
	}
	for _, m := range p.contributions(p.partner, month).Members {
		if out[m.UserID] != m.Received {
			p.t.Errorf("%s: member %d receives %d for Partner, %d for Bert", month, m.UserID, m.Received, out[m.UserID])
		}
	}
	return out
}

// incoming adds a booked or pending row from an IBAN to an account.
func (p *pair) incoming(account int64, iban string, amount int64, date, status string) int64 {
	p.t.Helper()
	var id int64
	if err := p.db.QueryRow(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, counterparty_iban, status, dedupe_key)
		VALUES (?, ?, ?, 'Proef Afzender', ?, ?, 'contrib-' || (SELECT COUNT(*) FROM transactions)) RETURNING id`,
		account, amount, date, iban, status).Scan(&id); err != nil {
		p.t.Fatal(err)
	}
	return id
}

func TestContributionClaims(t *testing.T) {
	p := newPair(t)
	// Before any claim: both members with nothing, shares as seeded (50/50).
	equalJSON(t, p.bert("GET", contribPath+"?month=2026-11", "").body, `{"month": "2026-11", "members": [
		{"userId": 1, "name": "Bert", "me": true, "share": 50, "senders": 0, "received": 0, "confirmed": false},
		{"userId": 2, "name": "Partner", "me": false, "share": 50, "senders": 0, "received": 0, "confirmed": false}
	], "mySenders": []}`)

	// (a) Each from their own account.
	bert := p.claim(p.bert, `{"fromAccountId": 1}`)
	equalJSON(t, jsonBody(bert), `{"id": `+strconv.FormatInt(bert.ID, 10)+`, "iban": "BE68 •••• •••• 4821"}`)
	partner := p.claim(p.partner, `{"fromAccountId": 5}`)
	if partner.IBAN != "BE71 •••• •••• 5038" {
		t.Errorf("Partner's sender: %+v", partner)
	}
	// Each sees a count for the other and only their own masked IBAN; the
	// default month is the server's (18 Nov 2026).
	equalJSON(t, p.partner("GET", contribPath, "").body, `{"month": "2026-11", "members": [
		{"userId": 1, "name": "Bert", "me": false, "share": 50, "senders": 1, "received": 45000, "confirmed": true},
		{"userId": 2, "name": "Partner", "me": true, "share": 50, "senders": 1, "received": 45000, "confirmed": true}
	], "mySenders": [{"id": `+strconv.FormatInt(partner.ID, 10)+`, "iban": "BE71 •••• •••• 5038"}]}`)

	// (a) refused: another user's account, an own account without IBAN, the
	// shared account itself, a missing one: one generic answer, nothing written.
	for who, c := range map[string]struct {
		h    func(string, string, string) response
		body string
	}{
		"other's":  {p.partner, `{"fromAccountId": 1}`},
		"no IBAN":  {p.bert, `{"fromAccountId": 3}`},
		"itself":   {p.bert, `{"fromAccountId": 4}`},
		"missing":  {p.bert, `{"fromAccountId": 999}`},
		"outgoing": {p.bert, `{"transactionId": ` + strconv.FormatInt(p.addRow(4, "Uit", -500, "booked", nil, nil), 10) + `}`},
		"no row":   {p.bert, `{"transactionId": 999999}`},
		// (b) with a row of another account, and with a row whose sender is a Saldo account.
		"elsewhere":   {p.bert, `{"transactionId": ` + strconv.FormatInt(p.incoming(1, outsideIBAN, 700, "2026-11-10", "booked"), 10) + `}`},
		"saldo IBAN":  {p.partner, `{"transactionId": ` + strconv.FormatInt(p.incoming(4, "BE41000000001196", 700, "2026-11-10", "booked"), 10) + `}`},
		"own IBAN":    {p.bert, `{"transactionId": ` + strconv.FormatInt(p.incoming(4, "BE68000000004821", 700, "2026-11-10", "booked"), 10) + `}`},
		"no sender":   {p.bert, `{"transactionId": ` + strconv.FormatInt(p.addRow(4, "Zonder", 800, "booked", nil, nil), 10) + `}`},
		"other's tx5": {p.bert, `{"transactionId": ` + strconv.FormatInt(p.incoming(5, outsideIBAN, 900, "2026-11-10", "booked"), 10) + `}`},
	} {
		snap := p.snapshot()
		if msg := expectError(t, c.h("POST", sendersPath, c.body), http.StatusBadRequest, "invalid"); msg != msgNotSender {
			t.Errorf("%s: %q", who, msg)
		}
		if p.snapshot() != snap {
			t.Errorf("%s wrote", who)
		}
	}
	for body, want := range map[string]string{
		`{}`: "Kies je eigen rekening of een ontvangen betaling.",
		`{"fromAccountId": 1, "transactionId": 5}`: "Kies je eigen rekening of een ontvangen betaling.",
		`{"iban": "BE11000000000071"}`:             "De gegevens kloppen niet.",
	} {
		if msg := expectError(t, p.bert("POST", sendersPath, body), http.StatusBadRequest, "invalid"); msg != want {
			t.Errorf("%s: %q", body, msg)
		}
	}

	// (b) a row from a sender outside Saldo; a second claim is a conflict.
	row := p.incoming(4, outsideIBAN, 30000, "2026-11-05", "booked")
	extra := p.claim(p.partner, `{"transactionId": `+strconv.FormatInt(row, 10)+`}`)
	if extra.IBAN != "BE11 •••• •••• 0071" {
		t.Errorf("outside sender: %+v", extra)
	}
	if msg := expectError(t, p.bert("POST", sendersPath, `{"transactionId": `+strconv.FormatInt(row, 10)+`}`), http.StatusConflict, "conflict"); msg != "Deze afzender is al ingesteld als bijdrage van Partner." {
		t.Errorf("conflict: %q", msg)
	}
	if msg := expectError(t, p.bert("POST", sendersPath, `{"fromAccountId": 1}`), http.StatusConflict, "conflict"); msg != "Deze afzender is al ingesteld als jouw bijdrage." {
		t.Errorf("own conflict: %q", msg)
	}
	// Bert's: the demo's 45000 and the 700 of the "own IBAN" row above.
	if got := p.received("2026-11"); got[1] != 45700 || got[2] != 75000 {
		t.Errorf("received: %v", got)
	}

	// Who may: read-only 403, personal 400, hidden 404 (as missing).
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	snap := p.snapshot()
	if msg := expectError(t, p.partner("POST", sendersPath, `{"fromAccountId": 5}`), http.StatusForbidden, "forbidden"); msg != "Je mag deze rekening alleen bekijken." {
		t.Errorf("read-only: %q", msg)
	}
	expectError(t, p.partner("DELETE", sendersPath+"/"+strconv.FormatInt(partner.ID, 10), ""), http.StatusForbidden, "forbidden")
	if p.partner("GET", contribPath, "").status != http.StatusOK {
		t.Error("a read-only member cannot read the contributions")
	}
	if msg := expectError(t, p.bert("POST", "/api/accounts/1/contribution-senders", `{"fromAccountId": 2}`), http.StatusBadRequest, "invalid"); msg != "Een persoonlijke rekening heeft geen bijdragen." {
		t.Errorf("personal: %q", msg)
	}
	equalJSON(t, p.bert("GET", "/api/accounts/1/contributions", "").body, `{"month": "2026-11", "members": [], "mySenders": []}`)
	hidden := expectError(t, p.partner("POST", "/api/accounts/1/contribution-senders", `{"fromAccountId": 5}`), http.StatusNotFound, "not_found")
	if missing := expectError(t, p.partner("POST", "/api/accounts/999/contribution-senders", `{"fromAccountId": 5}`), http.StatusNotFound, "not_found"); missing != hidden {
		t.Errorf("hidden %q, missing %q", hidden, missing)
	}
	expectError(t, p.partner("GET", "/api/accounts/1/contributions", ""), http.StatusNotFound, "not_found")
	expectError(t, p.bert("GET", contribPath+"?month=2026-13", ""), http.StatusBadRequest, "invalid")
	expectError(t, p.bert("GET", contribPath+"?month=2026-1", ""), http.StatusBadRequest, "invalid")
	if p.snapshot() != snap {
		t.Error("a refused call wrote")
	}
	p.exec(`UPDATE account_access SET permission = 'edit' WHERE account_id = 4 AND user_id = 2`)

	// Removing: a member only their own (403 for Bert's), the manager anyone's.
	if msg := expectError(t, p.partner("DELETE", sendersPath+"/"+strconv.FormatInt(bert.ID, 10), ""), http.StatusForbidden, "forbidden"); msg != "Alleen de beheerder kan dit wijzigen." {
		t.Errorf("other member's: %q", msg)
	}
	for _, path := range []string{sendersPath + "/999", "/api/accounts/5/contribution-senders/" + strconv.FormatInt(bert.ID, 10), "/api/accounts/999/contribution-senders/1", sendersPath + "/abc"} {
		if msg := expectError(t, p.bert("DELETE", path, ""), http.StatusNotFound, "not_found"); msg != "Afzender niet gevonden." {
			t.Errorf("%s: %q", path, msg)
		}
	}
	if r := p.partner("DELETE", sendersPath+"/"+strconv.FormatInt(extra.ID, 10), ""); r.status != http.StatusNoContent {
		t.Fatalf("own delete: %d %s", r.status, r.body)
	}
	if r := p.bert("DELETE", sendersPath+"/"+strconv.FormatInt(partner.ID, 10), ""); r.status != http.StatusNoContent {
		t.Fatalf("manager deletes Partner's: %d %s", r.status, r.body)
	}
	if n := p.count(`SELECT COUNT(*) FROM contribution_senders`); n != 1 {
		t.Errorf("%d senders left, want Bert's", n)
	}
	p.assertInvariant()
}

func TestContributionFigure(t *testing.T) {
	p := newPair(t)
	p.claim(p.bert, `{"fromAccountId": 1}`)
	p.claim(p.partner, `{"fromAccountId": 5}`)
	if got := p.received("2026-11"); got[1] != 45000 || got[2] != 45000 {
		t.Fatalf("November: %v", got)
	}
	if got := p.received("2026-10"); got[1] != 45000 || got[2] != 45000 {
		t.Errorf("October: %v", got)
	}
	if got := p.received("2025-01"); got[1] != 0 || got[2] != 0 {
		t.Errorf("before the history: %v", got)
	}

	// Only booked incoming rows of the shared account in the month count:
	// pending, outgoing, the month's edges, and rows with the same sender and
	// amount on the members' personal accounts.
	p.incoming(4, "BE71000000005038", 1000, "2026-11-30", "booked")
	p.incoming(4, "BE71000000005038", 2000, "2026-12-01", "booked")
	p.incoming(4, "BE71000000005038", 4000, "2026-10-31", "booked")
	p.incoming(4, "BE71000000005038", 8000, "2026-11-15", "pending")
	p.incoming(4, "BE71000000005038", -16000, "2026-11-15", "booked")
	p.incoming(5, "BE71000000005038", 45000, "2026-11-02", "booked")
	p.incoming(1, "BE68000000004821", 45000, "2026-11-02", "booked")
	p.incoming(5, "BE68000000004821", 45000, "2026-11-02", "booked")
	if got := p.received("2026-11"); got[1] != 45000 || got[2] != 46000 {
		t.Errorf("November: %v", got)
	}
	if got := p.received("2026-10"); got[2] != 49000 {
		t.Errorf("October: %v", got)
	}

	// Categories and rules do not matter: a manual category on the demo
	// rows; a rule of the account that categorises the uncategorised ones,
	// applied and deleted.
	same := func(when string) {
		t.Helper()
		if got := p.received("2026-11"); got[1] != 45000 || got[2] != 46000 {
			t.Errorf("%s: %v", when, got)
		}
	}
	p.exec(`UPDATE transactions SET category_id = 3, category_origin = 'manual' WHERE account_id = 4 AND amount > 0 AND counterparty_name <> 'Proef Afzender'`)
	same("manual category")
	rule := p.newRule(p.bert, `{"accountId": 4, "counterparty": "Proef Afzender", "categoryId": 5}`)
	if n := p.applyRule(p.bert, rule); p.count(`SELECT COUNT(*) FROM transactions WHERE rule_id = ?`, rule) == 0 {
		t.Fatalf("the rule categorised nothing: %+v", n)
	}
	same("rule applied")
	if r := p.bert("DELETE", rulePath(rule, ""), ""); r.status != http.StatusNoContent {
		t.Fatalf("delete rule: %d %s", r.status, r.body)
	}
	same("rule deleted")

	// The label on rows: incoming booked rows of the shared account from a
	// claimed sender, for both members; never on personal accounts, pending,
	// outgoing or unclaimed rows.
	p.incoming(4, outsideIBAN, 3300, "2026-11-16", "booked")
	label := func(h func(string, string, string) response, name string, amount int64, status string) *ledger.ContributionLabel {
		t.Helper()
		for _, x := range decode[ledger.Page](t, h("GET", "/api/transactions?limit=200&account=4", "").body).Items {
			if x.Counterparty == name && x.Amount == amount && x.Status == status {
				return x.Contribution
			}
		}
		t.Fatalf("no row %s %d %s", name, amount, status)
		return nil
	}
	for _, c := range []struct {
		h            func(string, string, string) response
		name, status string
		amount       int64
		want         string
	}{
		{p.bert, "Proef Afzender", "booked", 1000, `{"name": "Partner", "me": false}`},
		{p.partner, "Proef Afzender", "booked", 1000, `{"name": "Partner", "me": true}`},
		{p.partner, "Bert", "booked", 45000, `{"name": "Bert", "me": false}`},
		{p.bert, "Bert", "booked", 45000, `{"name": "Bert", "me": true}`},
		{p.bert, "Proef Afzender", "pending", 8000, `null`},
		{p.bert, "Proef Afzender", "booked", -16000, `null`},
		{p.partner, "Proef Afzender", "booked", 3300, `null`},
		{p.bert, "Luminus", "booked", -14500, `null`},
	} {
		equalJSON(t, jsonBody(label(c.h, c.name, c.amount, c.status)), c.want)
	}
	for _, x := range decode[ledger.Page](t, p.partner("GET", "/api/transactions?limit=200&account=5", "").body).Items {
		if x.Contribution != nil {
			t.Errorf("a personal row is labelled: %+v", x)
		}
	}
}

func TestContributionShares(t *testing.T) {
	p := newPair(t)
	shares := func() string {
		return p.text(`SELECT group_concat(user_id || ':' || COALESCE(contribution_share, '-'), ' ') FROM (SELECT * FROM account_access WHERE account_id = 4 ORDER BY user_id)`)
	}
	r := p.bert("PUT", sharesPath, `{"shares": {"1": 60, "2": 40}}`)
	if r.status != http.StatusOK {
		t.Fatalf("put: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"month": "2026-11", "members": [
		{"userId": 1, "name": "Bert", "me": true, "share": 60, "senders": 0, "received": 0, "confirmed": false},
		{"userId": 2, "name": "Partner", "me": false, "share": 40, "senders": 0, "received": 0, "confirmed": false}
	], "mySenders": []}`)
	if p.bert("PUT", sharesPath, `{"shares": {"1": 100, "2": 0}}`).status != http.StatusOK || shares() != "1:100 2:0" {
		t.Errorf("100/0: %s", shares())
	}

	before := p.snapshot()
	for body, want := range map[string]string{
		`{"shares": {"1": 60, "2": 30}}`:          "De aandelen moeten samen 100 % zijn.",
		`{"shares": {"1": 100}}`:                  "Geef elk lid precies één aandeel.",
		`{"shares": {"1": 50, "3": 50}}`:          "Geef elk lid precies één aandeel.",
		`{"shares": {"1": 50, "02": 50}}`:         "Geef elk lid precies één aandeel.",
		`{"shares": {"1": 50, "2": 25, "5": 25}}`: "Geef elk lid precies één aandeel.",
		`{"shares": {"1": 150, "2": -50}}`:        "Elk aandeel is een geheel getal van 0 tot 100.",
		`{"shares": {"1": 50.5, "2": 49.5}}`:      "Elk aandeel is een geheel getal van 0 tot 100.",
		`{"shares": [50, 50]}`:                    "De gegevens kloppen niet.",
		`{}`:                                      "Geef elk lid precies één aandeel.",
	} {
		if msg := expectError(t, p.bert("PUT", sharesPath, body), http.StatusBadRequest, "invalid"); msg != want {
			t.Errorf("%s: %q, want %q", body, msg, want)
		}
	}
	if msg := expectError(t, p.partner("PUT", sharesPath, `{"shares": null}`), http.StatusForbidden, "forbidden"); msg != "Alleen de beheerder kan dit wijzigen." {
		t.Errorf("member: %q", msg)
	}
	expectError(t, p.bert("PUT", "/api/accounts/1/contribution-shares", `{"shares": null}`), http.StatusBadRequest, "invalid")
	expectError(t, p.partner("PUT", "/api/accounts/1/contribution-shares", `{"shares": null}`), http.StatusNotFound, "not_found")
	if p.snapshot() != before {
		t.Error("a refused call wrote")
	}
	if r := p.bert("PUT", sharesPath, `{"shares": null}`); r.status != http.StatusOK || shares() != "1:- 2:-" {
		t.Errorf("null: %d %s; %s", r.status, r.body, shares())
	}
	p.assertInvariant()
}

// Membership changes: the member's claims go and every share is back to
// equal, on leave, on delete user and on join; deleting the account takes
// its claims along.
func TestContributionsResetOnMembershipChange(t *testing.T) {
	setup := func(t *testing.T) *pair {
		p := newPair(t)
		p.claim(p.bert, `{"fromAccountId": 1}`)
		p.claim(p.partner, `{"fromAccountId": 5}`)
		if n := p.count(`SELECT COUNT(*) FROM account_access WHERE account_id = 4 AND contribution_share IS NOT NULL`); n != 2 {
			t.Fatalf("%d shares seeded", n)
		}
		return p
	}
	after := func(t *testing.T, p *pair, senders string) {
		t.Helper()
		if got := p.text(`SELECT group_concat(account_id || ':' || user_id, ' ') FROM (SELECT * FROM contribution_senders ORDER BY id)`); got != senders {
			t.Errorf("senders %q, want %q", got, senders)
		}
		if n := p.count(`SELECT COUNT(*) FROM account_access WHERE contribution_share IS NOT NULL`); n != 0 {
			t.Errorf("%d shares kept", n)
		}
		p.assertInvariant()
	}
	t.Run("leave", func(t *testing.T) {
		p := setup(t)
		if r := p.partner("POST", "/api/accounts/4/leave", ""); r.status != http.StatusOK {
			t.Fatalf("leave: %d %s", r.status, r.body)
		}
		after(t, p, "4:1")
		// Bert alone: a personal account has no contributions and no labels,
		// though his claim stays.
		equalJSON(t, p.bert("GET", contribPath, "").body, `{"month": "2026-11", "members": [], "mySenders": []}`)
		for _, x := range decode[ledger.Page](t, p.bert("GET", "/api/transactions?limit=200&account=4", "").body).Items {
			if x.Contribution != nil {
				t.Errorf("a row of a personal account is labelled: %+v", x)
			}
		}
	})
	t.Run("manager leaves", func(t *testing.T) {
		p := setup(t)
		if r := p.bert("POST", "/api/accounts/4/leave", ""); r.status != http.StatusOK {
			t.Fatalf("leave: %d %s", r.status, r.body)
		}
		after(t, p, "4:2")
	})
	t.Run("delete user", func(t *testing.T) {
		p := setup(t)
		if r := p.bert("DELETE", "/api/users/2", ""); r.status != http.StatusNoContent {
			t.Fatalf("delete user: %d %s", r.status, r.body)
		}
		after(t, p, "4:1")
		if refs := p.usersRefs(2); len(refs) != 0 {
			t.Errorf("rows still point at the deleted user: %v", refs)
		}
	})
	t.Run("delete account", func(t *testing.T) {
		p := setup(t)
		if r := p.bert("DELETE", "/api/accounts/4?confirm=Gedeelde+rekening", ""); r.status != http.StatusNoContent {
			t.Fatalf("delete: %d %s", r.status, r.body)
		}
		after(t, p, "")
	})
	t.Run("join", func(t *testing.T) {
		p := setup(t)
		third := p.third("user", "edit")
		p.exec(`DELETE FROM account_access WHERE account_id = 4 AND user_id = 3`)
		p.exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, status) VALUES (3, 3, 'fake', 'Argenta', 'active')`)
		p.exec(`INSERT INTO join_offers (id, user_id, connection_id, account_id, external_account_id, created_at) VALUES (9, 3, 3, 4, 'x', '2026-11-18T18:00:00Z')`)
		if r := do(t, third, "POST", "/api/join-offers/9/accept", ""); r.status != http.StatusOK {
			t.Fatalf("join: %d %s", r.status, r.body)
		}
		after(t, p, "4:1 4:2")
	})
}
