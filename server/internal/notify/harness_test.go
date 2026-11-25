package notify

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
)

// harness is a database with the dispatcher on a recording mailer and a fake
// push sender, and the transcript of what went out.
type harness struct {
	t     *testing.T
	d     *sql.DB
	mail  *recorder
	push  *push.Fake
	s     *Service
	seen  int               // pushes already taken
	names map[string]string // e-mail address or push endpoint → user name
	live  bool              // every run first records a good sync an hour before it (syncAll)
}

func newHarnessOn(t *testing.T, d *sql.DB) *harness {
	h := &harness{t: t, d: d, mail: &recorder{}, push: &push.Fake{}, names: map[string]string{}}
	h.s = h.service()
	rows, err := d.Query(`SELECT display_name, email FROM users`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name, email string
		if err := rows.Scan(&name, &email); err != nil {
			t.Fatal(err)
		}
		h.names[email] = name
	}
	return h
}

// service is a new Service on the same database, mailer and push sender: a
// restart.
func (h *harness) service() *Service {
	return New(Options{DB: h.d, Mailer: h.mail, Pushes: push.NewStore(h.d), Push: h.push, PublicURL: "https://saldo.example.com"})
}

func (h *harness) exec(q string, args ...any) int64 {
	h.t.Helper()
	res, err := h.d.Exec(q, args...)
	if err != nil {
		h.t.Fatalf("%v\n%s", err, q)
	}
	id, _ := res.LastInsertId()
	return id
}

// subscribe gives the user a device with a push subscription.
func (h *harness) subscribe(user int64, name string) {
	h.t.Helper()
	dev := h.exec(`INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'Telefoon', ?)`, user, fmt.Sprint("hash-", user, "-", name))
	endpoint := "https://fcm.googleapis.com/fcm/send/" + name
	h.exec(`INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth) VALUES (?, ?, ?, 'k', 'a')`, user, dev, endpoint)
	var display string
	if err := h.d.QueryRow(`SELECT display_name FROM users WHERE id = ?`, user).Scan(&display); err != nil {
		h.t.Fatal(err)
	}
	h.names[endpoint] = display
}

// take returns what went out since the last call, sorted: "<user> email:
// <subject>" and "<user> push: <title> <url>".
func (h *harness) take() []string {
	h.mail.mu.Lock()
	var out []string
	for _, m := range h.mail.sent {
		out = append(out, h.names[m.To]+" email: "+m.Subject)
	}
	h.mail.sent = nil
	h.mail.mu.Unlock()
	sent := h.push.Sent()
	for _, p := range sent[h.seen:] {
		out = append(out, h.names[p.Subscription.Endpoint]+" push: "+p.Message.Title+" "+p.Message.URL)
	}
	h.seen = len(sent)
	slices.Sort(out)
	return out
}

// run runs every trigger at now and checks what went out.
func (h *harness) run(now time.Time, want ...string) {
	h.t.Helper()
	h.runOn(h.s, now, want...)
}

func (h *harness) runOn(s *Service, now time.Time, want ...string) {
	h.t.Helper()
	if h.live {
		h.syncAll(now.Add(-time.Hour))
	}
	if err := s.Run(context.Background(), now); err != nil {
		h.t.Fatal(err)
	}
	got := h.take()
	slices.Sort(want)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		h.t.Errorf("run at %s:\n got %q\nwant %q", now.Format(time.DateTime), got, want)
	}
}

// count is the number of log rows matching where.
func (h *harness) count(where string, args ...any) int {
	h.t.Helper()
	var n int
	if err := h.d.QueryRow(`SELECT COUNT(*) FROM notification_log WHERE `+where, args...).Scan(&n); err != nil {
		h.t.Fatal(err)
	}
	return n
}

// The planning world: today is Wednesday 18 November 2026. Bert (look-ahead
// 3), Partner (3) and Lezer (3, read-only on the shared account). Two manual
// current accounts with a buffer of € 500 and € 1.000 on the 18th and nothing
// else, so their month ends move only with the planned items a test adds:
// A1 Zichtrekening (Bert's own) and A2 Gedeelde rekening (all three).
const (
	bert, partner, lezer int64 = 1, 2, 3
	a1, a2               int64 = 1, 2
)

// day is a moment of the n-th day after 18 November 2026, in Brussels.
func day(n, hour, minute int) time.Time {
	return time.Date(2026, 11, 18+n, hour, minute, 0, 0, clock.Brussels)
}

func planningHarness(t *testing.T) *harness {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	h := newHarnessOn(t, d)
	h.exec(`INSERT INTO users (id, email, display_name) VALUES (1, 'bert@example.com', 'Bert'), (2, 'partner@example.com', 'Partner'), (3, 'lezer@example.com', 'Lezer')`)
	h.names = map[string]string{"bert@example.com": "Bert", "partner@example.com": "Partner", "lezer@example.com": "Lezer"}
	h.exec(`INSERT INTO accounts (id, type, source, iban, name, buffer) VALUES (1, 'current', 'manual', 'BE68539007547034', 'Zichtrekening', 50000)`)
	h.exec(`INSERT INTO accounts (id, type, source, name, buffer, shared) VALUES (2, 'current', 'manual', 'Gedeelde rekening', 50000, 1)`)
	h.exec(`INSERT INTO accounts (id, type, source, name) VALUES (3, 'savings', 'manual', 'Spaarrekening')`)
	h.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 1, 'manager', 'edit'), (2, 1, 'manager', 'edit'),
		(2, 2, 'member', 'edit'), (2, 3, 'member', 'read'), (3, 1, 'manager', 'edit')`)
	h.exec(`INSERT INTO balance_snapshots (account_id, balance, date, origin) VALUES (1, 100000, '2026-11-18', 'manual'),
		(2, 100000, '2026-11-18', 'manual'), (3, 900000, '2026-11-18', 'manual')`)
	h.subscribe(bert, "bert")
	h.subscribe(partner, "partner")
	h.subscribe(lezer, "lezer")
	return h
}

// plan adds a planned item and returns its id.
func (h *harness) plan(account int64, date string, amount int64) int64 {
	h.t.Helper()
	return h.exec(`INSERT INTO planned_items (account_id, date, amount, description) VALUES (?, ?, ?, 'Autoherstelling')`, account, date, amount)
}

func (h *harness) unplan(id int64) {
	h.t.Helper()
	h.exec(`DELETE FROM planned_items WHERE id = ?`, id)
}
