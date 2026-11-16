package server

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Lifecycle (0.6-1c): leave, delete a shared account, remove a link, delete a
// user. The demo pair: Bert (admin) holds 1 (bank), 2 and 3 (manual) and
// manages the shared bank account 4 (his connection 1 is its primary);
// Partner holds 5 (bank) and is a member of 4 (her connection 2, fallback).

// as is a handler acting as any user of the pair's database.
func (p *pair) as(user int64) http.Handler {
	return New(Options{DB: p.db, Version: "test", Demo: true, Clock: demoClock,
		Viewer: func(*http.Request) (int64, bool) { return user, true }})
}

// third adds user 3, Derde, a member of the shared account 4 who joined
// before Partner (but has a higher id), so joined_at and user id disagree.
func (p *pair) third(role, permission string) http.Handler {
	p.exec(`INSERT INTO users (id, email, display_name, role) VALUES (3, 'derde@example.com', 'Derde', ?)`, role)
	p.exec(`INSERT INTO account_access (account_id, user_id, role, permission, joined_at) VALUES (4, 3, 'member', ?, '2026-06-04T12:00:00Z')`, permission)
	return p.as(3)
}

// text is the single value of a query, as text ("" for NULL).
func (p *pair) text(q string, args ...any) string {
	p.t.Helper()
	var v sql.NullString
	if err := p.db.QueryRow(q, args...).Scan(&v); err != nil {
		p.t.Fatalf("%s: %v", q, err)
	}
	return v.String
}

// noticeAlerts are a user's alerts that come from stored notices.
func noticeAlerts(t *testing.T, h http.Handler) []ledger.Alert {
	t.Helper()
	var out []ledger.Alert
	for _, a := range decode[[]ledger.Alert](t, do(t, h, "GET", "/api/alerts", "").body) {
		if a.NoticeID != 0 {
			a.NoticeID = 0
			out = append(out, a)
		}
	}
	return out
}

func sameAlerts(t *testing.T, who string, got []ledger.Alert, want ...ledger.Alert) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%s: %d notices %+v, want %+v", who, len(got), got, want)
		return
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("%s notice %d: %+v, want %+v", who, i, got[i], want[i])
		}
	}
}

func leftAlert(actor string) ledger.Alert {
	return ledger.Alert{Kind: "ok", Type: "left", Title: actor + " heeft Gedeelde rekening verlaten",
		Note: actor + " ziet deze rekening niet meer", Href: "/rekeningen/4", AccountID: 4}
}

func TestLeaveAsMember(t *testing.T) {
	p := newPair(t)
	before := map[string]int{
		"transactions": p.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 4`),
		"partner":      p.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 5`),
	}
	r := p.partner("POST", "/api/accounts/4/leave", "")
	if r.status != http.StatusOK {
		t.Fatalf("leave: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"handedOverTo": null}`)
	p.assertInvariant()

	// Partner sees nothing of the account any more; her own account and link stay.
	expectError(t, p.partner("GET", "/api/accounts/4/balances", ""), http.StatusNotFound, "not_found")
	expectError(t, p.partner("GET", "/api/transactions?account=4", ""), http.StatusNotFound, "not_found")
	ids := []int64{}
	for _, a := range decode[[]ledger.Account](t, p.partner("GET", "/api/accounts", "").body) {
		ids = append(ids, a.ID)
	}
	if len(ids) != 1 || ids[0] != 5 {
		t.Errorf("Partner's accounts: %v", ids)
	}
	if page := decode[ledger.Page](t, p.partner("GET", "/api/transactions", "").body); len(page.Items) == 0 {
		t.Error("Partner lost her own transactions")
	} else {
		for _, x := range page.Items {
			if x.AccountID != 5 {
				t.Errorf("Partner still sees a row of account %d", x.AccountID)
			}
		}
	}
	if n := p.count(`SELECT COUNT(*) FROM provider_connections WHERE id = 2 AND status = 'active'`); n != 1 {
		t.Error("Partner's connection changed")
	}
	if got := p.text(`SELECT group_concat(account_id || ':' || connection_id || ':' || priority, ' ') FROM (SELECT * FROM account_sources ORDER BY account_id, connection_id)`); got != "1:1:primary 4:1:primary 5:2:primary" {
		t.Errorf("sources: %s", got)
	}
	if n := p.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 4`); n != before["transactions"] {
		t.Errorf("the shared history changed: %d of %d", n, before["transactions"])
	}
	if n := p.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 5`); n != before["partner"] {
		t.Errorf("Partner's history changed: %d of %d", n, before["partner"])
	}
	sameAlerts(t, "Bert", noticeAlerts(t, p.bertH), leftAlert("Partner"))
	sameAlerts(t, "Partner", noticeAlerts(t, p.partnerH))
	if n := p.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'account_left' AND user_id = 2 AND detail = 'account=4'`); n != 1 {
		t.Errorf("%d audit lines", n)
	}

	// Again: no access. Bert is now the last member and cannot leave.
	snap := p.snapshot()
	expectError(t, p.partner("POST", "/api/accounts/4/leave", ""), http.StatusNotFound, "not_found")
	if msg := expectError(t, p.bert("POST", "/api/accounts/4/leave", ""), http.StatusBadRequest, "invalid"); msg != "Je bent het laatste lid. Verwijder de rekening of haal je koppeling weg." {
		t.Errorf("last member: %q", msg)
	}
	expectError(t, p.bert("POST", "/api/accounts/1/leave", ""), http.StatusBadRequest, "invalid")
	expectError(t, p.bert("POST", "/api/accounts/5/leave", ""), http.StatusNotFound, "not_found")
	expectError(t, p.bert("POST", "/api/accounts/999/leave", ""), http.StatusNotFound, "not_found")
	expectError(t, p.bert("POST", "/api/accounts/abc/leave", ""), http.StatusNotFound, "not_found")
	if p.snapshot() != snap {
		t.Error("a refused leave wrote")
	}
	p.assertInvariant()
}

func TestLeaveAsManagerHandsOver(t *testing.T) {
	p := newPair(t)
	derde := p.third("user", "read") // read-only: the new manager must get edit
	r := p.bert("POST", "/api/accounts/4/leave", "")
	if r.status != http.StatusOK {
		t.Fatalf("leave: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"handedOverTo": {"userId": 3, "name": "Derde"}}`)
	p.assertInvariant()
	if got := p.text(`SELECT group_concat(user_id || ':' || role || ':' || permission, ' ') FROM (SELECT * FROM account_access WHERE account_id = 4 ORDER BY user_id)`); got != "2:member:edit 3:manager:edit" {
		t.Errorf("access: %s", got)
	}
	// Bert's link was the primary: Partner's fallback takes over.
	if got := p.text(`SELECT group_concat(connection_id || ':' || priority, ' ') FROM account_sources WHERE account_id = 4`); got != "2:primary" {
		t.Errorf("sources of 4: %s", got)
	}
	// Bert keeps his link and his other accounts.
	if got := p.text(`SELECT group_concat(account_id, ' ') FROM (SELECT account_id FROM account_access WHERE user_id = 1 ORDER BY account_id)`); got != "1 2 3" {
		t.Errorf("Bert's accounts: %s", got)
	}
	if p.count(`SELECT COUNT(*) FROM account_sources WHERE connection_id = 1 AND account_id = 1 AND priority = 'primary'`) != 1 ||
		p.count(`SELECT COUNT(*) FROM provider_connections WHERE id = 1 AND status = 'active'`) != 1 {
		t.Error("Bert's link lost its other account")
	}
	for _, path := range []string{"/api/accounts/4/balances", "/api/transactions?account=4"} {
		expectError(t, p.bert("GET", path, ""), http.StatusNotFound, "not_found")
	}
	expectError(t, p.bert("PATCH", "/api/accounts/4", `{"name": "x"}`), http.StatusNotFound, "not_found")

	sameAlerts(t, "Partner", noticeAlerts(t, p.partnerH), leftAlert("Bert"))
	sameAlerts(t, "Derde", noticeAlerts(t, derde), leftAlert("Bert"), ledger.Alert{Kind: "ok", Type: "manager",
		Title: "Je bent nu beheerder van Gedeelde rekening", Note: "De beheerder beslist wie de rekening mag bewerken",
		Href: "/rekeningen/4", AccountID: 4})
	sameAlerts(t, "Bert", noticeAlerts(t, p.bertH))
	if n := p.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'account_left' AND user_id = 1 AND detail = 'account=4 manager=3'`); n != 1 {
		t.Errorf("%d audit lines", n)
	}

	// The new manager manages: Partner to read-only.
	if r := do(t, derde, "PATCH", "/api/accounts/4/members/2", `{"permission": "read"}`); r.status != http.StatusOK {
		t.Errorf("the new manager: %d %s", r.status, r.body)
	}
	p.assertInvariant()
}

func TestDeleteSharedAccount(t *testing.T) {
	p := newPair(t)
	split := p.addRow(4, "Proef Gesplitst", -2000, "booked", nil, nil)
	p.tx(p.bert, "PUT", txPath(split, "/split"), `{"parts":[{"categoryId":3,"amount":-1000},{"categoryId":6,"amount":-1000}]}`)
	p.exec(`INSERT INTO account_notices (user_id, account_id, type, actor_id, created_at) VALUES (1, 4, 'member', 2, '2026-11-18T19:00:00Z')`)
	others := p.count(`SELECT COUNT(*) FROM transactions WHERE account_id <> 4`)
	otherBalances := p.count(`SELECT COUNT(*) FROM balance_snapshots WHERE account_id <> 4`)
	if p.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 4`) == 0 || p.count(`SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 4`) == 0 {
		t.Fatal("the shared account has no history to delete")
	}

	snap := p.snapshot()
	expectError(t, p.partner("DELETE", "/api/accounts/4?confirm=Gedeelde+rekening", ""), http.StatusForbidden, "forbidden")
	expectError(t, p.partner("DELETE", "/api/accounts/1?confirm=Zichtrekening", ""), http.StatusNotFound, "not_found")
	for _, q := range []string{"", "?confirm=", "?confirm=Gedeelde", "?confirm=Gedeelde+rekeningen"} {
		if msg := expectError(t, p.bert("DELETE", "/api/accounts/4"+q, ""), http.StatusBadRequest, "invalid"); msg != "Typ de naam van de rekening om te bevestigen." {
			t.Errorf("%q: %q", q, msg)
		}
	}
	if p.snapshot() != snap {
		t.Error("a refused delete wrote")
	}

	if r := p.bert("DELETE", "/api/accounts/4?confirm="+url.QueryEscape("  gedeelde REKENING "), ""); r.status != http.StatusNoContent {
		t.Fatalf("delete: %d %s", r.status, r.body)
	}
	p.assertInvariant()
	for what, q := range map[string]string{
		"accounts":        `SELECT COUNT(*) FROM accounts WHERE id = 4`,
		"transactions":    `SELECT COUNT(*) FROM transactions WHERE account_id = 4`,
		"splits":          `SELECT COUNT(*) FROM transaction_splits WHERE transaction_id NOT IN (SELECT id FROM transactions)`,
		"split of 4":      `SELECT COUNT(*) FROM transaction_splits WHERE transaction_id = ` + p.text(`SELECT ?`, split),
		"balances":        `SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 4`,
		"sources":         `SELECT COUNT(*) FROM account_sources WHERE account_id = 4`,
		"access":          `SELECT COUNT(*) FROM account_access WHERE account_id = 4`,
		"offers":          `SELECT COUNT(*) FROM join_offers WHERE account_id = 4`,
		"notices":         `SELECT COUNT(*) FROM account_notices WHERE account_id = 4`,
		"orphan notices":  `SELECT COUNT(*) FROM account_notices WHERE account_id IS NULL AND type <> 'deleted'`,
		"rules of 4":      `SELECT COUNT(*) FROM rules WHERE account_id = 4`,
		"imports":         `SELECT COUNT(*) FROM import_batches WHERE account_id = 4`,
		"recurring items": `SELECT COUNT(*) FROM recurring_items WHERE account_id = 4`,
	} {
		if n := p.count(q); n != 0 {
			t.Errorf("%s: %d rows left", what, n)
		}
	}
	if n := p.count(`SELECT COUNT(*) FROM transactions`); n != others {
		t.Errorf("other accounts' transactions: %d, want %d", n, others)
	}
	if n := p.count(`SELECT COUNT(*) FROM balance_snapshots`); n != otherBalances {
		t.Errorf("other accounts' balances: %d, want %d", n, otherBalances)
	}
	// Both links stay with their other accounts.
	if got := p.text(`SELECT group_concat(account_id || ':' || connection_id, ' ') FROM (SELECT * FROM account_sources ORDER BY account_id)`); got != "1:1 5:2" {
		t.Errorf("sources: %s", got)
	}
	if n := p.count(`SELECT COUNT(*) FROM provider_connections WHERE status = 'active'`); n != 2 {
		t.Errorf("%d active links, want 2", n)
	}
	// Partner is told, by a notice that outlives the account; Bert is not.
	deleted := ledger.Alert{Kind: "warn", Type: "deleted", Title: "Bert heeft Gedeelde rekening verwijderd",
		Note: "De rekening en haar geschiedenis zijn voor alle leden weg · je koppeling en je andere rekeningen blijven", Href: "/rekeningen"}
	sameAlerts(t, "Partner", noticeAlerts(t, p.partnerH), deleted)
	sameAlerts(t, "Bert", noticeAlerts(t, p.bertH))
	if !strings.Contains(p.partner("GET", "/api/alerts", "").body, `"type":"deleted"`) || strings.Contains(p.partner("GET", "/api/alerts", "").body, `"accountId":4`) {
		t.Errorf("the deleted alert: %s", p.partner("GET", "/api/alerts", "").body)
	}
	id := p.text(`SELECT id FROM account_notices WHERE type = 'deleted'`)
	if r := p.partner("POST", "/api/notices/"+id+"/read", ""); r.status != http.StatusNoContent && r.status != http.StatusOK {
		t.Errorf("dismiss: %d %s", r.status, r.body)
	}
	sameAlerts(t, "Partner after dismissing", noticeAlerts(t, p.partnerH))
	expectError(t, p.bert("DELETE", "/api/accounts/4?confirm=Gedeelde+rekening", ""), http.StatusNotFound, "not_found")
	if n := p.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'account_deleted' AND user_id = 1 AND detail = 'account=4'`); n != 1 {
		t.Errorf("%d audit lines", n)
	}
	p.assertInvariant()
}

// One member: a manual account goes without confirmation as before; a bank
// account still goes through its link.
func TestDeleteSingleMemberAccount(t *testing.T) {
	p := newPair(t)
	if msg := expectError(t, p.bert("DELETE", "/api/accounts/1?confirm=Zichtrekening", ""), http.StatusBadRequest, "invalid"); msg != "Een bankrekening verwijder je door haar koppeling te verwijderen." {
		t.Errorf("bank account: %q", msg)
	}
	if r := p.bert("DELETE", "/api/accounts/3", ""); r.status != http.StatusNoContent {
		t.Fatalf("delete: %d %s", r.status, r.body)
	}
	if p.count(`SELECT COUNT(*) FROM accounts WHERE id = 3`)+p.count(`SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 3`) != 0 {
		t.Error("the account or its balances are still there")
	}
	if n := p.count(`SELECT COUNT(*) FROM account_notices`); n != 0 {
		t.Errorf("%d notices for a personal account", n)
	}
	p.assertInvariant()
}

// Removing the manager's link: the shared account is kept (never deleted by
// one member's removal, even with "delete history") and Partner's fallback
// becomes its primary; Bert's personal bank account goes.
func TestRemoveLinkPromotesFallback(t *testing.T) {
	for _, history := range []string{"keep", "delete"} {
		t.Run(history, func(t *testing.T) {
			p := newPair(t)
			p.exec(`UPDATE transactions SET source_connection_id = 1 WHERE id = ?`, p.addRow(4, "Proef Wachtend", -900, "pending", nil, nil))
			shared := p.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 4`)
			r := p.bert("DELETE", "/api/connections/1?history="+history, "")
			if r.status != http.StatusOK {
				t.Fatalf("remove: %d %s", r.status, r.body)
			}
			if history == "keep" {
				equalJSON(t, r.body, `{"deleted": [], "kept": [1, 4]}`)
			} else {
				equalJSON(t, r.body, `{"deleted": [1], "kept": [4]}`)
			}
			if got := p.text(`SELECT group_concat(account_id || ':' || connection_id || ':' || priority, ' ') FROM (SELECT * FROM account_sources ORDER BY account_id)`); got != "4:2:primary 5:2:primary" {
				t.Errorf("sources: %s", got)
			}
			if n := p.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 4`); n != shared {
				t.Errorf("the shared history: %d of %d", n, shared)
			}
			// The pending rows follow the promoted source (only it may replace them).
			if got := p.text(`SELECT group_concat(DISTINCT COALESCE(source_connection_id, 0)) FROM transactions WHERE account_id = 4 AND status = 'pending'`); got != "2" {
				t.Errorf("pending rows' source: %q", got)
			}
			if got := p.text(`SELECT group_concat(user_id || ':' || role, ' ') FROM (SELECT * FROM account_access WHERE account_id = 4 ORDER BY user_id)`); got != "1:manager 2:member" {
				t.Errorf("access: %s", got)
			}
			p.assertInvariant()
		})
	}
	// Partner removes hers: her fallback goes, Bert's primary stays.
	p := newPair(t)
	if r := p.partner("DELETE", "/api/connections/2?history=delete", ""); r.status != http.StatusOK {
		t.Fatalf("Partner removes: %d %s", r.status, r.body)
	}
	if got := p.text(`SELECT group_concat(account_id || ':' || connection_id || ':' || priority, ' ') FROM (SELECT * FROM account_sources ORDER BY account_id)`); got != "1:1:primary 4:1:primary" {
		t.Errorf("sources: %s", got)
	}
	if p.count(`SELECT COUNT(*) FROM accounts WHERE id IN (4, 5)`) != 1 {
		t.Error("want 4 kept and 5 deleted")
	}
	p.assertInvariant()
}

// usersRefs counts the rows of every table whose foreign key to users names id.
func (p *pair) usersRefs(id int64) map[string]int {
	p.t.Helper()
	out := map[string]int{}
	for _, table := range strings.Fields(p.text(`SELECT group_concat(name, ' ') FROM sqlite_master WHERE type = 'table'`)) {
		rows, err := p.db.Query(`SELECT "table", "from" FROM pragma_foreign_key_list(?)`, table)
		if err != nil {
			p.t.Fatal(err)
		}
		var cols []string
		for rows.Next() {
			var ref, col string
			if err := rows.Scan(&ref, &col); err != nil {
				p.t.Fatal(err)
			}
			if ref == "users" {
				cols = append(cols, col)
			}
		}
		rows.Close()
		for _, col := range cols {
			if n := p.count(`SELECT COUNT(*) FROM "`+table+`" WHERE "`+col+`" = ?`, id); n != 0 {
				out[table+"."+col] = n
			}
		}
	}
	return out
}

func TestDeleteUser(t *testing.T) {
	p := newPair(t)
	// Partner's traces everywhere: an offer, an audit line, a rule, a notice.
	p.exec(`INSERT INTO join_offers (user_id, connection_id, account_id, external_account_id, created_at) VALUES (2, 2, 1, 'x', '2026-11-18T10:00:00Z')`)
	p.exec(`INSERT INTO audit_log (event, user_id) VALUES ('login_ok', 2)`)
	p.exec(`INSERT INTO account_notices (user_id, account_id, type, actor_id, created_at) VALUES (1, 4, 'member', 2, '2026-11-18T19:00:00Z')`)
	if len(p.usersRefs(2)) == 0 {
		t.Fatal("Partner has no rows to remove")
	}
	bertTx := p.count(`SELECT COUNT(*) FROM transactions WHERE account_id IN (1, 4)`)

	// Refused: a non-admin, yourself, an unknown user. Nothing changes.
	snap := p.snapshot()
	for _, method := range []string{"GET", "DELETE"} {
		path := func(id string) string {
			if method == "GET" {
				return "/api/users/" + id + "/removal-preview"
			}
			return "/api/users/" + id
		}
		if msg := expectError(t, p.partner(method, path("1"), ""), http.StatusForbidden, "forbidden"); msg != "Alleen een beheerder kan gebruikers beheren." {
			t.Errorf("%s non-admin: %q", method, msg)
		}
		if msg := expectError(t, p.bert(method, path("1"), ""), http.StatusBadRequest, "invalid"); msg != "Je kunt jezelf niet verwijderen." {
			t.Errorf("%s self: %q", method, msg)
		}
		for _, id := range []string{"999", "0", "abc"} {
			if msg := expectError(t, p.bert(method, path(id), ""), http.StatusNotFound, "not_found"); msg != "Gebruiker niet gevonden." {
				t.Errorf("%s %s: %q", method, id, msg)
			}
		}
	}

	// The preview changes nothing and says what the delete does.
	r := p.bert("GET", "/api/users/2/removal-preview", "")
	if r.status != http.StatusOK {
		t.Fatalf("preview: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"deletedAccounts": 1, "leftAccounts": 1, "connections": 1}`)
	if p.snapshot() != snap {
		t.Error("a refused call or the preview wrote")
	}

	if r := p.bert("DELETE", "/api/users/2", ""); r.status != http.StatusNoContent {
		t.Fatalf("delete: %d %s", r.status, r.body)
	}
	p.assertInvariant()
	if refs := p.usersRefs(2); len(refs) != 0 {
		t.Errorf("rows still point at the deleted user: %v", refs)
	}
	for what, q := range map[string]string{
		"user":         `SELECT COUNT(*) FROM users WHERE id = 2`,
		"account 5":    `SELECT COUNT(*) FROM accounts WHERE id = 5`,
		"history of 5": `SELECT COUNT(*) FROM transactions WHERE account_id = 5`,
		"balances 5":   `SELECT COUNT(*) FROM balance_snapshots WHERE account_id = 5`,
		"connection":   `SELECT COUNT(*) FROM provider_connections WHERE id = 2 OR session_id_enc IS NULL AND user_id = 2`,
		"offers":       `SELECT COUNT(*) FROM join_offers`,
		"sources of 2": `SELECT COUNT(*) FROM account_sources WHERE connection_id = 2`,
	} {
		if n := p.count(q); n != 0 {
			t.Errorf("%s: %d rows left", what, n)
		}
	}
	if got := p.text(`SELECT group_concat(account_id || ':' || user_id || ':' || role, ' ') FROM (SELECT * FROM account_access ORDER BY account_id)`); got != "1:1:manager 2:1:manager 3:1:manager 4:1:manager" {
		t.Errorf("access: %s", got)
	}
	if n := p.count(`SELECT COUNT(*) FROM transactions WHERE account_id IN (1, 4)`); n != bertTx {
		t.Errorf("Bert's history: %d of %d", n, bertTx)
	}
	// The audit lines survive: the new one names the admin, the old one lost its user.
	if n := p.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'user_deleted' AND user_id = 1 AND detail = 'user=2 deleted=1 left=1 connections=1'`); n != 1 {
		t.Errorf("%d audit lines for the delete", n)
	}
	if n := p.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'login_ok' AND user_id IS NULL`); n != 1 {
		t.Errorf("the old audit line: %d", n)
	}
	// Bert hears that Partner left, by name although she is gone.
	sameAlerts(t, "Bert", noticeAlerts(t, p.bertH), leftAlert("Partner"))
	expectError(t, p.bert("DELETE", "/api/users/2", ""), http.StatusNotFound, "not_found")
	if n := p.count(`SELECT COUNT(*) FROM pragma_foreign_key_check`); n != 0 {
		t.Errorf("%d foreign key violations", n)
	}
}

// Bert manages the shared account and holds three personal ones: deleting
// him (by a second admin) hands the shared account to Partner, whose fallback
// becomes primary; deleting Partner afterwards deletes it, she being its last
// member.
func TestDeleteUserWhoManagesAndHoldsAlone(t *testing.T) {
	p := newPair(t)
	p.exec(`INSERT INTO users (id, email, display_name, role) VALUES (3, 'derde@example.com', 'Derde', 'admin')`)
	admin := p.as(3)
	r := do(t, admin, "GET", "/api/users/1/removal-preview", "")
	if r.status != http.StatusOK {
		t.Fatalf("preview: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"deletedAccounts": 3, "leftAccounts": 1, "connections": 1}`)
	if r := do(t, admin, "DELETE", "/api/users/1", ""); r.status != http.StatusNoContent {
		t.Fatalf("delete: %d %s", r.status, r.body)
	}
	p.assertInvariant()
	if refs := p.usersRefs(1); len(refs) != 0 {
		t.Errorf("rows still point at the deleted user: %v", refs)
	}
	if got := p.text(`SELECT group_concat(id, ' ') FROM (SELECT id FROM accounts ORDER BY id)`); got != "4 5" {
		t.Errorf("accounts left: %s", got)
	}
	if got := p.text(`SELECT group_concat(account_id || ':' || user_id || ':' || role || ':' || permission, ' ') FROM (SELECT * FROM account_access ORDER BY account_id)`); got != "4:2:manager:edit 5:2:manager:edit" {
		t.Errorf("access: %s", got)
	}
	if got := p.text(`SELECT group_concat(account_id || ':' || connection_id || ':' || priority, ' ') FROM (SELECT * FROM account_sources ORDER BY account_id)`); got != "4:2:primary 5:2:primary" {
		t.Errorf("sources: %s", got)
	}
	if n := p.count(`SELECT COUNT(*) FROM transactions WHERE account_id IN (1, 2, 3)`) + p.count(`SELECT COUNT(*) FROM balance_snapshots WHERE account_id IN (1, 2, 3)`); n != 0 {
		t.Errorf("%d rows of Bert's personal accounts left", n)
	}
	sameAlerts(t, "Partner", noticeAlerts(t, p.partnerH), leftAlert("Bert"), ledger.Alert{Kind: "ok", Type: "manager",
		Title: "Je bent nu beheerder van Gedeelde rekening", Note: "De beheerder beslist wie de rekening mag bewerken",
		Href: "/rekeningen/4", AccountID: 4})

	// Partner is now the last member of the shared account: it goes with her.
	r = do(t, admin, "GET", "/api/users/2/removal-preview", "")
	equalJSON(t, r.body, `{"deletedAccounts": 2, "leftAccounts": 0, "connections": 1}`)
	if r := do(t, admin, "DELETE", "/api/users/2", ""); r.status != http.StatusNoContent {
		t.Fatalf("delete Partner: %d %s", r.status, r.body)
	}
	for _, table := range []string{"accounts", "account_access", "account_sources", "transactions", "balance_snapshots", "account_notices", "provider_connections"} {
		if n := p.count(`SELECT COUNT(*) FROM ` + table); n != 0 {
			t.Errorf("%s: %d rows left", table, n)
		}
	}
	p.assertInvariant()
}

// The last admin cannot be deleted. Over HTTP the caller is an admin other
// than the target, so the guard is reached only from the store.
func TestDeleteLastAdmin(t *testing.T) {
	p := newPair(t)
	store := ledger.New(p.db)
	snap := p.snapshot()
	_, err := store.RemoveUser(context.Background(), 2, 1, demoClock.Now(), true)
	var invalid *apperr.InvalidError
	if !errors.As(err, &invalid) || invalid.Message != "Je kunt de laatste beheerder niet verwijderen." {
		t.Errorf("last admin: %v", err)
	}
	if p.snapshot() != snap {
		t.Error("the refused delete wrote")
	}
	p.assertInvariant()
}
