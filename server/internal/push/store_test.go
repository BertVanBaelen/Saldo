package push

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/secrets"
)

func newDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	return d
}

func newBox(t *testing.T, name string) *secrets.Box {
	t.Helper()
	b, err := secrets.Load(filepath.Join(t.TempDir(), name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func exec(t *testing.T, d *sql.DB, q string, args ...any) int64 {
	t.Helper()
	res, err := d.Exec(q, args...)
	if err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	id, _ := res.LastInsertId()
	return id
}

func count(t *testing.T, d *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := d.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

func TestLoadOrCreateKeys(t *testing.T) {
	ctx := context.Background()
	d := newDB(t)
	box := newBox(t, "secret.key")
	first, err := LoadOrCreateKeys(ctx, d, box)
	if err != nil || first.Renewed || len(first.Private) != 32 || !pairMatches(first.Private, first.Public) {
		t.Fatalf("first start: %+v, %v", first, err)
	}
	var sealed []byte
	if err := d.QueryRow(`SELECT private_key FROM push_keys`).Scan(&sealed); err != nil || bytes.Contains(sealed, first.Private) {
		t.Errorf("the private key is not sealed (%v)", err)
	}
	again, err := LoadOrCreateKeys(ctx, d, box)
	if err != nil || again.Public != first.Public || !bytes.Equal(again.Private, first.Private) || again.Renewed {
		t.Fatalf("second start: %+v, %v; want the stored pair", again, err)
	}
	if _, err := NewWeb(again.Private, again.Public, "https://saldo.example.org"); err != nil {
		t.Errorf("the stored pair does not make a sender: %v", err)
	}

	// Another secret key (secret.key lost or replaced): a new pair, and the
	// subscriptions made with the old public key are gone.
	user := exec(t, d, `INSERT INTO users (email, display_name) VALUES ('a@example.com', 'A')`)
	dev := exec(t, d, `INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'x', 'h')`, user)
	exec(t, d, `INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth) VALUES (?, ?, 'https://fcm.googleapis.com/x', 'k', 's')`, user, dev)
	other := newBox(t, "other.key")
	renewed, err := LoadOrCreateKeys(ctx, d, other)
	if err != nil || !renewed.Renewed || renewed.Public == first.Public || !pairMatches(renewed.Private, renewed.Public) {
		t.Fatalf("with another secret key: %+v, %v", renewed, err)
	}
	if n := count(t, d, `SELECT COUNT(*) FROM push_subscriptions`); n != 0 {
		t.Errorf("%d subscriptions survived a new key", n)
	}
	if n := count(t, d, `SELECT COUNT(*) FROM push_keys`); n != 1 {
		t.Errorf("%d key rows", n)
	}
	if k, err := LoadOrCreateKeys(ctx, d, other); err != nil || k.Renewed || k.Public != renewed.Public {
		t.Errorf("after renewing: %+v, %v", k, err)
	}
}

// testSub is a subscription the guard accepts (a real P-256 point).
func testSub(t *testing.T, endpoint string) Subscription {
	t.Helper()
	_, public, err := GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	return Subscription{Endpoint: endpoint, P256dh: public, Auth: "AAAAAAAAAAAAAAAAAAAAAA"}
}

type fixture struct {
	d                  *sql.DB
	s                  *Store
	bert, partner      int64
	bertA, bertB, pDev int64
	now                time.Time
}

func newFixture(t *testing.T) fixture {
	d := newDB(t)
	f := fixture{d: d, s: NewStore(d), now: time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)}
	f.bert = exec(t, d, `INSERT INTO users (email, display_name) VALUES ('bert@example.com', 'Bert')`)
	f.partner = exec(t, d, `INSERT INTO users (email, display_name) VALUES ('partner@example.com', 'Partner')`)
	f.bertA = exec(t, d, `INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'a', 'ha')`, f.bert)
	f.bertB = exec(t, d, `INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'b', 'hb')`, f.bert)
	f.pDev = exec(t, d, `INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'p', 'hp')`, f.partner)
	return f
}

func TestUpsertBindsToTheDevice(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	a := testSub(t, "https://fcm.googleapis.com/fcm/send/a")
	if err := f.s.Upsert(ctx, f.bert, f.bertA, a, "android", f.now); err != nil {
		t.Fatal(err)
	}
	list, err := f.s.ForUser(ctx, f.bert)
	if err != nil || len(list) != 1 || list[0].DeviceID != f.bertA || list[0].Subscription != a || list[0].Platform != "android" {
		t.Fatalf("after upsert: %+v, %v", list, err)
	}
	var created, used string
	f.d.QueryRow(`SELECT created_at, last_used_at FROM push_subscriptions`).Scan(&created, &used)
	if used != "2026-11-23T10:00:00Z" || created != used {
		t.Errorf("created %q, last used %q", created, used)
	}

	// The same endpoint again: one row, new keys. A new endpoint on the same
	// device replaces the old one (one subscription per device).
	a2 := testSub(t, a.Endpoint)
	if err := f.s.Upsert(ctx, f.bert, f.bertA, a2, "android", f.now); err != nil {
		t.Fatal(err)
	}
	b := testSub(t, "https://web.push.apple.com/b")
	if err := f.s.Upsert(ctx, f.bert, f.bertA, b, "ios", f.now); err != nil {
		t.Fatal(err)
	}
	if list, _ := f.s.ForDevice(ctx, f.bert, f.bertA); len(list) != 1 || list[0].Subscription != b {
		t.Errorf("device a holds %+v, want only b", list)
	}

	// Partner presents Bert's endpoint (the same browser): it is re-bound to
	// her device, Bert's row is gone, nothing of it carries over.
	p := testSub(t, b.Endpoint)
	if err := f.s.Upsert(ctx, f.partner, f.pDev, p, "ios", f.now); err != nil {
		t.Fatal(err)
	}
	if list, _ := f.s.ForUser(ctx, f.bert); len(list) != 0 {
		t.Errorf("Bert still holds %+v", list)
	}
	if list, _ := f.s.ForUser(ctx, f.partner); len(list) != 1 || list[0].DeviceID != f.pDev || list[0].Subscription != p {
		t.Errorf("Partner holds %+v", list)
	}

	// Not her device, a signed-out device, a device that does not exist.
	exec(t, f.d, `UPDATE devices SET revoked_at = '2026-11-23T09:00:00Z' WHERE id = ?`, f.bertB)
	for name, dev := range map[string]int64{"Bert's device": f.bertA, "revoked": f.bertB, "missing": 999} {
		user := f.partner
		if name == "revoked" {
			user = f.bert
		}
		if err := f.s.Upsert(ctx, user, dev, testSub(t, "https://fcm.googleapis.com/fcm/send/"+name[:1]), "other", f.now); !errors.Is(err, ErrNoDevice) {
			t.Errorf("%s: %v, want ErrNoDevice", name, err)
		}
	}
	// A refused device changes nothing (the transaction rolls back).
	if n := count(t, f.d, `SELECT COUNT(*) FROM push_subscriptions`); n != 1 {
		t.Errorf("%d rows after refusals, want 1", n)
	}

	// The guard runs first.
	if err := f.s.Upsert(ctx, f.bert, f.bertA, testSub(t, "https://evil.example.org/x"), "other", f.now); !errors.Is(err, ErrEndpoint) {
		t.Errorf("bad endpoint: %v", err)
	}
	bad := testSub(t, "https://fcm.googleapis.com/fcm/send/k")
	bad.Auth = "kort"
	if err := f.s.Upsert(ctx, f.bert, f.bertA, bad, "other", f.now); !errors.Is(err, ErrKeys) {
		t.Errorf("bad keys: %v", err)
	}
}

func TestUpsertCap(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	var devices []int64
	for i := range MaxPerUser + 1 {
		devices = append(devices, exec(t, f.d, `INSERT INTO devices (user_id, name, token_hash) VALUES (?, 'x', ?)`, f.bert, fmt.Sprintf("cap%d", i)))
	}
	for i, dev := range devices[:MaxPerUser] {
		if err := f.s.Upsert(ctx, f.bert, dev, testSub(t, fmt.Sprintf("https://fcm.googleapis.com/fcm/send/%d", i)), "android", f.now); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.s.Upsert(ctx, f.bert, devices[MaxPerUser], testSub(t, "https://fcm.googleapis.com/fcm/send/eleven"), "android", f.now); !errors.Is(err, ErrTooMany) {
		t.Fatalf("eleventh device: %v, want ErrTooMany", err)
	}
	// Renewing on a device that already has one is not a new device.
	if err := f.s.Upsert(ctx, f.bert, devices[0], testSub(t, "https://fcm.googleapis.com/fcm/send/renewed"), "android", f.now); err != nil {
		t.Errorf("renewing at the cap: %v", err)
	}
	// Another user is not affected.
	if err := f.s.Upsert(ctx, f.partner, f.pDev, testSub(t, "https://fcm.googleapis.com/fcm/send/p"), "android", f.now); err != nil {
		t.Errorf("Partner: %v", err)
	}
	if n := count(t, f.d, `SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?`, f.bert); n != MaxPerUser {
		t.Errorf("Bert holds %d", n)
	}
}

func TestDeleteAndPrune(t *testing.T) {
	ctx := context.Background()
	f := newFixture(t)
	idle := exec(t, f.d, `INSERT INTO devices (user_id, name, token_hash, created_at, last_used_at) VALUES (?, 'idle', 'hi', '2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z')`, f.bert)
	for dev, ep := range map[int64]string{f.bertA: "a", f.bertB: "b", f.pDev: "p", idle: "i"} {
		user := f.bert
		if dev == f.pDev {
			user = f.partner
		}
		if err := f.s.Upsert(ctx, user, dev, testSub(t, "https://fcm.googleapis.com/fcm/send/"+ep), "android", f.now); err != nil {
			t.Fatal(err)
		}
	}
	endpoints := func() string {
		var s sql.NullString
		f.d.QueryRow(`SELECT group_concat(substr(endpoint, -1), '') FROM (SELECT endpoint FROM push_subscriptions ORDER BY endpoint)`).Scan(&s)
		return s.String
	}
	if got := endpoints(); got != "abip" {
		t.Fatalf("stored %q", got)
	}

	// DeleteDevice: only the user's own device.
	if n, err := f.s.DeleteDevice(ctx, f.partner, f.bertA); err != nil || n != 0 {
		t.Errorf("Partner deleting Bert's device: %d, %v", n, err)
	}
	if n, err := f.s.DeleteDevice(ctx, f.bert, f.bertA); err != nil || n != 1 || endpoints() != "bip" {
		t.Errorf("DeleteDevice: %d, %v, left %q", n, err, endpoints())
	}
	// DeleteEndpoint (ErrGone).
	if err := f.s.DeleteEndpoint(ctx, "https://fcm.googleapis.com/fcm/send/b"); err != nil || endpoints() != "ip" {
		t.Errorf("DeleteEndpoint: %v, left %q", err, endpoints())
	}

	// Prune: idle for 90 days (cutoff 25 Aug), revoked, or held by another user.
	if err := f.s.Upsert(ctx, f.bert, f.bertB, testSub(t, "https://fcm.googleapis.com/fcm/send/r"), "android", f.now); err != nil {
		t.Fatal(err)
	}
	exec(t, f.d, `UPDATE devices SET revoked_at = '2026-11-23T09:00:00Z' WHERE id = ?`, f.bertB)
	cutoff := f.now.Add(-90 * 24 * time.Hour)
	if n, err := f.s.Prune(ctx, cutoff); err != nil || n != 2 || endpoints() != "p" {
		t.Errorf("Prune: %d, %v, left %q; want only p", n, err, endpoints())
	}
	if n, err := f.s.Prune(ctx, cutoff); err != nil || n != 0 {
		t.Errorf("second Prune: %d, %v", n, err)
	}
}

func TestPlatform(t *testing.T) {
	for ua, want := range map[string]string{
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15": "ios",
		"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)":                               "ios",
		"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0":    "android",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0":                      "other",
		"": "other",
	} {
		if got := Platform(ua); got != want {
			t.Errorf("Platform(%q) = %q, want %q", ua, got, want)
		}
	}
}
