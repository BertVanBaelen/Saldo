package auth

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// renewAfter is how stale "last used" may get before a request bumps it (and
// the cookie is sent again), so not every request writes.
const renewAfter = 5 * time.Minute

// Device is a trusted device as Instellingen → Toestellen lists it.
type Device struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt"`
	Current    bool   `json:"current"`
}

// Resolve returns the session of a device cookie token. A device that is
// unknown, signed out or unused for DeviceIdle answers apperr.ErrNotFound.
// renewed reports that "last used" moved, so the cookie should be renewed.
func (s *Store) Resolve(ctx context.Context, token string) (sess Session, renewed bool, err error) {
	now := s.now()
	var last string
	err = s.db.QueryRowContext(ctx,
		`SELECT id, user_id, COALESCE(last_used_at, created_at) FROM devices WHERE token_hash = ? AND revoked_at IS NULL`,
		HashToken(token)).Scan(&sess.DeviceID, &sess.UserID, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, false, apperr.ErrNotFound
	}
	if err != nil {
		return Session{}, false, err
	}
	lastUsed := parseStamp(last)
	if !now.Before(lastUsed.Add(DeviceIdle)) {
		return Session{}, false, apperr.ErrNotFound
	}
	if now.Sub(lastUsed) < renewAfter {
		return sess, false, nil
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE devices SET last_used_at = ? WHERE id = ?`, stamp(now), sess.DeviceID); err != nil {
		return Session{}, false, err
	}
	return sess, true, nil
}

// active selects a user's devices that still sign in.
const active = `user_id = ? AND revoked_at IS NULL AND COALESCE(last_used_at, created_at) > ?`

// Devices lists the user's active devices, most recently used first.
func (s *Store) Devices(ctx context.Context, user, current int64) ([]Device, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, created_at, COALESCE(last_used_at, created_at) FROM devices
		WHERE `+active+` ORDER BY COALESCE(last_used_at, created_at) DESC, id DESC`, user, s.idleCutoff())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Device{}
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.Name, &d.CreatedAt, &d.LastUsedAt); err != nil {
			return nil, err
		}
		d.CreatedAt, d.LastUsedAt = brussels(d.CreatedAt), brussels(d.LastUsedAt)
		d.Current = d.ID == current
		list = append(list, d)
	}
	return list, rows.Err()
}

// SignOut revokes one of the user's active devices; someone else's device
// answers apperr.ErrNotFound.
func (s *Store) SignOut(ctx context.Context, user, device int64, ip string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE devices SET revoked_at = ? WHERE id = ? AND `+active,
		stamp(s.now()), device, user, s.idleCutoff())
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return apperr.ErrNotFound
	}
	return s.audit(ctx, s.db, EventDeviceSignedOut, user, device, ip, "")
}

// SignOutOthers revokes every device of the user except keep.
func (s *Store) SignOutOthers(ctx context.Context, user, keep int64, ip string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE devices SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
		stamp(s.now()), user, keep)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil
	}
	return s.audit(ctx, s.db, EventDeviceSignedOut, user, keep, ip, "others")
}

func (s *Store) idleCutoff() string { return stamp(s.now().Add(-DeviceIdle)) }

func brussels(stored string) string {
	return parseStamp(stored).In(clock.Brussels).Format(time.RFC3339)
}

// DeviceName names a device from its User-Agent, as the design does:
// "Safari op iPhone", "Chrome op Windows".
func DeviceName(ua string) string {
	has := func(s ...string) bool {
		for _, x := range s {
			if strings.Contains(ua, x) {
				return true
			}
		}
		return false
	}
	browser := ""
	switch {
	case has("Edg/", "EdgA/", "EdgiOS/"):
		browser = "Edge"
	case has("OPR/", "Opera"):
		browser = "Opera"
	case has("SamsungBrowser/"):
		browser = "Samsung Internet"
	case has("Firefox/", "FxiOS/"):
		browser = "Firefox"
	case has("Chrome/", "CriOS/"):
		browser = "Chrome"
	case has("Safari/"):
		browser = "Safari"
	}
	system := ""
	switch {
	case has("iPhone"):
		system = "iPhone"
	case has("iPad"):
		system = "iPad"
	case has("Android"):
		system = "Android"
	case has("Windows"):
		system = "Windows"
	case has("CrOS"):
		system = "ChromeOS"
	case has("Macintosh", "Mac OS X"):
		system = "Mac"
	case has("Linux"):
		system = "Linux"
	}
	switch {
	case browser != "" && system != "":
		return browser + " op " + system
	case browser != "":
		return browser
	case system != "":
		return system
	}
	return "Onbekend toestel"
}
