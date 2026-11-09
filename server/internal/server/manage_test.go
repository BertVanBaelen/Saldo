package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

func TestManualAccounts(t *testing.T) {
	e := newBankEnv(t)
	r := e.as(e.bert, "POST", "/api/accounts", `{"name":" Spaarpot ","type":"savings","colour":"orange","iban":"be83 3630 1234 5615","balance":1250000}`)
	if r.status != http.StatusCreated {
		t.Fatalf("create: %d %s", r.status, r.body)
	}
	a := decode[ledger.Account](t, r.body)
	equalJSON(t, r.body, `{"id": `+strconv.FormatInt(a.ID, 10)+`, "name": "Spaarpot", "type": "savings", "source": "manual", "kind": "personal",
		"iban": "BE83 •••• •••• 5615", "colour": "orange", "buffer": 0, "balance": 1250000, "balanceDate": "2026-11-18",
		"state": null, "bank": null, "lastSync": null, "syncStatus": null, "permission": "edit", "role": "manager", "members": []}`)
	path := "/api/accounts/" + strconv.FormatInt(a.ID, 10)

	// A current account without a link: buffer and state, no balance yet.
	r = e.as(e.bert, "POST", "/api/accounts", `{"name":"Contant","type":"current","buffer":50000}`)
	if r.status != http.StatusCreated {
		t.Fatalf("create current: %d %s", r.status, r.body)
	}
	cur := decode[ledger.Account](t, r.body)
	if cur.Colour != "green" || cur.Buffer != 50000 || cur.BalanceDate != nil || cur.IBAN != nil || cur.State == nil || *cur.State != "buffer" {
		t.Errorf("current manual account: %+v", cur)
	}

	for _, body := range []string{
		`{"name":"","type":"savings"}`,
		`{"name":"X","type":"investment"}`,
		`{"name":"X","type":"savings","buffer":10000}`,
		`{"name":"X","type":"current","buffer":12345}`,
		`{"name":"X","type":"savings","colour":"red"}`,
		`{"name":"X","type":"savings","iban":"BE00 1234"}`,
		`{"name":"X","type":"savings","iban":"BE68539007547035"}`,
		`{"name":"X","type":"savings","balance":100000000000000}`,
		`{"name":"X","type":"savings","source":"bank"}`,
	} {
		expectError(t, e.as(e.bert, "POST", "/api/accounts", body), http.StatusBadRequest, "invalid")
	}

	// The balance by hand: one row per day, a later update of the day replaces it.
	for _, body := range []string{`{"balance":1260000}`, `{"balance":1270000}`, `{"balance":1200000,"date":"2026-10-02"}`} {
		if r := e.as(e.bert, "PUT", path+"/balance", body); r.status != 200 {
			t.Fatalf("balance %s: %d %s", body, r.status, r.body)
		}
	}
	a = decode[ledger.Account](t, e.as(e.bert, "PUT", path+"/balance", `{"balance":1275000,"date":"2026-11-18"}`).body)
	if a.Balance != 1275000 || *a.BalanceDate != "2026-11-18" {
		t.Errorf("after the update: %d on %v", a.Balance, a.BalanceDate)
	}
	equalJSON(t, e.as(e.bert, "GET", path+"/balances", "").body, `[
		{"date": "2026-10-02", "balance": 1200000, "origin": "manual"},
		{"date": "2026-11-18", "balance": 1275000, "origin": "manual"}]`)
	expectError(t, e.as(e.bert, "PUT", path+"/balance", `{"balance":1,"date":"2026-11-19"}`), http.StatusBadRequest, "invalid")
	expectError(t, e.as(e.bert, "PUT", path+"/balance", `{"balance":1,"date":"18-11-2026"}`), http.StatusBadRequest, "invalid")
	expectError(t, e.as(e.bert, "PUT", path+"/balance", `{"date":"2026-11-18"}`), http.StatusBadRequest, "invalid")
	if r := e.as(e.bert, "GET", "/api/accounts/"+strconv.FormatInt(cur.ID, 10)+"/balances", ""); r.body != "[]\n" {
		t.Errorf("no history is an empty list: %q", r.body)
	}

	// The IBAN of a manual account can change or go.
	a = decode[ledger.Account](t, e.as(e.bert, "PATCH", path, `{"iban":""}`).body)
	if a.IBAN != nil {
		t.Errorf("IBAN not removed: %v", *a.IBAN)
	}
	expectError(t, e.as(e.bert, "PATCH", path, `{"iban":"nonsense"}`), http.StatusBadRequest, "invalid")

	// Bank accounts: balance from the bank, IBAN from the bank, removed via the link.
	e.saveCredentials(e.bert)
	linked := e.link(e.bert, "")
	bankPath := "/api/accounts/" + strconv.FormatInt(linked.Accounts[0].ID, 10)
	expectError(t, e.as(e.bert, "PUT", bankPath+"/balance", `{"balance":1}`), http.StatusBadRequest, "invalid")
	expectError(t, e.as(e.bert, "PATCH", bankPath, `{"iban":"BE83363012345615"}`), http.StatusBadRequest, "invalid")
	expectError(t, e.as(e.bert, "DELETE", bankPath, ""), http.StatusBadRequest, "invalid")
	if hist := decode[[]ledger.Balance](t, e.as(e.bert, "GET", bankPath+"/balances", "").body); len(hist) != 1 || hist[0].Origin != "bank" {
		t.Errorf("bank history: %+v", hist)
	}

	// A member who is not the manager cannot write (manual accounts are private
	// in v1; this guards the rule).
	if _, err := e.db.Exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, ?, 'member', 'read')`, a.ID, e.partner); err != nil {
		t.Fatal(err)
	}
	expectError(t, e.as(e.partner, "PUT", path+"/balance", `{"balance":1}`), http.StatusForbidden, "forbidden")
	expectError(t, e.as(e.partner, "DELETE", path, ""), http.StatusForbidden, "forbidden")
	if _, err := e.db.Exec(`DELETE FROM account_access WHERE user_id = ?`, e.partner); err != nil {
		t.Fatal(err)
	}

	// Deleting takes the history with it.
	if r := e.as(e.bert, "DELETE", path, ""); r.status != http.StatusNoContent {
		t.Fatalf("delete: %d %s", r.status, r.body)
	}
	if e.count(`SELECT COUNT(*) FROM balance_snapshots WHERE account_id = ?`, a.ID)+e.count(`SELECT COUNT(*) FROM accounts WHERE id = ?`, a.ID) != 0 {
		t.Error("the deleted account or its history is still there")
	}
	expectError(t, e.as(e.bert, "DELETE", path, ""), http.StatusNotFound, "not_found")
	if e.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'account_deleted' AND user_id = ?`, e.bert) != 1 {
		t.Error("no audit line")
	}
}

// accountsOf lists the viewer's accounts by id.
func (e *bankEnv) accountsOf(user int64) map[int64]ledger.Account {
	e.t.Helper()
	out := map[int64]ledger.Account{}
	for _, a := range decode[[]ledger.Account](e.t, e.as(user, "GET", "/api/accounts", "").body) {
		out[a.ID] = a
	}
	return out
}

func TestRemoveLinkKeepsHistory(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	linked := e.link(e.bert, "")
	conn := "/api/connections/" + strconv.FormatInt(linked.Connection.ID, 10)
	txBefore := e.count(`SELECT COUNT(*) FROM transactions`)
	if txBefore == 0 {
		t.Fatal("the first sync stored nothing")
	}

	expectError(t, e.as(e.bert, "DELETE", conn, ""), http.StatusBadRequest, "invalid")
	expectError(t, e.as(e.bert, "DELETE", conn+"?history=maybe", ""), http.StatusBadRequest, "invalid")
	expectError(t, e.as(e.bert, "DELETE", "/api/connections/999?history=keep", ""), http.StatusNotFound, "not_found")

	r := e.as(e.bert, "DELETE", conn+"?history=keep", "")
	if r.status != 200 {
		t.Fatalf("remove: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"deleted": [], "kept": [`+strconv.FormatInt(linked.Accounts[0].ID, 10)+`, `+strconv.FormatInt(linked.Accounts[1].ID, 10)+`]}`)
	if e.count(`SELECT COUNT(*) FROM provider_connections WHERE status = 'revoked' AND session_id_enc IS NULL AND private_key_enc IS NULL`) != 1 {
		t.Error("the connection is not revoked with its secrets wiped")
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions`); n != txBefore {
		t.Errorf("transactions %d, want %d", n, txBefore)
	}
	if r := e.as(e.bert, "GET", "/api/connections", ""); r.body != "[]\n" {
		t.Errorf("connections: %s", r.body)
	}
	for _, a := range e.accountsOf(e.bert) {
		if a.SyncStatus == nil || *a.SyncStatus != "unlinked" || a.LastSync != nil || a.Bank == nil {
			t.Errorf("account without a source: %+v", a)
		}
	}
	if alerts := e.as(e.bert, "GET", "/api/alerts", "").body; strings.Contains(alerts, `"sync"`) || strings.Contains(alerts, `"consent"`) {
		t.Errorf("an unlinked account raises bank alerts: %s", alerts)
	}
	expectError(t, e.as(e.bert, "DELETE", conn+"?history=keep", ""), http.StatusNotFound, "not_found")
	if e.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'bank_link_removed' AND detail LIKE '%history=keep%'`) != 1 {
		t.Error("no audit line")
	}

	// Linking again re-attaches the same accounts by IBAN, without duplicates.
	e.saveCredentials(e.bert)
	again := e.link(e.bert, "")
	if len(again.Skipped) != 0 || len(again.Accounts) != 2 || again.Accounts[0].ID != linked.Accounts[0].ID || again.Accounts[1].ID != linked.Accounts[1].ID {
		t.Fatalf("re-link: %+v", again)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions`); n != txBefore {
		t.Errorf("transactions after re-link %d, want %d", n, txBefore)
	}
	for _, a := range e.accountsOf(e.bert) {
		if a.SyncStatus == nil || *a.SyncStatus != "ok" {
			t.Errorf("re-linked account: %+v", a)
		}
	}
}

func TestRemoveLinkWhileSyncing(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	linked := e.link(e.bert, "")
	id := linked.Connection.ID
	defer func(d time.Duration) { removeWait = d }(removeWait)
	removeWait = 50 * time.Millisecond

	// A sync of the link holds it.
	held, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		_ = e.s.opts.Bank.Exclusive(context.Background(), id, func() error { close(held); <-release; return nil })
	}()
	<-held
	txBefore := e.count(`SELECT COUNT(*) FROM transactions`)

	r := e.as(e.bert, "DELETE", "/api/connections/"+strconv.FormatInt(id, 10)+"?history=delete", "")
	expectError(t, r, http.StatusServiceUnavailable, "unavailable")
	if !strings.Contains(r.body, "Er loopt nog een synchronisatie") {
		t.Errorf("message: %s", r.body)
	}
	if e.count(`SELECT COUNT(*) FROM provider_connections WHERE id = ? AND status = 'active' AND session_id_enc IS NOT NULL`, id) != 1 {
		t.Error("the connection changed although the removal answered 503")
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions`); n != txBefore || len(e.accountsOf(e.bert)) != 2 {
		t.Errorf("data removed: transactions %d of %d, accounts %d", n, txBefore, len(e.accountsOf(e.bert)))
	}

	close(release)
	<-done
	if r := e.as(e.bert, "DELETE", "/api/connections/"+strconv.FormatInt(id, 10)+"?history=delete", ""); r.status != http.StatusOK {
		t.Fatalf("remove after the sync: %d %s", r.status, r.body)
	}
}

func TestRemoveLinkDeletesHistory(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	linked := e.link(e.bert, "")
	personal, shared := linked.Accounts[0].ID, linked.Accounts[1].ID
	// Partner is a member of the second account; she must keep it.
	if _, err := e.db.Exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, ?, 'member', 'edit')`, shared, e.partner); err != nil {
		t.Fatal(err)
	}
	// A split on a personal transaction goes with it.
	if _, err := e.db.Exec(`INSERT INTO categories (id, name, type) VALUES (1, 'Boodschappen', 'expense')`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount)
		SELECT id, 1, amount FROM transactions WHERE account_id = ? LIMIT 1`, personal); err != nil {
		t.Fatal(err)
	}
	// Partner's own link and data are not touched.
	e.bank.set(func(b *testBank) {
		b.accounts = []bank.Account{{ID: "uid-p", IBAN: ibanPartner, Name: "Eigen rekening", Currency: "EUR", Bank: "Argenta"}}
	})
	e.saveCredentials(e.partner)
	hers := e.link(e.partner, "")
	herTx := e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = ?`, hers.Accounts[0].ID)
	sharedTx := e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = ?`, shared)

	r := e.as(e.bert, "DELETE", "/api/connections/"+strconv.FormatInt(linked.Connection.ID, 10)+"?history=delete", "")
	if r.status != 200 {
		t.Fatalf("remove: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"deleted": [`+strconv.FormatInt(personal, 10)+`], "kept": [`+strconv.FormatInt(shared, 10)+`]}`)
	for table, q := range map[string]string{
		"accounts":          `SELECT COUNT(*) FROM accounts WHERE id = ?`,
		"transactions":      `SELECT COUNT(*) FROM transactions WHERE account_id = ?`,
		"balance_snapshots": `SELECT COUNT(*) FROM balance_snapshots WHERE account_id = ?`,
		"account_access":    `SELECT COUNT(*) FROM account_access WHERE account_id = ?`,
	} {
		if n := e.count(q, personal); n != 0 {
			t.Errorf("%s keeps %d rows of the deleted account", table, n)
		}
	}
	if n := e.count(`SELECT COUNT(*) FROM transaction_splits`); n != 0 {
		t.Errorf("%d splits left", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = ?`, shared); n != sharedTx || n == 0 {
		t.Errorf("the shared account lost transactions: %d of %d", n, sharedTx)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = ?`, hers.Accounts[0].ID); n != herTx {
		t.Errorf("Partner's account lost transactions: %d of %d", n, herTx)
	}
	if a, ok := e.accountsOf(e.partner)[shared]; !ok || *a.SyncStatus != "unlinked" {
		t.Errorf("Partner's view of the shared account: %+v", a)
	}
	if e.count(`SELECT COUNT(*) FROM provider_connections WHERE user_id = ? AND status = 'active'`, e.partner) != 1 {
		t.Error("Partner's link changed")
	}
}
