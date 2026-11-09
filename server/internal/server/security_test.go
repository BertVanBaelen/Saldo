package server

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
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
	bertImport := e.importOK(e.bert, bert.Accounts[0].ID, csvHeader+csvCoffee).Batch
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
	}
	secrets := []string{ibanPersonal, ibanShared, "7034", "6769", "Zichtrekening", "Gezinsrekening",
		"Koffiebar", "Bakkerij", "Werkgever NV", "Loon", "Supermarkt", "196882", "94608", "150000", "1230", "8642",
		"bert@", "Chrome op Windows", "Spaarpot", "1250000", "5615"}
	for _, c := range cases {
		r := e.as(e.partner, c.method, c.path, c.body)
		if r.status != c.status {
			t.Errorf("%s %s: %d, want %d (%s)", c.method, c.path, r.status, c.status, r.body)
		}
		for _, s := range secrets {
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
}

// The import routes need a viewer like every other route but health; the
// list of the other routes is in TestOutsideDemoModeEverythingButHealthIs401.
func TestImportRoutesOutsideDemoModeAre401(t *testing.T) {
	h := New(Options{DB: seededDB(t), Version: "test", Clock: demoClock})
	body, ct := multipartForm(t, importForm(csvHeader+csvCoffee, 1, csvMapping)...)
	for _, c := range []struct{ method, path, body, ct string }{
		{"GET", "/api/imports", "", ""},
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
