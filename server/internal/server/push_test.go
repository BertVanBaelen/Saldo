package server

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
)

// pushEnv is a server outside demo mode with the fake push sender, on an
// https public_url, with real device sign-in (cookies).
type pushEnv struct {
	*env
	fake *push.Fake
	key  string
}

func newPushEnv(t *testing.T, edit ...func(*Options)) *pushEnv {
	t.Helper()
	fake := &push.Fake{}
	_, public, err := push.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	e := newEnv(t, append([]func(*Options){func(o *Options) { o.Push, o.PushKey = fake, public }}, edit...)...)
	return &pushEnv{env: e, fake: fake, key: public}
}

// signInNext signs in another device; the clock first moves past the limit
// of three codes per 10 minutes.
func (e *pushEnv) signInNext(email, password string) string {
	e.t.Helper()
	e.now = e.now.Add(auth.CodeTTL)
	return e.signIn(email, password)
}

// fcm is the start of every test endpoint: the endpoints end in a short name.
const fcm = "https://fcm.googleapis.com/fcm/send/"

// subscription is a body as PushSubscription.toJSON() sends it, with keys
// the guard accepts.
func subscription(t *testing.T, name string) string {
	t.Helper()
	_, p256dh, err := push.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf(`{"endpoint":%q,"expirationTime":null,"keys":{"p256dh":%q,"auth":"AAAAAAAAAAAAAAAAAAAAAA"}}`, fcm+name, p256dh)
}

func (e *pushEnv) subscribe(device, name string) response {
	e.t.Helper()
	return e.do(call{method: "PUT", path: "/api/push/subscription", device: device, body: subscription(e.t, name)})
}

func (e *pushEnv) testPush(device string) response {
	e.t.Helper()
	return e.do(call{method: "POST", path: "/api/notifications/test", device: device})
}

// stored lists the stored endpoints by name, sorted.
func (e *pushEnv) stored() string {
	e.t.Helper()
	rows, err := e.db.Query(`SELECT endpoint FROM push_subscriptions ORDER BY endpoint`)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		rows.Scan(&s)
		out = append(out, strings.TrimPrefix(s, fcm))
	}
	return strings.Join(out, " ")
}

// sent lists where the fake delivered since the last call, by name.
func (e *pushEnv) sent(seen *int) string {
	all := e.fake.Sent()
	var out []string
	for _, m := range all[*seen:] {
		out = append(out, strings.TrimPrefix(m.Subscription.Endpoint, fcm))
	}
	*seen = len(all)
	return strings.Join(out, " ")
}

func TestPushKey(t *testing.T) {
	e := newPushEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	a := e.signIn("bert@example.com", bertPass)
	equalJSON(t, e.get("/api/push/key", a).body, `{"key":"`+e.key+`","enabled":true}`)
	expectError(t, e.get("/api/push/key", ""), http.StatusUnauthorized, "unauthorized")

	// Without an https origin a phone cannot subscribe; without a sender nothing is sent.
	for name, edit := range map[string]func(*Options){
		"http":      func(o *Options) { o.PublicURL = "http://saldo.local:8080" },
		"no url":    func(o *Options) { o.PublicURL = "" },
		"no sender": func(o *Options) { o.Push = nil },
	} {
		e := newPushEnv(t, edit)
		e.addUser("bert@example.com", "Bert", "admin", bertPass)
		var a string
		if name == "no sender" {
			a = e.signIn("bert@example.com", bertPass)
		} else {
			// Sign-in links need the public URL; set a session directly.
			a = e.deviceFor(1)
		}
		if r := decode[map[string]any](t, e.get("/api/push/key", a).body); r["enabled"] != false || r["key"] != e.key {
			t.Errorf("%s: %+v", name, r)
		}
		expectError(t, e.subscribe(a, "x"), http.StatusServiceUnavailable, "unavailable")
		expectError(t, e.testPush(a), http.StatusServiceUnavailable, "unavailable")
		if e.stored() != "" {
			t.Errorf("%s: stored %q", name, e.stored())
		}
	}
}

// deviceFor stores a signed-in device for user straight in the database and
// returns its cookie value.
func (e *pushEnv) deviceFor(user int64) string {
	e.t.Helper()
	token, hash := auth.NewToken()
	if _, err := e.db.Exec(`INSERT INTO devices (user_id, name, token_hash, created_at, last_used_at) VALUES (?, 'Test', ?, ?, ?)`,
		user, hash, e.now.UTC().Format("2006-01-02T15:04:05Z"), e.now.UTC().Format("2006-01-02T15:04:05Z")); err != nil {
		e.t.Fatal(err)
	}
	return token
}

func TestPushSubscriptionAndTestPush(t *testing.T) {
	e := newPushEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	a := e.signIn("bert@example.com", bertPass)
	b := e.signInNext("bert@example.com", bertPass)
	seen := 0

	// No subscription yet: the test answers 409.
	if msg := expectError(t, e.testPush(a), http.StatusConflict, "conflict"); msg != "Pushmeldingen staan uit op dit toestel." {
		t.Errorf("409 message %q", msg)
	}

	// The guard: a host that is no push service, a bad key, an unknown field.
	if msg := expectError(t, e.do(call{method: "PUT", path: "/api/push/subscription", device: a,
		body: strings.Replace(subscription(t, "x"), "fcm.googleapis.com", "evil.example.org", 1)}), http.StatusBadRequest, "invalid"); msg != "Dit toestel kan geen pushmeldingen krijgen." {
		t.Errorf("bad endpoint message %q", msg)
	}
	expectError(t, e.do(call{method: "PUT", path: "/api/push/subscription", device: a,
		body: strings.Replace(subscription(t, "x"), "AAAAAAAAAAAAAAAAAAAAAA", "kort", 1)}), http.StatusBadRequest, "invalid")
	expectError(t, e.do(call{method: "PUT", path: "/api/push/subscription", device: a,
		body: `{"endpoint":"` + fcm + `x","keys":{"p256dh":"a","auth":"b"},"userId":2}`}), http.StatusBadRequest, "invalid")
	// Cross-origin requests are refused like on every other route (CSRF).
	for _, c := range []call{
		{method: "PUT", path: "/api/push/subscription", body: subscription(t, "x")},
		{method: "DELETE", path: "/api/push/subscription"},
		{method: "POST", path: "/api/notifications/test"},
	} {
		c.device, c.header = a, map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example.org"}
		expectError(t, e.do(c), http.StatusForbidden, "forbidden")
	}
	if e.stored() != "" {
		t.Fatalf("refused subscriptions were stored: %q", e.stored())
	}

	// Subscribe a; the row is bound to a's device with the platform of the User-Agent.
	if r := e.subscribe(a, "a"); r.status != http.StatusNoContent {
		t.Fatalf("subscribe a: %d %s", r.status, r.body)
	}
	var platform string
	var lastUsed *string
	e.db.QueryRow(`SELECT platform, last_used_at FROM push_subscriptions`).Scan(&platform, &lastUsed)
	if platform != "ios" || lastUsed == nil {
		t.Errorf("platform %q, last used %v", platform, lastUsed)
	}
	if r := e.testPush(a); r.status != http.StatusOK {
		t.Fatalf("test a: %d %s", r.status, r.body)
	} else {
		equalJSON(t, r.body, `{"sent":true}`)
	}
	if got := e.sent(&seen); got != "a" {
		t.Fatalf("sent to %q", got)
	}
	if m := e.fake.Sent()[0].Message; m.Payload != (push.Payload{Title: "Testmelding", Body: "Pushmeldingen werken op dit toestel.", URL: "/meldingen", Tone: "info", Tag: "test"}) || m.TTL <= 0 {
		t.Errorf("message %+v", m)
	}
	// b has none: the test does not fall back to a's subscription.
	expectError(t, e.testPush(b), http.StatusConflict, "conflict")
	if got := e.sent(&seen); got != "" {
		t.Errorf("b's test reached %q", got)
	}
	// A new subscription on a replaces its old one.
	e.subscribe(a, "a2")
	e.subscribe(b, "b")
	if got := e.stored(); got != "a2 b" {
		t.Errorf("stored %q", got)
	}

	// The push service says the subscription is gone: deleted, 409.
	e.fake.SetErr(push.ErrGone)
	expectError(t, e.testPush(b), http.StatusConflict, "conflict")
	e.fake.SetErr(nil)
	if got := e.stored(); got != "a2" {
		t.Errorf("after ErrGone: %q", got)
	}

	// DELETE removes this device's subscription only; twice is fine.
	e.subscribe(b, "b")
	for range 2 {
		if r := e.do(call{method: "DELETE", path: "/api/push/subscription", device: b}); r.status != http.StatusNoContent {
			t.Fatalf("delete: %d %s", r.status, r.body)
		}
	}
	if got := e.stored(); got != "a2" {
		t.Errorf("after delete on b: %q", got)
	}

	// At most 5 test pushes per user per hour, counted per user over all
	// devices: a's test and b's (gone) one used two. A 409 counts nothing.
	for i := range 3 {
		if r := e.testPush(a); r.status != http.StatusOK {
			t.Fatalf("test %d: %d %s", i+3, r.status, r.body)
		}
	}
	r := e.testPush(a)
	expectError(t, r, http.StatusTooManyRequests, "rate_limited")
	if r.header.Get("Retry-After") == "" {
		t.Error("no Retry-After")
	}
}

func TestPushCap(t *testing.T) {
	e := newPushEnv(t)
	bert := e.addUser("bert@example.com", "Bert", "admin", bertPass)
	a := e.signIn("bert@example.com", bertPass)
	for i := range push.MaxPerUser {
		dev := e.deviceFor(bert)
		if r := e.subscribe(dev, fmt.Sprintf("d%d", i)); r.status != http.StatusNoContent {
			t.Fatalf("device %d: %d %s", i, r.status, r.body)
		}
	}
	if msg := expectError(t, e.subscribe(a, "eleven"), http.StatusBadRequest, "invalid"); msg != "Je hebt al 10 toestellen met pushmeldingen." {
		t.Errorf("cap message %q", msg)
	}
}

// Signing a device out removes its subscription in the same transaction, at
// every revoke site, and the fake transport never gets a message for it.
func TestSignedOutDeviceGetsNoPush(t *testing.T) {
	e := newPushEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	partner := e.addUser("partner@example.com", "Partner", "user", partnerPass)
	a := e.signIn("bert@example.com", bertPass)
	b := e.signInNext("bert@example.com", bertPass)
	c := e.signInNext("bert@example.com", bertPass)
	p := e.signIn("partner@example.com", partnerPass)
	for dev, name := range map[string]string{a: "a", b: "b", c: "c", p: "p"} {
		if r := e.subscribe(dev, name); r.status != http.StatusNoContent {
			t.Fatalf("subscribe %s: %d %s", name, r.status, r.body)
		}
	}
	idOf := func(name string) string {
		var id string
		e.db.QueryRow(`SELECT device_id FROM push_subscriptions WHERE endpoint = ?`, fcm+name).Scan(&id)
		return id
	}

	// DELETE /api/devices/{id}: b from a.
	if r := e.do(call{method: "DELETE", path: "/api/devices/" + idOf("b"), device: a}); r.status != http.StatusNoContent {
		t.Fatalf("sign out b: %d %s", r.status, r.body)
	}
	if got := e.stored(); got != "a c p" {
		t.Errorf("after signing out b: %q", got)
	}
	expectError(t, e.testPush(b), http.StatusUnauthorized, "unauthorized")

	// Sign out the others: c goes, Partner's stays.
	if r := e.do(call{method: "POST", path: "/api/devices/sign-out-others", device: a}); r.status != http.StatusNoContent {
		t.Fatalf("sign out others: %d %s", r.status, r.body)
	}
	if got := e.stored(); got != "a p" {
		t.Errorf("after sign-out-others: %q", got)
	}

	// A password change on a signs out (and unsubscribes) d.
	d := e.signInNext("bert@example.com", bertPass)
	e.subscribe(d, "d")
	if r := e.do(call{method: "PUT", path: "/api/me/password", device: a, body: jsonBody(map[string]string{"current": bertPass, "new": "een heel nieuwe lange zin"})}); r.status != http.StatusNoContent {
		t.Fatalf("password change: %d %s", r.status, r.body)
	}
	if got := e.stored(); got != "a p" {
		t.Errorf("after the password change: %q", got)
	}

	// Signing out a itself.
	if r := e.do(call{method: "POST", path: "/api/auth/logout", device: a}); r.status != http.StatusNoContent {
		t.Fatalf("logout: %d %s", r.status, r.body)
	}
	if got := e.stored(); got != "p" {
		t.Errorf("after logout: %q", got)
	}

	// Only Partner's own device was ever reached by her test.
	seen := 0
	if r := e.testPush(p); r.status != http.StatusOK {
		t.Fatalf("Partner's test: %d %s", r.status, r.body)
	}
	if got := e.sent(&seen); got != "p" {
		t.Errorf("sent to %q, want only p", got)
	}

	// Deleting a user removes their subscriptions.
	admin := e.signInNext("bert@example.com", "een heel nieuwe lange zin")
	if r := e.do(call{method: "DELETE", path: fmt.Sprintf("/api/users/%d", partner), device: admin}); r.status != http.StatusNoContent {
		t.Fatalf("delete Partner: %d %s", r.status, r.body)
	}
	if got := e.stored(); got != "" {
		t.Errorf("after deleting Partner: %q", got)
	}
}

// A password reset (admin link) signs out every device and removes every subscription.
func TestPasswordResetRemovesPush(t *testing.T) {
	e := newPushEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	partner := e.addUser("partner@example.com", "Partner", "user", partnerPass)
	a := e.signIn("bert@example.com", bertPass)
	p := e.signIn("partner@example.com", partnerPass)
	e.subscribe(a, "a")
	e.subscribe(p, "p")
	token, _, err := e.s.auth.CreateReset(t.Context(), 1, partner)
	if err != nil {
		t.Fatal(err)
	}
	if r := e.do(call{method: "POST", path: "/api/auth/redeem", body: jsonBody(map[string]string{"token": token, "password": "een heel nieuwe lange zin"})}); r.status/100 != 2 {
		t.Fatalf("redeem: %d %s", r.status, r.body)
	}
	if got := e.stored(); got != "a" {
		t.Errorf("after the reset: %q", got)
	}
	expectError(t, e.testPush(p), http.StatusUnauthorized, "unauthorized")
}

// The idle limit is no revoke: the hourly push-prune job (Store.Prune)
// removes the subscription of a device unused for 90 days.
func TestPushPruneIdleDevice(t *testing.T) {
	e := newPushEnv(t)
	e.addUser("bert@example.com", "Bert", "admin", bertPass)
	a := e.signIn("bert@example.com", bertPass)
	e.subscribe(a, "a")
	store := push.NewStore(e.db)
	if n, err := store.Prune(t.Context(), e.now.Add(-auth.DeviceIdle)); err != nil || n != 0 {
		t.Fatalf("prune of an active device: %d, %v", n, err)
	}
	e.now = e.now.Add(auth.DeviceIdle)
	if n, err := store.Prune(t.Context(), e.now.Add(-auth.DeviceIdle)); err != nil || n != 1 || e.stored() != "" {
		t.Errorf("prune after 90 idle days: %d, %v, left %q", n, err, e.stored())
	}
}

// Demo mode: the fake sender, and a stand-in device per demo user.
func TestDemoPush(t *testing.T) {
	fake := &push.Fake{}
	_, public, _ := push.GenerateVAPIDKeys()
	h, d := demoServer(t, func(o *Options) { o.Push, o.PushKey = fake, public })
	equalJSON(t, do(t, h, "GET", "/api/push/key", "").body, `{"key":"`+public+`","enabled":true}`)
	expectError(t, do(t, h, "POST", "/api/notifications/test", ""), http.StatusConflict, "conflict")
	if r := do(t, h, "PUT", "/api/push/subscription", subscription(t, "demo")); r.status != http.StatusNoContent {
		t.Fatalf("subscribe: %d %s", r.status, r.body)
	}
	if r := do(t, h, "POST", "/api/notifications/test", ""); r.status != http.StatusOK || len(fake.Sent()) != 1 {
		t.Fatalf("test: %d %s, sent %d", r.status, r.body, len(fake.Sent()))
	}
	if r := do(t, h, "DELETE", "/api/push/subscription", ""); r.status != http.StatusNoContent {
		t.Fatalf("delete: %d %s", r.status, r.body)
	}
	var subs, devices int
	d.QueryRow(`SELECT COUNT(*) FROM push_subscriptions`).Scan(&subs)
	d.QueryRow(`SELECT COUNT(*) FROM devices WHERE name = 'Demo-toestel'`).Scan(&devices)
	if subs != 0 || devices != 1 {
		t.Errorf("%d subscriptions, %d stand-in devices", subs, devices)
	}
}
