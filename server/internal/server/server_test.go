package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// demoClock is 18 November 2026, 20:00 in Brussels.
var demoClock = clock.Fixed(time.Date(2026, 11, 18, 20, 0, 0, 0, clock.Brussels))

func seededDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	ctx := context.Background()
	if _, err := db.Migrate(ctx, d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := demo.Seed(ctx, d, fake.Provider{}, nil); err != nil {
		t.Fatal(err)
	}
	return d
}

// demoServer is the server in demo mode (viewer Bert) on a seeded database.
func demoServer(t *testing.T, edit ...func(*Options)) (http.Handler, *sql.DB) {
	t.Helper()
	d := seededDB(t)
	o := Options{DB: d, Version: "test", Demo: true, Clock: demoClock, Syncer: demo.Syncer{Store: ledger.New(d)}}
	for _, e := range edit {
		e(&o)
	}
	return New(o), d
}

func asPartner(o *Options) {
	o.Viewer = func(*http.Request) (int64, bool) { return demo.Partner, true }
}

type response struct {
	status int
	header http.Header
	body   string
}

func do(t *testing.T, h http.Handler, method, target, body string) response {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, r)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return response{status: rec.Code, header: rec.Header(), body: rec.Body.String()}
}

// equalJSON compares a body with the expected JSON, ignoring formatting.
func equalJSON(t *testing.T, got, want string) {
	t.Helper()
	var g, w any
	if err := json.Unmarshal([]byte(got), &g); err != nil {
		t.Fatalf("invalid JSON %q: %v", got, err)
	}
	if err := json.Unmarshal([]byte(want), &w); err != nil {
		t.Fatalf("bad expectation: %v", err)
	}
	if !reflect.DeepEqual(g, w) {
		t.Errorf("JSON differs\n got: %s\nwant: %s", strings.TrimSpace(got), want)
	}
}

func decode[T any](t *testing.T, body string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("decode %q: %v", body, err)
	}
	return v
}

func expectError(t *testing.T, r response, status int, code string) string {
	t.Helper()
	if r.status != status {
		t.Fatalf("status %d, want %d (%s)", r.status, status, r.body)
	}
	if ct := r.header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content type %q", ct)
	}
	e := decode[errorBody](t, r.body)
	if e.Error.Code != code || e.Error.Message == "" {
		t.Errorf("error %+v, want code %s with a message", e.Error, code)
	}
	return e.Error.Message
}

func TestHealth(t *testing.T) {
	h, d := demoServer(t)
	for _, path := range []string{"/api/health", "/healthz"} {
		r := do(t, h, "GET", path, "")
		if r.status != 200 {
			t.Fatalf("%s: %d", path, r.status)
		}
		equalJSON(t, r.body, `{"status": "ok", "version": "test", "demo": true}`)
	}
	d.Close()
	r := do(t, h, "GET", "/healthz", "")
	if r.status != http.StatusServiceUnavailable {
		t.Errorf("health with a closed database: %d", r.status)
	}
}

func TestOutsideDemoModeEverythingButHealthIs401(t *testing.T) {
	d := seededDB(t)
	h := New(Options{DB: d, Version: "test", Clock: demoClock})

	r := do(t, h, "GET", "/api/health", "")
	if r.status != 200 {
		t.Fatalf("health: %d", r.status)
	}
	equalJSON(t, r.body, `{"status": "ok", "version": "test", "demo": false}`)

	calls := []struct{ method, path, body string }{
		{"GET", "/api/me", ""},
		{"PUT", "/api/me/preferences", `{"scope":"gedeeld"}`},
		{"GET", "/api/accounts", ""},
		{"PATCH", "/api/accounts/1", `{"name":"x"}`},
		{"GET", "/api/transactions", ""},
		{"GET", "/api/transactions?account=1", ""},
		{"GET", "/api/alerts", ""},
		{"GET", "/api/connections", ""},
		{"POST", "/api/sync", ""},
		{"GET", "/api/sync", ""},
		{"GET", "/api/bank/enablebanking", ""},
		{"PUT", "/api/bank/enablebanking", `{"applicationId":"x","privateKey":"y"}`},
		{"POST", "/api/bank/link", ""},
		{"POST", "/api/bank/callback", `{"code":"x","state":"y"}`},
		{"GET", "/api/unknown", ""},
		{"PATCH", "/api/me", `{"name":"x"}`},
		{"PUT", "/api/me/password", `{"current":"x","new":"y"}`},
		{"POST", "/api/auth/logout", ""},
		{"GET", "/api/devices", ""},
		{"DELETE", "/api/devices/1", ""},
		{"POST", "/api/devices/sign-out-others", ""},
		{"GET", "/api/users", ""},
		{"POST", "/api/users/invitations", `{"email":"x@example.com","role":"user"}`},
		{"DELETE", "/api/users/invitations/1", ""},
		{"POST", "/api/users/1/password-reset", ""},
		{"GET", "/api/auth/token/../../me", ""},
	}
	for _, c := range calls {
		r := do(t, h, c.method, c.path, c.body)
		if msg := expectError(t, r, http.StatusUnauthorized, "unauthorized"); msg != "Log in om verder te gaan." {
			t.Errorf("%s %s: message %q", c.method, c.path, msg)
		}
	}
}

func TestMe(t *testing.T) {
	h, _ := demoServer(t)
	r := do(t, h, "GET", "/api/me", "")
	if r.status != 200 {
		t.Fatalf("status %d", r.status)
	}
	equalJSON(t, r.body, `{
		"user": { "id": 1, "name": "Bert", "email": "bert@jouw-domein.be", "role": "admin", "initial": "B" },
		"preferences": { "scope": "alles", "theme": "system" },
		"today": "2026-11-18"
	}`)

	hp, _ := demoServer(t, asPartner)
	r = do(t, hp, "GET", "/api/me", "")
	me := decode[meBody](t, r.body)
	if me.User.ID != 2 || me.User.Role != "user" || me.User.Initial != "P" {
		t.Errorf("Partner: %+v", me.User)
	}
}

func TestPreferences(t *testing.T) {
	h, _ := demoServer(t)
	r := do(t, h, "PUT", "/api/me/preferences", `{"scope":"gedeeld"}`)
	if r.status != 200 {
		t.Fatalf("status %d: %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"scope": "gedeeld", "theme": "system"}`)
	r = do(t, h, "PUT", "/api/me/preferences", `{"theme":"dark"}`)
	equalJSON(t, r.body, `{"scope": "gedeeld", "theme": "dark"}`)
	r = do(t, h, "GET", "/api/me", "")
	if me := decode[meBody](t, r.body); me.Preferences.Scope != "gedeeld" || me.Preferences.Theme != "dark" {
		t.Errorf("stored preferences: %+v", me.Preferences)
	}

	for _, body := range []string{`{"scope":"iedereen"}`, `{"theme":"blauw"}`, `{}`, `{"scope":"alles","extra":1}`, `{"scope":`, `[1]`, `{"scope":"alles"} {}`} {
		expectError(t, do(t, h, "PUT", "/api/me/preferences", body), http.StatusBadRequest, "invalid")
	}

	req := httptest.NewRequest("PUT", "/api/me/preferences", strings.NewReader(`{"scope":"alles"}`))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	expectError(t, response{rec.Code, rec.Header(), rec.Body.String()}, http.StatusUnsupportedMediaType, "unsupported_media_type")

	big := `{"scope":"` + strings.Repeat("a", maxBody) + `"}`
	expectError(t, do(t, h, "PUT", "/api/me/preferences", big), http.StatusRequestEntityTooLarge, "too_large")
}

// The first account is exactly the example of docs/api.md.
func TestAccounts(t *testing.T) {
	h, _ := demoServer(t)
	r := do(t, h, "GET", "/api/accounts", "")
	if r.status != 200 {
		t.Fatalf("status %d", r.status)
	}
	list := decode[[]json.RawMessage](t, r.body)
	if len(list) != 4 {
		t.Fatalf("%d accounts", len(list))
	}
	equalJSON(t, string(list[0]), `{
		"id": 1, "name": "Zichtrekening", "type": "current", "source": "bank", "kind": "personal",
		"iban": "BE68 •••• •••• 4821", "colour": "green", "buffer": 90000, "balance": 196882,
		"balanceDate": "2026-11-18", "state": "ok", "bank": "Argenta", "lastSync": "2026-11-18T04:02:00+01:00",
		"syncStatus": "ok", "permission": "edit", "role": "manager", "members": []
	}`)
	equalJSON(t, string(list[1]), `{
		"id": 2, "name": "Spaarrekening", "type": "savings", "source": "manual", "kind": "personal",
		"iban": "BE41 •••• •••• 1196", "colour": "orange", "buffer": 0, "balance": 1250000,
		"balanceDate": "2026-10-02", "state": null, "bank": null, "lastSync": null,
		"syncStatus": null, "permission": "edit", "role": "manager", "members": []
	}`)
	equalJSON(t, string(list[3]), `{
		"id": 4, "name": "Gedeelde rekening", "type": "current", "source": "bank", "kind": "shared",
		"iban": "BE12 •••• •••• 7730", "colour": "violet", "buffer": 60000, "balance": 94608,
		"balanceDate": "2026-11-18", "state": "ok", "bank": "Argenta", "lastSync": "2026-11-18T04:02:00+01:00",
		"syncStatus": "ok", "permission": "edit", "role": "manager",
		"members": [
			{"name": "Bert", "initial": "B", "role": "manager", "permission": "edit", "me": true},
			{"name": "Partner", "initial": "P", "role": "member", "permission": "edit", "me": false}
		]
	}`)
}

func TestPatchAccount(t *testing.T) {
	h, d := demoServer(t)
	r := do(t, h, "PATCH", "/api/accounts/1", `{"name":"Dagelijks","colour":"blue","buffer":120000}`)
	if r.status != 200 {
		t.Fatalf("status %d: %s", r.status, r.body)
	}
	a := decode[ledger.Account](t, r.body)
	if a.ID != 1 || a.Name != "Dagelijks" || a.Colour != "blue" || a.Buffer != 120000 || *a.State != "ok" {
		t.Errorf("patched: %+v", a)
	}
	r = do(t, h, "GET", "/api/accounts", "")
	if list := decode[[]ledger.Account](t, r.body); list[0].Name != "Dagelijks" {
		t.Errorf("not stored: %+v", list[0])
	}

	invalid := map[string]string{
		`{"name":""}`:        "De naam moet tussen 1 en 40 tekens lang zijn.",
		`{"colour":"red"}`:   "Kies een van de acht rekeningkleuren.",
		`{"buffer":-100}`:    "De buffer kan niet negatief zijn.",
		`{"buffer":90050}`:   "De buffer is een bedrag in hele euro.",
		`{"buffer":900.5}`:   "De gegevens kloppen niet.",
		`{}`:                 "Geef een naam, een kleur of een buffer op.",
		`{"owner":2}`:        "De gegevens kloppen niet.",
		`{"buffer":"90000"}`: "De gegevens kloppen niet.",
	}
	for body, want := range invalid {
		if msg := expectError(t, do(t, h, "PATCH", "/api/accounts/1", body), http.StatusBadRequest, "invalid"); msg != want {
			t.Errorf("%s: %q, want %q", body, msg, want)
		}
	}
	if msg := expectError(t, do(t, h, "PATCH", "/api/accounts/2", `{"buffer":10000}`), http.StatusBadRequest, "invalid"); msg != "Alleen een zichtrekening heeft een buffer." {
		t.Errorf("savings buffer: %q", msg)
	}
	for _, path := range []string{"/api/accounts/5", "/api/accounts/999", "/api/accounts/abc", "/api/accounts/-1"} {
		expectError(t, do(t, h, "PATCH", path, `{"name":"x"}`), http.StatusNotFound, "not_found")
	}

	d.Exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 1`)
	expectError(t, do(t, h, "PATCH", "/api/accounts/4", `{"colour":"teal"}`), http.StatusForbidden, "forbidden")
	r = do(t, h, "GET", "/api/accounts", "")
	if list := decode[[]ledger.Account](t, r.body); list[3].Permission != "read" || list[3].Colour != "violet" {
		t.Errorf("read-only account: %+v", list[3])
	}
}

type pageBody struct {
	Items []json.RawMessage `json:"items"`
	Next  *string           `json:"next"`
}

func TestTransactions(t *testing.T) {
	h, _ := demoServer(t)
	r := do(t, h, "GET", "/api/transactions", "")
	if r.status != 200 {
		t.Fatalf("status %d", r.status)
	}
	page := decode[pageBody](t, r.body)
	if len(page.Items) != 50 || page.Next == nil || *page.Next == "" {
		t.Fatalf("default page: %d items, next %v", len(page.Items), page.Next)
	}
	first := decode[map[string]any](t, string(page.Items[0]))
	delete(first, "id")
	b, _ := json.Marshal(first)
	equalJSON(t, string(b), `{
		"accountId": 1, "bookingDate": "2026-11-18", "amount": -2499, "counterparty": "Bol.com",
		"communication": "Bestelling 4471-2210", "status": "pending", "category": null, "transfer": false
	}`)
	second := decode[ledger.Transaction](t, string(page.Items[1]))
	if second.Category == nil || *second.Category != (ledger.Category{ID: 2, Name: "Boodschappen", Colour: "c2"}) {
		t.Errorf("Colruyt's category: %+v", second.Category)
	}

	// Following next gives the following rows, without overlap.
	r2 := do(t, h, "GET", "/api/transactions?limit=50&before="+*page.Next, "")
	page2 := decode[pageBody](t, r2.body)
	last := decode[ledger.Transaction](t, string(page.Items[49]))
	next := decode[ledger.Transaction](t, string(page2.Items[0]))
	if next.BookingDate > last.BookingDate || (next.BookingDate == last.BookingDate && next.ID >= last.ID) {
		t.Errorf("page 2 starts at %+v after %+v", next, last)
	}

	r = do(t, h, "GET", "/api/transactions?uncategorised=1", "")
	page = decode[pageBody](t, r.body)
	if len(page.Items) != 4 || page.Next != nil {
		t.Errorf("uncategorised: %d items, next %v", len(page.Items), page.Next)
	}
	r = do(t, h, "GET", "/api/transactions?scope=gedeeld&limit=200", "")
	for _, raw := range decode[pageBody](t, r.body).Items {
		if tx := decode[ledger.Transaction](t, string(raw)); tx.AccountID != 4 {
			t.Fatalf("gedeeld holds account %d", tx.AccountID)
		}
	}
	r = do(t, h, "GET", "/api/transactions?account=1&q=graankorrel", "")
	page = decode[pageBody](t, r.body)
	if len(page.Items) != 1 {
		t.Errorf("search: %s", r.body)
	}
	r = do(t, h, "GET", "/api/transactions?limit=1000", "")
	if n := len(decode[pageBody](t, r.body).Items); n != 200 {
		t.Errorf("limit cap: %d", n)
	}

	expectError(t, do(t, h, "GET", "/api/transactions?account=5", ""), http.StatusNotFound, "not_found")
	expectError(t, do(t, h, "GET", "/api/transactions?account=abc", ""), http.StatusNotFound, "not_found")
	expectError(t, do(t, h, "GET", "/api/transactions?scope=iedereen", ""), http.StatusBadRequest, "invalid")
	expectError(t, do(t, h, "GET", "/api/transactions?limit=0", ""), http.StatusBadRequest, "invalid")
	expectError(t, do(t, h, "GET", "/api/transactions?limit=x", ""), http.StatusBadRequest, "invalid")
	expectError(t, do(t, h, "GET", "/api/transactions?uncategorised=ja", ""), http.StatusBadRequest, "invalid")
	expectError(t, do(t, h, "GET", "/api/transactions?before=garbage", ""), http.StatusBadRequest, "invalid")
	expectError(t, do(t, h, "GET", "/api/transactions?q="+strings.Repeat("x", 101), ""), http.StatusBadRequest, "invalid")
}

func TestAlerts(t *testing.T) {
	h, _ := demoServer(t)
	r := do(t, h, "GET", "/api/alerts", "")
	if r.status != 200 {
		t.Fatalf("status %d", r.status)
	}
	equalJSON(t, r.body, `[
		{ "kind": "warn", "type": "consent", "title": "Toestemming verloopt over 12 dagen", "note": "Argenta · opnieuw autoriseren", "href": "/bankkoppelingen" },
		{ "kind": "ok", "type": "categorise", "title": "4 transacties te categoriseren", "note": "", "href": "/transacties?filter=niet-gecategoriseerd" }
	]`)
}

func TestConnections(t *testing.T) {
	h, _ := demoServer(t)
	r := do(t, h, "GET", "/api/connections", "")
	if r.status != 200 {
		t.Fatalf("status %d", r.status)
	}
	equalJSON(t, r.body, `[
		{ "id": 1, "bank": "Argenta", "since": "2026-06-03", "validUntil": "2026-11-30", "daysLeft": 12, "lastSync": "2026-11-18T04:02:00+01:00", "status": "ok", "accounts": [1, 4] }
	]`)
}

func TestSyncRateLimit(t *testing.T) {
	now := time.Date(2026, 11, 18, 21, 15, 0, 0, clock.Brussels)
	h, _ := demoServer(t, func(o *Options) {
		o.Clock = clock.Fixed(now)
		o.Now = func() time.Time { return now }
	})
	r := do(t, h, "POST", "/api/sync", "")
	if r.status != http.StatusAccepted {
		t.Fatalf("first sync: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"started": true}`)
	waitSync(t, h)
	r = do(t, h, "GET", "/api/connections", "")
	if c := decode[[]ledger.Connection](t, r.body); *c[0].LastSync != "2026-11-18T21:15:00+01:00" {
		t.Errorf("last sync after Sync now: %s", *c[0].LastSync)
	}

	now = now.Add(10 * time.Minute)
	r = do(t, h, "POST", "/api/sync", "")
	msg := expectError(t, r, http.StatusTooManyRequests, "rate_limited")
	if msg != "Je hebt net gesynchroniseerd. Probeer het over 5 minuten opnieuw." || r.header.Get("Retry-After") != "300" {
		t.Errorf("429: %q, Retry-After %q", msg, r.header.Get("Retry-After"))
	}
	now = now.Add(4*time.Minute + 30*time.Second)
	if msg := expectError(t, do(t, h, "POST", "/api/sync", ""), http.StatusTooManyRequests, "rate_limited"); !strings.Contains(msg, "1 minuut") {
		t.Errorf("singular: %q", msg)
	}
	now = now.Add(30 * time.Second)
	if r := do(t, h, "POST", "/api/sync", ""); r.status != http.StatusAccepted {
		t.Errorf("after 15 minutes: %d", r.status)
	}

	h2, _ := demoServer(t, func(o *Options) { o.Syncer = nil })
	expectError(t, do(t, h2, "POST", "/api/sync", ""), http.StatusServiceUnavailable, "unavailable")
}

// waitSync polls GET /api/sync, as the web app does, until no sync runs.
func waitSync(t *testing.T, h http.Handler) syncBody {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		b := decode[syncBody](t, do(t, h, "GET", "/api/sync", "").body)
		if !b.Running {
			return b
		}
		if time.Now().After(deadline) {
			t.Fatal("the sync does not end")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

var fullIBAN = regexp.MustCompile(`[A-Z]{2}\d{2}[A-Z0-9]{8,30}`)

// Privacy (analysis 2): Bert never sees Partner's own account in any
// endpoint, Partner never sees Bert's personal accounts, and a hidden
// account answers 404.
func TestPrivacyEndpoints(t *testing.T) {
	h, _ := demoServer(t)
	hp, _ := demoServer(t, asPartner)

	collect := func(h http.Handler) map[string]string {
		bodies := map[string]string{}
		for _, path := range []string{"/api/me", "/api/accounts", "/api/alerts", "/api/connections",
			"/api/transactions?scope=persoonlijk&limit=200", "/api/transactions?scope=gedeeld&limit=200"} {
			r := do(t, h, "GET", path, "")
			if r.status != 200 {
				t.Fatalf("%s: %d", path, r.status)
			}
			bodies[path] = r.body
		}
		next := ""
		for i := 0; ; i++ {
			r := do(t, h, "GET", "/api/transactions?limit=200&before="+next, "")
			bodies["/api/transactions#"+string(rune('a'+i))] = r.body
			p := decode[pageBody](t, r.body)
			if p.Next == nil {
				break
			}
			next = *p.Next
		}
		return bodies
	}

	accountsOf := func(h http.Handler) []int64 {
		var ids []int64
		for _, a := range decode[[]ledger.Account](t, do(t, h, "GET", "/api/accounts", "").body) {
			ids = append(ids, a.ID)
		}
		return ids
	}
	if got := accountsOf(h); !reflect.DeepEqual(got, []int64{1, 2, 3, 4}) {
		t.Errorf("Bert's accounts: %v", got)
	}
	if got := accountsOf(hp); !reflect.DeepEqual(got, []int64{4, 5}) {
		t.Errorf("Partner's accounts: %v", got)
	}

	cases := []struct {
		name    string
		h       http.Handler
		visible map[int64]bool
		hidden  []string // hidden account ids
		secrets []string // text that must never appear
	}{
		{"Bert", h, map[int64]bool{1: true, 2: true, 3: true, 4: true}, []string{"5"},
			[]string{"•••• 5038", "Lidl", "Zara", "Werkgever BV", "Basic-Fit", "De Lijn", "pink"}},
		{"Partner", hp, map[int64]bool{4: true, 5: true}, []string{"1", "2", "3"},
			[]string{"•••• 4821", "•••• 1196", "Spaarrekening", "Reserve", "Werkgever NV", "Immo Verhaeghe", "Kinepolis", "Bol.com"}},
	}
	for _, c := range cases {
		for path, body := range collect(c.h) {
			text := body
			if strings.HasPrefix(path, "/api/transactions") {
				// Check the rows only: the opaque cursor is not data.
				text = ""
				for _, raw := range decode[pageBody](t, body).Items {
					text += string(raw)
					if tx := decode[ledger.Transaction](t, string(raw)); !c.visible[tx.AccountID] {
						t.Errorf("%s sees transaction %d of account %d", c.name, tx.ID, tx.AccountID)
					}
				}
			}
			for _, secret := range c.secrets {
				if strings.Contains(text, secret) {
					t.Errorf("%s: %s contains %q", c.name, path, secret)
				}
			}
			if m := fullIBAN.FindString(text); m != "" {
				t.Errorf("%s: %s contains an unmasked IBAN %s", c.name, path, m)
			}
		}
		for _, id := range c.hidden {
			expectError(t, do(t, c.h, "GET", "/api/transactions?account="+id, ""), http.StatusNotFound, "not_found")
			expectError(t, do(t, c.h, "PATCH", "/api/accounts/"+id, `{"name":"Gezien"}`), http.StatusNotFound, "not_found")
		}
	}

	// A hidden account and a missing one answer the same.
	a := do(t, h, "PATCH", "/api/accounts/5", `{"name":"x"}`)
	b := do(t, h, "PATCH", "/api/accounts/999", `{"name":"x"}`)
	if a.status != b.status || a.body != b.body {
		t.Errorf("hidden %d %s vs missing %d %s", a.status, a.body, b.status, b.body)
	}
	// Partner's alerts and connections are hers.
	equalJSON(t, do(t, hp, "GET", "/api/connections", "").body, `[
		{ "id": 2, "bank": "Argenta", "since": "2026-06-05", "validUntil": "2026-12-02", "daysLeft": 14, "lastSync": "2026-11-18T04:05:00+01:00", "status": "ok", "accounts": [4, 5] }
	]`)
}

func TestSecurityHeaders(t *testing.T) {
	h, _ := demoServer(t)
	for _, path := range []string{"/api/accounts", "/", "/api/nope"} {
		r := do(t, h, "GET", path, "")
		want := map[string]string{
			"Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
			"X-Content-Type-Options":  "nosniff",
			"Referrer-Policy":         "same-origin",
		}
		for k, v := range want {
			if got := r.header.Get(k); got != v {
				t.Errorf("%s %s = %q", path, k, got)
			}
		}
		if r.header.Get("Permissions-Policy") == "" {
			t.Errorf("%s: no Permissions-Policy", path)
		}
	}
	if r := do(t, h, "GET", "/api/accounts", ""); r.header.Get("Cache-Control") != "no-store" {
		t.Errorf("API cache: %q", r.header.Get("Cache-Control"))
	}
}

func TestRouting(t *testing.T) {
	h, _ := demoServer(t)
	expectError(t, do(t, h, "GET", "/api/nope", ""), http.StatusNotFound, "not_found")
	expectError(t, do(t, h, "GET", "/api", ""), http.StatusNotFound, "not_found")
	expectError(t, do(t, h, "GET", "/api/accounts/", ""), http.StatusNotFound, "not_found")
	r := do(t, h, "GET", "/api/accounts/1", "")
	expectError(t, r, http.StatusMethodNotAllowed, "method_not_allowed")
	if r.header.Get("Allow") != "PATCH" {
		t.Errorf("Allow: %q", r.header.Get("Allow"))
	}
	r = do(t, h, "POST", "/api/accounts", `{}`)
	expectError(t, r, http.StatusMethodNotAllowed, "method_not_allowed")
	if r.header.Get("Allow") != "GET, HEAD" {
		t.Errorf("Allow: %q", r.header.Get("Allow"))
	}
	r = do(t, h, "DELETE", "/api/sync", "")
	expectError(t, r, http.StatusMethodNotAllowed, "method_not_allowed")
	if r.header.Get("Allow") != "GET, POST, HEAD" {
		t.Errorf("Allow: %q", r.header.Get("Allow"))
	}
	if r := do(t, h, "HEAD", "/healthz", ""); r.status != 200 {
		t.Errorf("HEAD /healthz: %d", r.status)
	}
}

func TestPanicRecovery(t *testing.T) {
	s := &Server{log: slog.New(slog.DiscardHandler)}
	h := s.recoverPanics(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/accounts", nil))
	expectError(t, response{rec.Code, rec.Header(), rec.Body.String()}, http.StatusInternalServerError, "internal")
}

func TestWebNotBuilt(t *testing.T) {
	for _, dir := range []string{"", filepath.Join(t.TempDir(), "missing")} {
		h, _ := demoServer(t, func(o *Options) { o.WebDir = dir })
		r := do(t, h, "GET", "/", "")
		if r.status != 200 || r.body != notBuilt || !strings.HasPrefix(r.header.Get("Content-Type"), "text/plain") {
			t.Errorf("web dir %q: %d %q", dir, r.status, r.body)
		}
	}
}

func TestWebApp(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		p := filepath.Join(dir, filepath.FromSlash(name))
		os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", "<!doctype html><title>Saldo</title>")
	write("assets/app-4f3c2a.js", "console.log('saldo')")
	write("favicon.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>")
	write(".env", "SECRET=1")
	outside := filepath.Join(filepath.Dir(dir), "outside.txt")
	os.WriteFile(outside, []byte("outside"), 0o644)
	t.Cleanup(func() { os.Remove(outside) })

	h, _ := demoServer(t, func(o *Options) { o.WebDir = dir })
	index := func(path string) {
		t.Helper()
		r := do(t, h, "GET", path, "")
		if r.status != 200 || !strings.Contains(r.body, "<title>Saldo</title>") {
			t.Errorf("%s: %d %q", path, r.status, r.body)
		}
		if r.header.Get("Cache-Control") != "no-cache" || !strings.HasPrefix(r.header.Get("Content-Type"), "text/html") {
			t.Errorf("%s: headers %v", path, r.header)
		}
	}
	index("/")
	index("/index.html")
	index("/transacties?filter=niet-gecategoriseerd")
	index("/rekeningen/4")
	index("/.env")
	index("/outside.txt")
	if r := do(t, h, "GET", "/../outside.txt", ""); strings.Contains(r.body, "outside") && r.status == 200 {
		t.Errorf("served a file outside the web folder: %d %q", r.status, r.body)
	}

	r := do(t, h, "GET", "/assets/app-4f3c2a.js", "")
	if r.status != 200 || r.body != "console.log('saldo')" || r.header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Errorf("asset: %d %q %v", r.status, r.body, r.header)
	}
	if ct := r.header.Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("asset type %q", ct)
	}
	if r := do(t, h, "GET", "/assets/missing.js", ""); r.status != 404 {
		t.Errorf("missing asset: %d", r.status)
	}
	if r := do(t, h, "GET", "/favicon.svg", ""); r.status != 200 || r.header.Get("Cache-Control") != "no-cache" {
		t.Errorf("favicon: %d %v", r.status, r.header)
	}
	if r := do(t, h, "POST", "/", "x"); r.status != http.StatusMethodNotAllowed {
		t.Errorf("POST /: %d", r.status)
	}
	// The API never falls back to the web app.
	expectError(t, do(t, h, "GET", "/api/nope", ""), http.StatusNotFound, "not_found")
}
