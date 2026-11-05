package notify

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
)

// recorder is a mail.Sender that keeps what it was given.
type recorder struct {
	mu   sync.Mutex
	sent []mail.Message
	fail bool
	wait time.Duration
}

func (r *recorder) Send(ctx context.Context, m mail.Message) error {
	time.Sleep(r.wait)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return errors.New("550 mailbox unavailable")
	}
	r.sent = append(r.sent, m)
	return nil
}

// take returns the subjects sent since the last call.
func (r *recorder) take() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, m := range r.sent {
		out = append(out, m.To+": "+m.Subject)
	}
	r.sent = nil
	return out
}

// t0 is a morning in Brussels; the consent of connection 1 ends 14 days on.
var t0 = time.Date(2026, 11, 16, 9, 0, 0, 0, clock.Brussels)

const fullIBAN = "BE68539007547034"

func setup(t *testing.T) (*sql.DB, *recorder, *Service) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	exec(t, d, `INSERT INTO users (id, email, display_name) VALUES (1, 'bert@example.com', 'Bert'), (2, 'partner@example.com', 'Partner')`)
	addConnection(t, d, 1, 1, "Argenta", t0.AddDate(0, 0, 14), t0.Add(-5*time.Hour))
	addAccount(t, d, 1, 1, 1, "Zichtrekening", fullIBAN)
	r := &recorder{}
	return d, r, New(d, r, "https://saldo.example.com", nil)
}

func exec(t *testing.T, d *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := d.Exec(q, args...); err != nil {
		t.Fatal(err)
	}
}

func ts(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func addConnection(t *testing.T, d *sql.DB, id, user int64, bank string, validUntil, lastSync time.Time) {
	exec(t, d, `INSERT INTO provider_connections (id, user_id, provider, aspsp_name, status, consent_since, valid_until, last_sync_at, created_at)
		VALUES (?, ?, 'enablebanking', ?, 'active', '2026-06-03', ?, ?, '2026-06-03T10:00:00Z')`, id, user, bank, ts(validUntil), ts(lastSync))
}

func addAccount(t *testing.T, d *sql.DB, id, conn, user int64, name, iban string) {
	exec(t, d, `INSERT INTO accounts (id, type, source, iban, name, bank_name) VALUES (?, 'current', 'bank', ?, ?, 'Argenta')`, id, iban, name)
	exec(t, d, `INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, ?, 'manager', 'edit')`, id, user)
	exec(t, d, `INSERT INTO account_sources (account_id, connection_id, priority, status, last_sync_at) VALUES (?, ?, 'primary', 'ok', ?)`, id, conn, ts(t0))
}

// synced records a successful sync, as the sync engine does.
func synced(t *testing.T, d *sql.DB, conn int64, at time.Time) {
	exec(t, d, `UPDATE provider_connections SET last_sync_at = ?, sync_status = 'ok' WHERE id = ?`, ts(at), conn)
}

func run(t *testing.T, s *Service, r *recorder, now time.Time, want ...string) {
	t.Helper()
	if err := s.CheckConnections(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	got := r.take()
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("run at %s:\n got %q\nwant %q", now.Format(time.DateTime), got, want)
	}
}

const (
	mail14 = "bert@example.com: Je Argenta-koppeling verloopt over 14 dagen (Zichtrekening)"
	mail3  = "bert@example.com: Laatste herinnering: Argenta verloopt over 3 dagen (Zichtrekening)"
	stop   = "bert@example.com: Synchronisatie gestopt bij Argenta (Zichtrekening)"
)

func TestConsentReminders(t *testing.T) {
	d, r, s := setup(t)
	// The nightly sync keeps working throughout.
	at := func(now time.Time, want ...string) {
		t.Helper()
		synced(t, d, 1, now.Add(-time.Hour))
		run(t, s, r, now, want...)
	}
	at(t0, mail14)
	at(t0.Add(time.Hour))    // the next run
	at(t0.AddDate(0, 0, 1))  // the next day
	at(t0.AddDate(0, 0, 10)) // 4 days left
	at(t0.AddDate(0, 0, 11), mail3)
	at(t0.AddDate(0, 0, 11).Add(time.Hour))
	at(t0.AddDate(0, 0, 13).Add(-2 * time.Hour))

	// Re-authorised: a new consent of 180 days starts a new cycle.
	renewed := t0.AddDate(0, 0, 13)
	exec(t, d, `UPDATE provider_connections SET valid_until = ?, consent_since = ? WHERE id = 1`,
		ts(renewed.AddDate(0, 0, 180)), renewed.Format(time.DateOnly))
	at(renewed.Add(time.Hour))
	at(renewed.AddDate(0, 0, 166), mail14)
	at(renewed.AddDate(0, 0, 166).Add(time.Hour))
	at(renewed.AddDate(0, 0, 177), mail3)
}

func TestFirstSeenAtTwoDaysSendsOnlyTheLastReminder(t *testing.T) {
	d, r, s := setup(t)
	now := t0.AddDate(0, 0, 12)
	synced(t, d, 1, now.Add(-time.Hour))
	run(t, s, r, now, "bert@example.com: Laatste herinnering: Argenta verloopt over 2 dagen (Zichtrekening)")
	run(t, s, r, now.AddDate(0, 0, 1).Add(-2*time.Hour))
}

func TestLapsedConsentStopsOnce(t *testing.T) {
	d, r, s := setup(t)
	lapsed := t0.AddDate(0, 0, 15)
	run(t, s, r, lapsed, stop)
	run(t, s, r, lapsed.Add(time.Hour))
	run(t, s, r, lapsed.AddDate(0, 0, 5)) // still lapsed, still once
	// The bank's expired session says the same.
	exec(t, d, `UPDATE provider_connections SET status = 'expired' WHERE id = 1`)
	run(t, s, r, lapsed.AddDate(0, 0, 6))

	m, _ := mailFor(t, d, lapsed)
	if !strings.Contains(m.Text, "De toestemming bij Argenta is verlopen.") {
		t.Errorf("reason:\n%s", m.Text)
	}
}

func TestFailingSyncStopsOncePerEpisode(t *testing.T) {
	d, r, s := setup(t)
	// Consent far away, so only the sync matters.
	exec(t, d, `UPDATE provider_connections SET valid_until = ?, sync_status = 'failed' WHERE id = 1`, ts(t0.AddDate(0, 6, 0)))
	last := t0.Add(-5 * time.Hour)
	run(t, s, r, last.Add(71*time.Hour))
	run(t, s, r, last.Add(73*time.Hour), stop)
	run(t, s, r, last.Add(74*time.Hour))
	run(t, s, r, last.Add(200*time.Hour))

	// It recovers, then fails again for three days: a new episode.
	ok := last.Add(201 * time.Hour)
	synced(t, d, 1, ok)
	run(t, s, r, ok.Add(time.Hour))
	run(t, s, r, ok.Add(73*time.Hour), stop)
	run(t, s, r, ok.Add(80*time.Hour))
}

func TestFailedSendIsRetried(t *testing.T) {
	_, r, s := setup(t)
	r.fail = true
	run(t, s, r, t0)
	run(t, s, r, t0.Add(time.Hour))
	r.fail = false
	run(t, s, r, t0.Add(2*time.Hour), mail14)
	run(t, s, r, t0.Add(3*time.Hour))
}

func TestUsersOnlyGetTheirOwnConnections(t *testing.T) {
	d, r, s := setup(t)
	addConnection(t, d, 2, 2, "KBC", t0.AddDate(0, 0, 2), t0.Add(-time.Hour))
	addAccount(t, d, 2, 2, 2, "Rekening van Partner", "BE71096123456769")
	run(t, s, r, t0, mail14, "partner@example.com: Laatste herinnering: KBC verloopt over 2 dagen (Rekening van Partner)")
	for _, to := range []string{"bert@example.com", "partner@example.com"} {
		m, err := mailTo(t, d, to, t0)
		if err != nil {
			t.Fatal(err)
		}
		other := map[string]string{"bert@example.com": "Partner", "partner@example.com": "Zichtrekening"}[to]
		if strings.Contains(m.Text+m.HTML, other) {
			t.Errorf("%s's mail mentions %q:\n%s", to, other, m.Text)
		}
	}
}

func TestPrefsOffAreRespected(t *testing.T) {
	d, r, s := setup(t)
	exec(t, d, `INSERT INTO notification_prefs (user_id, type, push, email) VALUES (1, 'consent', 1, 0)`)
	run(t, s, r, t0)
	exec(t, d, `UPDATE provider_connections SET sync_status = 'failed', last_sync_at = ? WHERE id = 1`, ts(t0.Add(-80*time.Hour)))
	run(t, s, r, t0, stop) // only the consent mails are off
	exec(t, d, `UPDATE notification_prefs SET email = 1 WHERE user_id = 1`)
	run(t, s, r, t0.Add(time.Hour), mail14)
}

func TestMailShowsTheMaskedIBANOnly(t *testing.T) {
	d, _, _ := setup(t)
	m, err := mailFor(t, d, t0)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{m.Text, m.HTML} {
		if strings.Contains(part, fullIBAN) || strings.Contains(part, "5390") || strings.Contains(part, "0754") {
			t.Errorf("the mail shows the full IBAN:\n%s", part)
		}
		if !strings.Contains(part, "Persoonlijk · BE68 •••• •••• 7034") {
			t.Errorf("the account block lacks the masked IBAN:\n%s", part)
		}
	}
	if !strings.Contains(m.HTML, `href="https://saldo.example.com/bankkoppelingen"`) {
		t.Error("the button does not lead to Bankkoppelingen")
	}
}

func TestAddressesAndMailerMissing(t *testing.T) {
	d, r, _ := setup(t)
	if err := New(d, nil, "", nil).CheckConnections(context.Background(), t0); err != nil {
		t.Fatal(err)
	}
	exec(t, d, `UPDATE users SET email = 'not an address' WHERE id = 1`)
	run(t, New(d, r, "", nil), r, t0)
	// A pending link (credentials saved, no consent) has nothing to remind of.
	exec(t, d, `UPDATE users SET email = 'bert@example.com' WHERE id = 1`)
	exec(t, d, `UPDATE provider_connections SET status = 'pending', valid_until = NULL, last_sync_at = NULL WHERE id = 1`)
	run(t, New(d, r, "", nil), r, t0.AddDate(0, 1, 0))
}

func TestConcurrentRunsSendOnce(t *testing.T) {
	_, r, s := setup(t)
	r.wait = 50 * time.Millisecond
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			if err := s.CheckConnections(context.Background(), t0); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if got := r.take(); len(got) != 1 {
		t.Errorf("concurrent runs sent %q", got)
	}
}

// mailFor returns Bert's mail of a run at now: it clears the log and sends
// with a recorder of its own.
func mailFor(t *testing.T, d *sql.DB, now time.Time) (mail.Message, error) {
	return mailTo(t, d, "bert@example.com", now)
}

func mailTo(t *testing.T, d *sql.DB, to string, now time.Time) (mail.Message, error) {
	t.Helper()
	exec(t, d, `DELETE FROM notification_log`)
	r := &recorder{}
	if err := New(d, r, "https://saldo.example.com", nil).CheckConnections(context.Background(), now); err != nil {
		return mail.Message{}, err
	}
	for _, m := range r.sent {
		if m.To == to {
			return m, nil
		}
	}
	return mail.Message{}, errors.New("no mail to " + to)
}
