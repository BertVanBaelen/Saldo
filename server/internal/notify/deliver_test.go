package notify

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
)

func TestDefaults(t *testing.T) {
	want := map[string]Pref{
		"rood": {true, true}, "buffer": {true, false}, "consent": {true, true}, "stop": {true, true},
		"joined": {true, true}, "invite": {true, true}, "contrib": {false, false}, "cat": {true, false},
		"device": {true, true}, "week": {false, false}, "month": {false, false},
	}
	got := Effective(nil)
	if len(got) != len(want) || len(Types) != len(want) {
		t.Fatalf("Effective(nil) has %d types, Types %d, want %d", len(got), len(Types), len(want))
	}
	for k, p := range want {
		if got[k] != p {
			t.Errorf("default of %s: %+v, want %+v", k, got[k], p)
		}
	}
	// A stored row wins; the device e-mail cannot be turned off; unknown rows are ignored.
	got = Effective(map[string]Pref{"buffer": {false, true}, "device": {false, false}, "toestel": {true, true}})
	if got["buffer"] != (Pref{false, true}) || got["device"] != (Pref{false, true}) || len(got) != len(want) {
		t.Errorf("stored rows: %+v", got)
	}
	if d, _ := TypeByKey(TypeDevice); !d.Security || !d.AlwaysEmail {
		t.Error("device is not a security type with an e-mail that is always sent")
	}

	// The dispatcher reads the same defaults: no rows, a cat and a contrib
	// message go by push (cat) or not at all (contrib), never by e-mail.
	h := planningHarness(t)
	for _, typ := range []string{TypeCat, TypeContrib, TypeBuffer} {
		res, err := h.s.Deliver(context.Background(), day(0, 12, 0), testMessage(bert, typ, "k:"+typ))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Join(res.Sent, ",") != map[string]string{TypeCat: "push", TypeContrib: "", TypeBuffer: "push"}[typ] {
			t.Errorf("%s with no rows went by %v", typ, res.Sent)
		}
	}
	if n := h.count(`channel = 'email' AND status = 'suppressed'`); n != 3 {
		t.Errorf("%d suppressed e-mail rows, want 3", n)
	}
}

// testMessage is a message with both forms about nothing in particular.
func testMessage(user int64, typ, key string) Message {
	p := Payload(typ, Text{Count: 3}, Detail)
	p.URL, p.Tag = "/", typ
	return Message{User: user, Type: typ, Key: key, Push: &p, Email: &mail.Message{Subject: "Test " + typ, Text: "t", HTML: "h"}}
}

func TestDeliverExpiresAndSecurity(t *testing.T) {
	h := planningHarness(t)
	ctx := context.Background()
	m := testMessage(bert, TypeJoined, "notice:1")
	m.Expires = day(0, 12, 0)
	res, err := h.s.Deliver(ctx, day(0, 12, 0), m)
	if err != nil || !res.Dropped || h.count(`1`) != 0 {
		t.Errorf("an expired message: %+v %v, %d rows", res, err, h.count(`1`))
	}
	// A new device at 03:00: the push does not wait, the e-mail goes even with
	// the chip and the e-mail channel off.
	h.exec(`INSERT INTO notification_prefs (user_id, type, push, email) VALUES (1, 'device', 1, 0)`)
	h.exec(`UPDATE users SET notify_email = 0 WHERE id = 1`)
	res, err = h.s.Deliver(ctx, day(1, 3, 0), testMessage(bert, TypeDevice, "device:9"))
	if err != nil || strings.Join(res.Sent, ",") != "email,push" {
		t.Errorf("device at 03:00: %+v %v", res, err)
	}
	// Another type at 03:00 waits without a claim.
	res, err = h.s.Deliver(ctx, day(1, 3, 0), testMessage(bert, TypeJoined, "notice:2"))
	if err != nil || !res.Retry || len(res.Sent) != 0 || h.count(`dedupe = 'notice:2' AND channel = 'push'`) != 0 {
		t.Errorf("joined at 03:00: %+v %v", res, err)
	}
	// An unknown type or an empty key is a programming error.
	if _, err := h.s.Deliver(ctx, day(1, 9, 0), testMessage(bert, "toestel", "x")); err == nil {
		t.Error("an unknown type was delivered")
	}
}

func TestDeliverStaleClaim(t *testing.T) {
	h := planningHarness(t)
	ctx := context.Background()
	now := day(0, 12, 0)
	h.exec(`UPDATE users SET notify_email = 0`)
	h.exec(`INSERT INTO notification_log (user_id, type, channel, dedupe, status, claimed_at) VALUES
		(1, 'joined', 'push', 'notice:fresh', 'claimed', ?), (1, 'joined', 'push', 'notice:old', 'claimed', ?)`,
		stamp(now.Add(-5*time.Minute)), stamp(now.Add(-11*time.Minute)))
	fresh, err := h.s.Deliver(ctx, now, testMessage(bert, TypeJoined, "notice:fresh"))
	if err != nil || len(fresh.Sent) != 0 {
		t.Errorf("a fresh claim was taken over: %+v %v", fresh, err)
	}
	old, err := h.s.Deliver(ctx, now, testMessage(bert, TypeJoined, "notice:old"))
	if err != nil || strings.Join(old.Sent, ",") != "push" || h.count(`dedupe = 'notice:old' AND status = 'sent'`) != 1 {
		t.Errorf("a claim of 11 minutes was not retried: %+v %v", old, err)
	}
}

// pickySender answers per endpoint: gone, failing or fine.
type pickySender struct {
	mu   sync.Mutex
	fail map[string]error
	sent []push.Message
}

func (p *pickySender) Send(_ context.Context, sub push.Subscription, m push.Message) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	for suffix, err := range p.fail {
		if strings.HasSuffix(sub.Endpoint, suffix) {
			return err
		}
	}
	p.sent = append(p.sent, m)
	return nil
}

func TestDeliverPushSubscriptions(t *testing.T) {
	h := planningHarness(t)
	ctx := context.Background()
	h.exec(`UPDATE users SET notify_email = 0`)
	h.subscribe(bert, "bert-gone")
	h.subscribe(bert, "bert-broken")
	sender := &pickySender{fail: map[string]error{"bert-gone": push.ErrGone, "bert-broken": errors.New("push: 500")}}
	s := New(Options{DB: h.d, Mailer: h.mail, Pushes: push.NewStore(h.d), Push: sender})

	// One phone accepts: sent; the gone one is deleted, the broken one kept.
	res, err := s.Deliver(ctx, day(0, 12, 0), testMessage(bert, TypeJoined, "notice:1"))
	if err != nil || strings.Join(res.Sent, ",") != "push" || res.Retry {
		t.Errorf("%+v %v", res, err)
	}
	var endpoints string
	if err := h.d.QueryRow(`SELECT group_concat(endpoint, ' ') FROM push_subscriptions WHERE user_id = 1`).Scan(&endpoints); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(endpoints, "bert-gone") || !strings.Contains(endpoints, "bert-broken") || !strings.Contains(endpoints, "/bert") {
		t.Errorf("subscriptions left: %s", endpoints)
	}

	// No phone accepts: the claim goes, the next run retries.
	sender.fail["/bert"] = errors.New("push: timeout")
	res, err = s.Deliver(ctx, day(0, 12, 0), testMessage(bert, TypeJoined, "notice:2"))
	if err != nil || !res.Retry || h.count(`dedupe = 'notice:2' AND channel = 'push'`) != 0 {
		t.Errorf("all failed: %+v %v", res, err)
	}
	delete(sender.fail, "/bert")
	res, err = s.Deliver(ctx, day(0, 12, 15), testMessage(bert, TypeJoined, "notice:2"))
	if err != nil || strings.Join(res.Sent, ",") != "push" {
		t.Errorf("the retry: %+v %v", res, err)
	}

	// What a real push service accepts: a Topic of at most 32 base64url
	// characters, a same-origin path, a tone the service worker knows.
	topicRE := regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)
	for _, m := range sender.sent {
		if !topicRE.MatchString(m.Topic) || !strings.HasPrefix(m.URL, "/") || !strings.Contains("info warn error", m.Tone) || m.Tone == "" {
			t.Errorf("push %+v would be refused", m)
		}
	}
	for _, typ := range Types {
		p := Payload(typ.Key, Text{}, Detail)
		if p.Tone != "info" && p.Tone != "warn" && p.Tone != "error" {
			t.Errorf("%s: tone %q", typ.Key, p.Tone)
		}
	}
	if got := topic("planning-1", "account:1|rood|2027-02|red"); !topicRE.MatchString(got) || got != topic("planning-1", "other") {
		t.Errorf("topic %q", got)
	}
}

// TestConnectionsBaseline: the bank reminders mailed before the upgrade are
// not sent again, by mail or by push; a new reminder goes by both.
func TestConnectionsBaseline(t *testing.T) {
	ctx := context.Background()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	before := fstest.MapFS{}
	full := db.Migrations()
	entries, _ := fs.ReadDir(full, ".")
	for _, e := range entries {
		if e.Name() != "0019_notifications.sql" {
			b, _ := fs.ReadFile(full, e.Name())
			before[e.Name()] = &fstest.MapFile{Data: b}
		}
	}
	if _, err := db.Migrate(ctx, d, before, "", nil); err != nil {
		t.Fatal(err)
	}
	exec(t, d, `INSERT INTO users (id, email, display_name) VALUES (1, 'bert@example.com', 'Bert')`)
	addConnection(t, d, 1, 1, "Argenta", t0.AddDate(0, 0, 14), t0.Add(-5*time.Hour))
	addAccount(t, d, 1, 1, 1, "Zichtrekening", fullIBAN)
	// The 0.3-2 check mailed the 14-day reminder, with the state it computes.
	conns, err := ledger.New(d).Connections(ctx, 1, t0)
	if err != nil || len(conns) != 1 {
		t.Fatal(conns, err)
	}
	list := reminders(conns[0], t0)
	if len(list) != 1 || !strings.HasPrefix(list[0].state, "14d:") {
		t.Fatalf("reminders %+v", list)
	}
	exec(t, d, `INSERT INTO notification_log (user_id, type, connection_id, state, channel, sent_at) VALUES (1, 'consent', 1, ?, 'email', ?)`,
		list[0].state, ts(t0))
	if _, err := db.Migrate(ctx, d, full, "", nil); err != nil {
		t.Fatal(err)
	}

	h := newHarnessOn(t, d)
	h.subscribe(1, "bert")
	h.exec(`INSERT INTO notify_runs (name, day) VALUES ('baseline:planning', '2026-11-01')`) // only the bank reminders here
	at := func(now time.Time, want ...string) {
		t.Helper()
		synced(t, d, 1, now.Add(-time.Hour)) // the nightly sync keeps working
		h.run(now, want...)
	}
	at(t0.Add(time.Hour)) // the baseline
	if h.count(`channel = 'push' AND status = 'suppressed' AND dedupe = ?`, connectionKey(1, TypeConsent, list[0].state)) != 1 {
		t.Error("the baseline did not copy the mailed reminder to push")
	}
	at(t0.Add(2 * time.Hour))
	at(t0.AddDate(0, 0, 1))
	// The 3-day reminder falls due at midnight: the mail goes at 03:00, the
	// push at 07:00 when quiet hours end.
	brussels := t0.Location()
	at(time.Date(2026, 11, 27, 3, 0, 0, 0, brussels), "Bert email: Laatste herinnering: Argenta verloopt over 3 dagen (Zichtrekening)")
	at(time.Date(2026, 11, 27, 6, 45, 0, 0, brussels))
	at(time.Date(2026, 11, 27, 7, 0, 0, 0, brussels), "Bert push: Bankkoppeling verloopt binnenkort /bankkoppelingen")
	at(time.Date(2026, 11, 27, 7, 15, 0, 0, brussels))
}
