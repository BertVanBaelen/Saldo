package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/notify"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
)

// gate is a mailer that holds the new-device mail until it is opened, so a
// test can see that the sign-in answers before the mail goes.
type gate struct {
	box  *mailbox
	open chan struct{}
	once sync.Once
}

func (g *gate) Send(ctx context.Context, m mail.Message) error {
	if strings.HasPrefix(m.Subject, "Nieuw toestel") {
		<-g.open
	}
	return g.box.Send(ctx, m)
}

func (g *gate) release() { g.once.Do(func() { close(g.open) }) }

// TestNewDeviceThroughTheDispatcher (0.9-3b step 6): with Options.Notify the
// new-device message goes through the dispatcher in the background: the
// verify answer is the same and does not wait for the mail; the e-mail goes
// (always on) and the push reaches the user's other phone, never the new
// device; the log has the device:<id> key.
func TestNewDeviceThroughTheDispatcher(t *testing.T) {
	fake := &push.Fake{}
	var g *gate
	e := newEnv(t, func(o *Options) {
		g = &gate{box: o.Mailer.(*mailbox), open: make(chan struct{})}
		o.Notify = notify.New(notify.Options{DB: o.DB, Mailer: g, Pushes: push.NewStore(o.DB), Push: fake, PublicURL: o.PublicURL})
	})
	defer g.release()
	bert := e.addUser("bert@example.com", "Bert", "admin", bertPass)
	// Bert's phone, signed in before, with a push subscription.
	res, err := e.db.Exec(`INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'Chrome op Android', 'old-phone')`, bert)
	if err != nil {
		t.Fatal(err)
	}
	phone, _ := res.LastInsertId()
	if _, err := e.db.Exec(`INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth)
		VALUES (?, ?, 'https://fcm.googleapis.com/fcm/send/phone', 'k', 'a')`, bert, phone); err != nil {
		t.Fatal(err)
	}

	l := e.login("bert@example.com", bertPass)
	code := e.code("bert@example.com")
	r := e.verify(l.Challenge, code)
	if r.status != http.StatusOK {
		t.Fatalf("verify: %d %s", r.status, r.body)
	}
	// The answer came while the mail is still held: the same shape as before.
	equalJSON(t, r.body, `{"user": {"id": 1, "name": "Bert", "email": "bert@example.com", "role": "admin", "initial": "B"}}`)
	g.release()
	msgs := e.mails()
	if len(msgs) != 1 || msgs[0].Subject != "Nieuw toestel aangemeld: Safari op iPhone" || msgs[0].To != "bert@example.com" ||
		!strings.Contains(msgs[0].Text, "https://saldo.example.com/instellingen/toestellen") {
		t.Fatalf("new device mail: %+v", msgs)
	}
	sent := fake.Sent()
	if len(sent) != 1 || sent[0].Subscription.Endpoint != "https://fcm.googleapis.com/fcm/send/phone" ||
		sent[0].Message.Title != "Nieuw toestel aangemeld" || sent[0].Message.URL != "/instellingen/toestellen" {
		t.Fatalf("pushes: %+v", sent)
	}
	var keys []string
	rows, err := e.db.Query(`SELECT dedupe || ' ' || channel || ' ' || status FROM notification_log ORDER BY channel`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		rows.Scan(&k)
		keys = append(keys, k)
	}
	var dev int64
	e.db.QueryRow(`SELECT MAX(id) FROM devices`).Scan(&dev)
	want := "device:" + strconv.FormatInt(dev, 10) + " email sent, device:" + strconv.FormatInt(dev, 10) + " push sent"
	if strings.Join(keys, ", ") != want {
		t.Errorf("log %q, want %q", keys, want)
	}
}
