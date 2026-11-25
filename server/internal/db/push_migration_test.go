package db

import (
	"context"
	"io/fs"
	"path/filepath"
	"slices"
	"testing"
	"testing/fstest"
)

// 0018 (0.9-2) runs on a 0.8.1 database, which already holds 0020 and 0021:
// a subscription with a device is kept, one without is dropped, and from then
// on a subscription needs a device and goes with it. push_keys holds one row.
func TestMigration0018RebuildsPushSubscriptions(t *testing.T) {
	ctx := context.Background()
	db, err := Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	full := Migrations()
	old := fstest.MapFS{}
	entries, err := fs.ReadDir(full, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() == "0018_push.sql" {
			continue
		}
		b, err := fs.ReadFile(full, e.Name())
		if err != nil {
			t.Fatal(err)
		}
		old[e.Name()] = &fstest.MapFile{Data: b}
	}
	backups := filepath.Join(t.TempDir(), "backups")
	if _, err := Migrate(ctx, db, old, backups, nil); err != nil {
		t.Fatal(err)
	}
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.com', 'A')`)
	exec(`INSERT INTO devices (id, user_id, name, token_hash) VALUES (7, 1, 'Safari op iPhone', 'h7'), (8, 1, 'Chrome op Android', 'h8')`)
	exec(`INSERT INTO push_subscriptions (id, user_id, device_id, endpoint, p256dh, auth, platform, created_at, last_used_at)
		VALUES (3, 1, 7, 'https://web.push.apple.com/a', 'k', 's', 'ios', '2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z'),
		       (4, 1, NULL, 'https://fcm.googleapis.com/b', 'k', 's', 'android', '2026-11-01T10:00:00Z', NULL)`)

	applied, err := Migrate(ctx, db, full, backups, nil)
	if err != nil || !slices.Equal(applied, []int{18}) {
		t.Fatalf("applied %v, %v; want [18]", applied, err)
	}
	var got string
	if err := db.QueryRow(`SELECT group_concat(id || ':' || device_id || ':' || endpoint || ':' || platform || ':' || created_at || ':' || last_used_at, ' ')
		FROM push_subscriptions`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if want := "3:7:https://web.push.apple.com/a:ios:2026-11-01T10:00:00Z:2026-11-02T10:00:00Z"; got != want {
		t.Errorf("rows after 0018: %q, want %q", got, want)
	}

	for name, q := range map[string]string{
		"no device":      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://fcm.googleapis.com/c', 'k', 's')`,
		"unknown device": `INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth) VALUES (1, 99, 'https://fcm.googleapis.com/c', 'k', 's')`,
		"same endpoint":  `INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth) VALUES (1, 8, 'https://web.push.apple.com/a', 'k', 's')`,
		"bad platform":   `INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth, platform) VALUES (1, 8, 'https://fcm.googleapis.com/c', 'k', 's', 'pc')`,
		"second key":     `INSERT INTO push_keys (id, public_key, private_key) VALUES (2, 'p', x'00')`,
	} {
		if _, err := db.Exec(q); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	exec(`INSERT INTO push_keys (id, public_key, private_key) VALUES (1, 'p', x'00')`)

	// Deleting the device (or its user) takes the subscription with it.
	exec(`INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth) VALUES (1, 8, 'https://fcm.googleapis.com/c', 'k', 's')`)
	exec(`DELETE FROM devices WHERE id = 7`)
	count := func() int {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM push_subscriptions`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(); n != 1 {
		t.Errorf("after deleting device 7: %d subscriptions, want 1", n)
	}
	exec(`DELETE FROM users WHERE id = 1`)
	if n := count(); n != 0 {
		t.Errorf("after deleting the user: %d subscriptions, want 0", n)
	}
	if again, err := Migrate(ctx, db, full, backups, nil); err != nil || len(again) != 0 {
		t.Errorf("second run applied %v, %v", again, err)
	}
}
