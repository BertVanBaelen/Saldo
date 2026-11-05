package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/enablebanking"
	"github.com/BertVanBaelen/Saldo/server/internal/banklink"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/secrets"
)

// Invented accounts; the IBANs are documentation examples.
const (
	ibanPersonal = "BE68539007547034"
	ibanShared   = "BE71096123456769"
	ibanPartner  = "BE62510007547061"
	testAppID    = "00000000-0000-4000-8000-000000000001"
	testSession  = "sess-secret-4821"
)

// testKeyPEM is generated once per run; no key is ever committed.
var testKeyPEM = sync.OnceValue(func() string {
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(k)
	if err != nil {
		panic(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
})

// keyChunk is a piece of the key's base64 body, to look for in leaks.
func keyChunk() string { return testKeyPEM()[60:100] }

// testBank is a scriptable bank shared by every connection of a test.
type testBank struct {
	mu        sync.Mutex
	checkErr  error
	createErr error
	fetchErr  error
	session   string
	accounts  []bank.Account
	txs       map[string][]bank.Transaction // by IBAN, so new provider ids still find them
	bals      map[string][]bank.Balance     // by IBAN
	states    []string
	redirects []string
	froms     []string
	fetched   []string // "session/account id" of every fetch
}

func newTestBank() *testBank {
	return &testBank{
		session: testSession,
		accounts: []bank.Account{
			{ID: "uid-1", IBAN: ibanPersonal, Name: "Zichtrekening", Currency: "EUR", Bank: "Argenta"},
			{ID: "uid-2", IBAN: ibanShared, Name: "Gezinsrekening", Currency: "EUR", Bank: "Argenta"},
		},
		txs: map[string][]bank.Transaction{
			ibanPersonal: { // newest first, as the provider lists them
				{ValueDate: "2026-11-17", Amount: -450, CounterpartyName: "Koffiebar", Status: bank.StatusPending},
				{EntryReference: "ref-2", BookingDate: "2026-11-12", ValueDate: "2026-11-12", Amount: -1230, CounterpartyName: "Bakkerij Voorbeeld", Communication: "Brood", Status: bank.StatusBooked},
				{EntryReference: "ref-1", BookingDate: "2026-11-10", ValueDate: "2026-11-10", Amount: 150000, CounterpartyName: "Werkgever NV", Communication: "Loon november", Status: bank.StatusBooked},
			},
			ibanShared:  {{EntryReference: "ref-9", BookingDate: "2026-11-11", Amount: -8642, CounterpartyName: "Supermarkt", Status: bank.StatusBooked}},
			ibanPartner: {{EntryReference: "ref-5", BookingDate: "2026-11-09", Amount: 246000, CounterpartyName: "Werkgever BV", Status: bank.StatusBooked}},
		},
		bals: map[string][]bank.Balance{
			ibanPersonal: {{Amount: -2510, Date: "2026-11-16", Type: "CLBD"}, {Amount: 196882, Date: "2026-11-17", Type: "ITBD"}, {Amount: 999999, Date: "2026-11-18", Type: "ITAV"}},
			ibanShared:   {{Amount: 94608, Date: "2026-11-17", Type: "CLBD"}},
			ibanPartner:  {{Amount: 143215, Date: "2026-11-17", Type: "CLBD"}},
		},
	}
}

// open checks the credentials with the real Opener, then serves this bank.
func (b *testBank) open(user int64, appID string, key []byte) (banklink.Client, error) {
	if _, err := banklink.EnableBanking(user, appID, key); err != nil {
		return nil, err
	}
	return b, nil
}

func (b *testBank) CheckApplication(context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.checkErr
}

func (b *testBank) StartAuth(_ context.Context, aspsp, country, state, redirectURL string, _ time.Time) (string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if aspsp != "Argenta" || country != "BE" {
		return "", fmt.Errorf("unexpected bank %s %s", aspsp, country)
	}
	b.states = append(b.states, state)
	b.redirects = append(b.redirects, redirectURL)
	return "https://bank.example/consent?id=1", nil
}

func (b *testBank) CreateSession(_ context.Context, code string) (bank.SessionInfo, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.createErr != nil {
		return bank.SessionInfo{}, b.createErr
	}
	return bank.SessionInfo{ID: b.session, Accounts: slices.Clone(b.accounts),
		ValidUntil: time.Date(2027, 5, 17, 10, 0, 0, 0, time.UTC)}, nil
}

func (b *testBank) ListAccounts(context.Context, bank.Session) ([]bank.Account, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return slices.Clone(b.accounts), nil
}

func (b *testBank) ibanOf(id string) string {
	for _, a := range b.accounts {
		if a.ID == id {
			return a.IBAN
		}
	}
	return ""
}

func (b *testBank) FetchTransactions(_ context.Context, s bank.Session, id, from, _ string) ([]bank.Transaction, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.froms = append(b.froms, from)
	b.fetched = append(b.fetched, s.ID+"/"+id)
	if b.fetchErr != nil {
		return nil, b.fetchErr
	}
	return slices.Clone(b.txs[b.ibanOf(id)]), nil
}

func (b *testBank) FetchBalances(_ context.Context, _ bank.Session, id string) ([]bank.Balance, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return slices.Clone(b.bals[b.ibanOf(id)]), nil
}

func (b *testBank) lastState() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.states[len(b.states)-1]
}

func (b *testBank) set(f func(b *testBank)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	f(b)
}

// bankEnv is a server outside demo mode with two users, the test bank and a
// log that is checked for leaks. The viewer comes from the X-Test-User header.
type bankEnv struct {
	*env
	bank          *testBank
	box           *secrets.Box
	logs          *bytes.Buffer
	bert, partner int64
}

func newBankEnv(t *testing.T) *bankEnv {
	t.Helper()
	b := newTestBank()
	box, err := secrets.Load(filepath.Join(t.TempDir(), "secret.key"))
	if err != nil {
		t.Fatal(err)
	}
	logs := &bytes.Buffer{}
	log := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	var e *env
	e = newEnv(t, func(o *Options) {
		o.Logger = log
		o.Viewer = func(r *http.Request) (int64, bool) {
			id, err := strconv.ParseInt(r.Header.Get("X-Test-User"), 10, 64)
			return id, err == nil
		}
		o.Bank = banklink.New(o.DB, box, b.open, func() time.Time { return e.now }, log)
		o.Syncer = o.Bank
	})
	be := &bankEnv{env: e, bank: b, box: box, logs: logs}
	be.bert = e.addUser("bert@jouw-domein.be", "Bert", "admin", bertPass)
	be.partner = e.addUser("partner@jouw-domein.be", "Partner", "user", partnerPass)
	return be
}

func (e *bankEnv) as(user int64, method, path, body string) response {
	e.t.Helper()
	return e.do(call{method: method, path: path, body: body, header: map[string]string{"X-Test-User": strconv.FormatInt(user, 10)}})
}

func (e *bankEnv) saveCredentials(user int64) {
	e.t.Helper()
	r := e.as(user, "PUT", "/api/bank/enablebanking", jsonBody(map[string]string{"applicationId": testAppID, "privateKey": testKeyPEM()}))
	if r.status != http.StatusOK {
		e.t.Fatalf("save credentials: %d %s", r.status, r.body)
	}
}

// link runs link and callback and returns the callback's answer.
func (e *bankEnv) link(user int64, body string) callbackBody {
	e.t.Helper()
	r := e.as(user, "POST", "/api/bank/link", body)
	if r.status != http.StatusOK {
		e.t.Fatalf("link: %d %s", r.status, r.body)
	}
	equalJSON(e.t, r.body, `{"url": "https://bank.example/consent?id=1"}`)
	r = e.as(user, "POST", "/api/bank/callback", jsonBody(map[string]string{"code": "code-1", "state": e.bank.lastState()}))
	if r.status != http.StatusOK {
		e.t.Fatalf("callback: %d %s", r.status, r.body)
	}
	return decode[callbackBody](e.t, r.body)
}

func (e *bankEnv) count(q string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.db.QueryRow(q, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

// noLeaks fails when a secret shows up in the text.
func (e *bankEnv) noLeaks(where, text string) {
	e.t.Helper()
	for _, secret := range []string{testSession, keyChunk(), "PRIVATE KEY", "secret-marker"} {
		if strings.Contains(text, secret) {
			e.t.Errorf("%s leaks %q", where, secret)
		}
	}
}

func TestBankCredentials(t *testing.T) {
	e := newBankEnv(t)
	r := e.as(e.bert, "GET", "/api/bank/enablebanking", "")
	equalJSON(t, r.body, `{"configured": false, "applicationId": null, "redirectUrl": "https://saldo.example.com/bankkoppelingen/terug"}`)

	invalid := []string{
		jsonBody(map[string]string{"applicationId": "", "privateKey": testKeyPEM()}),
		jsonBody(map[string]string{"applicationId": "id with spaces", "privateKey": testKeyPEM()}),
		jsonBody(map[string]string{"applicationId": testAppID, "privateKey": ""}),
		jsonBody(map[string]string{"applicationId": testAppID, "privateKey": "hello"}),
		jsonBody(map[string]string{"applicationId": testAppID, "privateKey": testKeyPEM(), "extra": "x"}),
	}
	for _, body := range invalid {
		expectError(t, e.as(e.bert, "PUT", "/api/bank/enablebanking", body), http.StatusBadRequest, "invalid")
	}
	good := jsonBody(map[string]string{"applicationId": testAppID, "privateKey": testKeyPEM()})
	e.bank.set(func(b *testBank) {
		b.checkErr = &enablebanking.APIError{Op: "get application", Status: 401, Code: "UNAUTHORIZED"}
	})
	if msg := expectError(t, e.as(e.bert, "PUT", "/api/bank/enablebanking", good), http.StatusBadRequest, "invalid"); !strings.Contains(msg, "aanvaardt") {
		t.Errorf("refused key: %q", msg)
	}
	e.bank.set(func(b *testBank) { b.checkErr = &enablebanking.APIError{Op: "get application", Status: 503} })
	expectError(t, e.as(e.bert, "PUT", "/api/bank/enablebanking", good), http.StatusServiceUnavailable, "unavailable")
	if n := e.count(`SELECT COUNT(*) FROM provider_connections`); n != 0 {
		t.Fatalf("a refused key was stored: %d rows", n)
	}

	e.bank.set(func(b *testBank) { b.checkErr = nil })
	r = e.as(e.bert, "PUT", "/api/bank/enablebanking", good)
	if r.status != http.StatusOK {
		t.Fatalf("save: %d %s", r.status, r.body)
	}
	want := `{"configured": true, "applicationId": "` + testAppID + `", "redirectUrl": "https://saldo.example.com/bankkoppelingen/terug"}`
	equalJSON(t, r.body, want)
	e.saveCredentials(e.bert) // replacing keeps one connection
	r = e.as(e.bert, "GET", "/api/bank/enablebanking", "")
	equalJSON(t, r.body, want)
	e.noLeaks("GET /api/bank/enablebanking", r.body)
	equalJSON(t, e.as(e.bert, "GET", "/api/connections", "").body, `[
		{"id": 1, "bank": "Argenta", "since": null, "validUntil": null, "daysLeft": null, "lastSync": null, "status": "pending", "accounts": []}
	]`)

	// Sealed at rest: the column opens to the key, and the key's text is
	// nowhere in the database files.
	var sealed []byte
	var provider, status string
	if err := e.db.QueryRow(`SELECT private_key_enc, provider, status FROM provider_connections WHERE user_id = ?`, e.bert).
		Scan(&sealed, &provider, &status); err != nil {
		t.Fatal(err)
	}
	if plain, err := e.box.Open(sealed); err != nil || string(plain) != strings.TrimSpace(testKeyPEM()) || provider != "enablebanking" || status != "pending" {
		t.Errorf("stored key: %v, provider %s, status %s", err, provider, status)
	}
	var dbFile string
	if err := e.db.QueryRow(`SELECT file FROM pragma_database_list WHERE name = 'main'`).Scan(&dbFile); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{dbFile, dbFile + "-wal"} {
		b, err := os.ReadFile(f)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			t.Fatal(err)
		}
		if bytes.Contains(b, []byte(keyChunk())) || bytes.Contains(b, []byte("PRIVATE KEY")) {
			t.Errorf("%s holds the plain key", filepath.Base(f))
		}
	}

	// Privacy: Partner sees none of it.
	equalJSON(t, e.as(e.partner, "GET", "/api/bank/enablebanking", "").body,
		`{"configured": false, "applicationId": null, "redirectUrl": "https://saldo.example.com/bankkoppelingen/terug"}`)
	equalJSON(t, e.as(e.partner, "GET", "/api/connections", "").body, `[]`)
}

func TestBankLinkAndSync(t *testing.T) {
	e := newBankEnv(t)
	if msg := expectError(t, e.as(e.bert, "POST", "/api/bank/link", ""), http.StatusBadRequest, "invalid"); !strings.Contains(msg, "Enable Banking") {
		t.Errorf("not configured: %q", msg)
	}
	e.saveCredentials(e.bert)

	got := e.link(e.bert, "")
	if e.bank.redirects[0] != "https://saldo.example.com/bankkoppelingen/terug" {
		t.Errorf("redirect URL %q", e.bank.redirects[0])
	}
	b := jsonBody(got)
	equalJSON(t, b, `{
		"connection": {"id": 1, "bank": "Argenta", "since": "2026-11-18", "validUntil": "2027-05-17", "daysLeft": 180,
			"lastSync": "2026-11-18T20:00:00+01:00", "status": "ok", "accounts": [1, 2]},
		"accounts": [
			{"id": 1, "name": "Zichtrekening", "type": "current", "source": "bank", "kind": "personal",
				"iban": "BE68 •••• •••• 7034", "colour": "green", "buffer": 0, "balance": 196882,
				"balanceDate": "2026-11-17", "state": "ok", "bank": "Argenta", "lastSync": "2026-11-18T20:00:00+01:00",
				"syncStatus": "ok", "permission": "edit", "role": "manager", "members": []},
			{"id": 2, "name": "Gezinsrekening", "type": "current", "source": "bank", "kind": "personal",
				"iban": "BE71 •••• •••• 6769", "colour": "green", "buffer": 0, "balance": 94608,
				"balanceDate": "2026-11-17", "state": "ok", "bank": "Argenta", "lastSync": "2026-11-18T20:00:00+01:00",
				"syncStatus": "ok", "permission": "edit", "role": "manager", "members": []}
		],
		"skipped": []
	}`)
	if !slices.Equal(e.bank.froms, []string{"", ""}) {
		t.Errorf("first sync should ask for the longest history: %q", e.bank.froms)
	}

	// The pending row without a booking date is listed on its value date.
	page := decode[pageBody](t, e.as(e.bert, "GET", "/api/transactions?account=1", "").body)
	if len(page.Items) != 3 {
		t.Fatalf("%d transactions", len(page.Items))
	}
	first := decode[ledger.Transaction](t, string(page.Items[0]))
	if first.BookingDate != "2026-11-17" || first.Status != "pending" || first.Counterparty != "Koffiebar" {
		t.Errorf("pending row: %+v", first)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions WHERE source_connection_id = 1`); n != 4 {
		t.Errorf("%d rows carry their connection", n)
	}

	// A later sync starts 14 days before the newest row and adds nothing twice.
	rows := e.count(`SELECT COUNT(*) FROM transactions`)
	r := e.as(e.bert, "POST", "/api/sync", "")
	if r.status != http.StatusAccepted {
		t.Fatalf("sync: %d %s", r.status, r.body)
	}
	if !slices.Equal(e.bank.froms[2:], []string{"2026-11-03", "2026-10-28"}) {
		t.Errorf("incremental from: %q", e.bank.froms)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions`); n != rows {
		t.Errorf("sync added duplicates: %d → %d", rows, n)
	}

	// Re-authorise: a new session with new provider ids, the same accounts.
	e.bank.set(func(b *testBank) {
		b.session = "sess-secret-2"
		b.accounts[0].ID, b.accounts[1].ID = "uid-1b", "uid-2b"
	})
	again := e.link(e.bert, `{"connectionId": 1}`)
	if !slices.Equal(accountIDs(again.Accounts), []int64{1, 2}) || len(again.Skipped) != 0 {
		t.Errorf("re-authorised: %+v", again)
	}
	if n := e.count(`SELECT COUNT(*) FROM accounts`); n != 2 {
		t.Errorf("re-authorising made %d accounts", n)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions`); n != rows {
		t.Errorf("re-authorising added duplicates: %d → %d", rows, n)
	}
	if last := e.bank.fetched[len(e.bank.fetched)-1]; last != "sess-secret-2/uid-2b" {
		t.Errorf("fetched with %q after re-authorising", last)
	}

	// Nothing secret in the answers, the database's plain columns or the log.
	e.noLeaks("callback", b)
	e.noLeaks("connections", e.as(e.bert, "GET", "/api/connections", "").body)
	var plain string
	if err := e.db.QueryRow(`SELECT COALESCE(application_id, '') || COALESCE(last_error, '') FROM provider_connections`).Scan(&plain); err != nil {
		t.Fatal(err)
	}
	e.noLeaks("provider_connections", plain)
	e.noLeaks("log", e.logs.String())
}

func TestBankCallbackRejectsStates(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	e.saveCredentials(e.partner)
	link := func() string {
		if r := e.as(e.bert, "POST", "/api/bank/link", ""); r.status != http.StatusOK {
			t.Fatalf("link: %d %s", r.status, r.body)
		}
		return e.bank.lastState()
	}
	callback := func(user int64, state string) string {
		t.Helper()
		r := e.as(user, "POST", "/api/bank/callback", jsonBody(map[string]string{"code": "code-1", "state": state}))
		return expectError(t, r, http.StatusBadRequest, "invalid")
	}

	generic := callback(e.bert, "unknown-state")
	if !strings.Contains(generic, "verlopen") {
		t.Errorf("message %q", generic)
	}

	expired := link()
	e.now = e.now.Add(16 * time.Minute)
	if msg := callback(e.bert, expired); msg != generic {
		t.Errorf("expired: %q", msg)
	}

	used := link()
	e.link(e.bert, "") // a fresh link works
	if r := e.as(e.bert, "POST", "/api/bank/callback", jsonBody(map[string]string{"code": "code-1", "state": used})); r.status != http.StatusOK {
		t.Fatalf("own state: %d %s", r.status, r.body)
	}
	if msg := callback(e.bert, used); msg != generic {
		t.Errorf("reused: %q", msg)
	}

	foreign := link()
	if msg := callback(e.partner, foreign); msg != generic {
		t.Errorf("someone else's state: %q", msg)
	}
	if msg := callback(e.bert, foreign); msg != generic {
		t.Errorf("a state shown by someone else must be spent: %q", msg)
	}
	if msg := callback(e.bert, ""); msg != generic {
		t.Errorf("empty state: %q", msg)
	}
	if n := e.count(`SELECT COUNT(*) FROM provider_connections WHERE user_id = ? AND status = 'active'`, e.partner); n != 0 {
		t.Error("Partner's connection was linked with Bert's state")
	}

	// A code the bank refuses keeps the connection as it was.
	e.bank.set(func(b *testBank) {
		b.createErr = &enablebanking.APIError{Op: "create session", Status: 400, Code: "WRONG_CODE"}
	})
	r := e.as(e.bert, "POST", "/api/bank/callback", jsonBody(map[string]string{"code": "code-1", "state": link()}))
	expectError(t, r, http.StatusBadRequest, "invalid")
	e.bank.set(func(b *testBank) { b.createErr = errors.New("connection reset") })
	r = e.as(e.bert, "POST", "/api/bank/callback", jsonBody(map[string]string{"code": "code-1", "state": link()}))
	expectError(t, r, http.StatusServiceUnavailable, "unavailable")
}

func TestBankLinkSkipsAnotherUsersIBAN(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	e.link(e.bert, "")

	e.saveCredentials(e.partner)
	e.bank.set(func(b *testBank) {
		b.session = "sess-partner"
		b.accounts = []bank.Account{
			{ID: "p-1", IBAN: ibanPartner, Name: "Zichtrekening", Bank: "Argenta"},
			{ID: "p-2", IBAN: "be71 0961 2345 6769", Name: "Gezinsrekening", Bank: "Argenta"},
		}
	})
	got := e.link(e.partner, "")
	if got.Connection.ID != 2 || !slices.Equal(accountIDs(got.Accounts), []int64{3}) {
		t.Errorf("Partner's link: %+v", got)
	}
	equalJSON(t, jsonBody(got.Skipped), `[{"iban": "BE71 •••• •••• 6769", "reason": "exists"}]`)
	if got.Accounts[0].Role != "manager" || got.Accounts[0].Balance != 143215 {
		t.Errorf("Partner's account: %+v", got.Accounts[0])
	}

	// The shared IBAN stays Bert's alone, and nobody sees the other's account.
	bert := decode[[]ledger.Account](t, e.as(e.bert, "GET", "/api/accounts", "").body)
	if !slices.Equal(accountIDs(bert), []int64{1, 2}) || bert[1].Kind != "personal" {
		t.Errorf("Bert's accounts: %+v", bert)
	}
	partner := decode[[]ledger.Account](t, e.as(e.partner, "GET", "/api/accounts", "").body)
	if !slices.Equal(accountIDs(partner), []int64{3}) {
		t.Errorf("Partner's accounts: %+v", partner)
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions WHERE account_id = 2`); n != 1 {
		t.Errorf("the skipped account got Partner's rows: %d", n)
	}
}

func TestBankSyncFailures(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)

	// A first sync that fails keeps the link and shows "failed".
	e.bank.set(func(b *testBank) { b.fetchErr = errors.New("secret-marker " + ibanPersonal) })
	got := e.link(e.bert, "")
	if got.Connection.Status != "failed" || len(got.Accounts) != 2 {
		t.Fatalf("failed first sync: %+v", got.Connection)
	}
	var code string
	e.db.QueryRow(`SELECT last_error FROM provider_connections WHERE id = 1`).Scan(&code)
	if code != "provider_error" {
		t.Errorf("stored error %q", code)
	}
	e.noLeaks("log", e.logs.String())
	if strings.Contains(e.logs.String(), ibanPersonal) {
		t.Error("the log holds the IBAN from the error")
	}
	alerts := e.as(e.bert, "GET", "/api/alerts", "").body
	if !strings.Contains(alerts, "Synchronisatie mislukt") {
		t.Errorf("alerts: %s", alerts)
	}

	// The next sync works again.
	e.bank.set(func(b *testBank) { b.fetchErr = nil })
	if r := e.as(e.bert, "POST", "/api/sync", ""); r.status != http.StatusAccepted {
		t.Fatalf("sync: %d", r.status)
	}
	if c := decode[[]ledger.Connection](t, e.as(e.bert, "GET", "/api/connections", "").body); c[0].Status != "ok" {
		t.Errorf("after a good sync: %s", c[0].Status)
	}

	// A lapsed session marks the connection expired.
	e.now = e.now.Add(16 * time.Minute)
	e.bank.set(func(b *testBank) {
		b.fetchErr = fmt.Errorf("enablebanking: fetch transactions: EXPIRED_SESSION: %w", bank.ErrSessionExpired)
	})
	if r := e.as(e.bert, "POST", "/api/sync", ""); r.status != http.StatusAccepted {
		t.Fatalf("sync: %d", r.status)
	}
	if c := decode[[]ledger.Connection](t, e.as(e.bert, "GET", "/api/connections", "").body); c[0].Status != "expired" {
		t.Errorf("after a lapsed session: %s", c[0].Status)
	}
	e.db.QueryRow(`SELECT last_error FROM provider_connections WHERE id = 1`).Scan(&code)
	if code != "session_expired" {
		t.Errorf("stored error %q", code)
	}
	// An expired connection is left alone until it is re-authorised.
	fetches := len(e.bank.fetched)
	e.now = e.now.Add(16 * time.Minute)
	e.as(e.bert, "POST", "/api/sync", "")
	if len(e.bank.fetched) != fetches {
		t.Error("an expired connection was synced")
	}
	if n := e.count(`SELECT COUNT(*) FROM transactions`); n != 4 {
		t.Errorf("failed syncs changed the stored rows: %d", n)
	}
}

func TestBankLinkPrivacyAndLimits(t *testing.T) {
	e := newBankEnv(t)
	e.saveCredentials(e.bert)
	e.link(e.bert, "")
	e.saveCredentials(e.partner)

	// Bert's connection is not Partner's to use: 404, like a missing one.
	other := e.as(e.partner, "POST", "/api/bank/link", `{"connectionId": 1}`)
	missing := e.as(e.partner, "POST", "/api/bank/link", `{"connectionId": 99}`)
	expectError(t, other, http.StatusNotFound, "not_found")
	if other.body != missing.body {
		t.Errorf("someone else's connection %s, a missing one %s", other.body, missing.body)
	}
	expectError(t, e.as(e.partner, "POST", "/api/bank/link", `{"connectionId": 0}`), http.StatusNotFound, "not_found")
	expectError(t, e.as(e.partner, "POST", "/api/bank/link", `{"connection": 2}`), http.StatusBadRequest, "invalid")
	conns := decode[[]ledger.Connection](t, e.as(e.partner, "GET", "/api/connections", "").body)
	if len(conns) != 1 || conns[0].ID != 2 || conns[0].Status != "pending" {
		t.Errorf("Partner's connections: %+v", conns)
	}

	// 10 links per user per hour; the three 404s above count, the bad body not.
	for range 7 {
		if r := e.as(e.partner, "POST", "/api/bank/link", ""); r.status != http.StatusOK {
			t.Fatalf("link: %d %s", r.status, r.body)
		}
	}
	r := e.as(e.partner, "POST", "/api/bank/link", "")
	expectError(t, r, http.StatusTooManyRequests, "rate_limited")
	if r.header.Get("Retry-After") == "" {
		t.Error("no Retry-After")
	}
	if r := e.as(e.bert, "POST", "/api/bank/link", ""); r.status != http.StatusOK {
		t.Errorf("Bert has his own limit: %d", r.status)
	}

	// Without public_url linking cannot send anyone back.
	e2 := newBankEnv(t)
	e2.s.opts.PublicURL = ""
	e2.saveCredentials(e2.bert)
	equalJSON(t, e2.as(e2.bert, "GET", "/api/bank/enablebanking", "").body,
		`{"configured": true, "applicationId": "`+testAppID+`", "redirectUrl": null}`)
	expectError(t, e2.as(e2.bert, "POST", "/api/bank/link", ""), http.StatusServiceUnavailable, "unavailable")

	// Without the bank service the routes answer 503.
	h := New(Options{DB: e.db, Version: "test", Clock: demoClock, Viewer: func(*http.Request) (int64, bool) { return 1, true }})
	for _, c := range []struct{ method, path, body string }{
		{"GET", "/api/bank/enablebanking", ""},
		{"PUT", "/api/bank/enablebanking", `{}`},
		{"POST", "/api/bank/link", ""},
		{"POST", "/api/bank/callback", `{}`},
	} {
		expectError(t, do(t, h, c.method, c.path, c.body), http.StatusServiceUnavailable, "unavailable")
	}
}

// Demo mode walks the whole wizard through the same code with the fake bank.
func TestBankDemoWizard(t *testing.T) {
	for _, tc := range []struct {
		name     string
		as       []func(*Options)
		accounts []int64
	}{
		{"Bert", nil, []int64{1, 4}},
		{"Partner", []func(*Options){asPartner}, []int64{4, 5}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			box, err := secrets.Load(filepath.Join(t.TempDir(), "secret.key"))
			if err != nil {
				t.Fatal(err)
			}
			h, d := demoServer(t, append(tc.as, func(o *Options) {
				o.Bank = banklink.New(o.DB, box, demo.Bank, nil, nil)
			})...)
			equalJSON(t, do(t, h, "GET", "/api/bank/enablebanking", "").body,
				`{"configured": true, "applicationId": "demo", "redirectUrl": "http://example.com/bankkoppelingen/terug"}`)
			if msg := expectError(t, do(t, h, "PUT", "/api/bank/enablebanking", `{"applicationId":"x","privateKey":"y"}`),
				http.StatusBadRequest, "invalid"); msg != "Niet beschikbaar in de demo." {
				t.Errorf("PUT in demo: %q", msg)
			}

			var rows, snapshots int
			d.QueryRow(`SELECT COUNT(*) FROM transactions`).Scan(&rows)
			d.QueryRow(`SELECT COUNT(*) FROM balance_snapshots`).Scan(&snapshots)

			r := do(t, h, "POST", "/api/bank/link", "")
			if r.status != http.StatusOK {
				t.Fatalf("link: %d %s", r.status, r.body)
			}
			u, err := url.Parse(decode[map[string]string](t, r.body)["url"])
			if err != nil || u.Scheme+"://"+u.Host+u.Path != "http://example.com/bankkoppelingen/terug" || u.Query().Get("code") != "demo" {
				t.Fatalf("demo consent URL %v", u)
			}
			r = do(t, h, "POST", "/api/bank/callback", jsonBody(map[string]string{"code": u.Query().Get("code"), "state": u.Query().Get("state")}))
			if r.status != http.StatusOK {
				t.Fatalf("callback: %d %s", r.status, r.body)
			}
			got := decode[callbackBody](t, r.body)
			if !slices.Equal(accountIDs(got.Accounts), tc.accounts) || len(got.Skipped) != 0 ||
				got.Connection.Status != "ok" || *got.Connection.LastSync != "2026-11-18T20:00:00+01:00" || *got.Connection.ValidUntil != "2027-05-17" {
				t.Errorf("demo callback: %s", r.body)
			}
			var after, accounts, afterSnapshots int
			d.QueryRow(`SELECT COUNT(*) FROM transactions`).Scan(&after)
			d.QueryRow(`SELECT COUNT(*) FROM accounts`).Scan(&accounts)
			d.QueryRow(`SELECT COUNT(*) FROM balance_snapshots`).Scan(&afterSnapshots)
			if after != rows || accounts != 5 || afterSnapshots != snapshots+2 {
				t.Errorf("re-matching the demo made duplicates: rows %d → %d, %d accounts, snapshots %d → %d",
					rows, after, accounts, snapshots, afterSnapshots)
			}
		})
	}
}

func accountIDs(list []ledger.Account) []int64 {
	ids := []int64{}
	for _, a := range list {
		ids = append(ids, a.ID)
	}
	return ids
}
