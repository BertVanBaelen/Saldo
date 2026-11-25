package server

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
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
	equalJSON(t, p.bert("GET", contribPath+"?month=2026-11", "").body, `{"month": "2026-11", "need": 87200, "members": [
		{"userId": 1, "name": "Bert", "me": true, "share": 50, "senders": 0, "received": 0, "confirmed": false, "required": 43600, "covered": false},
		{"userId": 2, "name": "Partner", "me": false, "share": 50, "senders": 0, "received": 0, "confirmed": false, "required": 43600, "covered": false}
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
	equalJSON(t, p.partner("GET", contribPath, "").body, `{"month": "2026-11", "need": 87200, "members": [
		{"userId": 1, "name": "Bert", "me": false, "share": 50, "senders": 1, "received": 45000, "confirmed": true, "required": 43600, "covered": true},
		{"userId": 2, "name": "Partner", "me": true, "share": 50, "senders": 1, "received": 45000, "confirmed": true, "required": 43600, "covered": true}
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
	equalJSON(t, p.bert("GET", "/api/accounts/1/contributions", "").body, `{"month": "2026-11", "need": null, "members": [], "mySenders": []}`)
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
	equalJSON(t, r.body, `{"month": "2026-11", "need": 87200, "members": [
		{"userId": 1, "name": "Bert", "me": true, "share": 60, "senders": 0, "received": 0, "confirmed": false, "required": 52300, "covered": false},
		{"userId": 2, "name": "Partner", "me": false, "share": 40, "senders": 0, "received": 0, "confirmed": false, "required": 34900, "covered": false}
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
		equalJSON(t, p.bert("GET", contribPath, "").body, `{"month": "2026-11", "need": null, "members": [], "mySenders": []}`)
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

// Contributors without Saldo (0.8.1-7) on the demo pair: account 4 is the
// shared account Bert manages; its November need is 87118 (0.8-3); Partner's
// account 5 (IBAN BE71000000005038) pays 45000 into it every month.

const (
	contributorsPath = "/api/accounts/4/contributors"
	mamaIBAN         = "BE68539007547034" // valid checksum, no account in the demo pair
	msgIBANInUse     = "Deze IBAN kan je hier niet gebruiken."
)

// addContributor posts a contributor as h and returns its id (the newest).
func (p *pair) addContributor(h func(string, string, string) response, path, body string) int64 {
	p.t.Helper()
	r := h("POST", path, body)
	if r.status != http.StatusCreated {
		p.t.Fatalf("add contributor %s: %d %s", body, r.status, r.body)
	}
	c := decode[ledger.Contributions](p.t, r.body).Contributors
	return c[len(c)-1].ID
}

// parts is "name share required" of every member, then "name share required
// received covered" of every contributor.
func parts(c ledger.Contributions) string {
	out := ""
	for _, m := range c.Members {
		out += fmt.Sprintf("%s %v %v; ", m.Name, deref(m.Share), deref(m.Required))
	}
	for _, x := range c.Contributors {
		out += fmt.Sprintf("%s %v %v %d %v; ", x.Name, deref(x.Share), deref(x.Required), x.Received, deref(x.Covered))
	}
	return out
}

func deref[T any](v *T) any {
	if v == nil {
		return nil
	}
	return *v
}

// planParties is the running month's contribution of an account in GET
// /api/planning as raw objects (to see which keys are there).
func (p *pair) planParties(h func(string, string, string) response, account int64) []map[string]any {
	p.t.Helper()
	a := decode[struct {
		Accounts []struct {
			ID     int64
			Months []struct {
				Contribution *struct{ Members []map[string]any }
			}
		}
	}](p.t, h("GET", "/api/planning?scope=gedeeld", "").body)
	for _, x := range a.Accounts {
		if x.ID == account && x.Months[0].Contribution != nil {
			return x.Months[0].Contribution.Members
		}
	}
	p.t.Fatalf("no contribution for account %d", account)
	return nil
}

func TestContributorsNeedSplitAndRecognition(t *testing.T) {
	p := newPair(t)
	mama := p.addContributor(p.bert, contributorsPath, `{"name": " Mama ", "iban": "be68 5390 0754 7034"}`)
	// Adding resets every share (the seeded 50/50) to equal: ⌈871,18 / 3⌉ = 291 each.
	if n := p.count(`SELECT COUNT(*) FROM account_access WHERE account_id = 4 AND contribution_share IS NOT NULL`); n != 0 {
		t.Errorf("%d shares kept", n)
	}
	if got := parts(p.contributions(p.bert, "2026-11")); got != "Bert <nil> 29100; Partner <nil> 29100; Mama <nil> 29100 0 false; " {
		t.Errorf("equal: %s", got)
	}
	c := "c" + strconv.FormatInt(mama, 10)
	if r := p.bert("PUT", sharesPath, `{"shares": {"1": 40, "2": 40, "`+c+`": 20}}`); r.status != http.StatusOK {
		t.Fatalf("shares: %d %s", r.status, r.body)
	}
	if got := parts(p.contributions(p.bert, "2026-11")); got != "Bert 40 34900; Partner 40 34900; Mama 20 17500 0 false; " {
		t.Errorf("40/40/20: %s", got)
	}
	// Planning: the contributor after the members, with contributorId and no userId.
	got := p.planParties(p.partner, 4)
	if len(got) != 3 || got[2]["name"] != "Mama" || got[2]["contributorId"] != float64(mama) || got[2]["userId"] != nil ||
		got[2]["me"] != false || got[2]["share"] != float64(20) || got[2]["required"] != float64(17500) || got[0]["contributorId"] != nil {
		t.Errorf("planning: %v", got)
	}
	// Share keys: every member and contributor exactly once.
	before := p.snapshot()
	for _, body := range []string{`{"shares": {"1": 50, "2": 50}}`, `{"shares": {"1": 50, "2": 30, "c999": 20}}`, `{"shares": {"1": 50, "2": 30, "C` + c[1:] + `": 20}}`} {
		if msg := expectError(t, p.bert("PUT", sharesPath, body), http.StatusBadRequest, "invalid"); msg != "Geef elk lid precies één aandeel." {
			t.Errorf("%s: %q", body, msg)
		}
	}
	if p.snapshot() != before {
		t.Error("a refused share wrote")
	}

	// Recognition: +30000 from Mama's IBAN on 5 November; only this account's
	// booked incoming rows count.
	p.bert("PUT", sharesPath, `{"shares": null}`)
	row := p.incoming(4, mamaIBAN, 30000, "2026-11-05", "booked")
	p.incoming(1, mamaIBAN, 5000, "2026-11-06", "booked")
	p.incoming(4, mamaIBAN, 7000, "2026-11-07", "pending")
	// The bank's balance includes the payment (else the engine, reconstructing
	// backwards from the newest balance, sees a lower month start and a need 30000 higher).
	p.exec(`UPDATE balance_snapshots SET balance = balance + 30000 WHERE account_id = 4`)
	m := p.contributions(p.partner, "2026-11")
	if got := parts(m); deref(m.Need) != int64(87200) || got != "Bert <nil> 29100; Partner <nil> 29100; Mama <nil> 29100 30000 true; " || !m.Contributors[0].Confirmed {
		t.Errorf("with Mama's payment: need %v, %s", deref(m.Need), got)
	}
	labelled := false
	for _, x := range decode[ledger.Page](t, p.partner("GET", "/api/transactions?limit=200&account=4", "").body).Items {
		if x.ID == row {
			labelled = true
			equalJSON(t, jsonBody(x.Contribution), `{"name": "Mama", "me": false, "contributorId": `+strconv.FormatInt(mama, 10)+`}`)
		}
	}
	if !labelled {
		t.Error("Mama's row not listed")
	}
	// Removing resets the shares again and the 50/50 answer is 0.8's.
	p.bert("PUT", sharesPath, `{"shares": {"1": 50, "2": 25, "`+c+`": 25}}`)
	if r := p.bert("DELETE", contributorsPath+"/"+strconv.FormatInt(mama, 10), ""); r.status != http.StatusOK {
		t.Fatalf("delete: %d %s", r.status, r.body)
	}
	if n := p.count(`SELECT COUNT(*) FROM account_access WHERE contribution_share IS NOT NULL`); n != 0 {
		t.Errorf("%d shares kept after delete", n)
	}
	p.bert("PUT", sharesPath, `{"shares": {"1": 50, "2": 50}}`)
	if got := parts(p.contributions(p.bert, "2026-11")); got != "Bert 50 43600; Partner 50 43600; " {
		t.Errorf("50/50: %s", got)
	}
}

func TestContributorsIBANRulesAndVisibility(t *testing.T) {
	p := newPair(t)
	// An IBAN already a member's sender here: one generic text.
	claimed := p.incoming(4, mamaIBAN, 100, "2026-11-03", "booked")
	p.claim(p.partner, `{"transactionId": `+strconv.FormatInt(claimed, 10)+`}`)
	elsewhere := strconv.FormatInt(p.incoming(1, outsideIBAN, 700, "2026-11-10", "booked"), 10)
	outgoing := strconv.FormatInt(p.incoming(4, outsideIBAN, -700, "2026-11-10", "booked"), 10)
	for _, c := range []struct {
		body   string
		status int
		code   string
		msg    string
	}{
		{`{"name": "Mama", "iban": "` + mamaIBAN + `"}`, http.StatusConflict, "conflict", msgIBANInUse},
		{`{"name": "Mama", "iban": "BE68539007547035"}`, http.StatusBadRequest, "invalid", "Dit lijkt geen geldig IBAN. Kijk het na."},
		{`{"name": "", "iban": "BE62510007547061"}`, http.StatusBadRequest, "invalid", "Geef een naam van 1 tot 60 tekens."},
		{`{"name": "Mama"}`, http.StatusBadRequest, "invalid", "Geef een IBAN of een ontvangen betaling."},
		{`{"name": "Mama", "iban": "BE62510007547061", "share": 20}`, http.StatusBadRequest, "invalid", "De gegevens kloppen niet."},
		{`{"name": "Mama", "iban": "BE62510007547061", "transactionId": 1}`, http.StatusBadRequest, "invalid", "Geef een IBAN of een ontvangen betaling."},
		// Prefill: a row of another account, an outgoing row: ClaimSender's refusal.
		{`{"name": "Mama", "transactionId": ` + elsewhere + `}`, http.StatusBadRequest, "invalid", msgNotSender},
		{`{"name": "Mama", "transactionId": ` + outgoing + `}`, http.StatusBadRequest, "invalid", msgNotSender},
	} {
		before := p.snapshot()
		if msg := expectError(t, p.bert("POST", contributorsPath, c.body), c.status, c.code); msg != c.msg {
			t.Errorf("%s: %q", c.body, msg)
		}
		if p.snapshot() != before {
			t.Errorf("%s wrote", c.body)
		}
	}
	// The same IBAN on another shared account is fine (Bert's account 2, flagged).
	if r := p.bert("PATCH", "/api/accounts/2", `{"shared": true}`); r.status != http.StatusOK {
		t.Fatalf("flag: %d %s", r.status, r.body)
	}
	p.addContributor(p.bert, "/api/accounts/2/contributors", `{"name": "Mama", "iban": "`+mamaIBAN+`"}`)
	// Who: read-only 403, personal 400, hidden 404.
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	expectError(t, p.partner("POST", contributorsPath, `{"name": "Oma", "iban": "BE62510007547061"}`), http.StatusForbidden, "forbidden")
	p.exec(`UPDATE account_access SET permission = 'edit' WHERE account_id = 4 AND user_id = 2`)
	if msg := expectError(t, p.bert("POST", "/api/accounts/1/contributors", `{"name": "Oma", "iban": "BE62510007547061"}`), http.StatusBadRequest, "invalid"); msg != "Een persoonlijke rekening heeft geen bijdragen." {
		t.Errorf("personal: %q", msg)
	}
	expectError(t, p.partner("POST", "/api/accounts/2/contributors", `{"name": "Oma", "iban": "BE62510007547061"}`), http.StatusNotFound, "not_found")

	// Visibility: Partner adds Oma (an IBAN of an account in Saldo is accepted),
	// Bert adds Opa from a received payment. The creator and the manager see the
	// IBAN masked, a third member neither; no answer holds a full IBAN.
	p.addContributor(p.partner, contributorsPath, `{"name": "Oma", "iban": "BE62510007547061"}`)
	opaRow := p.incoming(4, "BE09000000000303", 2500, "2026-11-12", "booked")
	p.addContributor(p.bert, contributorsPath, `{"name": "Opa", "transactionId": `+strconv.FormatInt(opaRow, 10)+`}`)
	third := p.third("user", "edit")
	ibans := func(h func(string, string, string) response) string {
		r := h("GET", contribPath, "")
		for _, full := range []string{"BE62510007547061", "BE09000000000303", mamaIBAN} {
			if strings.Contains(r.body, full) {
				t.Errorf("a full IBAN in %s", r.body)
			}
		}
		out := ""
		for _, x := range decode[ledger.Contributions](t, r.body).Contributors {
			out += x.Name + "=" + x.IBAN + " "
		}
		return out
	}
	for who, c := range map[string]struct {
		h    func(string, string, string) response
		want string
	}{
		"manager": {p.bert, "Oma=BE62 •••• •••• 7061 Opa=BE09 •••• •••• 0303 "},
		"creator": {p.partner, "Oma=BE62 •••• •••• 7061 Opa= "},
		"member":  {func(m, path, b string) response { return do(t, third, m, path, b) }, "Oma= Opa= "},
	} {
		if got := ibans(c.h); got != c.want {
			t.Errorf("%s sees %s", who, got)
		}
	}
	// Renaming and re-pointing: one IBAN per contributor, the same 409.
	oma := decode[ledger.Contributions](t, p.bert("GET", contribPath, "").body).Contributors[0].ID
	omaPath := contributorsPath + "/" + strconv.FormatInt(oma, 10)
	if msg := expectError(t, p.partner("PATCH", omaPath, `{"iban": "`+mamaIBAN+`"}`), http.StatusConflict, "conflict"); msg != msgIBANInUse {
		t.Errorf("re-point to a sender: %q", msg)
	}
	if r := p.partner("PATCH", omaPath, `{"name": "Oma Jet"}`); r.status != http.StatusOK || p.text(`SELECT name FROM contributors WHERE id = ?`, oma) != "Oma Jet" {
		t.Errorf("rename: %d %s", r.status, r.body)
	}
	for _, path := range []string{contributorsPath + "/999", "/api/accounts/2/contributors/" + strconv.FormatInt(oma, 10), contributorsPath + "/abc"} {
		if msg := expectError(t, p.bert("PATCH", path, `{"name": "X"}`), http.StatusNotFound, "not_found"); msg != "Bijdrager niet gevonden." {
			t.Errorf("%s: %q", path, msg)
		}
	}
}

func TestContributorsMemberWinsAndLinking(t *testing.T) {
	audit := func(p *pair) string {
		return p.text(`SELECT group_concat(event || ' ' || detail, '; ') FROM audit_log WHERE event LIKE 'contributor%'`)
	}
	t.Run("member wins", func(t *testing.T) {
		p := newPair(t)
		// Bert names Partner's own account's IBAN "Mama" from a received payment.
		partnerRow := p.count(`SELECT id FROM transactions WHERE account_id = 4 AND counterparty_iban = 'BE71000000005038' AND booking_date >= '2026-11-01'`)
		mama := p.addContributor(p.bert, contributorsPath, `{"name": "Mama", "transactionId": `+strconv.Itoa(partnerRow)+`}`)
		if got := p.contributions(p.bert, "2026-11").Contributors[0]; got.Received != 45000 || got.IBAN != "BE71 •••• •••• 5038" {
			t.Errorf("Mama on Partner's IBAN: %+v", got) // only this account's rows count
		}
		// A received payment never replaces a contributor: 409, the generic text.
		outside := p.incoming(4, outsideIBAN, 900, "2026-11-10", "booked")
		buur := p.addContributor(p.bert, contributorsPath, `{"name": "Buur", "transactionId": `+strconv.FormatInt(outside, 10)+`}`)
		snap := p.snapshot()
		if msg := expectError(t, p.bert("POST", sendersPath, `{"transactionId": `+strconv.FormatInt(outside, 10)+`}`), http.StatusConflict, "conflict"); msg != msgIBANInUse {
			t.Errorf("transaction claim: %q", msg)
		}
		if p.snapshot() != snap {
			t.Error("the refused claim wrote")
		}
		// Partner proves it as her own account: her sender, Mama gone, shares equal.
		p.bert("PUT", sharesPath, fmt.Sprintf(`{"shares": {"1": 40, "2": 30, "c%d": 15, "c%d": 15}}`, mama, buur))
		if got := p.claim(p.partner, `{"fromAccountId": 5}`); got.IBAN != "BE71 •••• •••• 5038" {
			t.Errorf("claim: %+v", got)
		}
		c := p.contributions(p.bert, "2026-11")
		if len(c.Contributors) != 1 || c.Contributors[0].Name != "Buur" || c.Members[1].Received != 45000 {
			t.Errorf("after the claim: %s", parts(c))
		}
		if n := p.count(`SELECT (SELECT COUNT(*) FROM account_access WHERE contribution_share IS NOT NULL) + (SELECT COUNT(*) FROM contributors WHERE share IS NOT NULL)`); n != 0 {
			t.Errorf("%d shares kept", n)
		}
		if got := audit(p); got != "contributor_replaced account=4 contributor="+strconv.FormatInt(mama, 10) {
			t.Errorf("audit: %q", got)
		}
	})
	setup := func(t *testing.T) (*pair, int64, string) {
		p := newPair(t)
		mama := p.addContributor(p.bert, contributorsPath, `{"name": "Mama", "iban": "`+mamaIBAN+`"}`)
		return p, mama, contributorsPath + "/" + strconv.FormatInt(mama, 10)
	}
	t.Run("offer", func(t *testing.T) {
		p, _, path := setup(t)
		snap := p.snapshot()
		expectError(t, p.partner("PUT", path+"/link", `{"userId": 2}`), http.StatusForbidden, "forbidden")
		for _, user := range []string{"3", "999", "0"} { // not a member, nobody: one answer
			if msg := expectError(t, p.bert("PUT", path+"/link", `{"userId": `+user+`}`), http.StatusBadRequest, "invalid"); msg != "Kies een lid van deze rekening." {
				t.Errorf("user %s: %q", user, msg)
			}
		}
		expectError(t, p.partner("POST", path+"/link-answer", `{"yes": true}`), http.StatusNotFound, "not_found") // nothing offered
		// A read-only member could never answer (answering needs edit): the same refusal, nothing written.
		p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
		snap = p.snapshot()
		if msg := expectError(t, p.bert("PUT", path+"/link", `{"userId": 2}`), http.StatusBadRequest, "invalid"); msg != "Kies een lid van deze rekening." {
			t.Errorf("read-only member: %q", msg)
		}
		if p.snapshot() != snap {
			t.Error("a refused call wrote")
		}
	})
	for _, yes := range []bool{true, false} {
		t.Run(fmt.Sprintf("answer %v", yes), func(t *testing.T) {
			p, mama, path := setup(t)
			p.bert("PUT", sharesPath, fmt.Sprintf(`{"shares": {"1": 40, "2": 40, "c%d": 20}}`, mama))
			if yes { // re-pointing the IBAN withdraws an offer: she said yes to what she saw
				p.bert("PUT", path+"/link", `{"userId": 2}`)
				p.bert("PATCH", path, `{"iban": "BE62510007547061"}`)
				expectError(t, p.partner("POST", path+"/link-answer", `{"yes": true}`), http.StatusNotFound, "not_found")
				p.bert("PATCH", path, `{"iban": "`+mamaIBAN+`"}`)
			}
			third := p.third("user", "edit")
			if r := p.bert("PUT", path+"/link", `{"userId": 2}`); r.status != http.StatusOK {
				t.Fatalf("offer: %d %s", r.status, r.body)
			}
			// Only Partner sees the offer; the manager sees whom he asked.
			equalJSON(t, jsonBody(p.contributions(p.partner, "").LinkOffers), `[{"contributorId": `+strconv.FormatInt(mama, 10)+`, "name": "Mama", "iban": "BE68 •••• •••• 7034"}]`)
			if b := p.contributions(p.bert, ""); b.LinkOffers != nil || b.Contributors[0].LinkUserID == nil || *b.Contributors[0].LinkUserID != 2 {
				t.Errorf("Bert: %+v", b)
			}
			if r := do(t, third, "GET", contribPath, ""); strings.Contains(r.body, "linkOffers") || strings.Contains(r.body, "linkUserId") || strings.Contains(r.body, "7034") {
				t.Errorf("Derde: %s", r.body)
			}
			if msg := expectError(t, p.bert("POST", path+"/link-answer", `{"yes": true}`), http.StatusNotFound, "not_found"); msg != "Bijdrager niet gevonden." {
				t.Errorf("Bert answers Partner's offer: %q", msg)
			}
			r := p.partner("POST", path+"/link-answer", fmt.Sprintf(`{"yes": %v}`, yes))
			if r.status != http.StatusOK {
				t.Fatalf("answer: %d %s", r.status, r.body)
			}
			c := decode[ledger.Contributions](t, r.body)
			if yes {
				if len(c.Contributors) != 0 || len(c.MySenders) != 1 || c.MySenders[0].IBAN != "BE68 •••• •••• 7034" || c.LinkOffers != nil {
					t.Errorf("after Ja: %+v", c)
				}
				if n := p.count(`SELECT COUNT(*) FROM account_access WHERE contribution_share IS NOT NULL`); n != 0 {
					t.Errorf("%d shares kept after Ja", n)
				}
				if got := audit(p); got != fmt.Sprintf("contributor_linked account=4 contributor=%d user=2", mama) {
					t.Errorf("audit: %q", got)
				}
				return
			}
			if len(c.Contributors) != 1 || c.LinkOffers != nil || len(c.MySenders) != 0 || p.count(`SELECT COUNT(*) FROM contributors WHERE link_user IS NOT NULL`) != 0 {
				t.Errorf("after Nee: %+v", c)
			}
			if audit(p) != "" {
				t.Error("Nee audited")
			}
		})
	}
}

func TestContributorsOneMemberUnflagAndDetection(t *testing.T) {
	p := newPair(t)
	// A flagged account of Bert alone, with Mama 50/50.
	pot := decode[ledger.Account](t, p.bert("POST", "/api/accounts", `{"name": "Vakantiepot", "type": "current", "colour": "teal", "balance": 120000}`).body).ID
	potPath := "/api/accounts/" + strconv.FormatInt(pot, 10)
	if r := p.bert("PATCH", potPath, `{"shared": true}`); r.status != http.StatusOK {
		t.Fatalf("flag: %d %s", r.status, r.body)
	}
	mama := p.addContributor(p.bert, potPath+"/contributors", `{"name": "Mama", "iban": "`+mamaIBAN+`"}`)
	if r := p.bert("PUT", potPath+"/contribution-shares", `{"shares": {"1": 50, "c`+strconv.FormatInt(mama, 10)+`": 50}}`); r.status != http.StatusOK {
		t.Fatalf("shares: %d %s", r.status, r.body)
	}
	c := decode[ledger.Contributions](t, p.bert("GET", potPath+"/contributions", "").body)
	if len(c.Members) != 1 || len(c.Contributors) != 1 || deref(c.Contributors[0].Share) != 50 {
		t.Errorf("contributions: %s", parts(c))
	}
	if got := p.planParties(p.bert, pot); len(got) != 2 || got[0]["userId"] != float64(1) || got[1]["contributorId"] != float64(mama) {
		t.Errorf("planning: %v", got)
	}
	// Unflag is refused while contributors exist.
	if msg := expectError(t, p.bert("PATCH", potPath, `{"shared": false}`), http.StatusBadRequest, "invalid"); msg != "Verwijder eerst de bijdragers." {
		t.Errorf("unflag: %q", msg)
	}

	// Detection: Mama's monthly transfer to account 4 is a contribution once
	// she is a contributor there.
	for _, d := range []string{"2026-08-07", "2026-09-07", "2026-10-07", "2026-11-07"} {
		p.incoming(4, "BE62510007547061", 12300, d, "booked")
	}
	kind := func() string {
		for _, s := range decode[struct {
			Suggestions []struct {
				AccountID, Amount int64
				Kind              string
			}
		}](t, p.bert("GET", "/api/planning/suggestions?scope=gedeeld", "").body).Suggestions {
			if s.AccountID == 4 && s.Amount == 12300 {
				return s.Kind
			}
		}
		return "none"
	}
	if got := kind(); got != "income" { // counted as other income and as her part: twice
		t.Errorf("detection before: %s", got)
	}
	p.addContributor(p.partner, contributorsPath, `{"name": "Mama", "iban": "BE62510007547061"}`)
	if got := kind(); got != "contribution" {
		t.Errorf("detection: %s", got)
	}
}
