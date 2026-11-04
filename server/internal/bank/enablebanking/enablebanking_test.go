package enablebanking

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

const testAppID = "00000000-0000-4000-8000-000000000001"

var testNow = time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)

// testKey is generated once per run; no key is ever committed.
var testKey = sync.OnceValue(func() *rsa.PrivateKey {
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	return k
})

func pkcs1PEM(k *rsa.PrivateKey) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(k)})
}

func pkcs8PEM(t *testing.T, k any) []byte {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(k)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

// verifyJWT checks the token's signature against the test key and returns its
// header and claims.
func verifyJWT(t *testing.T, token string) (header, claims map[string]any) {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token has %d parts", len(parts))
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(&testKey().PublicKey, crypto.SHA256, sum[:], sig); err != nil {
		t.Fatalf("signature does not verify: %v", err)
	}
	for i, out := range []*map[string]any{&header, &claims} {
		b, err := base64.RawURLEncoding.DecodeString(parts[i])
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(b, out); err != nil {
			t.Fatal(err)
		}
	}
	return header, claims
}

// newTestClient runs h behind a test server that also checks every request's
// token, and returns a client with a fixed clock pointed at it.
func newTestClient(t *testing.T, h http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok {
			t.Errorf("%s %s: no bearer token", r.Method, r.URL.Path)
		} else {
			verifyJWT(t, token)
		}
		h(w, r)
	}))
	t.Cleanup(srv.Close)
	c, err := New(testAppID, pkcs8PEM(t, testKey()))
	if err != nil {
		t.Fatal(err)
	}
	c.BaseURL = srv.URL
	c.HTTP = srv.Client()
	c.Now = func() time.Time { return testNow }
	return c
}

func want(t *testing.T, r *http.Request, method, path string) {
	t.Helper()
	if r.Method != method || r.URL.Path != path {
		t.Errorf("got %s %s, want %s %s", r.Method, r.URL.Path, method, path)
	}
}

func TestNewParsesKeys(t *testing.T) {
	ec, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name    string
		appID   string
		pem     []byte
		wantErr string
	}{
		{"pkcs1", testAppID, pkcs1PEM(testKey()), ""},
		{"pkcs8", testAppID, pkcs8PEM(t, testKey()), ""},
		{"empty app id", "", pkcs1PEM(testKey()), "application id"},
		{"not pem", testAppID, []byte("hello"), "not in PEM format"},
		{"ec key", testAppID, pkcs8PEM(t, ec), "not an RSA key"},
		{"certificate", testAppID, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: []byte{1}}), `"CERTIFICATE"`},
		{"broken pkcs1", testAppID, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: []byte{1, 2}}), "invalid PKCS#1"},
		{"encrypted", testAppID, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Headers: map[string]string{"Proc-Type": "4,ENCRYPTED"}, Bytes: []byte{1}}), "encrypted"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := New(tc.appID, tc.pem)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("got %v, want an error with %q", err, tc.wantErr)
			}
		})
	}
}

func TestTokenClaims(t *testing.T) {
	c := newTestClient(t, nil)
	token, err := c.bearer()
	if err != nil {
		t.Fatal(err)
	}
	header, claims := verifyJWT(t, token)
	if header["typ"] != "JWT" || header["alg"] != "RS256" || header["kid"] != testAppID {
		t.Errorf("header %v", header)
	}
	iat, exp := claims["iat"].(float64), claims["exp"].(float64)
	if claims["iss"] != "enablebanking.com" || claims["aud"] != "api.enablebanking.com" || int64(iat) != testNow.Unix() {
		t.Errorf("claims %v", claims)
	}
	if life := exp - iat; life <= 0 || life > 24*3600/2 {
		t.Errorf("token lives %v s, want well under 24 h", life)
	}
}

func TestTokenRenewedAfterExpiry(t *testing.T) {
	c := newTestClient(t, nil)
	now := testNow
	c.Now = func() time.Time { return now }
	first, _ := c.bearer()
	now = now.Add(30 * time.Minute)
	if again, _ := c.bearer(); again != first {
		t.Error("a fresh token should be reused")
	}
	now = testNow.Add(tokenLifetime)
	renewed, _ := c.bearer()
	if renewed == first {
		t.Fatal("an expired token should be renewed")
	}
	if _, claims := verifyJWT(t, renewed); int64(claims["iat"].(float64)) != now.Unix() {
		t.Errorf("renewed token iat %v, want %d", claims["iat"], now.Unix())
	}
}

func TestStartAuth(t *testing.T) {
	validUntil := time.Date(2027, 5, 3, 12, 0, 0, 0, time.FixedZone("CEST", 2*3600))
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		want(t, r, http.MethodPost, "/auth")
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		wantBody := map[string]any{
			"access":       map[string]any{"valid_until": "2027-05-03T10:00:00.000000+00:00"},
			"aspsp":        map[string]any{"name": "Argenta", "country": "BE"},
			"state":        "state-1",
			"redirect_url": "https://saldo.example/api/bank/callback",
			"psu_type":     "personal",
		}
		if !reflect.DeepEqual(body, wantBody) {
			t.Errorf("body %v", body)
		}
		fmt.Fprint(w, `{"url":"https://bank.example/consent?id=1","authorization_id":"auth-1","psu_id_hash":"h"}`)
	})
	got, err := c.StartAuth(context.Background(), "Argenta", "BE", "state-1", "https://saldo.example/api/bank/callback", validUntil)
	if err != nil || got != "https://bank.example/consent?id=1" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestCreateSession(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		want(t, r, http.MethodPost, "/sessions")
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["code"] != "code-1" {
			t.Errorf("body %v", body)
		}
		fmt.Fprint(w, `{
			"session_id": "sess-1",
			"accounts": [{
				"uid": "uid-1",
				"account_id": {"iban": "be68 5390 0754 7034"},
				"name": "A. Holder",
				"product": "Zichtrekening",
				"currency": "EUR",
				"cash_account_type": "CACC"
			}],
			"aspsp": {"name": "Argenta", "country": "BE"},
			"psu_type": "personal",
			"access": {"valid_until": "2027-05-03T10:00:00.000000+00:00"}
		}`)
	})
	got, err := c.CreateSession(context.Background(), "code-1")
	if err != nil {
		t.Fatal(err)
	}
	wantInfo := SessionInfo{
		ID:         "sess-1",
		Accounts:   []bank.Account{{ID: "uid-1", IBAN: "BE68539007547034", Name: "Zichtrekening", Currency: "EUR", Bank: "Argenta"}},
		ValidUntil: time.Date(2027, 5, 3, 10, 0, 0, 0, time.UTC),
	}
	if !reflect.DeepEqual(got.Accounts, wantInfo.Accounts) || got.ID != wantInfo.ID || !got.ValidUntil.Equal(wantInfo.ValidUntil) {
		t.Fatalf("got %+v", got)
	}
}

func TestListAccounts(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sessions/sess-1":
			fmt.Fprint(w, `{"status":"AUTHORIZED","accounts":["uid-1"],"aspsp":{"name":"Argenta","country":"BE"}}`)
		case "/accounts/uid-1/details":
			fmt.Fprint(w, `{"account_id":{"iban":"BE68 5390 0754 7034"},"details":"Zichtrekening","currency":"EUR","cash_account_type":"CACC"}`)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})
	got, err := c.ListAccounts(context.Background(), bank.Session{ID: "sess-1"})
	wantAccs := []bank.Account{{ID: "uid-1", IBAN: "BE68539007547034", Name: "Zichtrekening", Currency: "EUR", Bank: "Argenta"}}
	if err != nil || !reflect.DeepEqual(got, wantAccs) {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestListAccountsLapsedSession(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"status":"EXPIRED","accounts":["uid-1"],"aspsp":{"name":"Argenta","country":"BE"}}`)
	})
	if _, err := c.ListAccounts(context.Background(), bank.Session{ID: "sess-1"}); !errors.Is(err, bank.ErrSessionExpired) {
		t.Fatalf("got %v, want ErrSessionExpired", err)
	}
}

// Rows exactly as the test server sends them, so Raw can be compared byte for byte.
const (
	rowOldest  = `{"entry_reference":"ref-1","transaction_amount":{"currency":"EUR","amount":"1500"},"credit_debit_indicator":"CRDT","status":"BOOK","booking_date":"2026-10-25","value_date":"2026-10-25","debtor":{"name":"Werkgever NV"},"debtor_account":{"iban":"nl91 abna 0417 1643 00"},"creditor":{"name":"A. Holder"},"remittance_information":["Loon ","  oktober"]}`
	rowMiddle  = `{"entry_reference":"ref-2","transaction_amount":{"currency":"EUR","amount":"12.3"},"credit_debit_indicator":"DBIT","status":"BOOK","booking_date":"2026-10-28","value_date":"2026-10-27","creditor":{"name":"Bakkerij Voorbeeld"},"creditor_account":{"iban":"BE68539007547034"},"debtor":{"name":"A. Holder"},"remittance_information":["Brood"]}`
	rowPending = `{"transaction_amount":{"currency":"EUR","amount":"4.50"},"credit_debit_indicator":"DBIT","status":"PDNG","value_date":"2026-11-03","creditor":{"name":"Koffiebar"}}`
	rowCancel  = `{"entry_reference":"ref-3","transaction_amount":{"currency":"EUR","amount":"9.99"},"credit_debit_indicator":"DBIT","status":"CNCL","booking_date":"2026-10-29"}`
)

func TestFetchTransactionsPaging(t *testing.T) {
	pages := 0
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		want(t, r, http.MethodGet, "/accounts/uid-1/transactions")
		q := r.URL.Query()
		if q.Get("strategy") != "longest" || q.Has("date_from") {
			t.Errorf("first sync query %v", q)
		}
		pages++
		switch q.Get("continuation_key") {
		case "":
			fmt.Fprintf(w, `{"transactions":[%s,%s],"continuation_key":"page-2"}`, rowOldest, rowMiddle)
		case "page-2":
			fmt.Fprintf(w, `{"transactions":[%s,%s],"continuation_key":null}`, rowCancel, rowPending)
		default:
			t.Errorf("continuation_key %q", q.Get("continuation_key"))
		}
	})
	got, err := c.FetchTransactions(context.Background(), bank.Session{ID: "sess-1"}, "uid-1", "", "2026-11-04")
	if err != nil {
		t.Fatal(err)
	}
	if pages != 2 {
		t.Errorf("fetched %d pages, want 2", pages)
	}
	wantRows := []bank.Transaction{
		{BookingDate: "", ValueDate: "2026-11-03", Amount: -450, Currency: "EUR", CounterpartyName: "Koffiebar", Status: bank.StatusPending, Raw: json.RawMessage(rowPending)},
		{EntryReference: "ref-2", BookingDate: "2026-10-28", ValueDate: "2026-10-27", Amount: -1230, Currency: "EUR", CounterpartyName: "Bakkerij Voorbeeld", CounterpartyIBAN: "BE68539007547034", Communication: "Brood", Status: bank.StatusBooked, Raw: json.RawMessage(rowMiddle)},
		{EntryReference: "ref-1", BookingDate: "2026-10-25", ValueDate: "2026-10-25", Amount: 150000, Currency: "EUR", CounterpartyName: "Werkgever NV", CounterpartyIBAN: "NL91ABNA0417164300", Communication: "Loon oktober", Status: bank.StatusBooked, Raw: json.RawMessage(rowOldest)},
	}
	if !reflect.DeepEqual(got, wantRows) {
		t.Fatalf("got\n%+v\nwant\n%+v", got, wantRows)
	}
}

func TestFetchTransactionsWindow(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("date_from") != "2026-10-01" || q.Get("date_to") != "2026-10-27" || q.Has("strategy") {
			t.Errorf("window query %v", q)
		}
		fmt.Fprintf(w, `{"transactions":[%s,%s]}`, rowOldest, rowMiddle)
	})
	got, err := c.FetchTransactions(context.Background(), bank.Session{ID: "sess-1"}, "uid-1", "2026-10-01", "2026-10-27")
	if err != nil || len(got) != 1 || got[0].EntryReference != "ref-1" {
		t.Fatalf("want only the row booked by date_to, got %+v, %v", got, err)
	}
}

func TestFetchTransactionsRepeatedKey(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"transactions":[],"continuation_key":"same"}`)
	})
	if _, err := c.FetchTransactions(context.Background(), bank.Session{}, "uid-1", "", ""); err == nil {
		t.Fatal("a repeated continuation key should stop the loop with an error")
	}
}

func TestParseCents(t *testing.T) {
	cases := []struct {
		in   string
		want int64
		ok   bool
	}{
		{"12.3", 1230, true},
		{"12.30", 1230, true},
		{"1234", 123400, true},
		{"0.01", 1, true},
		{"0.5", 50, true},
		{"1.230", 123, true},
		{"-25.10", -2510, true},
		{"+7", 700, true},
		{"92233720368547758.07", 9223372036854775807, true},
		{"92233720368547758.08", 0, false},
		{"1.234", 0, false},
		{"", 0, false},
		{"-", 0, false},
		{"1.", 0, false},
		{".5", 0, false},
		{"1,23", 0, false},
		{"1e3", 0, false},
		{" 1", 0, false},
		{"--1", 0, false},
	}
	for _, tc := range cases {
		got, err := parseCents(tc.in)
		if (err == nil) != tc.ok || got != tc.want {
			t.Errorf("parseCents(%q) = %d, %v; want %d, ok %v", tc.in, got, err, tc.want, tc.ok)
		}
	}
}

func TestTransactionSign(t *testing.T) {
	row := func(amount, indicator string) json.RawMessage {
		return json.RawMessage(fmt.Sprintf(`{"transaction_amount":{"currency":"EUR","amount":%q},"credit_debit_indicator":%q,"status":"BOOK","booking_date":"2026-11-01"}`, amount, indicator))
	}
	cases := []struct {
		amount, indicator string
		want              int64
		ok                bool
	}{
		{"12.30", "DBIT", -1230, true},
		{"12.30", "CRDT", 1230, true},
		{"-12.30", "DBIT", -1230, true}, // a signed amount must not flip twice
		{"0.05", "DBIT", -5, true},
		{"12.30", "", 0, false},
	}
	for _, tc := range cases {
		got, _, err := transaction(row(tc.amount, tc.indicator))
		if (err == nil) != tc.ok || got.Amount != tc.want {
			t.Errorf("%s %s: got %d, %v; want %d, ok %v", tc.amount, tc.indicator, got.Amount, err, tc.want, tc.ok)
		}
	}
}

func TestFetchBalances(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		want(t, r, http.MethodGet, "/accounts/uid-1/balances")
		fmt.Fprint(w, `{"balances":[
			{"name":"Booked","balance_amount":{"currency":"EUR","amount":"-25.10"},"balance_type":"CLBD","reference_date":"2026-11-03"},
			{"name":"Available","balance_amount":{"currency":"EUR","amount":"1968.82"},"balance_type":"ITAV","last_change_date_time":"2026-11-04T06:12:00+00:00"}
		]}`)
	})
	got, err := c.FetchBalances(context.Background(), bank.Session{ID: "sess-1"}, "uid-1")
	wantBal := []bank.Balance{{Amount: -2510, Date: "2026-11-03", Type: "CLBD"}, {Amount: 196882, Date: "2026-11-04", Type: "ITAV"}}
	if err != nil || !reflect.DeepEqual(got, wantBal) {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestLapsedSessionErrors(t *testing.T) {
	for _, code := range []string{"EXPIRED_SESSION", "CLOSED_SESSION", "REVOKED_SESSION"} {
		c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprintf(w, `{"code":401,"message":"Session is gone","error":%q}`, code)
		})
		_, err := c.FetchTransactions(context.Background(), bank.Session{ID: "sess-1"}, "uid-1", "2026-10-01", "2026-10-31")
		if !errors.Is(err, bank.ErrSessionExpired) {
			t.Errorf("%s: got %v, want ErrSessionExpired", code, err)
		}
		if _, err := c.FetchBalances(context.Background(), bank.Session{ID: "sess-1"}, "uid-1"); !errors.Is(err, bank.ErrSessionExpired) {
			t.Errorf("%s balances: got %v, want ErrSessionExpired", code, err)
		}
	}
}

func TestErrorsCarryNoSecrets(t *testing.T) {
	const sessionID = "sess-secret-4821"
	var sentToken string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		sentToken = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"code":500,"message":"body-marker","error":"ASPSP_ERROR","detail":"detail-marker"}`)
	})
	_, err := c.ListAccounts(context.Background(), bank.Session{ID: sessionID})
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 500 || apiErr.Code != "ASPSP_ERROR" {
		t.Fatalf("got %v, want an APIError with status and code", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "500") || !strings.Contains(msg, "ASPSP_ERROR") {
		t.Errorf("message %q lacks status or code", msg)
	}
	keyPEM := string(pkcs8PEM(t, testKey()))
	for _, secret := range []string{sentToken, sessionID, "body-marker", "detail-marker", "PRIVATE KEY", keyPEM[40:80]} {
		if secret == "" || strings.Contains(msg, secret) {
			t.Errorf("message %q leaks %q", msg, secret)
		}
	}

	// A transport error must not quote the URL, which holds the session id.
	down := newTestClient(t, nil)
	down.BaseURL = "http://127.0.0.1:1"
	if _, err := down.ListAccounts(context.Background(), bank.Session{ID: sessionID}); err == nil || strings.Contains(err.Error(), sessionID) {
		t.Errorf("transport error %v", err)
	}
}

func TestContextCancelled(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("no request should be sent with a cancelled context")
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.FetchBalances(ctx, bank.Session{}, "uid-1"); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
}
