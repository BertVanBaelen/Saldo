package server

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// assertInvariant: every account has at least one member and exactly one
// manager (plan 0.6-1, decision 4).
func (e *bankEnv) assertInvariant() {
	e.t.Helper()
	if n := e.count(`SELECT COUNT(*) FROM accounts a
		WHERE (SELECT COUNT(*) FROM account_access x WHERE x.account_id = a.id) = 0
		   OR (SELECT COUNT(*) FROM account_access x WHERE x.account_id = a.id AND x.role = 'manager') <> 1`); n != 0 {
		e.t.Errorf("%d accounts break the invariant (>= 1 member, exactly 1 manager)", n)
	}
}

// joinSetup: Bert links his personal and the shared account; Partner links
// her own and the shared IBAN through her own bank login, which gives her a
// join offer for account 2 and nothing else.
func joinSetup(t *testing.T) *bankEnv {
	t.Helper()
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	e.link(e.bert, "")
	e.saveCredentials(e.partner)
	e.bank.set(func(b *testBank) {
		b.session = "sess-partner"
		b.accounts = []bank.Account{
			{ID: "p-1", IBAN: ibanPartner, Name: "Zichtrekening", Bank: "Argenta"},
			{ID: "p-2", IBAN: ibanShared, Name: "Gezinsrekening", Bank: "Argenta"},
		}
	})
	return e
}

func (e *bankEnv) alertsOf(user int64, types ...string) []ledger.Alert {
	e.t.Helper()
	var out []ledger.Alert
	for _, a := range decode[[]ledger.Alert](e.t, e.as(user, "GET", "/api/alerts", "").body) {
		if slices.Contains(types, a.Type) {
			out = append(out, a)
		}
	}
	return out
}

func TestJoinSharedAccount(t *testing.T) {
	e := joinSetup(t)

	// Bert's user rule categorises the shared account while he is its only member.
	e.exec(`INSERT INTO categories (id, name, type) VALUES (50, 'Boodschappen', 'expense')`)
	r := e.as(e.bert, "POST", "/api/rules", `{"counterparty": "Supermarkt", "categoryId": 50}`)
	if r.status != http.StatusCreated {
		t.Fatalf("rule: %d %s", r.status, r.body)
	}
	userRule := decode[ledger.RuleView](t, r.body).ID
	if r := e.as(e.bert, "POST", "/api/rules/apply", ""); r.status != http.StatusOK {
		t.Fatalf("apply: %d %s", r.status, r.body)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 2 AND rule_id = ?`, userRule); n != 1 {
		t.Fatalf("the user rule set %d rows", n)
	}

	got := e.link(e.partner, "")
	equalJSON(t, jsonBody(got.Offers), `[{"id": 1, "iban": "BE71 •••• •••• 6769", "bank": "Argenta"}]`)
	equalJSON(t, jsonBody(got.Skipped), `[]`)
	if !slices.Equal(accountIDs(got.Accounts), []int64{3}) {
		t.Errorf("Partner's linked accounts: %v", accountIDs(got.Accounts))
	}
	equalJSON(t, e.as(e.partner, "GET", "/api/join-offers", "").body,
		`[{"id": 1, "iban": "BE71 •••• •••• 6769", "bank": "Argenta", "createdAt": "2026-11-18T20:00:00+01:00"}]`)
	equalJSON(t, e.as(e.bert, "GET", "/api/join-offers", "").body, `[]`)

	// Before accepting, Partner sees nothing of the account.
	before := func(where string) {
		t.Helper()
		if ids := accountIDs(decode[[]ledger.Account](t, e.as(e.partner, "GET", "/api/accounts", "").body)); !slices.Equal(ids, []int64{3}) {
			t.Errorf("%s: Partner's accounts %v", where, ids)
		}
		for _, path := range []string{"/api/transactions", "/api/alerts", "/api/connections", "/api/rules", "/api/join-offers"} {
			body := e.as(e.partner, "GET", path, "").body
			for _, leak := range []string{"Supermarkt", "Gezinsrekening", "94608", "Bert", "8642"} {
				if strings.Contains(body, leak) {
					t.Errorf("%s: %s shows %q: %s", where, path, leak, body)
				}
			}
		}
		expectError(t, e.as(e.partner, "GET", "/api/accounts/2/balances", ""), http.StatusNotFound, "not_found")
		if r := e.as(e.partner, "GET", "/api/transactions?account=2", ""); r.status != http.StatusNotFound &&
			(r.status != http.StatusOK || len(decode[ledger.Page](t, r.body).Items) != 0) {
			t.Errorf("%s: transactions of account 2: %d %s", where, r.status, r.body)
		}
		if n := e.count(`SELECT COUNT(*) FROM account_access WHERE account_id = 2`); n != 1 {
			t.Errorf("%s: %d members", where, n)
		}
	}
	before("offered")

	// A re-link refreshes the same offer.
	got = e.link(e.partner, `{"connectionId": 2}`)
	equalJSON(t, jsonBody(got.Offers), `[{"id": 1, "iban": "BE71 •••• •••• 6769", "bank": "Argenta"}]`)
	if n := e.count(`SELECT COUNT(*) FROM join_offers`); n != 1 {
		t.Errorf("%d offers after a re-link, want 1", n)
	}
	before("re-linked")

	// Nobody else can accept or decline it.
	expectError(t, e.as(e.bert, "POST", "/api/join-offers/1/accept", ""), http.StatusNotFound, "not_found")
	expectError(t, e.as(e.bert, "DELETE", "/api/join-offers/1", ""), http.StatusNotFound, "not_found")
	expectError(t, e.as(e.partner, "POST", "/api/join-offers/99/accept", ""), http.StatusNotFound, "not_found")
	// An offer bound to a connection that is not the viewer's is refused.
	e.exec(`INSERT INTO join_offers (id, user_id, connection_id, account_id, external_account_id, created_at)
		VALUES (7, ?, 1, 1, 'uid-1', '2026-11-18T19:00:00Z')`, e.partner)
	expectError(t, e.as(e.partner, "POST", "/api/join-offers/7/accept", ""), http.StatusBadRequest, "invalid")
	e.exec(`DELETE FROM join_offers WHERE id = 7`)

	// Expired and no longer active: 400, nothing changes.
	e.exec(`UPDATE join_offers SET created_at = '2026-11-17T18:59:59Z' WHERE id = 1`)
	if msg := expectError(t, e.as(e.partner, "POST", "/api/join-offers/1/accept", ""), http.StatusBadRequest, "invalid"); msg != "Koppel de rekening opnieuw om aan te sluiten." {
		t.Errorf("expired: %q", msg)
	}
	equalJSON(t, e.as(e.partner, "GET", "/api/join-offers", "").body, `[]`)
	e.exec(`UPDATE join_offers SET created_at = '2026-11-18T19:00:00Z' WHERE id = 1`)
	for _, set := range []string{`status = 'expired'`, `status = 'revoked'`, `valid_until = '2026-11-18T18:59:59Z'`} {
		e.exec(`UPDATE provider_connections SET ` + set + ` WHERE id = 2`)
		expectError(t, e.as(e.partner, "POST", "/api/join-offers/1/accept", ""), http.StatusBadRequest, "invalid")
		e.exec(`UPDATE provider_connections SET status = 'active', valid_until = '2027-05-17T10:00:00Z' WHERE id = 2`)
	}
	before("refused")

	// Accept.
	r = e.as(e.partner, "POST", "/api/join-offers/1/accept", "")
	if r.status != http.StatusOK {
		t.Fatalf("accept: %d %s", r.status, r.body)
	}
	joined := decode[struct {
		Account ledger.Account `json:"account"`
	}](t, r.body).Account
	if joined.ID != 2 || joined.Kind != "shared" || joined.Role != "member" || joined.Permission != "edit" || joined.ConvertibleRules != 0 {
		t.Errorf("joined account: %+v", joined)
	}
	expectError(t, e.as(e.partner, "POST", "/api/join-offers/1/accept", ""), http.StatusNotFound, "not_found")
	if n := e.count(`SELECT COUNT(*) FROM account_access WHERE account_id = 2 AND user_id = ? AND role = 'member' AND permission = 'edit'
		AND joined_at = '2026-11-18T19:00:00Z'`, e.partner); n != 1 {
		t.Errorf("Partner's access: %d", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM account_sources WHERE account_id = 2 AND connection_id = 2 AND priority = 'fallback' AND external_account_id = 'p-2'`); n != 1 {
		t.Errorf("fallback source: %d", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM join_offers`); n != 0 {
		t.Errorf("%d offers left", n)
	}
	e.assertInvariant()
	for _, u := range []int64{e.bert, e.partner} {
		a := decode[[]ledger.Account](t, e.as(u, "GET", "/api/accounts", "").body)
		i := slices.IndexFunc(a, func(a ledger.Account) bool { return a.ID == 2 })
		if i < 0 || a[i].Kind != "shared" || len(a[i].Members) != 2 {
			t.Errorf("user %d: account 2 is not shared: %+v", u, a)
		}
		if want := map[int64]int{e.bert: 1, e.partner: 0}[u]; i >= 0 && a[i].ConvertibleRules != want {
			t.Errorf("user %d: convertibleRules %d, want %d", u, a[i].ConvertibleRules, want)
		}
	}

	// The rule id of Bert's user rule is his: Partner sees the category, not the rule.
	for u, want := range map[int64]string{e.bert: fmt.Sprint(userRule), e.partner: "null"} {
		page := decode[ledger.Page](t, e.as(u, "GET", "/api/transactions?account=2", "").body)
		if len(page.Items) != 1 || page.Items[0].Category == nil || page.Items[0].CategoryOrigin == nil || *page.Items[0].CategoryOrigin != "rule" {
			t.Fatalf("user %d: %+v", u, page.Items)
		}
		if got := jsonBody(page.Items[0].RuleID); got != want {
			t.Errorf("user %d: ruleId %s, want %s", u, got, want)
		}
	}

	// Notices: the member notice for Bert only, the rules notice for the manager.
	equalJSON(t, jsonBody(e.alertsOf(e.bert, "member", "rules")), `[
		{"kind": "warn", "type": "rules", "title": "Je regels voor Gezinsrekening gelden niet meer",
		 "note": "Een regel van jezelf geldt alleen op een rekening met één lid · zet ze om naar regels van de rekening",
		 "href": "/rekeningen/2", "accountId": 2, "noticeId": 2},
		{"kind": "ok", "type": "member", "title": "Partner sluit aan bij Gezinsrekening",
		 "note": "Partner mag bewerken · ziet de geschiedenis van deze rekening, nooit je persoonlijke rekeningen",
		 "href": "/rekeningen/2", "accountId": 2, "noticeId": 1}]`)
	if a := e.alertsOf(e.partner, "member", "rules"); len(a) != 0 {
		t.Errorf("Partner's notices: %+v", a)
	}
	expectError(t, e.as(e.partner, "POST", "/api/notices/1/read", ""), http.StatusNotFound, "not_found")
	if r := e.as(e.bert, "POST", "/api/notices/1/read", ""); r.status != http.StatusNoContent {
		t.Fatalf("read: %d %s", r.status, r.body)
	}
	if r := e.as(e.bert, "POST", "/api/notices/1/read", ""); r.status != http.StatusNoContent {
		t.Errorf("read twice: %d %s", r.status, r.body)
	}
	if a := e.alertsOf(e.bert, "member", "rules"); len(a) != 1 || a[0].NoticeID != 2 {
		t.Errorf("after reading: %+v", a)
	}

	// The joiner's connection is not fetched for the fallback source (0.6-1d).
	e.bank.set(func(b *testBank) { b.fetched = nil })
	if r := e.as(e.partner, "POST", "/api/sync", ""); r.status != http.StatusAccepted && r.status != http.StatusOK {
		t.Fatalf("sync: %d %s", r.status, r.body)
	}
	e.bank.set(func(b *testBank) {
		if !slices.Equal(b.fetched, []string{"sess-partner/p-1"}) {
			t.Errorf("Partner's sync fetched %v, want only her own account", b.fetched)
		}
	})
	if a := e.alertsOf(e.bert, "sync"); len(a) != 0 {
		t.Errorf("a sync alert for Bert: %+v", a)
	}

	// Bert's user rule no longer categorises the shared account's new rows.
	e.bank.set(func(b *testBank) {
		// The test bank finds rows by the provider ids of its current list: Bert's again.
		b.accounts = append(b.accounts, bank.Account{ID: "uid-1", IBAN: ibanPersonal}, bank.Account{ID: "uid-2", IBAN: ibanShared})
		b.txs[ibanShared] = append(b.txs[ibanShared], bank.Transaction{EntryReference: "ref-10", BookingDate: "2026-11-18",
			Amount: -2500, CounterpartyName: "Supermarkt", Status: bank.StatusBooked})
	})
	if r := e.as(e.bert, "POST", "/api/sync", ""); r.status != http.StatusAccepted && r.status != http.StatusOK {
		t.Fatalf("Bert's sync: %d %s", r.status, r.body)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 2 AND booking_date = '2026-11-18' AND category_id IS NULL`); n != 1 {
		t.Errorf("the new row on the shared account: %d uncategorised, want 1", n)
	}

	// Converting the rules: manager only, shared only, idempotent.
	expectError(t, e.as(e.partner, "POST", "/api/accounts/2/convert-rules", ""), http.StatusForbidden, "forbidden")
	expectError(t, e.as(e.partner, "POST", "/api/accounts/1/convert-rules", ""), http.StatusNotFound, "not_found")
	expectError(t, e.as(e.partner, "POST", "/api/accounts/3/convert-rules", ""), http.StatusBadRequest, "invalid")
	equalJSON(t, e.as(e.bert, "POST", "/api/accounts/2/convert-rules", "").body, `{"converted": 1}`)
	equalJSON(t, e.as(e.bert, "POST", "/api/accounts/2/convert-rules", "").body, `{"converted": 0}`)
	if n := e.count(`SELECT COUNT(*) FROM rules WHERE account_id = 2 AND counterparty_match = 'Supermarkt' AND category_id = 50`); n != 1 {
		t.Errorf("%d account rules", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM rules WHERE id = ? AND user_id = ?`, userRule, e.bert); n != 1 {
		t.Error("Bert's user rule is gone")
	}
	if a, _ := e.accountOf(e.bert, 2); a.ConvertibleRules != 0 {
		t.Errorf("convertibleRules after converting: %d", a.ConvertibleRules)
	}
	// Applied, the account rule categorises the new row, and both see its id.
	if r := e.as(e.bert, "POST", "/api/rules/apply", ""); r.status != http.StatusOK {
		t.Fatalf("apply: %d %s", r.status, r.body)
	}
	accountRule := e.count(`SELECT id FROM rules WHERE account_id = 2`)
	for _, u := range []int64{e.bert, e.partner} {
		page := decode[ledger.Page](t, e.as(u, "GET", "/api/transactions?account=2", "").body)
		i := slices.IndexFunc(page.Items, func(x ledger.Transaction) bool { return x.BookingDate == "2026-11-18" })
		if i < 0 || page.Items[i].RuleID == nil || *page.Items[i].RuleID != int64(accountRule) {
			t.Errorf("user %d: the new row after converting: %+v", u, page.Items)
		}
	}
	e.assertInvariant()

	// Partner removes her link, also with "delete history": the shared account,
	// its history and Bert's access stay.
	if r := e.as(e.partner, "DELETE", "/api/connections/2?history=delete", ""); r.status != http.StatusOK && r.status != http.StatusNoContent {
		t.Fatalf("Partner removes her link: %d %s", r.status, r.body)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 2`); n != 2 {
		t.Errorf("shared history after Partner's removal: %d rows", n)
	}
	if a, ok := e.accountOf(e.bert, 2); !ok || a.Kind != "shared" || a.Role != "manager" {
		t.Errorf("Bert's account after Partner's removal: %+v", a)
	}
	e.assertInvariant()
}

// A manager who removes his link (keep history) after someone joined, and
// links again, feeds the account again: the member's fallback does not stop it.
func TestJoinManagerRelinks(t *testing.T) {
	e := joinSetup(t)
	e.link(e.partner, "")
	if r := e.as(e.partner, "POST", "/api/join-offers/1/accept", ""); r.status != http.StatusOK {
		t.Fatalf("accept: %d %s", r.status, r.body)
	}
	if r := e.as(e.bert, "DELETE", "/api/connections/1?history=keep", ""); r.status != http.StatusOK && r.status != http.StatusNoContent {
		t.Fatalf("Bert removes his link: %d %s", r.status, r.body)
	}
	e.assertInvariant()
	if n := e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 2`); n != 1 {
		t.Errorf("shared history after Bert's removal: %d rows", n)
	}
	e.saveCredentials(e.bert) // removing the link wiped them
	e.bank.set(func(b *testBank) {
		b.session = "sess-bert-2"
		b.accounts = []bank.Account{{ID: "b-2", IBAN: ibanShared, Name: "Gezinsrekening", Bank: "Argenta"}}
	})
	got := e.link(e.bert, "")
	if len(got.Skipped) != 0 || len(got.Offers) != 0 || !slices.Equal(accountIDs(got.Accounts), []int64{2}) {
		t.Errorf("Bert's re-link: %+v", got)
	}
	if n := e.count(`SELECT COUNT(*) FROM account_sources WHERE account_id = 2 AND priority = 'primary' AND external_account_id = 'b-2'`); n != 1 {
		t.Errorf("no primary source after the re-link: %d", n)
	}
	e.assertInvariant()
}

func (e *bankEnv) accountOf(user, id int64) (ledger.Account, bool) {
	e.t.Helper()
	for _, a := range decode[[]ledger.Account](e.t, e.as(user, "GET", "/api/accounts", "").body) {
		if a.ID == id {
			return a, true
		}
	}
	return ledger.Account{}, false
}

func TestJoinDeclineAndNoRulesNotice(t *testing.T) {
	e := joinSetup(t)
	e.link(e.partner, "")
	if r := e.as(e.partner, "DELETE", "/api/join-offers/1", ""); r.status != http.StatusNoContent {
		t.Fatalf("decline: %d %s", r.status, r.body)
	}
	expectError(t, e.as(e.partner, "DELETE", "/api/join-offers/1", ""), http.StatusNotFound, "not_found")
	expectError(t, e.as(e.partner, "POST", "/api/join-offers/1/accept", ""), http.StatusNotFound, "not_found")
	equalJSON(t, e.as(e.partner, "GET", "/api/join-offers", "").body, `[]`)
	if _, ok := e.accountOf(e.partner, 2); ok {
		t.Error("a declined offer gave access")
	}

	// Linking again offers it again; without user rules Bert only gets the member notice.
	got := e.link(e.partner, `{"connectionId": 2}`)
	if len(got.Offers) != 1 {
		t.Fatalf("offers: %+v", got.Offers)
	}
	if r := e.as(e.partner, "POST", fmt.Sprintf("/api/join-offers/%d/accept", got.Offers[0].ID), ""); r.status != http.StatusOK {
		t.Fatalf("accept: %d %s", r.status, r.body)
	}
	if a := e.alertsOf(e.bert, "member", "rules"); len(a) != 1 || a[0].Type != "member" {
		t.Errorf("Bert's notices: %+v", a)
	}
	if a, _ := e.accountOf(e.bert, 2); a.ConvertibleRules != 0 || a.Kind != "shared" {
		t.Errorf("Bert's account: %+v", a)
	}
	e.assertInvariant()

	// Partner linking again is a re-authorisation of her fallback source, no offer.
	got = e.link(e.partner, `{"connectionId": 2}`)
	if len(got.Offers) != 0 || len(got.Skipped) != 0 || !slices.Contains(accountIDs(got.Accounts), 2) {
		t.Errorf("re-link after joining: %+v", got)
	}
}

func (e *bankEnv) exec(q string, args ...any) {
	e.t.Helper()
	if _, err := e.db.Exec(q, args...); err != nil {
		e.t.Fatalf("%s: %v", q, err)
	}
}
