package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/users"
)

const (
	iPhone      = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
	bertPass    = "lange zin voor bert"
	partnerPass = "Partner kiest een zin"
)

// mailbox records the mails the server sends.
type mailbox struct {
	mu   sync.Mutex
	msgs []mail.Message
}

func (b *mailbox) Send(_ context.Context, m mail.Message) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.msgs = append(b.msgs, m)
	return nil
}

// env is a server outside demo mode on an empty database, with a recorder
// mailer and a clock the test moves.
type env struct {
	t   *testing.T
	s   *Server
	h   http.Handler
	db  *sql.DB
	box *mailbox
	now time.Time
}

func newEnv(t *testing.T, edit ...func(*Options)) *env {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, db: d, box: &mailbox{}, now: time.Date(2026, 11, 18, 19, 0, 0, 0, time.UTC)}
	o := Options{DB: d, Version: "test", Clock: demoClock, Mailer: e.box, PublicURL: "https://saldo.example.com",
		Now: func() time.Time { return e.now }}
	for _, f := range edit {
		f(&o)
	}
	e.s, e.h = newServer(o)
	return e
}

func (e *env) addUser(email, name, role, password string) int64 {
	e.t.Helper()
	res, err := e.db.Exec(`INSERT INTO users (email, display_name, role, password_hash) VALUES (?, ?, ?, ?)`,
		email, name, role, auth.HashPassword(password))
	if err != nil {
		e.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

// mails returns the mails sent since the last call, after waiting for the
// background sends.
func (e *env) mails() []mail.Message {
	e.s.mails.Wait()
	e.box.mu.Lock()
	defer e.box.mu.Unlock()
	m := e.box.msgs
	e.box.msgs = nil
	return m
}

type call struct {
	method, path, body string
	device             string // saldo_device cookie
	header             map[string]string
	remote             string
}

func (e *env) do(c call) response {
	e.t.Helper()
	var body io.Reader
	if c.body != "" {
		body = strings.NewReader(c.body)
	}
	req := httptest.NewRequest(c.method, c.path, body)
	if c.body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("User-Agent", iPhone)
	if c.device != "" {
		req.AddCookie(&http.Cookie{Name: deviceCookie, Value: c.device})
	}
	for k, v := range c.header {
		req.Header.Set(k, v)
	}
	if c.remote != "" {
		req.RemoteAddr = c.remote
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return response{status: rec.Code, header: rec.Header(), body: rec.Body.String()}
}

func (e *env) get(path, device string) response {
	return e.do(call{method: "GET", path: path, device: device})
}

func jsonBody(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

type loginBody struct {
	Challenge string `json:"challenge"`
	Email     string `json:"email"`
}

func (e *env) login(email, password string) loginBody {
	e.t.Helper()
	r := e.do(call{method: "POST", path: "/api/auth/login", body: jsonBody(map[string]string{"email": email, "password": password})})
	if r.status != http.StatusOK {
		e.t.Fatalf("login %s: %d %s", email, r.status, r.body)
	}
	return decode[loginBody](e.t, r.body)
}

var codeInSubject = regexp.MustCompile(`^Je inlogcode: (\d{4}) (\d{4})$`)

// code returns the code of the only mail sent, which must be a login code.
func (e *env) code(to string) string {
	e.t.Helper()
	msgs := e.mails()
	if len(msgs) != 1 || msgs[0].To != to {
		e.t.Fatalf("want one login code mail to %s, got %+v", to, msgs)
	}
	m := codeInSubject.FindStringSubmatch(msgs[0].Subject)
	if m == nil {
		e.t.Fatalf("not a login code: %q", msgs[0].Subject)
	}
	return m[1] + m[2]
}

func (e *env) verify(challenge, code string) response {
	return e.do(call{method: "POST", path: "/api/auth/verify", body: jsonBody(map[string]string{"challenge": challenge, "code": code})})
}

// cookieOf returns the last device cookie a response sets, nil for none.
func cookieOf(t *testing.T, r response) *http.Cookie {
	t.Helper()
	var last *http.Cookie
	for _, c := range (&http.Response{Header: r.header}).Cookies() {
		if c.Name == deviceCookie {
			last = c
		}
	}
	return last
}

// signIn runs password and code and returns the device cookie.
func (e *env) signIn(email, password string) string {
	e.t.Helper()
	l := e.login(email, password)
	r := e.verify(l.Challenge, e.code(email))
	if r.status != http.StatusOK {
		e.t.Fatalf("verify: %d %s", r.status, r.body)
	}
	c := cookieOf(e.t, r)
	if c == nil || c.Value == "" {
		e.t.Fatal("no device cookie")
	}
	e.mails() // the new-device mail
	return c.Value
}

func (e *env) events() []string {
	e.t.Helper()
	rows, err := e.db.Query(`SELECT event || COALESCE(':' || detail, '') FROM audit_log ORDER BY id`)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		out = append(out, s)
	}
	return out
}

func TestSignInFlow(t *testing.T) {
	e := newEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)

	l := e.login("Bert@Example.com", bertPass)
	if l.Email != "B•••@Example.com" || len(l.Challenge) != 43 {
		t.Errorf("login answer %+v", l)
	}
	msgs := e.mails()
	if len(msgs) != 1 || !strings.Contains(msgs[0].Text, "Toestel: Safari op iPhone") || !strings.Contains(msgs[0].Text, "Geldig tot 20:10") {
		t.Fatalf("code mail: %+v", msgs)
	}
	code := codeInSubject.FindStringSubmatch(msgs[0].Subject)
	r := e.verify(l.Challenge, code[1]+" "+code[2]) // as written in the mail
	if r.status != http.StatusOK {
		t.Fatalf("verify: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"user": {"id": 1, "name": "Bert", "email": "bert@example.com", "role": "admin", "initial": "B"}}`)
	c := cookieOf(t, r)
	if c == nil || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode || c.Path != "/" || c.MaxAge != 90*24*3600 {
		t.Fatalf("device cookie %+v", c)
	}
	msgs = e.mails()
	if len(msgs) != 1 || msgs[0].Subject != "Nieuw toestel aangemeld: Safari op iPhone" ||
		!strings.Contains(msgs[0].Text, "https://saldo.example.com/instellingen/toestellen") {
		t.Fatalf("new device mail: %+v", msgs)
	}
	var stored string
	e.db.QueryRow(`SELECT token_hash FROM devices`).Scan(&stored)
	if stored == c.Value || stored != auth.HashToken(c.Value) {
		t.Error("the device token must be stored as its hash only")
	}

	r = e.get("/api/me", c.Value)
	if me := decode[meBody](t, r.body); r.status != 200 || me.User.Email != "bert@example.com" {
		t.Fatalf("me: %d %s", r.status, r.body)
	}
	r = e.get("/api/devices", c.Value)
	equalJSON(t, r.body, `[{"id": 1, "name": "Safari op iPhone", "createdAt": "2026-11-18T20:00:00+01:00", "lastUsedAt": "2026-11-18T20:00:00+01:00", "current": true}]`)

	// The code works once.
	expectError(t, e.verify(l.Challenge, code[1]+code[2]), http.StatusUnauthorized, "invalid_code")

	r = e.do(call{method: "POST", path: "/api/auth/logout", device: c.Value})
	if r.status != http.StatusNoContent || cookieOf(t, r).MaxAge >= 0 {
		t.Fatalf("logout: %d %v", r.status, r.header)
	}
	expectError(t, e.get("/api/me", c.Value), http.StatusUnauthorized, "unauthorized")

	want := []string{"code_sent", "login_ok", "new_device:Safari op iPhone", "login_failed:code", "device_signed_out"}
	if got := e.events(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("audit log %v, want %v", got, want)
	}
}

// An unknown address and a wrong password look the same, in the answer and
// in step 2.
func TestLoginDoesNotEnumerate(t *testing.T) {
	e := newEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)

	unknown := e.do(call{method: "POST", path: "/api/auth/login", body: `{"email":"nobody@example.com","password":"lange zin voor bert"}`})
	wrong := e.do(call{method: "POST", path: "/api/auth/login", body: `{"email":"bert@example.com","password":"een fout wachtwoord"}`})
	if unknown.status != 200 || wrong.status != 200 {
		t.Fatalf("status %d / %d", unknown.status, wrong.status)
	}
	shape := func(body string) string {
		m := decode[map[string]string](t, body)
		return strconv.Itoa(len(m)) + ":" + strconv.Itoa(len(m["challenge"])) + ":" + m["email"][1:]
	}
	if a, b := shape(unknown.body), shape(wrong.body); a != b || a != "2:43:•••@example.com" {
		t.Errorf("shapes differ: %s vs %s", a, b)
	}
	if msgs := e.mails(); len(msgs) != 0 {
		t.Errorf("mail sent: %+v", msgs)
	}
	a := e.verify(decode[loginBody](t, unknown.body).Challenge, "12345678")
	b := e.verify(decode[loginBody](t, wrong.body).Challenge, "12345678")
	if a.status != http.StatusUnauthorized || a.status != b.status || a.body != b.body {
		t.Errorf("verify differs: %d %s vs %d %s", a.status, a.body, b.status, b.body)
	}
	expectError(t, e.do(call{method: "POST", path: "/api/auth/login", body: `{"email":"geen adres","password":"x"}`}), http.StatusBadRequest, "invalid")
	expectError(t, e.do(call{method: "POST", path: "/api/auth/login", body: `{"email":"bert@example.com","password":""}`}), http.StatusBadRequest, "invalid")
}

func TestCodeAttemptsExpiryAndReuse(t *testing.T) {
	e := newEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)

	// Five wrong attempts end the code, even for the right one after.
	l := e.login("bert@example.com", bertPass)
	code := e.code("bert@example.com")
	wrong := "00000000"
	if code == wrong {
		wrong = "11111111"
	}
	for range auth.CodeAttempts {
		expectError(t, e.verify(l.Challenge, wrong), http.StatusUnauthorized, "invalid_code")
	}
	expectError(t, e.verify(l.Challenge, code), http.StatusUnauthorized, "invalid_code")

	// A new code replaces the previous one.
	l1 := e.login("bert@example.com", bertPass)
	code1 := e.code("bert@example.com")
	l2 := e.login("bert@example.com", bertPass)
	code2 := e.code("bert@example.com")
	expectError(t, e.verify(l1.Challenge, code1), http.StatusUnauthorized, "invalid_code")
	// A code only works with its own challenge.
	if code1 != code2 {
		expectError(t, e.verify(l2.Challenge, code1), http.StatusUnauthorized, "invalid_code")
	}

	// Ten minutes later the code has expired.
	e.now = e.now.Add(auth.CodeTTL)
	expectError(t, e.verify(l2.Challenge, code2), http.StatusUnauthorized, "invalid_code")
}

// At most three codes per user per 10 minutes; a fourth request answers as a
// wrong password would, so the limit never confirms the password.
func TestCodeLimitPerUser(t *testing.T) {
	e := newEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	for range auth.CodesPerWindow {
		e.login("bert@example.com", bertPass)
		e.code("bert@example.com")
	}
	l := e.login("bert@example.com", bertPass)
	if msgs := e.mails(); len(msgs) != 0 {
		t.Fatalf("a fourth code was sent: %+v", msgs)
	}
	expectError(t, e.verify(l.Challenge, "12345678"), http.StatusUnauthorized, "invalid_code")
	if got := e.events(); !strings.Contains(strings.Join(got, ","), "rate_limited:codes") {
		t.Errorf("audit log %v", got)
	}
	e.now = e.now.Add(auth.CodeTTL)
	e.login("bert@example.com", bertPass)
	e.code("bert@example.com")
}

func TestDeviceLifecycle(t *testing.T) {
	e := newEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	a := e.signIn("bert@example.com", bertPass)

	// Use keeps a device signed in; 90 days without use ends it.
	for range 2 {
		e.now = e.now.Add(89 * 24 * time.Hour)
		r := e.get("/api/me", a)
		if r.status != 200 || cookieOf(t, r) == nil || cookieOf(t, r).MaxAge != 90*24*3600 {
			t.Fatalf("after 89 days: %d, cookie %v", r.status, cookieOf(t, r))
		}
	}
	r := e.get("/api/me", a)
	if cookieOf(t, r) != nil {
		t.Error("a request within minutes of the last one renews nothing")
	}
	e.now = e.now.Add(90 * 24 * time.Hour)
	r = e.get("/api/me", a)
	expectError(t, r, http.StatusUnauthorized, "unauthorized")
	if c := cookieOf(t, r); c == nil || c.MaxAge >= 0 {
		t.Error("a dead cookie is cleared")
	}

	a = e.signIn("bert@example.com", bertPass)
	b := e.signIn("bert@example.com", bertPass)
	devices := decode[[]auth.Device](t, e.get("/api/devices", a).body)
	if len(devices) != 2 || !devices[1].Current || devices[0].Current {
		t.Fatalf("devices from a: %+v", devices)
	}
	r = e.do(call{method: "DELETE", path: "/api/devices/" + strconv.FormatInt(devices[0].ID, 10), device: a})
	if r.status != http.StatusNoContent || cookieOf(t, r) != nil {
		t.Fatalf("sign out b: %d %v", r.status, r.header)
	}
	expectError(t, e.get("/api/me", b), http.StatusUnauthorized, "unauthorized")
	expectError(t, e.do(call{method: "DELETE", path: "/api/devices/" + strconv.FormatInt(devices[0].ID, 10), device: a}), http.StatusNotFound, "not_found")

	c := e.signIn("bert@example.com", bertPass)
	if r := e.do(call{method: "POST", path: "/api/devices/sign-out-others", device: a}); r.status != http.StatusNoContent {
		t.Fatalf("sign out others: %d %s", r.status, r.body)
	}
	expectError(t, e.get("/api/me", c), http.StatusUnauthorized, "unauthorized")
	if r := e.get("/api/me", a); r.status != 200 {
		t.Fatalf("a after sign-out-others: %d", r.status)
	}

	// A password change signs out every other device.
	e.now = e.now.Add(auth.CodeTTL) // three codes per 10 minutes were used
	d := e.signIn("bert@example.com", bertPass)
	pw := func(current, next string) response {
		return e.do(call{method: "PUT", path: "/api/me/password", device: a, body: jsonBody(map[string]string{"current": current, "new": next})})
	}
	if msg := expectError(t, pw("niet mijn wachtwoord", "een nieuwe lange zin"), http.StatusBadRequest, "invalid"); msg != "Je huidige wachtwoord klopt niet." {
		t.Errorf("wrong current: %q", msg)
	}
	expectError(t, pw(bertPass, "kort"), http.StatusBadRequest, "invalid")
	expectError(t, pw(bertPass, "Password1234"), http.StatusBadRequest, "invalid")
	expectError(t, pw(bertPass, "BERT@example.com"), http.StatusBadRequest, "invalid")
	if r := pw(bertPass, "een nieuwe lange zin"); r.status != http.StatusNoContent {
		t.Fatalf("change: %d %s", r.status, r.body)
	}
	expectError(t, e.get("/api/me", d), http.StatusUnauthorized, "unauthorized")
	if r := e.get("/api/me", a); r.status != 200 {
		t.Fatalf("the current device stays signed in: %d", r.status)
	}
	e.login("bert@example.com", bertPass)
	if msgs := e.mails(); len(msgs) != 0 {
		t.Error("the old password still works")
	}
	e.signIn("bert@example.com", "een nieuwe lange zin")

	// Deleting the current device is signing out.
	devices = decode[[]auth.Device](t, e.get("/api/devices", a).body)
	var current int64
	for _, dv := range devices {
		if dv.Current {
			current = dv.ID
		}
	}
	r = e.do(call{method: "DELETE", path: "/api/devices/" + strconv.FormatInt(current, 10), device: a})
	if r.status != http.StatusNoContent || cookieOf(t, r) == nil || cookieOf(t, r).MaxAge >= 0 {
		t.Fatalf("delete current: %d %v", r.status, r.header)
	}
	expectError(t, e.get("/api/me", a), http.StatusUnauthorized, "unauthorized")
}

func TestDevicesArePrivate(t *testing.T) {
	e := newEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	e.addUser("partner@example.com", "Partner", "user", partnerPass)
	bert := e.signIn("bert@example.com", bertPass)
	partner := e.signIn("partner@example.com", partnerPass)

	theirs := decode[[]auth.Device](t, e.get("/api/devices", bert).body)
	mine := decode[[]auth.Device](t, e.get("/api/devices", partner).body)
	if len(theirs) != 1 || len(mine) != 1 || theirs[0].ID == mine[0].ID {
		t.Fatalf("devices: %+v / %+v", theirs, mine)
	}
	id := strconv.FormatInt(theirs[0].ID, 10)
	a := e.do(call{method: "DELETE", path: "/api/devices/" + id, device: partner})
	b := e.do(call{method: "DELETE", path: "/api/devices/999", device: partner})
	expectError(t, a, http.StatusNotFound, "not_found")
	if a.body != b.body {
		t.Errorf("someone else's device and a missing one differ: %s vs %s", a.body, b.body)
	}
	if r := e.get("/api/me", bert); r.status != 200 {
		t.Errorf("Bert was signed out by Partner: %d", r.status)
	}
	// Signing out the others never reaches another user.
	e.do(call{method: "POST", path: "/api/devices/sign-out-others", device: partner})
	if r := e.get("/api/me", bert); r.status != 200 {
		t.Errorf("Bert was signed out by Partner's sign-out-others: %d", r.status)
	}
}

// bootstrapLink runs the first-start step and returns the link it logged.
func bootstrapLink(t *testing.T, e *env, recovery bool) string {
	t.Helper()
	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, nil))
	if err := e.s.auth.Bootstrap(context.Background(), "https://saldo.example.com", recovery, log); err != nil {
		t.Fatal(err)
	}
	if buf.Len() == 0 {
		return ""
	}
	var line struct{ Link string }
	json.Unmarshal(buf.Bytes(), &line)
	return line.Link
}

func token(link string) string { return link[strings.LastIndexByte(link, '/')+1:] }

func TestSetupOnlyWhileNoUser(t *testing.T) {
	e := newEnv(t)
	old := bootstrapLink(t, e, false)
	link := bootstrapLink(t, e, false) // every start makes a new link
	if !strings.HasPrefix(link, "https://saldo.example.com/setup/") {
		t.Fatalf("setup link %q", link)
	}
	expectError(t, e.get("/api/auth/token/"+token(old), ""), http.StatusNotFound, "not_found")
	r := e.get("/api/auth/token/"+token(link), "")
	if r.status != 200 {
		t.Fatalf("token: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"kind": "setup", "email": null, "name": null}`)

	redeem := func(body map[string]string) response {
		body["token"] = token(link)
		return e.do(call{method: "POST", path: "/api/auth/redeem", body: jsonBody(body)})
	}
	expectError(t, redeem(map[string]string{"name": "Bert", "email": "bert@example.com", "password": "te kort"}), http.StatusBadRequest, "invalid")
	expectError(t, redeem(map[string]string{"name": "Bert", "email": "bert@example.com", "password": "bert@example.com"}), http.StatusBadRequest, "invalid")
	expectError(t, redeem(map[string]string{"name": "", "email": "bert@example.com", "password": bertPass}), http.StatusBadRequest, "invalid")
	expectError(t, redeem(map[string]string{"name": "Bert", "email": "geen adres", "password": bertPass}), http.StatusBadRequest, "invalid")
	if r := redeem(map[string]string{"name": "Bert", "email": "bert@example.com", "password": bertPass}); r.status != http.StatusNoContent {
		t.Fatalf("setup: %d %s", r.status, r.body)
	}
	expectError(t, redeem(map[string]string{"name": "Eve", "email": "eve@example.com", "password": bertPass}), http.StatusNotFound, "not_found")
	expectError(t, e.get("/api/auth/token/"+token(link), ""), http.StatusNotFound, "not_found")

	bert := e.signIn("bert@example.com", bertPass)
	if me := decode[meBody](t, e.get("/api/me", bert).body); me.User.Role != "admin" || me.User.Name != "Bert" {
		t.Errorf("first user: %+v", me.User)
	}
	if bootstrapLink(t, e, false) != "" {
		t.Error("a setup link while a user exists")
	}
	// A setup link made before the first user stops working once one exists.
	e.db.Exec(`DELETE FROM users`)
	link = bootstrapLink(t, e, false)
	e.addUser("partner@example.com", "Partner", "admin", partnerPass)
	expectError(t, e.get("/api/auth/token/"+token(link), ""), http.StatusNotFound, "not_found")
}

func TestAdminRecovery(t *testing.T) {
	e := newEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	bert := e.signIn("bert@example.com", bertPass)
	link := bootstrapLink(t, e, true)
	if !strings.HasPrefix(link, "https://saldo.example.com/nieuw-wachtwoord/") {
		t.Fatalf("recovery link %q", link)
	}
	r := e.do(call{method: "POST", path: "/api/auth/redeem", body: jsonBody(map[string]string{"token": token(link), "password": "een nieuwe lange zin"})})
	if r.status != http.StatusNoContent {
		t.Fatalf("redeem: %d %s", r.status, r.body)
	}
	expectError(t, e.get("/api/me", bert), http.StatusUnauthorized, "unauthorized")
	e.signIn("bert@example.com", "een nieuwe lange zin")
}

func TestInvitationAndReset(t *testing.T) {
	e := newEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	bert := e.signIn("bert@example.com", bertPass)
	invite := func(device, email, role string) response {
		return e.do(call{method: "POST", path: "/api/users/invitations", device: device, body: jsonBody(map[string]string{"email": email, "role": role})})
	}

	r := invite(bert, "partner@example.com", "user")
	if r.status != http.StatusCreated {
		t.Fatalf("invite: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"id": 1, "email": "partner@example.com", "role": "user", "expiresAt": "2026-11-25T20:00:00+01:00"}`)
	msgs := e.mails()
	if len(msgs) != 1 || msgs[0].To != "partner@example.com" || msgs[0].Subject != "Bert nodigt je uit voor Saldo" {
		t.Fatalf("invitation mail: %+v", msgs)
	}
	link := regexp.MustCompile(`https://saldo\.example\.com/uitnodiging/[A-Za-z0-9_-]{43}`).FindString(msgs[0].Text)
	if link == "" {
		t.Fatalf("no link in %s", msgs[0].Text)
	}
	equalJSON(t, e.get("/api/users", bert).body, `{
		"users": [{"id": 1, "name": "Bert", "email": "bert@example.com", "role": "admin", "initial": "B"}],
		"invitations": [{"id": 1, "email": "partner@example.com", "role": "user", "expiresAt": "2026-11-25T20:00:00+01:00"}]
	}`)
	expectError(t, invite(bert, "BERT@example.com", "user"), http.StatusBadRequest, "invalid")
	expectError(t, invite(bert, "x@example.com", "owner"), http.StatusBadRequest, "invalid")

	equalJSON(t, e.get("/api/auth/token/"+token(link), "").body, `{"kind": "invitation", "email": "partner@example.com", "name": null}`)
	accept := func(body map[string]string) response {
		return e.do(call{method: "POST", path: "/api/auth/redeem", body: jsonBody(body)})
	}
	expectError(t, accept(map[string]string{"token": token(link), "password": partnerPass}), http.StatusBadRequest, "invalid") // no name
	if r := accept(map[string]string{"token": token(link), "name": "Partner", "password": partnerPass}); r.status != http.StatusNoContent {
		t.Fatalf("accept: %d %s", r.status, r.body)
	}
	expectError(t, accept(map[string]string{"token": token(link), "name": "Eve", "password": partnerPass}), http.StatusNotFound, "not_found")
	if u := decode[struct{ Users, Invitations []json.RawMessage }](t, e.get("/api/users", bert).body); len(u.Users) != 2 || len(u.Invitations) != 0 {
		t.Errorf("after accepting: %+v", u)
	}
	partner := e.signIn("partner@example.com", partnerPass)

	// Admin only.
	for _, c := range []call{
		{method: "GET", path: "/api/users"},
		{method: "POST", path: "/api/users/invitations", body: `{"email":"x@example.com","role":"admin"}`},
		{method: "DELETE", path: "/api/users/invitations/1"},
		{method: "POST", path: "/api/users/1/password-reset"},
	} {
		c.device = partner
		expectError(t, e.do(c), http.StatusForbidden, "forbidden")
	}

	// A reset link signs nothing out until it is used.
	if r := e.do(call{method: "POST", path: "/api/users/2/password-reset", device: bert}); r.status != http.StatusNoContent {
		t.Fatalf("reset: %d %s", r.status, r.body)
	}
	msgs = e.mails()
	if len(msgs) != 1 || msgs[0].To != "partner@example.com" || !strings.Contains(msgs[0].Text, "Aangemaakt door: Bert (beheerder)") {
		t.Fatalf("reset mail: %+v", msgs)
	}
	link = regexp.MustCompile(`https://saldo\.example\.com/nieuw-wachtwoord/[A-Za-z0-9_-]{43}`).FindString(msgs[0].Text)
	if r := e.get("/api/me", partner); r.status != 200 {
		t.Fatalf("Partner signed out before the reset is used: %d", r.status)
	}
	equalJSON(t, e.get("/api/auth/token/"+token(link), "").body, `{"kind": "password_reset", "email": "partner@example.com", "name": "Partner"}`)
	expectError(t, accept(map[string]string{"token": token(link), "password": "partner@example.com"}), http.StatusBadRequest, "invalid")
	if r := accept(map[string]string{"token": token(link), "password": "Partner kiest opnieuw"}); r.status != http.StatusNoContent {
		t.Fatalf("reset redeem: %d %s", r.status, r.body)
	}
	expectError(t, accept(map[string]string{"token": token(link), "password": "Partner kiest weer iets"}), http.StatusNotFound, "not_found")
	expectError(t, e.get("/api/me", partner), http.StatusUnauthorized, "unauthorized")
	e.signIn("partner@example.com", "Partner kiest opnieuw")
	expectError(t, e.do(call{method: "POST", path: "/api/users/99/password-reset", device: bert}), http.StatusNotFound, "not_found")

	// A withdrawn or expired invitation stops working.
	invite(bert, "eve@example.com", "user")
	link = regexp.MustCompile(`/uitnodiging/[A-Za-z0-9_-]{43}`).FindString(e.mails()[0].Text)
	id := strconv.FormatInt(decode[struct{ Invitations []auth.Invitation }](t, e.get("/api/users", bert).body).Invitations[0].ID, 10)
	if r := e.do(call{method: "DELETE", path: "/api/users/invitations/" + id, device: bert}); r.status != http.StatusNoContent {
		t.Fatalf("withdraw: %d", r.status)
	}
	expectError(t, e.get("/api/auth/token/"+token(link), ""), http.StatusNotFound, "not_found")
	expectError(t, e.do(call{method: "DELETE", path: "/api/users/invitations/" + id, device: bert}), http.StatusNotFound, "not_found")
	invite(bert, "eve@example.com", "user")
	link = regexp.MustCompile(`/uitnodiging/[A-Za-z0-9_-]{43}`).FindString(e.mails()[0].Text)
	e.now = e.now.Add(auth.InvitationTTL)
	expectError(t, e.get("/api/auth/token/"+token(link), ""), http.StatusNotFound, "not_found")
}

func TestCrossOriginPostIsRefused(t *testing.T) {
	e := newEnv(t)
	login := `{"email":"bert@example.com","password":"lange zin voor bert"}`
	r := e.do(call{method: "POST", path: "/api/auth/login", body: login,
		header: map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example.org"}})
	expectError(t, r, http.StatusForbidden, "forbidden")
	r = e.do(call{method: "POST", path: "/api/auth/login", body: login, header: map[string]string{"Origin": "https://evil.example.org"}})
	expectError(t, r, http.StatusForbidden, "forbidden")

	for _, h := range []map[string]string{
		{"Sec-Fetch-Site": "same-origin", "Origin": "https://saldo.example.com"},
		{"Sec-Fetch-Site": "cross-site", "Origin": "https://saldo.example.com"}, // the trusted public URL
		{},
	} {
		if r := e.do(call{method: "POST", path: "/api/auth/login", body: login, header: h}); r.status != 200 {
			t.Errorf("%v: %d %s", h, r.status, r.body)
		}
	}
	if r := e.do(call{method: "GET", path: "/api/health", header: map[string]string{"Sec-Fetch-Site": "cross-site"}}); r.status != 200 {
		t.Errorf("a cross-site GET is safe: %d", r.status)
	}
}

func TestSignInRateLimits(t *testing.T) {
	e := newEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	login := func(email, remote, cf string) response {
		return e.do(call{method: "POST", path: "/api/auth/login", remote: remote,
			body: jsonBody(map[string]string{"email": email, "password": "een fout wachtwoord"}), header: map[string]string{"CF-Connecting-IP": cf}})
	}

	// Per address, whatever the IP and whether the address exists.
	for i := range 5 {
		if r := login("nobody@example.com", "203.0.113."+strconv.Itoa(i+1)+":1000", ""); r.status != 200 {
			t.Fatalf("attempt %d: %d", i+1, r.status)
		}
	}
	r := login("Nobody@example.com", "203.0.113.50:1000", "")
	expectError(t, r, http.StatusTooManyRequests, "rate_limited")
	if r.header.Get("Retry-After") != "600" {
		t.Errorf("Retry-After %q", r.header.Get("Retry-After"))
	}
	login("nobody@example.com", "203.0.113.50:1000", "")
	if n := strings.Count(strings.Join(e.events(), ","), "rate_limited:login_email"); n != 1 {
		t.Errorf("a flood is audited once, got %d lines", n)
	}

	// Per IP. Behind Cloudflared (a private peer) the visitor's address counts.
	for i := range 20 {
		if r := login("user"+strconv.Itoa(i)+"@example.com", "172.30.32.1:1000", "198.51.100."+strconv.Itoa(i+1)); r.status != 200 {
			t.Fatalf("via Cloudflared %d: %d", i, r.status)
		}
	}
	for i := range 20 {
		login("ip"+strconv.Itoa(i)+"@example.com", "203.0.113.9:1000", "198.51.100."+strconv.Itoa(i+1))
	}
	expectError(t, login("one-more@example.com", "203.0.113.9:1000", "198.51.100.99"), http.StatusTooManyRequests, "rate_limited")

	// Wrong current passwords.
	bert := e.signIn("bert@example.com", bertPass)
	pw := func(current string) response {
		return e.do(call{method: "PUT", path: "/api/me/password", device: bert, body: jsonBody(map[string]string{"current": current, "new": "een nieuwe lange zin"})})
	}
	for range 5 {
		expectError(t, pw("fout"), http.StatusBadRequest, "invalid")
	}
	expectError(t, pw(bertPass), http.StatusTooManyRequests, "rate_limited")

	// Links and codes per IP.
	for range 20 {
		e.do(call{method: "GET", path: "/api/auth/token/abc", remote: "203.0.113.77:1"})
	}
	expectError(t, e.do(call{method: "GET", path: "/api/auth/token/abc", remote: "203.0.113.77:1"}), http.StatusTooManyRequests, "rate_limited")
	for range 20 {
		e.do(call{method: "POST", path: "/api/auth/verify", remote: "203.0.113.78:1", body: `{"challenge":"x","code":"12345678"}`})
	}
	expectError(t, e.do(call{method: "POST", path: "/api/auth/verify", remote: "203.0.113.78:1", body: `{"challenge":"x","code":"12345678"}`}),
		http.StatusTooManyRequests, "rate_limited")

	e.now = e.now.Add(10 * time.Minute)
	if r := login("nobody@example.com", "203.0.113.50:1000", ""); r.status != 200 {
		t.Errorf("after the window: %d", r.status)
	}
}

func TestWithoutMail(t *testing.T) {
	e := newEnv(t, func(o *Options) { o.Mailer = nil })
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	expectError(t, e.do(call{method: "POST", path: "/api/auth/login", body: `{"email":"bert@example.com","password":"lange zin voor bert"}`}),
		http.StatusServiceUnavailable, "unavailable")

	e2 := newEnv(t, func(o *Options) { o.PublicURL = "" })
	e2.addUser("bert@example.com", "Bert", "admin", bertPass)
	bert := e2.signIn("bert@example.com", bertPass)
	expectError(t, e2.do(call{method: "POST", path: "/api/users/invitations", device: bert, body: `{"email":"x@example.com","role":"user"}`}),
		http.StatusServiceUnavailable, "unavailable")
}

func TestPatchMe(t *testing.T) {
	h, _ := demoServer(t)
	r := do(t, h, "PATCH", "/api/me", `{"name":"  bertje "}`)
	if r.status != 200 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	if u := decode[users.User](t, r.body); u.Name != "bertje" || u.Initial != "B" {
		t.Errorf("patched: %+v", u)
	}
	for _, body := range []string{`{"name":""}`, `{"name":"` + strings.Repeat("x", 41) + `"}`, `{}`, `{"email":"x@example.com"}`} {
		expectError(t, do(t, h, "PATCH", "/api/me", body), http.StatusBadRequest, "invalid")
	}
}

func TestClientIP(t *testing.T) {
	tests := []struct{ remote, cf, want string }{
		{"203.0.113.9:1234", "198.51.100.1", "203.0.113.9"},
		{"172.30.32.2:1234", "198.51.100.1", "198.51.100.1"},
		{"127.0.0.1:1234", "2001:db8::1", "2001:db8::1"},
		{"[::ffff:10.0.0.1]:1234", "198.51.100.1", "198.51.100.1"},
		{"10.0.0.1:1234", "geen ip", "10.0.0.1"},
	}
	for _, tt := range tests {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = tt.remote
		r.Header.Set("CF-Connecting-IP", tt.cf)
		if got := clientIP(r); got != tt.want {
			t.Errorf("clientIP(%s, %s) = %s, want %s", tt.remote, tt.cf, got, tt.want)
		}
	}
}
