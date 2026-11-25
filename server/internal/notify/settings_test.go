package notify

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
)

func settingsDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO users (id, email, display_name) VALUES (1, 'bert@example.com', 'Bert'), (2, 'partner@example.com', 'Partner')`); err != nil {
		t.Fatal(err)
	}
	return d
}

func settingsPtr[T any](v T) *T { return &v }

func TestUpdateSettings(t *testing.T) {
	ctx := context.Background()
	d := settingsDB(t)

	// No rows: the defaults of Types, e-mail and quiet hours on, look-ahead 3.
	s, err := LoadSettings(ctx, d, 1)
	if err != nil || !s.Email || !s.QuietHours || s.Lookahead != 3 || len(s.Prefs) != len(Types) {
		t.Fatalf("defaults: %+v, %v", s, err)
	}
	if s.Prefs[TypeBuffer] != (Pref{true, false}) || s.Prefs[TypeWeek] != (Pref{false, false}) || s.Prefs[TypeDevice] != (Pref{true, true}) {
		t.Errorf("default prefs: %+v", s.Prefs)
	}

	// A partial update merges the missing half from the effective value and
	// writes a row only for the types it names.
	err = UpdateSettings(ctx, d, 1, SettingsPatch{QuietHours: settingsPtr(false), Lookahead: settingsPtr(6),
		Types: map[string]PrefPatch{TypeBuffer: {Email: settingsPtr(true)}, TypeRood: {Push: settingsPtr(false)}, TypeCat: {}}})
	if err != nil {
		t.Fatal(err)
	}
	s, _ = LoadSettings(ctx, d, 1)
	if !s.Email || s.QuietHours || s.Lookahead != 6 {
		t.Errorf("channels: %+v", s)
	}
	if s.Prefs[TypeBuffer] != (Pref{true, true}) || s.Prefs[TypeRood] != (Pref{false, true}) || s.Prefs[TypeCat] != (Pref{true, false}) {
		t.Errorf("prefs: %+v", s.Prefs)
	}
	var rows int
	d.QueryRow(`SELECT COUNT(*) FROM notification_prefs`).Scan(&rows)
	if rows != 2 {
		t.Errorf("%d rows, want one per type that named a chip (an empty patch writes none)", rows)
	}
	// The other user is untouched.
	if o, _ := LoadSettings(ctx, d, 2); !o.QuietHours || o.Lookahead != 3 || o.Prefs[TypeRood] != (Pref{true, true}) {
		t.Errorf("another user changed: %+v", o)
	}

	// The device e-mail cannot be turned off, whatever else the patch says; a
	// device push can be.
	if err := UpdateSettings(ctx, d, 1, SettingsPatch{Types: map[string]PrefPatch{TypeDevice: {Push: settingsPtr(false)}}}); err != nil {
		t.Fatal(err)
	}
	var email int
	d.QueryRow(`SELECT email FROM notification_prefs WHERE user_id = 1 AND type = 'device'`).Scan(&email)
	if s, _ = LoadSettings(ctx, d, 1); s.Prefs[TypeDevice] != (Pref{false, true}) || email != 1 {
		t.Errorf("device: %+v, stored email %d", s.Prefs[TypeDevice], email)
	}
}

// An invalid patch changes nothing, whichever part is invalid and whichever
// part comes first.
func TestUpdateSettingsInvalidChangesNothing(t *testing.T) {
	ctx := context.Background()
	d := settingsDB(t)
	for name, c := range map[string]struct {
		patch SettingsPatch
		msg   string
	}{
		"unknown type":  {SettingsPatch{Lookahead: settingsPtr(6), Types: map[string]PrefPatch{"toestel": {Push: settingsPtr(true)}}}, "Dit soort melding bestaat niet."},
		"locked e-mail": {SettingsPatch{Lookahead: settingsPtr(6), Types: map[string]PrefPatch{TypeRood: {Push: settingsPtr(false)}, TypeDevice: {Email: settingsPtr(false)}}}, "Deze e-mail kan je niet uitzetten."},
		"look-ahead":    {SettingsPatch{Email: settingsPtr(false), Lookahead: settingsPtr(2)}, "Kies 1, 3 of 6 maanden."},
	} {
		err := UpdateSettings(ctx, d, 1, c.patch)
		var inv *apperr.InvalidError
		if !errors.As(err, &inv) || inv.Message != c.msg {
			t.Errorf("%s: %v, want invalid %q", name, err, c.msg)
		}
	}
	s, _ := LoadSettings(ctx, d, 1)
	var rows int
	d.QueryRow(`SELECT COUNT(*) FROM notification_prefs`).Scan(&rows)
	if !s.Email || s.Lookahead != 3 || rows != 0 {
		t.Errorf("an invalid patch changed something: %+v, %d rows", s, rows)
	}
	if err := UpdateSettings(ctx, d, 99, SettingsPatch{Lookahead: settingsPtr(1)}); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("a missing user: %v", err)
	}
	if _, err := LoadSettings(ctx, d, 99); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("a missing user: %v", err)
	}
}
