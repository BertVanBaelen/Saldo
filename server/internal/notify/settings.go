package notify

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"sort"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

// The Meldingen settings of one user (0.9-4): the e-mail channel, quiet hours,
// the planning look-ahead and the push and e-mail chip per type. The push
// switch of a device is not here: that is the device's subscription
// (package push).

// Lookaheads are the months the planning warnings can look ahead.
var Lookaheads = []int{1, 3, 6}

// Settings is what the Meldingen screen shows for a user. Prefs holds the
// effective choice of every type (the stored rows merged over the defaults of
// Types), so a caller never repeats a default.
type Settings struct {
	Email      bool // users.notify_email: the e-mail channel
	QuietHours bool // users.quiet_hours: push waits during [22:00, 07:00)
	Lookahead  int  // users.lookahead_months: 1, 3 or 6
	Prefs      map[string]Pref
}

// LoadSettings reads the user's settings. A user that does not exist is
// apperr.ErrNotFound.
func LoadSettings(ctx context.Context, db *sql.DB, user int64) (Settings, error) {
	var s Settings
	err := db.QueryRowContext(ctx, `SELECT notify_email = 1, quiet_hours = 1, lookahead_months FROM users WHERE id = ?`, user).
		Scan(&s.Email, &s.QuietHours, &s.Lookahead)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{}, apperr.ErrNotFound
	}
	if err != nil {
		return Settings{}, fmt.Errorf("notify: %w", err)
	}
	if s.Prefs, err = Prefs(ctx, db, user); err != nil {
		return Settings{}, err
	}
	return s, nil
}

// PrefPatch changes the chips of one type; a nil half stays as it is.
type PrefPatch struct{ Push, Email *bool }

// SettingsPatch is a partial update: a nil field and an absent type stay as
// they are.
type SettingsPatch struct {
	Email, QuietHours *bool
	Lookahead         *int
	Types             map[string]PrefPatch
}

// UpdateSettings validates the patch and applies it in one transaction. The
// type rows are upserts that merge the missing half from the current effective
// value, so a row is written only for a type the patch names. An invalid patch
// (apperr.Invalid, in Dutch) changes nothing.
func UpdateSettings(ctx context.Context, db *sql.DB, user int64, p SettingsPatch) error {
	if p.Lookahead != nil && !slices.Contains(Lookaheads, *p.Lookahead) {
		return apperr.Invalid("Kies 1, 3 of 6 maanden.")
	}
	keys := make([]string, 0, len(p.Types))
	for key := range p.Types {
		keys = append(keys, key)
	}
	sort.Strings(keys) // the first error is the same on every run
	for _, key := range keys {
		typ, ok := TypeByKey(key)
		if !ok {
			return apperr.Invalid("Dit soort melding bestaat niet.")
		}
		if e := p.Types[key].Email; typ.AlwaysEmail && e != nil && !*e {
			return apperr.Invalid("Deze e-mail kan je niet uitzetten.")
		}
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `UPDATE users SET notify_email = COALESCE(?, notify_email),
		quiet_hours = COALESCE(?, quiet_hours), lookahead_months = COALESCE(?, lookahead_months) WHERE id = ?`,
		optPrefBit(p.Email), optPrefBit(p.QuietHours), optPrefInt(p.Lookahead), user)
	if err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return apperr.ErrNotFound
	}

	if len(keys) > 0 {
		stored, err := storedPrefs(ctx, tx, user)
		if err != nil {
			return err
		}
		current := Effective(stored)
		for _, key := range keys {
			typ, _ := TypeByKey(key)
			pref, patch := current[key], p.Types[key]
			if patch.Push == nil && patch.Email == nil {
				continue // nothing named: the type keeps its default
			}
			if patch.Push != nil {
				pref.Push = *patch.Push
			}
			if patch.Email != nil {
				pref.Email = *patch.Email
			}
			pref.Email = pref.Email || typ.AlwaysEmail
			if _, err := tx.ExecContext(ctx, `INSERT INTO notification_prefs (user_id, type, push, email) VALUES (?, ?, ?, ?)
				ON CONFLICT (user_id, type) DO UPDATE SET push = excluded.push, email = excluded.email`,
				user, key, prefBit(pref.Push), prefBit(pref.Email)); err != nil {
				return fmt.Errorf("notify: %w", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	return nil
}

// prefBit is a bool as the 0/1 of the CHECK constraints.
func prefBit(b bool) int {
	if b {
		return 1
	}
	return 0
}

// optPrefBit and optPrefInt are SQL arguments for COALESCE: nil stays NULL, so the
// column keeps its value.
func optPrefBit(b *bool) any {
	if b == nil {
		return nil
	}
	return prefBit(*b)
}

func optPrefInt(n *int) any {
	if n == nil {
		return nil
	}
	return *n
}

// prefsQuerier is what *sql.DB and *sql.Tx share.
type prefsQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// storedPrefs reads the user's notification_prefs rows as they are stored.
func storedPrefs(ctx context.Context, q prefsQuerier, user int64) (map[string]Pref, error) {
	rows, err := q.QueryContext(ctx, `SELECT type, push, email FROM notification_prefs WHERE user_id = ?`, user)
	if err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	defer rows.Close()
	stored := map[string]Pref{}
	for rows.Next() {
		var key string
		var p Pref
		if err := rows.Scan(&key, &p.Push, &p.Email); err != nil {
			return nil, fmt.Errorf("notify: %w", err)
		}
		stored[key] = p
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	return stored, nil
}
