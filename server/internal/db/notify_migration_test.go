package db

import (
	"context"
	"io/fs"
	"path/filepath"
	"slices"
	"testing"
	"testing/fstest"
)

// 0019 (0.9-3) runs on a database shaped like the live one: 0001..0018,
// 0020 and 0021 applied. The 0.3-2 rows of notification_log get the key of
// their connection episode and status sent, a duplicate of one key (the old
// read-then-write race) keeps the oldest row, and from then on one key per
// user and channel is unique. users gets the two channel columns and
// notify_runs exists.
func TestMigration0019RebuildsTheNotificationLog(t *testing.T) {
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
		if e.Name() == "0019_notifications.sql" {
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
	exec(`INSERT INTO users (id, email, display_name, lookahead_months) VALUES (1, 'a@example.com', 'A', 6), (2, 'b@example.com', 'B', 3)`)
	exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name) VALUES (1, 1, 'enablebanking', 'Argenta'), (2, 2, 'enablebanking', 'KBC')`)
	exec(`INSERT INTO notification_log (id, user_id, type, connection_id, state, channel, sent_at) VALUES
		(10, 1, 'consent', 1, '14d:2026-11-30T11:00:00Z', 'email', '2026-11-16T08:00:00Z'),
		(11, 1, 'consent', 1, '3d:2026-11-30T11:00:00Z', 'email', '2026-11-27T08:00:00Z'),
		(12, 1, 'consent', 1, '3d:2026-11-30T11:00:00Z', 'email', '2026-11-27T08:00:01Z'),
		(13, 2, 'stop', 2, 'failing:2026-11-01T03:00:00Z', 'email', '2026-11-04T08:00:00Z'),
		(14, 2, 'rood', NULL, NULL, 'push', '2026-11-04T08:00:00Z')`)

	applied, err := Migrate(ctx, db, full, backups, nil)
	if err != nil || !slices.Equal(applied, []int{19}) {
		t.Fatalf("applied %v, %v; want [19]", applied, err)
	}
	var got string
	if err := db.QueryRow(`SELECT group_concat(id || ' ' || user_id || ' ' || type || ' ' || channel || ' ' || dedupe || ' ' || status || ' ' ||
		claimed_at || ' ' || sent_at || ' ' || COALESCE(state, '-'), char(10)) FROM (SELECT * FROM notification_log ORDER BY id)`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	want := "10 1 consent email connection:1|consent|14d:2026-11-30T11:00:00Z sent 2026-11-16T08:00:00Z 2026-11-16T08:00:00Z 14d:2026-11-30T11:00:00Z\n" +
		"11 1 consent email connection:1|consent|3d:2026-11-30T11:00:00Z sent 2026-11-27T08:00:00Z 2026-11-27T08:00:00Z 3d:2026-11-30T11:00:00Z\n" +
		"13 2 stop email connection:2|stop|failing:2026-11-01T03:00:00Z sent 2026-11-04T08:00:00Z 2026-11-04T08:00:00Z failing:2026-11-01T03:00:00Z\n" +
		"14 2 rood push legacy:14 sent 2026-11-04T08:00:00Z 2026-11-04T08:00:00Z -"
	if got != want {
		t.Errorf("rows after 0019:\n%s\nwant\n%s", got, want)
	}

	var email, quiet, look int
	if err := db.QueryRow(`SELECT notify_email, quiet_hours, lookahead_months FROM users WHERE id = 1`).Scan(&email, &quiet, &look); err != nil {
		t.Fatal(err)
	}
	if email != 1 || quiet != 1 || look != 6 {
		t.Errorf("user 1: notify_email %d quiet_hours %d lookahead %d, want 1 1 6", email, quiet, look)
	}
	exec(`INSERT INTO notify_runs (name, day) VALUES ('planning', '2026-11-24'), ('baseline:planning', '2026-11-24')`)

	for name, q := range map[string]string{
		"same key twice": `INSERT INTO notification_log (user_id, type, channel, dedupe, status) VALUES (1, 'consent', 'email', 'connection:1|consent|14d:2026-11-30T11:00:00Z', 'sent')`,
		"bad status":     `INSERT INTO notification_log (user_id, type, channel, dedupe, status) VALUES (1, 'rood', 'push', 'k', 'done')`,
		"bad channel":    `INSERT INTO notification_log (user_id, type, channel, dedupe, status) VALUES (1, 'rood', 'sms', 'k', 'sent')`,
		"no key":         `INSERT INTO notification_log (user_id, type, channel, status) VALUES (1, 'rood', 'push', 'sent')`,
		"bad switch":     `UPDATE users SET quiet_hours = 2 WHERE id = 1`,
		"second run row": `INSERT INTO notify_runs (name, day) VALUES ('planning', '2026-11-25')`,
	} {
		if _, err := db.Exec(q); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	// The same key on the other channel or for another user is a row of its own.
	exec(`INSERT INTO notification_log (user_id, type, channel, dedupe, status) VALUES (1, 'consent', 'push', 'connection:1|consent|14d:2026-11-30T11:00:00Z', 'suppressed')`)
	exec(`INSERT INTO notification_log (user_id, type, channel, dedupe, status) VALUES (2, 'consent', 'email', 'connection:1|consent|14d:2026-11-30T11:00:00Z', 'sent')`)

	// The connection cascade still holds.
	exec(`DELETE FROM provider_connections WHERE id = 2`)
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM notification_log WHERE connection_id = 2`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rows of a deleted connection: %d, %v", n, err)
	}
	var idx string
	if err := db.QueryRow(`SELECT group_concat(name, ' ') FROM (SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notification_log' ORDER BY name)`).Scan(&idx); err != nil {
		t.Fatal(err)
	}
	if idx != "notification_log_account notification_log_connection notification_log_dedupe" {
		t.Errorf("indexes: %s", idx)
	}
	if again, err := Migrate(ctx, db, full, backups, nil); err != nil || len(again) != 0 {
		t.Errorf("second run applied %v, %v", again, err)
	}
}
