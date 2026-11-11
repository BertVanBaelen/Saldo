package server

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Behind the Cloudflared add-on the request arrives over http; the cookie is
// still Secure when the edge says https, but only a trusted peer may say so.
func TestDeviceCookieSecureBehindProxy(t *testing.T) {
	e := newEnv(t, func(o *Options) { o.PublicURL = "" })
	e.addUser("bert@jouw-domein.be", "Bert", "admin", bertPass)
	signIn := func(remote string, header map[string]string) *http.Cookie {
		t.Helper()
		e.now = e.now.Add(11 * time.Minute) // past the limit of codes per user
		l := e.login("bert@jouw-domein.be", bertPass)
		r := e.do(call{method: "POST", path: "/api/auth/verify", remote: remote, header: header,
			body: jsonBody(map[string]string{"challenge": l.Challenge, "code": e.code("bert@jouw-domein.be")})})
		e.mails()
		c := cookieOf(t, r)
		if r.status != http.StatusOK || c == nil {
			t.Fatalf("verify: %d %s", r.status, r.body)
		}
		return c
	}
	cases := []struct {
		name   string
		remote string
		header map[string]string
		secure bool
	}{
		{"plain http, no proxy", "192.0.2.1:1234", nil, false},
		{"Cloudflared, X-Forwarded-Proto", "172.30.33.4:5000", map[string]string{"X-Forwarded-Proto": "https"}, true},
		{"Cloudflared, CF-Visitor", "172.30.33.4:5000", map[string]string{"CF-Visitor": `{"scheme": "https"}`}, true},
		{"Cloudflared, http at the edge", "172.30.33.4:5000", map[string]string{"X-Forwarded-Proto": "http"}, false},
		{"public peer claims https", "192.0.2.1:1234", map[string]string{"X-Forwarded-Proto": "https", "CF-Visitor": `{"scheme":"https"}`}, false},
	}
	for _, c := range cases {
		if got := signIn(c.remote, c.header).Secure; got != c.secure {
			t.Errorf("%s: Secure %v, want %v", c.name, got, c.secure)
		}
	}
	// An https public_url always makes it Secure.
	e2 := newEnv(t)
	e2.addUser("bert@jouw-domein.be", "Bert", "admin", bertPass)
	l := e2.login("bert@jouw-domein.be", bertPass)
	if c := cookieOf(t, e2.verify(l.Challenge, e2.code("bert@jouw-domein.be"))); c == nil || !c.Secure {
		t.Errorf("https public_url: cookie %+v", c)
	}
}

func TestHSTS(t *testing.T) {
	e := newEnv(t) // public_url https
	for _, path := range []string{"/", "/api/health", "/api/accounts"} {
		if got := e.get(path, "").header.Get("Strict-Transport-Security"); got != "max-age=31536000" {
			t.Errorf("%s: HSTS %q", path, got)
		}
	}
	h, _ := demoServer(t) // no public_url
	if got := do(t, h, "GET", "/", "").header.Get("Strict-Transport-Security"); got != "" {
		t.Errorf("without an https public_url: HSTS %q", got)
	}
}

// One-time links must not end up in the add-on log, where anyone who can read
// it could redeem them.
func TestTokensNotLogged(t *testing.T) {
	var logs bytes.Buffer
	e := newEnv(t, func(o *Options) {
		o.Logger = slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	})
	const secret = "tok-secret-4821"
	for _, path := range []string{"/api/auth/token/" + secret, "/setup/" + secret, "/uitnodiging/" + secret, "/nieuw-wachtwoord/" + secret} {
		e.get(path, "")
	}
	if strings.Contains(logs.String(), secret) {
		t.Errorf("a token is logged:\n%s", logs.String())
	}
	if !strings.Contains(logs.String(), "/uitnodiging/…") {
		t.Errorf("the request line is gone:\n%s", logs.String())
	}
}

// A lost secret.key (the database restored without it) asks for the key
// again instead of failing with a 500.
func TestBankLinkWithUnreadableKey(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	if _, err := e.db.Exec(`UPDATE provider_connections SET private_key_enc = ?`, e.box.Seal(nil)[:20]); err != nil {
		t.Fatal(err)
	}
	expectError(t, e.as(e.bert, "POST", "/api/bank/link", ""), http.StatusBadRequest, "invalid")
	e.saveCredentials(e.bert) // storing the key again repairs it
	if r := e.as(e.bert, "POST", "/api/bank/link", ""); r.status != http.StatusOK {
		t.Errorf("after storing the key again: %d %s", r.status, r.body)
	}
}

// Two users linking the same new IBAN at once: one gets the account, the
// other the "exists" skip; nobody gets a 500.
func TestConcurrentLinkSameIBAN(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	e.saveCredentials(e.partner)
	states := map[int64]string{}
	for _, u := range []int64{e.bert, e.partner} {
		if r := e.as(u, "POST", "/api/bank/link", ""); r.status != http.StatusOK {
			t.Fatalf("link: %d %s", r.status, r.body)
		}
		states[u] = e.bank.lastState()
	}
	var wg sync.WaitGroup
	got := map[int64]response{}
	var mu sync.Mutex
	for u, st := range states {
		wg.Go(func() {
			r := e.request(u, "POST", "/api/bank/callback", jsonBody(map[string]string{"code": "code-1", "state": st}))
			mu.Lock()
			got[u] = r
			mu.Unlock()
		})
	}
	wg.Wait()
	e.s.syncs.Wait() // a WaitGroup may not be waited on while another goroutine adds to it
	skipped := 0
	for u, r := range got {
		if r.status != http.StatusOK {
			t.Fatalf("user %d: %d %s", u, r.status, r.body)
		}
		skipped += len(decode[callbackBody](t, r.body).Skipped)
	}
	if skipped != 2 || e.count(`SELECT COUNT(*) FROM accounts`) != 2 {
		t.Errorf("skipped %d, accounts %d; want each IBAN once", skipped, e.count(`SELECT COUNT(*) FROM accounts`))
	}
}

// The privacy sweep (analysis 9, risk 7): Bert and Partner each link their
// own accounts; Partner then calls every data endpoint of docs/api.md, also
// with Bert's ids, and sees none of Bert's accounts, balances, counterparties
// or transfers.
func TestPrivacySweep(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	bert := e.link(e.bert, "")
	e.bank.set(func(b *testBank) {
		b.accounts = []bank.Account{{ID: "uid-p", IBAN: ibanPartner, Name: "Eigen rekening", Currency: "EUR", Bank: "Argenta"}}
		// A transfer from Partner to Bert's personal account: on her side it
		// names his IBAN, which must not turn into anything of his.
		b.txs[ibanPartner] = append(b.txs[ibanPartner], bank.Transaction{EntryReference: "ref-6", BookingDate: "2026-11-08",
			Amount: -5000, CounterpartyName: "Overschrijving", CounterpartyIBAN: ibanPersonal, Status: bank.StatusBooked})
	})
	e.saveCredentials(e.partner)
	partner := e.link(e.partner, "")
	if len(bert.Accounts) != 2 || len(partner.Accounts) != 1 {
		t.Fatalf("linked: Bert %d, Partner %d accounts", len(bert.Accounts), len(partner.Accounts))
	}
	var bertDevice int64
	if err := e.db.QueryRow(`INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'Chrome op Windows', 'x') RETURNING id`,
		e.bert).Scan(&bertDevice); err != nil {
		t.Fatal(err)
	}

	id := func(n int64) string { return strconv.FormatInt(n, 10) }
	conn := id(bert.Connection.ID)
	acc1, acc2 := id(bert.Accounts[0].ID), id(bert.Accounts[1].ID)
	r := e.as(e.bert, "POST", "/api/accounts", `{"name":"Spaarpot","type":"savings","colour":"orange","iban":"BE83 3630 1234 5615","balance":1250000}`)
	if r.status != 201 {
		t.Fatalf("Bert's manual account: %d %s", r.status, r.body)
	}
	manual := id(decode[ledger.Account](t, r.body).ID)
	bertImport := e.importOK(e.bert, bert.Accounts[0].ID, csvHeader+csvCoffee).Batches[0]
	// Bert's rules (0.4-2): a user rule and a rule on his account, applied.
	if err := categorise.SeedDefaults(context.Background(), e.db); err != nil {
		t.Fatal(err)
	}
	rule := func(user int64, body string) string {
		t.Helper()
		r := e.as(user, "POST", "/api/rules", body)
		if r.status != http.StatusCreated {
			t.Fatalf("rule: %d %s", r.status, r.body)
		}
		return id(decode[ledger.RuleView](t, r.body).ID)
	}
	userRule := rule(e.bert, `{"counterparty":"Geheimwinkel","counterpartyIban":"BE11000000000071","categoryId":2}`)
	accRule := rule(e.bert, `{"accountId":`+acc1+`,"counterparty":"Werkgever","categoryId":7}`)
	if r := e.as(e.bert, "POST", "/api/rules/apply", ""); !strings.Contains(r.body, `{"updated":1}`) {
		t.Fatalf("Bert's apply: %s", r.body)
	}
	// Partner's own rules may match Bert's rows by name; they must never reach them.
	p1 := rule(e.partner, `{"counterparty":"Werkgever","categoryId":8}`)
	p2 := rule(e.partner, `{"counterparty":"markt","categoryId":2}`)
	// Bert's note and split (0.4-3) on his booked row.
	bertTx := id(int64(e.count(`SELECT MIN(id) FROM transactions WHERE account_id = ? AND status = 'booked'`, bert.Accounts[0].ID)))
	if r := e.as(e.bert, "PATCH", "/api/transactions/"+bertTx, `{"note":"Geheimnotitie"}`); r.status != 200 {
		t.Fatalf("Bert's note: %d %s", r.status, r.body)
	}
	amount := e.count(`SELECT amount FROM transactions WHERE id = ?`, bertTx)
	if r := e.as(e.bert, "PUT", "/api/transactions/"+bertTx+"/split", `{"parts":[{"categoryId":2,"amount":`+
		strconv.Itoa(amount-amount/2)+`},{"categoryId":3,"amount":`+strconv.Itoa(amount/2)+`}]}`); r.status != 200 {
		t.Fatalf("Bert's split: %d %s", r.status, r.body)
	}
	// Bert's suggestion (0.4-4): two manual choices and a row that waits.
	for i, cat := range []any{2, 2, nil} {
		origin := any("manual")
		if cat == nil {
			origin = nil
		}
		if _, err := e.db.Exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id, category_origin)
			VALUES (?, -4321, '2026-11-05', 'Geheimwinkel Noord', 'booked', ?, ?, ?)`, bert.Accounts[0].ID, "sweep-"+strconv.Itoa(i), cat, origin); err != nil {
			t.Fatal(err)
		}
	}
	if r := e.as(e.bert, "GET", "/api/suggestions", ""); !strings.Contains(r.body, `"counterpartyKey":"geheimwinkel noord"`) {
		t.Fatalf("Bert's suggestions: %s", r.body)
	}
	bertRows := e.query(`SELECT id, COALESCE(category_id, '-'), COALESCE(category_origin, '-'), COALESCE(rule_id, '-')
		FROM transactions t WHERE account_id IN (` + acc1 + `, ` + acc2 + `) ORDER BY id`)
	cases := []struct {
		method, path, body string
		status             int // 200 = must answer, without Bert's data
	}{
		{"GET", "/api/me", "", 200},
		{"GET", "/api/accounts", "", 200},
		{"GET", "/api/transactions?limit=200", "", 200},
		{"GET", "/api/transactions?scope=gedeeld", "", 200},
		{"GET", "/api/transactions?q=Werkgever", "", 200},
		{"GET", "/api/transactions?q=1500", "", 200},
		{"GET", "/api/transactions?uncategorised=1", "", 200},
		{"GET", "/api/alerts", "", 200},
		{"GET", "/api/connections", "", 200},
		{"GET", "/api/devices", "", 200},
		{"GET", "/api/bank/enablebanking", "", 200},
		{"GET", "/api/imports", "", 200},
		{"GET", "/api/imports/mappings?source=bilance", "", 200},
		{"PUT", "/api/imports/mappings?source=bilance", `[]`, 200},
		{"POST", "/api/imports/" + id(bertImport.ID) + "/reapply-categories", "", 404},
		{"GET", "/api/imports/" + id(bertImport.ID) + "/undo-preview", "", 404},
		{"POST", "/api/imports/" + id(bertImport.ID) + "/undo", "", 404},
		{"POST", "/api/imports/" + id(bertImport.ID) + "/undo?run=1", "", 404},
		{"POST", "/api/sync", "", 202},
		{"GET", "/api/sync", "", 200},
		{"GET", "/api/transactions?account=" + acc1, "", 404},
		{"GET", "/api/transactions?account=" + acc2, "", 404},
		{"PATCH", "/api/accounts/" + acc1, `{"name":"Gezien"}`, 404},
		{"PATCH", "/api/accounts/" + acc2, `{"buffer":0}`, 404},
		{"PATCH", "/api/accounts/" + manual, `{"iban":""}`, 404},
		{"GET", "/api/accounts/" + acc1 + "/balances", "", 404},
		{"GET", "/api/accounts/" + manual + "/balances", "", 404},
		{"PUT", "/api/accounts/" + manual + "/balance", `{"balance":1}`, 404},
		{"PUT", "/api/accounts/" + acc1 + "/balance", `{"balance":1}`, 404},
		{"DELETE", "/api/accounts/" + manual, "", 404},
		{"DELETE", "/api/accounts/" + acc1, "", 404},
		{"DELETE", "/api/connections/" + conn + "?history=delete", "", 404},
		{"DELETE", "/api/connections/" + conn + "?history=keep", "", 404},
		{"POST", "/api/bank/link", `{"connectionId":` + conn + `}`, 404},
		{"DELETE", "/api/devices/" + id(bertDevice), "", 404},
		{"GET", "/api/users", "", 403},
		{"DELETE", "/api/users/invitations/1", "", 403},
		{"POST", "/api/users/" + id(e.bert) + "/password-reset", "", 403},
		{"POST", "/api/bank/callback", jsonBody(map[string]string{"code": "code-1", "state": e.bank.states[0]}), 400},
		{"GET", "/api/categories", "", 200},
		{"GET", "/api/rules", "", 200},
		{"POST", "/api/rules/apply", "", 200},
		{"POST", "/api/rules", `{"accountId":` + acc1 + `,"counterparty":"x","categoryId":2}`, 404},
		{"POST", "/api/rules", `{"accountId":` + acc2 + `,"counterparty":"x","categoryId":2}`, 404},
		{"POST", "/api/rules", `{"accountId":` + manual + `,"counterparty":"x","categoryId":2}`, 404},
		{"PATCH", "/api/rules/" + userRule, `{"priority":1}`, 404},
		{"PATCH", "/api/rules/" + accRule, `{"counterparty":"Gezien"}`, 404},
		{"DELETE", "/api/rules/" + userRule, "", 404},
		{"DELETE", "/api/rules/" + accRule, "", 404},
		{"DELETE", "/api/categories/999?moveTo=none", "", 404},
		{"POST", "/api/rules/preview", `{"accountId":` + acc1 + `,"counterparty":"x"}`, 404},
		{"POST", "/api/rules/preview", `{"accountId":` + manual + `,"counterparty":"x"}`, 404},
		{"POST", "/api/rules/preview", `{"ruleId":` + userRule + `,"counterparty":"x"}`, 404},
		{"POST", "/api/rules/preview", `{"ruleId":` + accRule + `,"accountId":` + acc1 + `,"counterparty":"x"}`, 404},
		{"POST", "/api/rules/preview", `{"ruleId":999999,"counterparty":"x"}`, 404},
		{"POST", "/api/rules/preview", `{"counterparty":"Geheimwinkel","categoryId":2}`, 200},
		{"POST", "/api/rules/" + userRule + "/apply", "", 404},
		{"POST", "/api/rules/" + accRule + "/apply", "", 404},
		{"POST", "/api/rules/999999/apply", "", 404},
		{"PUT", "/api/rules/order", `{"ids":[` + userRule + `,` + accRule + `]}`, 400},
		{"PUT", "/api/rules/order", `{"ids":[` + p2 + `,` + p1 + `,` + userRule + `]}`, 400},
		{"PUT", "/api/rules/order", `{"ids":[` + p1 + `,` + p2 + `]}`, 200},
		{"GET", "/api/suggestions", "", 200},
		{"POST", "/api/suggestions/confirm", `{"counterpartyKey":"geheimwinkel noord","categoryId":2}`, 404},
		{"POST", "/api/suggestions/dismiss", `{"counterpartyKey":"geheimwinkel noord","categoryId":2}`, 404},
		{"PATCH", "/api/transactions/" + bertTx, `{"note":"Gezien"}`, 404},
		{"PATCH", "/api/transactions/" + bertTx, `{"categoryId":2}`, 404},
		{"GET", "/api/transactions/" + bertTx + "/similar", "", 404},
		{"POST", "/api/transactions/" + bertTx + "/similar", "", 404},
		{"PUT", "/api/transactions/" + bertTx + "/split", `{"parts":[{"categoryId":2,"amount":-1},{"categoryId":3,"amount":-1}]}`, 404},
		{"DELETE", "/api/transactions/" + bertTx + "/split", "", 404},
		{"PATCH", "/api/transactions/999999", `{"note":"x"}`, 404},
		{"GET", "/api/transactions/999999/similar", "", 404},
		{"DELETE", "/api/transactions/999999/split", "", 404},
	}
	secrets := []string{ibanPersonal, ibanShared, "7034", "6769", "Zichtrekening", "Gezinsrekening",
		"Koffiebar", "Bakkerij", "Werkgever NV", "Loon", "Supermarkt", "196882", "94608", "150000", "1230", "8642",
		"bert@", "Chrome op Windows", "Spaarpot", "1250000", "5615", "Geheimwinkel", "BE11", "0071", "Geheimnotitie"}
	for _, c := range cases {
		r := e.as(e.partner, c.method, c.path, c.body)
		if r.status != c.status {
			t.Errorf("%s %s: %d, want %d (%s)", c.method, c.path, r.status, c.status, r.body)
		}
		for _, s := range secrets {
			if s == "Supermarkt" && c.path == "/api/categories" {
				continue // also a name of the shared default tree, which everyone sees
			}
			if strings.Contains(r.body, s) {
				t.Errorf("%s %s shows Bert's %q: %s", c.method, c.path, s, r.body)
			}
		}
	}
	// The import routes, with Bert's accounts: hidden, and nothing of his file.
	for _, account := range []int64{bert.Accounts[0].ID, bert.Accounts[1].ID, bertImport.AccountID} {
		for _, path := range []string{"/api/imports", "/api/imports/preview"} {
			r := e.upload(e.partner, path, importForm(csvHeader+csvBread, account, csvMapping)...)
			if r.status != http.StatusNotFound {
				t.Errorf("POST %s into Bert's account %d: %d %s", path, account, r.status, r.body)
			}
			for _, s := range append(secrets, "Koffiehuis", "export.csv") {
				if strings.Contains(r.body, s) {
					t.Errorf("POST %s shows Bert's %q: %s", path, s, r.body)
				}
			}
		}
	}
	if r := e.as(e.partner, "GET", "/api/imports", ""); strings.Contains(r.body, "export.csv") || r.body != "[]\n" {
		t.Errorf("Partner sees Bert's imports: %s", r.body)
	}
	if e.count(`SELECT COUNT(*) FROM transactions WHERE counterparty_name = 'Bakker Test'`) != 0 {
		t.Error("Partner imported into Bert's account")
	}
	// Bert's objects are untouched, and Partner's transfer to him is just a
	// payment for her (his account is not hers to pair with).
	if e.count(`SELECT COUNT(*) FROM devices WHERE id = ? AND revoked_at IS NULL`, bertDevice) != 1 {
		t.Error("Partner signed out Bert's device")
	}
	if e.count(`SELECT COUNT(*) FROM accounts WHERE name = 'Gezien'`) != 0 {
		t.Error("Partner renamed Bert's account")
	}
	if e.count(`SELECT COUNT(*) FROM provider_connections WHERE id = ? AND status = 'active' AND session_id_enc IS NOT NULL`, bert.Connection.ID) != 1 ||
		e.count(`SELECT COUNT(*) FROM account_sources WHERE connection_id = ?`, bert.Connection.ID) != 2 {
		t.Error("Partner removed Bert's link")
	}
	if e.count(`SELECT COUNT(*) FROM accounts a JOIN balance_snapshots b ON b.account_id = a.id
		WHERE a.id = ? AND a.iban IS NOT NULL AND b.balance = 1250000`, manual) != 1 {
		t.Error("Partner changed Bert's manual account")
	}
	for _, tx := range decode[ledger.Page](t, e.as(e.partner, "GET", "/api/transactions", "").body).Items {
		if tx.Transfer {
			t.Errorf("Partner's transaction %d counts as a transfer to an account she cannot see", tx.ID)
		}
	}
	// Her own manual account with his IBANs is allowed (it only recognises
	// transfers) and joins nothing of his.
	for _, iban := range []string{ibanPersonal, "BE83363012345615"} {
		if r := e.as(e.partner, "POST", "/api/accounts", `{"name":"Zijn rekening","type":"savings","iban":"`+iban+`"}`); r.status != 201 {
			t.Fatalf("Partner's manual account: %d %s", r.status, r.body)
		}
	}
	if n := e.count(`SELECT COUNT(*) FROM account_access x JOIN accounts a ON a.id = x.account_id
		WHERE x.user_id = ? AND a.created_by = ?`, e.partner, e.bert); n != 0 {
		t.Errorf("Partner holds %d of Bert's accounts", n)
	}
	if n := len(decode[[]ledger.Account](t, e.as(e.bert, "GET", "/api/accounts", "").body)); n != 3 {
		t.Errorf("Bert sees %d accounts after Partner registered his IBANs", n)
	}
	// Rules and categories: Bert's rules and rows are untouched, Partner's
	// list holds only her rules, and her counts only her rows.
	if got := e.query(`SELECT id, COALESCE(category_id, '-'), COALESCE(category_origin, '-'), COALESCE(rule_id, '-')
		FROM transactions t WHERE account_id IN (` + acc1 + `, ` + acc2 + `) ORDER BY id`); got != bertRows {
		t.Errorf("Partner changed Bert's categories: %s, was %s", got, bertRows)
	}
	if e.count(`SELECT COUNT(*) FROM transactions WHERE note = 'Geheimnotitie'`) != 1 || e.count(`SELECT COUNT(*) FROM transaction_splits`) != 2 {
		t.Error("Partner changed Bert's note or split it")
	}
	if e.count(`SELECT COUNT(*) FROM rules WHERE user_id = ? OR account_id = ?`, e.bert, bert.Accounts[0].ID) != 2 {
		t.Error("Partner changed Bert's rules")
	}
	if e.count(`SELECT COUNT(*) FROM rules WHERE (user_id = ? OR account_id = ?) AND priority = 0`, e.bert, bert.Accounts[0].ID) != 2 {
		t.Error("Partner reordered Bert's rules")
	}
	if got := decode[ledger.RulePreview](t, e.as(e.partner, "POST", "/api/rules/preview", `{"counterparty":"Geheimwinkel"}`).body); got.Matches != 0 {
		t.Errorf("Partner's preview counts Bert's rows: %+v", got)
	}
	if !strings.Contains(e.as(e.bert, "GET", "/api/suggestions", "").body, `"geheimwinkel noord"`) ||
		e.count(`SELECT COUNT(*) FROM category_suggestions`) != 0 {
		t.Error("Partner decided Bert's suggestion")
	}
	for _, v := range decode[[]ledger.RuleView](t, e.as(e.partner, "GET", "/api/rules", "").body) {
		if v.AccountID != nil || e.count(`SELECT user_id FROM rules WHERE id = ?`, v.ID) != int(e.partner) {
			t.Errorf("Partner sees rule %d", v.ID)
		}
	}
	own := 0
	for _, c := range decode[[]ledger.TreeCategory](t, e.as(e.partner, "GET", "/api/categories", "").body) {
		own += c.Count
	}
	if want := e.count(`SELECT COUNT(*) FROM transactions t JOIN account_access me ON me.account_id = t.account_id AND me.user_id = ?
		WHERE t.category_id IS NOT NULL`, e.partner); own != want || e.count(`SELECT COUNT(*) FROM transactions WHERE category_id IS NOT NULL`) == want {
		t.Errorf("Partner's counts add up to %d, her own categorised rows are %d", own, want)
	}
}

// The import routes need a viewer like every other route but health; the
// list of the other routes is in TestOutsideDemoModeEverythingButHealthIs401.
func TestImportRoutesOutsideDemoModeAre401(t *testing.T) {
	h := New(Options{DB: seededDB(t), Version: "test", Clock: demoClock})
	body, ct := multipartForm(t, importForm(csvHeader+csvCoffee, 1, csvMapping)...)
	for _, c := range []struct{ method, path, body, ct string }{
		{"GET", "/api/imports", "", ""},
		{"GET", "/api/imports/mappings?source=bilance", "", ""},
		{"PUT", "/api/imports/mappings?source=bilance", `[]`, "application/json"},
		{"POST", "/api/imports/1/reapply-categories", "", ""},
		{"GET", "/api/imports/1/undo-preview", "", ""},
		{"POST", "/api/imports/1/undo", "", ""},
		{"POST", "/api/imports", body, ct},
		{"POST", "/api/imports/preview", body, ct},
		{"POST", "/api/imports", `{"x":1}`, "application/json"},
	} {
		req := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		if c.ct != "" {
			req.Header.Set("Content-Type", c.ct)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		r := response{status: rec.Code, header: rec.Header(), body: rec.Body.String()}
		if msg := expectError(t, r, http.StatusUnauthorized, "unauthorized"); msg != "Log in om verder te gaan." {
			t.Errorf("%s %s: message %q", c.method, c.path, msg)
		}
	}
}
