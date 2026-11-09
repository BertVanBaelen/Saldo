// Package auth is Saldo's sign-in (analysis 7): argon2id passwords, the
// e-mailed 8-digit code, trusted devices, one-time links (setup, invitation,
// password reset) and the audit log. Every token is random and stored only
// as a SHA-256 hash.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/mail"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

// Lifetimes and limits of analysis 7.
const (
	CodeTTL        = 10 * time.Minute
	CodeAttempts   = 5
	CodesPerWindow = 3 // codes per user per CodeTTL
	DeviceIdle     = 90 * 24 * time.Hour
	SetupTTL       = time.Hour
	InvitationTTL  = 7 * 24 * time.Hour
	ResetTTL       = time.Hour
)

var (
	// ErrInvalidCode: the code is wrong, expired, used or for no challenge.
	ErrInvalidCode = errors.New("auth: invalid code")
	// ErrWrongPassword: the current password does not match.
	ErrWrongPassword = errors.New("auth: wrong password")
)

// Audit events (docs/api.md, "Audit log").
const (
	EventCodeSent           = "code_sent"
	EventLoginOK            = "login_ok"
	EventLoginFailed        = "login_failed"
	EventNewDevice          = "new_device"
	EventDeviceSignedOut    = "device_signed_out"
	EventPasswordChanged    = "password_changed"
	EventPasswordFailed     = "password_failed"
	EventInvitationSent     = "invitation_sent"
	EventInvitationAccepted = "invitation_accepted"
	EventResetSent          = "reset_sent"
	EventSetupDone          = "setup_done"
	EventRateLimited        = "rate_limited"
	EventBankLinkRemoved    = "bank_link_removed"
	EventAccountDeleted     = "account_deleted"
	EventImportDone         = "import_done"
)

// Store runs sign-in on the database.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// New returns a Store; now is time.Now when nil.
func New(db *sql.DB, now func() time.Time) *Store {
	if now == nil {
		now = time.Now
	}
	return &Store{db: db, now: now}
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// Audit writes one line to the audit log; user and device 0 mean none.
func (s *Store) Audit(ctx context.Context, event string, user, device int64, ip, detail string) error {
	return s.audit(ctx, s.db, event, user, device, ip, detail)
}

func (s *Store) audit(ctx context.Context, ex execer, event string, user, device int64, ip, detail string) error {
	_, err := ex.ExecContext(ctx,
		`INSERT INTO audit_log (event, user_id, device_id, ip, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		event, nullID(user), nullID(device), nullText(ip), nullText(detail), stamp(s.now()))
	return err
}

func nullID(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}

func nullText(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// stamp is the stored timestamp format (UTC, seconds), which sorts as text.
func stamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05Z") }

func parseStamp(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

// NewToken returns a random 32-byte token (base64url) and its stored hash.
func NewToken() (token, hash string) {
	b := make([]byte, 32)
	rand.Read(b)
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashToken(token)
}

// HashToken is the stored form of a token: hex SHA-256.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newCode() string {
	n, err := rand.Int(rand.Reader, big.NewInt(100_000_000))
	if err != nil {
		panic(err)
	}
	return fmt.Sprintf("%08d", n)
}

// codeHash binds a code to its challenge: the database alone (without the
// challenge, which only the browser holds) cannot be used to find the code.
func codeHash(challenge, code string) string { return HashToken(challenge + ":" + code) }

// CleanEmail trims an address and checks that it is a plain address.
func CleanEmail(s string) (string, error) {
	s = strings.TrimSpace(s)
	a, err := mail.ParseAddress(s)
	if err != nil || a.Name != "" || a.Address != s || len(s) > 254 || !strings.Contains(s[strings.LastIndexByte(s, '@')+1:], ".") {
		return "", apperr.Invalid("Vul een geldig e-mailadres in.")
	}
	return s, nil
}

// MaskEmail shows an address as "b•••@example.com".
func MaskEmail(s string) string {
	at := strings.LastIndexByte(s, '@')
	if at < 1 {
		return "•••"
	}
	first := []rune(s[:at])[0]
	return string(first) + "•••" + s[at:]
}
