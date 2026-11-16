package banklink

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/enablebanking"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/secrets"
)

// linkEnv is a viewer with one pending connection and a Service whose bank is
// open: the link is made with Complete, as the callback does.
func linkEnv(t *testing.T, open Opener) (*Service, *syncEnv) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	box, err := secrets.Load(filepath.Join(t.TempDir(), "secret.key"))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.com', 'A')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := d.Exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, aspsp_country, application_id, private_key_enc, status)
		VALUES (1, 1, 'enablebanking', 'Argenta', 'BE', 'app', ?, 'pending')`, box.Seal([]byte("key"))); err != nil {
		t.Fatal(err)
	}
	svc := New(d, box, open, nil, nil)
	return svc, &syncEnv{t: t, db: d, box: box, svc: svc}
}

// checkTwoAccountsSynced links through Complete, syncs with "Sync now" and
// asserts that both accounts of the one connection were fetched and stored.
func checkTwoAccountsSynced(t *testing.T, svc *Service, e *syncEnv, code string, wantTxs [2]string) {
	t.Helper()
	ctx := context.Background()
	now := at(18, 10, 0)

	state := svc.states.add(1, 1)
	linked, err := svc.Complete(ctx, 1, code, state, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(linked.Accounts) != 2 || len(linked.Skipped) != 0 {
		t.Fatalf("linked %+v, want two accounts and none skipped", linked)
	}
	if got := e.query(`SELECT COUNT(*) FROM account_sources WHERE connection_id = 1 AND external_account_id IS NOT NULL`); got != "2" {
		t.Fatalf("account_sources with a provider id: %s, want 2", got)
	}

	if err := svc.Sync(ctx, 1, now); err != nil {
		t.Fatal(err)
	}
	for i, id := range linked.Accounts {
		if got := e.query(fmt.Sprintf(`SELECT COUNT(*) FROM transactions WHERE account_id = %d`, id)); got != wantTxs[i] {
			t.Errorf("account %d: %s transactions, want %s", id, got, wantTxs[i])
		}
		if got := e.query(fmt.Sprintf(`SELECT COUNT(*) FROM balance_snapshots WHERE account_id = %d AND origin = 'bank'`, id)); got != "1" {
			t.Errorf("account %d: %s bank balance snapshots, want 1", id, got)
		}
		if got := e.query(fmt.Sprintf(`SELECT status, last_sync_at, COALESCE(last_error, '-') FROM account_sources
			WHERE account_id = %d AND connection_id = 1`, id)); got != "ok "+now.UTC().Format(time.RFC3339)+" -" {
			t.Errorf("account %d: source %q, want ok with a fresh last_sync_at", id, got)
		}
	}
	if got := e.query(`SELECT sync_status, last_sync_at, COALESCE(last_error, '-') FROM provider_connections WHERE id = 1`); got != "ok "+now.UTC().Format(time.RFC3339)+" -" {
		t.Errorf("connection: %q", got)
	}
}

// One consent over two accounts (the fake bank's Bert session: his own account
// and the shared one) feeds both accounts.
func TestLinkWithTwoAccountsSyncsBoth(t *testing.T) {
	open := func(int64, string, []byte) (Client, error) { return fake.Client{Session: fake.SessionBert}, nil }
	svc, e := linkEnv(t, open)
	// The story's row count per account on the demo date.
	sess := bank.Session{ID: fake.SessionBert}
	accs, err := fake.Provider{}.ListAccounts(context.Background(), sess)
	if err != nil || len(accs) != 2 {
		t.Fatalf("fake accounts: %d, %v", len(accs), err)
	}
	var want [2]string
	for i, a := range accs {
		txs, err := fake.Provider{}.FetchTransactions(context.Background(), sess, a.ID, "", "2026-11-18")
		if err != nil || len(txs) == 0 {
			t.Fatalf("story of %s: %d rows, %v", a.IBAN, len(txs), err)
		}
		want[i] = fmt.Sprint(len(txs))
	}
	checkTwoAccountsSynced(t, svc, e, fake.DemoCode, want)
}

// The same through the real client against a test server that answers like
// Enable Banking: a session with two accounts, and per account its own
// transactions and balances under its own uid.
func TestLinkWithTwoAccountsSyncsBothEnableBanking(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})

	tx := func(ref, amount string) string {
		return `{"entry_reference":"` + ref + `","transaction_amount":{"currency":"EUR","amount":"` + amount + `"},` +
			`"credit_debit_indicator":"DBIT","status":"BOOK","booking_date":"2026-11-10","value_date":"2026-11-10",` +
			`"creditor":{"name":"Winkel ` + ref + `"},"remittance_information":["x"]}`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch p := r.URL.Path; {
		case r.Method == http.MethodPost && p == "/sessions":
			fmt.Fprint(w, `{"session_id":"sess-2","aspsp":{"name":"Argenta","country":"BE"},
				"access":{"valid_until":"2027-05-03T10:00:00.000000+00:00"},
				"accounts":[
				  {"uid":"uid-1","account_id":{"iban":"BE68 5390 0754 7034"},"product":"Zichtrekening","currency":"EUR"},
				  {"uid":"uid-2","account_id":{"iban":"BE71 0961 2345 6769"},"product":"Gezinsrekening","currency":"EUR"}]}`)
		case p == "/accounts/uid-1/transactions":
			fmt.Fprint(w, `{"transactions":[`+tx("r1", "10.00")+`,`+tx("r2", "20.00")+`]}`)
		case p == "/accounts/uid-2/transactions":
			fmt.Fprint(w, `{"transactions":[`+tx("r3", "30.00")+`]}`)
		case strings.HasSuffix(p, "/balances") && strings.HasPrefix(p, "/accounts/uid-"):
			fmt.Fprint(w, `{"balances":[{"balance_amount":{"currency":"EUR","amount":"100.00"},"balance_type":"CLBD","reference_date":"2026-11-17"}]}`)
		default:
			t.Errorf("unexpected %s %s", r.Method, p)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)

	open := func(int64, string, []byte) (Client, error) {
		c, err := enablebanking.New("00000000-0000-4000-8000-000000000001", keyPEM)
		if err != nil {
			return nil, err
		}
		c.BaseURL, c.HTTP = srv.URL, srv.Client()
		return c, nil
	}
	svc, e := linkEnv(t, open)
	checkTwoAccountsSynced(t, svc, e, "code-2", [2]string{"2", "1"})
}
