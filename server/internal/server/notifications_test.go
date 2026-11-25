package server

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/notify"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
)

// The Meldingen settings API (0.9-4, docs/api.md "Notifications (0.9-4)").

const defaultNotifications = `{
	"channels": {"email": true, "quietHours": true},
	"lookahead": 3,
	"groups": [
		{"id": "planning", "label": "Planning"}, {"id": "bank", "label": "Bank"}, {"id": "gedeeld", "label": "Gedeeld"},
		{"id": "transacties", "label": "Transacties"}, {"id": "overzicht", "label": "Overzicht"}, {"id": "beveiliging", "label": "Beveiliging"}
	],
	"types": [
		{"key": "rood", "name": "Rekening staat rood", "subline": "Als een rekening in de planning onder € 0 zakt", "group": "planning", "dot": "neg", "push": true, "email": true, "emailLocked": false},
		{"key": "buffer", "name": "Rekening komt in de buffer", "subline": "Als een rekening onder haar eigen buffer zakt", "group": "planning", "dot": "warn", "push": true, "email": false, "emailLocked": false},
		{"key": "consent", "name": "Koppeling verloopt", "subline": "14 en 3 dagen vooraf", "group": "bank", "dot": "warn", "push": true, "email": true, "emailLocked": false},
		{"key": "stop", "name": "Synchronisatie gestopt", "subline": "Als Saldo een rekening niet meer kan lezen", "group": "bank", "dot": "neg", "push": true, "email": true, "emailLocked": false},
		{"key": "joined", "name": "Iemand sluit aan", "subline": "Bij een gedeelde rekening waar jij beheerder bent", "group": "gedeeld", "dot": "shared", "push": true, "email": true, "emailLocked": false},
		{"key": "invite", "name": "Uitnodiging voor een gedeelde rekening", "subline": "Als een beheerder je uitnodigt", "group": "gedeeld", "dot": "shared", "push": true, "email": true, "emailLocked": false},
		{"key": "contrib", "name": "Bijdrage ontbreekt", "subline": "Als een bijdrage op de 3e nog niet binnen is", "group": "gedeeld", "dot": "shared", "push": false, "email": false, "emailLocked": false},
		{"key": "cat", "name": "Te categoriseren", "subline": "Eén keer per dag om 19:00, als er iets is", "group": "transacties", "dot": "green", "push": true, "email": false, "emailLocked": false},
		{"key": "week", "name": "Weekoverzicht", "subline": "Elke zondag om 19:00, met wat je uitgaf per categorie", "group": "overzicht", "dot": "green", "push": false, "email": false, "emailLocked": false},
		{"key": "month", "name": "Maandoverzicht", "subline": "Op de laatste dag van de maand om 19:00, met je budgetten", "group": "overzicht", "dot": "green", "push": false, "email": false, "emailLocked": false},
		{"key": "device", "name": "Nieuw toestel aangemeld", "subline": "Als iemand inlogt op een nieuw toestel", "group": "beveiliging", "dot": "warn", "push": true, "email": true, "emailLocked": true}
	]
}`

// notifEnv is a push environment with two users and one device each.
type notifEnv struct {
	*pushEnv
	bert, partner int64
	a, p          string // their device cookies
}

func newNotifEnv(t *testing.T) *notifEnv {
	t.Helper()
	e := &notifEnv{pushEnv: newPushEnv(t)}
	e.bert = e.addUser("bert@example.com", "Bert", "admin", bertPass)
	e.partner = e.addUser("partner@example.com", "Partner", "user", partnerPass)
	e.a, e.p = e.deviceFor(e.bert), e.deviceFor(e.partner)
	return e
}

func (e *notifEnv) getSettings(device string) response {
	e.t.Helper()
	return e.get("/api/notifications", device)
}

func (e *notifEnv) putSettings(device, body string) response {
	e.t.Helper()
	return e.do(call{method: "PUT", path: "/api/notifications", device: device, body: body})
}

// settings is the answer of a call that must be a 200.
func (e *notifEnv) settings(r response) notificationsBody {
	e.t.Helper()
	if r.status != http.StatusOK {
		e.t.Fatalf("%d %s", r.status, r.body)
	}
	return decode[notificationsBody](e.t, r.body)
}

// chips is the push and e-mail chip of every type of an answer, by key.
func chips(b notificationsBody) map[string]notify.Pref {
	out := map[string]notify.Pref{}
	for _, t := range b.Types {
		out[t.Key] = notify.Pref{Push: t.Push, Email: t.Email}
	}
	return out
}

func (e *notifEnv) rows(user int64) int {
	e.t.Helper()
	var n int
	if err := e.db.QueryRow(`SELECT COUNT(*) FROM notification_prefs WHERE user_id = ?`, user).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestNotificationSettings(t *testing.T) {
	e := newNotifEnv(t)

	// Not signed in: 401 on both routes.
	expectError(t, e.getSettings(""), http.StatusUnauthorized, "unauthorized")
	expectError(t, e.putSettings("", `{"lookahead":6}`), http.StatusUnauthorized, "unauthorized")

	// No rows: the defaults of the table, merged (the screen repeats none): the
	// e-mail of buffer, cat and contrib off, week and month off and off, the
	// e-mail of device locked on.
	r := e.getSettings(e.a)
	equalJSON(t, r.body, defaultNotifications)
	if ct := r.header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content type %q", ct)
	}
	if e.rows(e.bert) != 0 {
		t.Error("a read wrote rows")
	}

	// A partial update changes only what was sent: one half of one chip.
	want := chips(e.settings(e.getSettings(e.a)))
	got := e.settings(e.putSettings(e.a, `{"types":{"buffer":{"email":true}}}`))
	want["buffer"] = notify.Pref{Push: true, Email: true}
	if !got.Channels.Email || !got.Channels.QuietHours || got.Lookahead != 3 || !slices.Equal(got.Groups, e.settings(e.getSettings(e.a)).Groups) {
		t.Errorf("a chip changed the channels: %+v", got)
	}
	if g := chips(got); !mapsEqual(g, want) {
		t.Errorf("chips %+v, want %+v", g, want)
	}
	if again := chips(e.settings(e.getSettings(e.a))); !mapsEqual(again, want) {
		t.Errorf("not stored: %+v", again)
	}
	// Only the type that was named has a row; the push half came from the default.
	if e.rows(e.bert) != 1 {
		t.Errorf("%d rows, want one", e.rows(e.bert))
	}

	// The channels and the look-ahead are separate parts, each alone.
	if b := e.settings(e.putSettings(e.a, `{"channels":{"quietHours":false}}`)); !b.Channels.Email || b.Channels.QuietHours || b.Lookahead != 3 {
		t.Errorf("quiet hours alone: %+v", b)
	}
	if b := e.settings(e.putSettings(e.a, `{"channels":{"email":false}}`)); b.Channels.Email || b.Channels.QuietHours || b.Lookahead != 3 {
		t.Errorf("e-mail alone: %+v", b)
	}
	if b := e.settings(e.putSettings(e.a, `{"lookahead":6}`)); b.Channels.Email || b.Channels.QuietHours || b.Lookahead != 6 || !mapsEqual(chips(b), want) {
		t.Errorf("look-ahead alone: %+v", b)
	}
	// Everything at once, and back; the e-mail of a type is kept when only its push is sent.
	b := e.settings(e.putSettings(e.a, `{"channels":{"email":true,"quietHours":true},"lookahead":1,"types":{"rood":{"push":false},"week":{"push":true,"email":true},"contrib":{"push":true}}}`))
	if !b.Channels.Email || !b.Channels.QuietHours || b.Lookahead != 1 {
		t.Errorf("all at once: %+v", b)
	}
	c := chips(b)
	if c["rood"] != (notify.Pref{Push: false, Email: true}) || c["week"] != (notify.Pref{Push: true, Email: true}) ||
		c["contrib"] != (notify.Pref{Push: true, Email: false}) || c["buffer"] != (notify.Pref{Push: true, Email: true}) || c["cat"] != (notify.Pref{Push: true, Email: false}) {
		t.Errorf("chips after the update: %+v", c)
	}

	// An empty body (or empty parts) changes nothing and answers the state.
	before := e.getSettings(e.a).body
	for _, body := range []string{`{}`, `{"channels":{}}`, `{"types":{}}`, `{"types":{"rood":{}}}`, `{"lookahead":null}`} {
		if r := e.putSettings(e.a, body); r.status != http.StatusOK || r.body != before {
			t.Errorf("%s: %d %s", body, r.status, r.body)
		}
	}

	// The device e-mail is locked on: "on" is fine, a device push can be turned off.
	if b := e.settings(e.putSettings(e.a, `{"types":{"device":{"push":false,"email":true}}}`)); chips(b)["device"] != (notify.Pref{Push: false, Email: true}) {
		t.Errorf("device: %+v", chips(b)["device"])
	}
	var locked int
	for _, ty := range e.settings(e.getSettings(e.a)).Types {
		if ty.EmailLocked {
			locked++
			if ty.Key != "device" || !ty.Email {
				t.Errorf("locked type %+v", ty)
			}
		}
	}
	if locked != 1 {
		t.Errorf("%d locked types", locked)
	}
}

// A stored row wins over the default; rows of unknown types are ignored and a
// stored row cannot turn the device e-mail off.
func TestNotificationSettingsStoredRowWins(t *testing.T) {
	e := newNotifEnv(t)
	for _, row := range []string{
		`(1, 'rood', 0, 0)`, `(1, 'week', 1, 1)`, `(1, 'device', 0, 0)`, `(1, 'toestel', 0, 0)`, `(2, 'rood', 0, 1)`,
	} {
		if _, err := e.db.Exec(`INSERT INTO notification_prefs (user_id, type, push, email) VALUES ` + row); err != nil {
			t.Fatal(err)
		}
	}
	c := chips(e.settings(e.getSettings(e.a)))
	if c["rood"] != (notify.Pref{}) || c["week"] != (notify.Pref{Push: true, Email: true}) || c["device"] != (notify.Pref{Push: false, Email: true}) ||
		c["buffer"] != (notify.Pref{Push: true, Email: false}) || len(c) != len(notify.Types) {
		t.Errorf("chips %+v", c)
	}
	if c := chips(e.settings(e.getSettings(e.p))); c["rood"] != (notify.Pref{Push: false, Email: true}) || c["week"] != (notify.Pref{}) {
		t.Errorf("Partner's chips %+v", c)
	}
	// An update merges the missing half from the stored row, not from the default.
	c = chips(e.settings(e.putSettings(e.a, `{"types":{"rood":{"push":true}}}`)))
	if c["rood"] != (notify.Pref{Push: true, Email: false}) {
		t.Errorf("rood after a push-only update: %+v", c["rood"])
	}
}

func TestNotificationSettingsValidation(t *testing.T) {
	e := newNotifEnv(t)
	const bad = "De gegevens kloppen niet."
	for body, want := range map[string]string{
		`{"types":{"toestel":{"push":true}}}`:                        "Dit soort melding bestaat niet.",
		`{"types":{"Rood":{"push":true}}}`:                           "Dit soort melding bestaat niet.",
		`{"types":{"":{"push":true}}}`:                               "Dit soort melding bestaat niet.",
		`{"types":{"rood":{"push":false},"x":{"email":true}}}`:       "Dit soort melding bestaat niet.",
		`{"types":{"device":{"email":false}}}`:                       "Deze e-mail kan je niet uitzetten.",
		`{"types":{"device":{"push":true,"email":false}}}`:           "Deze e-mail kan je niet uitzetten.",
		`{"lookahead":2}`:                                            "Kies 1, 3 of 6 maanden.",
		`{"lookahead":0}`:                                            "Kies 1, 3 of 6 maanden.",
		`{"lookahead":12}`:                                           "Kies 1, 3 of 6 maanden.",
		`{"lookahead":-1}`:                                           "Kies 1, 3 of 6 maanden.",
		`{"channels":{"push":false}}`:                                bad, // push is per device (PUT /api/push/subscription)
		`{"channels":{"email":"nee"}}`:                               bad,
		`{"channels":{"quietHours":1}}`:                              bad,
		`{"foo":1}`:                                                  bad,
		`{"types":{"rood":{"sms":true}}}`:                            bad,
		`{"types":{"rood":{"push":"ja"}}}`:                           bad,
		`{"types":{"rood":true}}`:                                    bad,
		`{"types":[]}`:                                               bad,
		`{"lookahead":"3"}`:                                          bad,
		`{"lookahead":3.5}`:                                          bad,
		`{"lookahead":`:                                              bad,
		`[1]`:                                                        bad,
		`{"lookahead":3} {}`:                                         bad,
		`{"lookahead":6,"types":{"device":{"email":false}}}`:         "Deze e-mail kan je niet uitzetten.", // a valid part saves nothing
		`{"channels":{"email":false},"types":{"toestel":{}}}`:        "Dit soort melding bestaat niet.",
		`{"channels":{"email":false},"lookahead":2}`:                 "Kies 1, 3 of 6 maanden.",
		`{"lookahead":2,"types":{"toestel":{"push":true}}}`:          "Kies 1, 3 of 6 maanden.",
		`{"types":{"rood":{"push":false},"device":{"email":false}}}`: "Deze e-mail kan je niet uitzetten.",
	} {
		if msg := expectError(t, e.putSettings(e.a, body), http.StatusBadRequest, "invalid"); msg != want {
			t.Errorf("%s: %q, want %q", body, msg, want)
		}
	}
	// Nothing of the refused bodies was saved.
	equalJSON(t, e.getSettings(e.a).body, defaultNotifications)
	if e.rows(e.bert) != 0 {
		t.Errorf("%d rows after refused updates", e.rows(e.bert))
	}

	// The rules of every write: JSON only, a size limit, no cross-origin calls.
	expectError(t, e.do(call{method: "PUT", path: "/api/notifications", device: e.a, body: `{"lookahead":6}`,
		header: map[string]string{"Content-Type": "text/plain"}}), http.StatusUnsupportedMediaType, "unsupported_media_type")
	expectError(t, e.putSettings(e.a, `{"lookahead":`+strings.Repeat("1", maxBody)+`}`), http.StatusRequestEntityTooLarge, "too_large")
	expectError(t, e.do(call{method: "PUT", path: "/api/notifications", device: e.a, body: `{"lookahead":6}`,
		header: map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example.org"}}), http.StatusForbidden, "forbidden")
	expectError(t, e.do(call{method: "POST", path: "/api/notifications", device: e.a, body: `{}`}), http.StatusMethodNotAllowed, "method_not_allowed")
	equalJSON(t, e.getSettings(e.a).body, defaultNotifications)
}

// One user's changes never reach another's, in either direction.
func TestNotificationSettingsArePerUser(t *testing.T) {
	e := newNotifEnv(t)
	if b := e.settings(e.putSettings(e.a, `{"channels":{"email":false,"quietHours":false},"lookahead":6,"types":{"rood":{"push":false,"email":false},"week":{"push":true}}}`)); b.Lookahead != 6 {
		t.Fatalf("Bert's update: %+v", b)
	}
	// Partner still has the defaults.
	equalJSON(t, e.getSettings(e.p).body, defaultNotifications)

	// Partner changes other things; Bert keeps his.
	bert := e.getSettings(e.a).body
	e.settings(e.putSettings(e.p, `{"channels":{"quietHours":false},"lookahead":1,"types":{"rood":{"email":false},"cat":{"push":false}}}`))
	if after := e.getSettings(e.a).body; after != bert {
		t.Errorf("Partner's update changed Bert's settings:\n%s\n%s", bert, after)
	}
	p := e.settings(e.getSettings(e.p))
	if !p.Channels.Email || p.Channels.QuietHours || p.Lookahead != 1 || chips(p)["rood"] != (notify.Pref{Push: true, Email: false}) ||
		chips(p)["cat"] != (notify.Pref{Push: false, Email: false}) || chips(p)["week"] != (notify.Pref{}) {
		t.Errorf("Partner: %+v", p)
	}

	// A refused update of one writes nothing for either.
	rows := e.rows(e.bert) + e.rows(e.partner)
	expectError(t, e.putSettings(e.p, `{"types":{"cat":{"push":true},"device":{"email":false}}}`), http.StatusBadRequest, "invalid")
	if e.rows(e.bert)+e.rows(e.partner) != rows || chips(e.settings(e.getSettings(e.p)))["cat"].Push {
		t.Error("a refused update wrote")
	}
	// Per user in the users table too.
	var look [2]int
	e.db.QueryRow(`SELECT lookahead_months FROM users WHERE id = ?`, e.bert).Scan(&look[0])
	e.db.QueryRow(`SELECT lookahead_months FROM users WHERE id = ?`, e.partner).Scan(&look[1])
	if look != [2]int{6, 1} {
		t.Errorf("look-ahead per user: %v", look)
	}
}

// notifyService is the dispatcher on the server's database, with the server's
// mailbox and fake push sender.
func (e *notifEnv) notifyService() *notify.Service {
	return notify.New(notify.Options{DB: e.db, Mailer: e.box, Pushes: push.NewStore(e.db), Push: e.fake, PublicURL: "https://saldo.example.com"})
}

// message is a typed message for a user with a push and an e-mail form.
func message(user int64, typ, key string) notify.Message {
	return notify.Message{User: user, Type: typ, Key: key,
		Push:  &push.Payload{Title: "Titel", Body: "Regel", URL: "/meldingen", Tone: "info", Tag: key},
		Email: &mail.Message{Subject: "Onderwerp", Text: "Tekst", HTML: "<p>Tekst</p>"}}
}

// What the settings do to what is sent: the next Deliver reads them, no cache.
func TestNotificationSettingsChangeWhatIsSent(t *testing.T) {
	e := newNotifEnv(t)
	svc := e.notifyService()
	ctx := context.Background()
	noon := time.Date(2026, 11, 18, 12, 0, 0, 0, clock.Brussels)
	late := time.Date(2026, 11, 18, 23, 0, 0, 0, clock.Brussels)
	if r := e.subscribe(e.a, "bert-telefoon"); r.status != http.StatusNoContent {
		t.Fatalf("subscribe: %d %s", r.status, r.body)
	}
	e.mails()
	pushes := func() int { return len(e.fake.Sent()) }
	mailCount := func() int {
		e.box.mu.Lock()
		defer e.box.mu.Unlock()
		return len(e.box.msgs)
	}

	// deliver sends m and returns the channels that went out, checked against
	// what the recorders saw.
	deliver := func(now time.Time, m notify.Message) (sent []string, retry bool) {
		t.Helper()
		before, mailsBefore := pushes(), mailCount()
		res, err := svc.Deliver(ctx, now, m)
		if err != nil {
			t.Fatal(err)
		}
		var seen []string
		if mailCount() > mailsBefore {
			seen = append(seen, "email")
		}
		if pushes() > before {
			seen = append(seen, "push")
		}
		if !slices.Equal(seen, res.Sent) {
			t.Fatalf("Deliver says %v, the mailbox and the push sender saw %v", res.Sent, seen)
		}
		return res.Sent, res.Retry
	}
	expect := func(what string, got []string, want ...string) {
		t.Helper()
		if !slices.Equal(got, want) {
			t.Errorf("%s: sent %v, want %v", what, got, want)
		}
	}
	suppressed := func(channel, key string) int {
		t.Helper()
		var n int
		e.db.QueryRow(`SELECT COUNT(*) FROM notification_log WHERE user_id = ? AND channel = ? AND dedupe = ? AND status = 'suppressed'`, e.bert, channel, key).Scan(&n)
		return n
	}

	// The control: the defaults send "Iemand sluit aan" by push and e-mail.
	got, _ := deliver(noon, message(e.bert, notify.TypeJoined, "k1"))
	expect("defaults", got, "email", "push")

	// The push chip of the type off: no push, a suppressed row, the e-mail still goes.
	e.settings(e.putSettings(e.a, `{"types":{"joined":{"push":false}}}`))
	got, _ = deliver(noon, message(e.bert, notify.TypeJoined, "k2"))
	expect("push chip off", got, "email")
	if suppressed("push", "k2") != 1 || suppressed("email", "k2") != 0 {
		t.Error("the push chip off did not log a suppressed push row (only)")
	}
	// Another type is not affected.
	got, _ = deliver(noon, message(e.bert, notify.TypeInvite, "k2b"))
	expect("another type", got, "email", "push")

	// Both chips off: nothing; one on again: that one.
	e.settings(e.putSettings(e.a, `{"types":{"joined":{"email":false}}}`))
	got, _ = deliver(noon, message(e.bert, notify.TypeJoined, "k3"))
	expect("both chips off", got)
	e.settings(e.putSettings(e.a, `{"types":{"joined":{"push":true}}}`))
	got, _ = deliver(noon, message(e.bert, notify.TypeJoined, "k4"))
	expect("push chip back on", got, "push")
	// Switching on later replays nothing: k3 stays suppressed.
	if got, _ = deliver(noon, message(e.bert, notify.TypeJoined, "k3")); len(got) != 0 {
		t.Errorf("k3 was replayed: %v", got)
	}
	e.settings(e.putSettings(e.a, `{"types":{"joined":{"email":true}}}`))

	// The e-mail channel off silences every e-mail except the new-device mail.
	e.settings(e.putSettings(e.a, `{"channels":{"email":false}}`))
	got, _ = deliver(noon, message(e.bert, notify.TypeJoined, "k5"))
	expect("e-mail channel off", got, "push")
	got, _ = deliver(noon, message(e.bert, notify.TypeDevice, "k6"))
	expect("new device with the e-mail channel off", got, "email", "push")
	e.settings(e.putSettings(e.a, `{"channels":{"email":true}}`))
	got, _ = deliver(noon, message(e.bert, notify.TypeJoined, "k7"))
	expect("e-mail channel back on", got, "email", "push")

	// Quiet hours: a push at 23:00 waits; with the switch off it goes; the
	// security message ignores them either way. cat has no e-mail by default.
	cat := func(key string) notify.Message { m := message(e.bert, notify.TypeCat, key); m.Email = nil; return m }
	got, retry := deliver(late, cat("q1"))
	if len(got) != 0 || !retry {
		t.Errorf("a push at 23:00 with quiet hours on: sent %v, retry %v", got, retry)
	}
	got, _ = deliver(late, message(e.bert, notify.TypeDevice, "q2"))
	expect("security at 23:00 with quiet hours on", got, "email", "push")
	e.settings(e.putSettings(e.a, `{"channels":{"quietHours":false}}`))
	got, retry = deliver(late, cat("q1"))
	expect("the held push after quiet hours off", got, "push")
	if retry {
		t.Error("retry after the push went out")
	}
	e.settings(e.putSettings(e.a, `{"channels":{"quietHours":true}}`))
	got, retry = deliver(late, cat("q3"))
	if len(got) != 0 || !retry {
		t.Errorf("quiet hours back on: sent %v, retry %v", got, retry)
	}

	// Partner's choices are Partner's: Bert's chips off do not silence her.
	e.settings(e.putSettings(e.a, `{"types":{"joined":{"push":false,"email":false}}}`))
	if r := e.subscribe(e.p, "partner-telefoon"); r.status != http.StatusNoContent {
		t.Fatalf("subscribe: %d %s", r.status, r.body)
	}
	got, _ = deliver(noon, message(e.partner, notify.TypeJoined, "p1"))
	expect("another user", got, "email", "push")
	got, _ = deliver(noon, message(e.bert, notify.TypeJoined, "k8"))
	expect("Bert, both chips off", got)
}

// The look-ahead of the API is the look-ahead of the planning warnings: of
// Start's alert and of the daily notification run alike.
func TestNotificationLookaheadChangesPlanningWarnings(t *testing.T) {
	e := newNotifEnv(t)
	for _, q := range []string{
		`INSERT INTO accounts (id, type, source, iban, name, buffer) VALUES (1, 'current', 'manual', 'BE68539007547034', 'Zichtrekening', 50000)`,
		`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 1, 'manager', 'edit')`,
		`INSERT INTO balance_snapshots (account_id, balance, date, origin) VALUES (1, 100000, '2026-11-18', 'manual')`,
		// February 2027 ends at −€ 1.000: red, three months after the running one.
		`INSERT INTO planned_items (account_id, date, amount, description) VALUES (1, '2027-02-10', -200000, 'Autoherstelling')`,
	} {
		if _, err := e.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if r := e.subscribe(e.a, "bert-telefoon"); r.status != http.StatusNoContent {
		t.Fatalf("subscribe: %d %s", r.status, r.body)
	}
	e.mails()
	svc := e.notifyService()
	ctx := context.Background()
	day := func(n int) time.Time { return time.Date(2026, 11, 18+n, 7, 5, 0, 0, clock.Brussels) }
	redRows := func() int {
		var n int
		e.db.QueryRow(`SELECT COUNT(*) FROM notification_log WHERE user_id = ? AND type = 'rood'`, e.bert).Scan(&n)
		return n
	}
	planningAlerts := func() []ledger.Alert {
		var out []ledger.Alert
		for _, a := range decode[[]ledger.Alert](t, e.get("/api/alerts", e.a).body) {
			if a.Type == "planning" {
				out = append(out, a)
			}
		}
		return out
	}

	// Look-ahead 1: February is out of sight, in Start's alert and in the run.
	if b := e.settings(e.putSettings(e.a, `{"lookahead":1}`)); b.Lookahead != 1 {
		t.Fatalf("look-ahead %d", b.Lookahead)
	}
	if a := planningAlerts(); len(a) != 0 {
		t.Errorf("look-ahead 1: Start shows %+v", a)
	}
	if err := svc.Planning(ctx, day(1)); err != nil {
		t.Fatal(err)
	}
	if n, m := len(e.fake.Sent()), len(e.mails()); redRows() != 0 || n != 0 || m != 0 {
		t.Errorf("look-ahead 1: %d red rows, %d pushes, %d mails", redRows(), n, m)
	}

	// Look-ahead 3 the next morning: February is red, one push and one e-mail.
	if b := e.settings(e.putSettings(e.a, `{"lookahead":3}`)); b.Lookahead != 3 {
		t.Fatalf("look-ahead %d", b.Lookahead)
	}
	if a := planningAlerts(); len(a) != 1 || !strings.Contains(a[0].Title, "februari") || a[0].AccountID != 1 {
		t.Errorf("look-ahead 3: Start shows %+v", a)
	}
	if err := svc.Planning(ctx, day(2)); err != nil {
		t.Fatal(err)
	}
	sent := e.fake.Sent()
	if len(sent) != 1 || !strings.Contains(sent[0].Message.URL, "maand=2027-02") || len(e.mails()) != 1 {
		t.Fatalf("look-ahead 3: %d pushes %+v", len(sent), sent)
	}
	var channels []string
	rows, err := e.db.Query(`SELECT channel FROM notification_log WHERE user_id = ? AND dedupe = 'account:1|rood|2027-02|red' AND status = 'sent' ORDER BY channel`, e.bert)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var c string
		rows.Scan(&c)
		channels = append(channels, c)
	}
	rows.Close()
	if !slices.Equal(channels, []string{"email", "push"}) {
		t.Errorf("the log of the red February: %v", channels)
	}

	// Look-ahead 1 and 6 change Start's alert at once (in this order: the run
	// below must see February, so it ends on 6); the sent message is not sent
	// twice and not taken back.
	for _, c := range []struct{ look, want int }{{1, 0}, {6, 1}} {
		e.settings(e.putSettings(e.a, `{"lookahead":`+string(rune('0'+c.look))+`}`))
		if a := planningAlerts(); len(a) != c.want {
			t.Errorf("look-ahead %d: Start shows %+v", c.look, a)
		}
	}
	if err := svc.Planning(ctx, day(3)); err != nil {
		t.Fatal(err)
	}
	if len(e.fake.Sent()) != 1 {
		t.Errorf("the red February was sent again: %d pushes", len(e.fake.Sent()))
	}
}

func mapsEqual[K comparable, V comparable](a, b map[K]V) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if w, ok := b[k]; !ok || w != v {
			return false
		}
	}
	return true
}
