package push

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// MaxPerUser is how many subscriptions one user may hold (one per device).
const MaxPerUser = 10

// ErrTooMany means the user already holds MaxPerUser subscriptions on other
// devices; the API answers 400.
var ErrTooMany = errors.New("push: too many subscriptions")

// ErrNoDevice means the device is not an active device of the user.
var ErrNoDevice = errors.New("push: no such device")

// Box seals and opens the VAPID private key at rest (secrets.Box).
type Box interface {
	Seal(plain []byte) []byte
	Open(sealed []byte) ([]byte, error)
}

// Keys is the VAPID key pair: the private key as the raw 32-octet P-256
// scalar, the public key as a base64url uncompressed point (what the browser
// gets as applicationServerKey). Renewed reports that a stored pair could not
// be opened and was replaced, so every subscription was deleted with it.
type Keys struct {
	Private []byte
	Public  string
	Renewed bool
}

// LoadOrCreateKeys returns the VAPID key pair of push_keys, generating and
// storing one on first start (demo mode too). A stored pair that cannot be
// opened (the secret key file was replaced or lost) or does not match itself
// is replaced by a new pair, and every subscription is deleted in the same
// transaction: those were made with the old public key and would only fail.
// The app re-subscribes on its next start (0.9-2 step 5, self-healing).
func LoadOrCreateKeys(ctx context.Context, db *sql.DB, box Box) (Keys, error) {
	for range 2 {
		var public string
		var sealed []byte
		err := db.QueryRowContext(ctx, `SELECT public_key, private_key FROM push_keys WHERE id = 1`).Scan(&public, &sealed)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			if err := storeNewKeys(ctx, db, box); err != nil {
				return Keys{}, err
			}
			continue // read back what is stored: another start may have won the insert
		case err != nil:
			return Keys{}, fmt.Errorf("push keys: %w", err)
		}
		if private, err := box.Open(sealed); err == nil && pairMatches(private, public) {
			return Keys{Private: private, Public: public}, nil
		}
		return renewKeys(ctx, db, box)
	}
	return Keys{}, errors.New("push keys: not stored")
}

// storeNewKeys inserts a fresh pair unless one is there already.
func storeNewKeys(ctx context.Context, db *sql.DB, box Box) error {
	private, public, err := GenerateVAPIDKeys()
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `INSERT INTO push_keys (id, public_key, private_key, created_at) VALUES (1, ?, ?, ?)
		ON CONFLICT (id) DO NOTHING`, public, box.Seal(private), stamp(time.Now()))
	return err
}

// renewKeys replaces an unreadable pair and drops every subscription.
func renewKeys(ctx context.Context, db *sql.DB, box Box) (Keys, error) {
	private, public, err := GenerateVAPIDKeys()
	if err != nil {
		return Keys{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Keys{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM push_subscriptions`); err != nil {
		return Keys{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE push_keys SET public_key = ?, private_key = ?, created_at = ? WHERE id = 1`,
		public, box.Seal(private), stamp(time.Now())); err != nil {
		return Keys{}, err
	}
	if err := tx.Commit(); err != nil {
		return Keys{}, err
	}
	return Keys{Private: private, Public: public, Renewed: true}, nil
}

// pairMatches reports whether public is the public key of private.
func pairMatches(private []byte, public string) bool {
	key, err := ecdh.P256().NewPrivateKey(private)
	if err != nil {
		return false
	}
	given, err := decodeB64(public)
	return err == nil && bytes.Equal(given, key.PublicKey().Bytes())
}

// Store keeps the push subscriptions. Every subscription belongs to one
// device of one user (push_subscriptions.device_id, migration 0018) and goes
// when that device is signed out (package auth deletes it in the revoke's
// transaction), deleted (foreign key cascade) or idle (Prune).
type Store struct{ db *sql.DB }

// NewStore returns the subscription store on db.
func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// Stored is a subscription as the store holds it.
type Stored struct {
	ID       int64
	UserID   int64
	DeviceID int64
	Platform string
	Subscription
}

// Upsert stores the browser's subscription for the user's device and sets
// last_used_at. It checks the endpoint and keys first (ErrEndpoint, ErrKeys).
//
// Binding: one device holds at most one subscription, so the device's older
// rows are replaced. An endpoint is unique; when another row already holds it
// (the same browser, re-subscribed under another sign-in, or another user of
// the same browser profile) that row is deleted and the endpoint is bound to
// this user and device: delete-then-insert, never an update of someone else's
// row, so nothing of the old row (its user, device or keys) carries over.
// The endpoint is a capability URL only the browser knows; whoever presents
// it holds that browser.
//
// The user may hold at most MaxPerUser subscriptions (ErrTooMany, and then
// nothing changes). A device that is not an active device of the user
// answers ErrNoDevice.
func (s *Store) Upsert(ctx context.Context, user, device int64, sub Subscription, platform string, now time.Time) error {
	if err := ValidateEndpoint(sub.Endpoint); err != nil {
		return err
	}
	if err := ValidateKeys(sub.P256dh, sub.Auth); err != nil {
		return err
	}
	switch platform {
	case "android", "ios", "other":
	default:
		platform = "other"
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = ? OR device_id = ?`, sub.Endpoint, device); err != nil {
		return err
	}
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?`, user).Scan(&n); err != nil {
		return err
	}
	if n >= MaxPerUser {
		return ErrTooMany
	}
	at := stamp(now)
	res, err := tx.ExecContext(ctx, `INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth, platform, created_at, last_used_at)
		SELECT user_id, id, ?, ?, ?, ?, ?, ? FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
		sub.Endpoint, sub.P256dh, sub.Auth, platform, at, at, device, user)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoDevice
	}
	return tx.Commit()
}

const columns = `id, user_id, device_id, platform, endpoint, p256dh, auth`

func (s *Store) list(ctx context.Context, where string, args ...any) ([]Stored, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+columns+` FROM push_subscriptions WHERE `+where+` ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Stored
	for rows.Next() {
		var x Stored
		if err := rows.Scan(&x.ID, &x.UserID, &x.DeviceID, &x.Platform, &x.Endpoint, &x.P256dh, &x.Auth); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// ForUser lists the user's subscriptions, oldest first.
func (s *Store) ForUser(ctx context.Context, user int64) ([]Stored, error) {
	return s.list(ctx, `user_id = ?`, user)
}

// ForDevice lists the subscriptions of one device of the user (at most one).
func (s *Store) ForDevice(ctx context.Context, user, device int64) ([]Stored, error) {
	return s.list(ctx, `user_id = ? AND device_id = ?`, user, device)
}

// DeleteEndpoint removes the subscription with this endpoint, as the caller
// does when the push service answered ErrGone.
func (s *Store) DeleteEndpoint(ctx context.Context, endpoint string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint)
	return err
}

// DeleteDevice removes the subscriptions of one device of the user (the
// user turned push off on it) and returns how many there were.
func (s *Store) DeleteDevice(ctx context.Context, user, device int64) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE user_id = ? AND device_id = ?`, user, device)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// Prune deletes the subscriptions whose device is signed out, gone, held by
// another user, or not used since idleCutoff (now minus auth.DeviceIdle:
// such a device no longer signs in, though nothing revoked it). The hourly
// push-prune job runs it; it returns how many it deleted.
func (s *Store) Prune(ctx context.Context, idleCutoff time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE NOT EXISTS (
		SELECT 1 FROM devices d WHERE d.id = push_subscriptions.device_id AND d.user_id = push_subscriptions.user_id
		AND d.revoked_at IS NULL AND COALESCE(d.last_used_at, d.created_at) > ?)`, stamp(idleCutoff))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// Platform names the platform of a User-Agent for push_subscriptions:
// "ios" (iPhone, iPad, iPod), "android", or "other". An iPad that asks for
// the desktop site says "Macintosh" and counts as other.
func Platform(userAgent string) string {
	switch {
	case strings.Contains(userAgent, "iPhone"), strings.Contains(userAgent, "iPad"), strings.Contains(userAgent, "iPod"):
		return "ios"
	case strings.Contains(userAgent, "Android"):
		return "android"
	}
	return "other"
}

// stamp is the database's time format (UTC, seconds), as package auth writes it.
func stamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05Z") }
