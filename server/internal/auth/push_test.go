package auth

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/db"
)

// pushWorld is two users with devices that each hold a push subscription.
type pushWorld struct {
	t             *testing.T
	d             *sql.DB
	s             *Store
	bert, partner int64
	dev           map[string]int64 // name -> device id
}

func newPushWorld(t *testing.T) *pushWorld {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)
	w := &pushWorld{t: t, d: d, s: New(d, func() time.Time { return now }), dev: map[string]int64{}}
	w.bert = w.insert(`INSERT INTO users (email, display_name, password_hash) VALUES ('bert@example.com', 'Bert', ?)`, HashPassword("lange zin voor bert"))
	w.partner = w.insert(`INSERT INTO users (email, display_name) VALUES ('partner@example.com', 'Partner')`)
	for _, name := range []string{"bert1", "bert2", "bert3", "partner"} {
		user := w.bert
		if name == "partner" {
			user = w.partner
		}
		w.dev[name] = w.insert(`INSERT INTO devices (user_id, name, token_hash, created_at, last_used_at) VALUES (?, ?, ?, '2026-11-23T09:00:00Z', '2026-11-23T09:00:00Z')`,
			user, name, "hash-"+name)
		w.insert(`INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth) VALUES (?, ?, ?, 'k', 's')`,
			user, w.dev[name], "https://fcm.googleapis.com/fcm/send/"+name)
	}
	return w
}

func (w *pushWorld) insert(q string, args ...any) int64 {
	w.t.Helper()
	res, err := w.d.Exec(q, args...)
	if err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
	id, _ := res.LastInsertId()
	return id
}

// subscribed lists the devices that still hold a subscription, by name.
func (w *pushWorld) subscribed() string {
	w.t.Helper()
	out := ""
	for _, name := range []string{"bert1", "bert2", "bert3", "partner"} {
		var n int
		if err := w.d.QueryRow(`SELECT COUNT(*) FROM push_subscriptions WHERE device_id = ?`, w.dev[name]).Scan(&n); err != nil {
			w.t.Fatal(err)
		}
		if n > 0 {
			out += fmt.Sprintf("%s ", name)
		}
	}
	return out
}

func TestSignOutDeletesPushSubscriptions(t *testing.T) {
	ctx := context.Background()
	w := newPushWorld(t)
	if err := w.s.SignOut(ctx, w.partner, w.dev["bert1"], ""); err == nil {
		t.Fatal("Partner signed out Bert's device")
	}
	if got := w.subscribed(); got != "bert1 bert2 bert3 partner " {
		t.Fatalf("a refused sign-out deleted subscriptions: %q", got)
	}
	if err := w.s.SignOut(ctx, w.bert, w.dev["bert1"], ""); err != nil {
		t.Fatal(err)
	}
	if got := w.subscribed(); got != "bert2 bert3 partner " {
		t.Errorf("after signing out bert1: %q", got)
	}
	if err := w.s.SignOutOthers(ctx, w.bert, w.dev["bert2"], ""); err != nil {
		t.Fatal(err)
	}
	if got := w.subscribed(); got != "bert2 partner " {
		t.Errorf("after signing out the others of bert2: %q", got)
	}
	// Nothing left to revoke still commits cleanly.
	if err := w.s.SignOutOthers(ctx, w.bert, w.dev["bert2"], ""); err != nil {
		t.Errorf("second sign-out-others: %v", err)
	}
}

func TestPasswordChangeDeletesOtherPushSubscriptions(t *testing.T) {
	ctx := context.Background()
	w := newPushWorld(t)
	if err := w.s.ChangePassword(ctx, w.bert, w.dev["bert3"], "niet het wachtwoord", "een heel nieuwe zin", ""); err != ErrWrongPassword {
		t.Fatalf("wrong current: %v", err)
	}
	if got := w.subscribed(); got != "bert1 bert2 bert3 partner " {
		t.Fatalf("a refused change deleted subscriptions: %q", got)
	}
	if err := w.s.ChangePassword(ctx, w.bert, w.dev["bert3"], "lange zin voor bert", "een heel nieuwe zin", ""); err != nil {
		t.Fatal(err)
	}
	if got := w.subscribed(); got != "bert3 partner " {
		t.Errorf("after the change on bert3: %q", got)
	}
}

func TestPasswordResetDeletesEveryPushSubscription(t *testing.T) {
	ctx := context.Background()
	w := newPushWorld(t)
	token, _, err := w.s.CreateReset(ctx, w.bert, w.bert)
	if err != nil {
		t.Fatal(err)
	}
	if got := w.subscribed(); got != "bert1 bert2 bert3 partner " {
		t.Fatalf("creating the link deleted subscriptions: %q", got)
	}
	if err := w.s.Redeem(ctx, token, "", "", "een heel nieuwe zin", ""); err != nil {
		t.Fatal(err)
	}
	if got := w.subscribed(); got != "partner " {
		t.Errorf("after the reset: %q", got)
	}
}
