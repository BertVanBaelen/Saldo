package auth

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"slices"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/users"
)

// Kinds of one-time token.
const (
	KindSetup         = "setup"
	KindInvitation    = "invitation"
	KindPasswordReset = "password_reset"
)

// TokenInfo describes a live one-time link to the page that opens it.
type TokenInfo struct {
	Kind  string  `json:"kind"`
	Email *string `json:"email"`
	Name  *string `json:"name"`
}

// Invitation is a pending invitation.
type Invitation struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	ExpiresAt string `json:"expiresAt"`
}

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (s *Store) createToken(ctx context.Context, ex execer, kind string, user, by int64, email, role string, ttl time.Duration) (id int64, token string, expires time.Time, err error) {
	token, hash := NewToken()
	now := s.now()
	expires = now.Add(ttl)
	res, err := ex.ExecContext(ctx, `INSERT INTO user_tokens (kind, token_hash, user_id, email, role, created_by, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, kind, hash, nullID(user), nullText(email), nullText(role), nullID(by), stamp(now), stamp(expires))
	if err != nil {
		return 0, "", time.Time{}, err
	}
	id, err = res.LastInsertId()
	return id, token, expires, err
}

type tokenRow struct {
	id    int64
	kind  string
	user  sql.NullInt64
	email sql.NullString
	role  sql.NullString
}

// live finds an unused, unexpired token; a setup token only lives while no
// user exists. Anything else answers apperr.ErrNotFound.
func (s *Store) live(ctx context.Context, q queryer, token string) (tokenRow, error) {
	var t tokenRow
	err := q.QueryRowContext(ctx, `SELECT id, kind, user_id, email, role FROM user_tokens
		WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`, HashToken(token), stamp(s.now())).
		Scan(&t.id, &t.kind, &t.user, &t.email, &t.role)
	if errors.Is(err, sql.ErrNoRows) {
		return t, apperr.ErrNotFound
	}
	if err != nil {
		return t, err
	}
	if !slices.Contains([]string{KindSetup, KindInvitation, KindPasswordReset}, t.kind) {
		return t, apperr.ErrNotFound
	}
	if t.kind == KindSetup {
		var n int
		if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
			return t, err
		}
		if n > 0 {
			return t, apperr.ErrNotFound
		}
	}
	return t, nil
}

// Lookup describes a live token: the invited address, or the address and
// name of the user whose password is reset.
func (s *Store) Lookup(ctx context.Context, token string) (TokenInfo, error) {
	t, err := s.live(ctx, s.db, token)
	if err != nil {
		return TokenInfo{}, err
	}
	info := TokenInfo{Kind: t.kind}
	switch t.kind {
	case KindInvitation:
		info.Email = &t.email.String
	case KindPasswordReset:
		u, _, err := users.Get(ctx, s.db, t.user.Int64)
		if err != nil {
			return TokenInfo{}, err
		}
		info.Email, info.Name = &u.Email, &u.Name
	}
	return info, nil
}

// Redeem spends a token: setup creates the first admin (name, email,
// password), an invitation creates the invited user (name, password), a reset
// sets the password and signs out every device of that user.
func (s *Store) Redeem(ctx context.Context, token, name, email, password, ip string) error {
	t, err := s.live(ctx, s.db, token)
	if err != nil {
		return err
	}
	switch t.kind {
	case KindSetup:
		if name, err = users.CheckName(name); err != nil {
			return err
		}
		if email, err = CleanEmail(email); err != nil {
			return err
		}
	case KindInvitation:
		if name, err = users.CheckName(name); err != nil {
			return err
		}
		email = t.email.String
	case KindPasswordReset:
		u, _, err := users.Get(ctx, s.db, t.user.Int64)
		if err != nil {
			return err
		}
		email = u.Email
	}
	if err := CheckPassword(password, email); err != nil {
		return err
	}
	hash := HashPassword(password) // before the transaction: it takes a while

	now := stamp(s.now())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := s.live(ctx, tx, token); err != nil {
		return err // spent or expired meanwhile
	}
	if _, err := tx.ExecContext(ctx, `UPDATE user_tokens SET used_at = ? WHERE id = ?`, now, t.id); err != nil {
		return err
	}
	switch t.kind {
	case KindSetup, KindInvitation:
		var taken int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE email = ?`, email).Scan(&taken); err != nil {
			return err
		}
		if taken > 0 {
			return apperr.Invalid("Er bestaat al een account met dit e-mailadres.")
		}
		role, event := "admin", EventSetupDone
		if t.kind == KindInvitation {
			role, event = t.role.String, EventInvitationAccepted
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO users (email, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)`,
			email, hash, name, role, now)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return err
		}
		if err := s.audit(ctx, tx, event, id, 0, ip, ""); err != nil {
			return err
		}
	case KindPasswordReset:
		if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, hash, t.user.Int64); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, now, t.user.Int64); err != nil {
			return err
		}
		if err := s.audit(ctx, tx, EventPasswordChanged, t.user.Int64, 0, ip, "reset"); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Invite creates an invitation for email with role ("user" or "admin"),
// replacing an earlier pending one for the same address.
func (s *Store) Invite(ctx context.Context, by int64, email, role string) (Invitation, string, error) {
	email, err := CleanEmail(email)
	if err != nil {
		return Invitation{}, "", err
	}
	if role != "user" && role != "admin" {
		return Invitation{}, "", apperr.Invalid("Kies de rol gebruiker of beheerder.")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Invitation{}, "", err
	}
	defer tx.Rollback()
	var taken int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE email = ?`, email).Scan(&taken); err != nil {
		return Invitation{}, "", err
	}
	if taken > 0 {
		return Invitation{}, "", apperr.Invalid("Er bestaat al een account met dit e-mailadres.")
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_tokens WHERE kind = 'invitation' AND used_at IS NULL AND email = ? COLLATE NOCASE`, email); err != nil {
		return Invitation{}, "", err
	}
	id, token, expires, err := s.createToken(ctx, tx, KindInvitation, 0, by, email, role, InvitationTTL)
	if err != nil {
		return Invitation{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return Invitation{}, "", err
	}
	return Invitation{ID: id, Email: email, Role: role, ExpiresAt: brussels(stamp(expires))}, token, nil
}

// Invitations lists the pending invitations, oldest first.
func (s *Store) Invitations(ctx context.Context) ([]Invitation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, email, role, expires_at FROM user_tokens
		WHERE kind = 'invitation' AND used_at IS NULL AND expires_at > ? ORDER BY id`, stamp(s.now()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Invitation{}
	for rows.Next() {
		var inv Invitation
		if err := rows.Scan(&inv.ID, &inv.Email, &inv.Role, &inv.ExpiresAt); err != nil {
			return nil, err
		}
		inv.ExpiresAt = brussels(inv.ExpiresAt)
		list = append(list, inv)
	}
	return list, rows.Err()
}

// DeleteInvitation withdraws a pending invitation.
func (s *Store) DeleteInvitation(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM user_tokens WHERE id = ? AND kind = 'invitation' AND used_at IS NULL`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return apperr.ErrNotFound
	}
	return nil
}

// CreateReset makes a password-reset link for user, replacing an earlier
// unused one. The user's devices stay signed in until it is used.
func (s *Store) CreateReset(ctx context.Context, by, user int64) (string, time.Time, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id = ?`, user).Scan(&n); err != nil {
		return "", time.Time{}, err
	}
	if n == 0 {
		return "", time.Time{}, apperr.ErrNotFound
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM user_tokens WHERE kind = 'password_reset' AND used_at IS NULL AND user_id = ?`, user); err != nil {
		return "", time.Time{}, err
	}
	_, token, expires, err := s.createToken(ctx, s.db, KindPasswordReset, user, by, "", "", ResetTTL)
	return token, expires, err
}

// Bootstrap runs at every start outside demo mode. Without any user it logs
// a fresh setup link for the first admin (1 hour). With admin recovery on it
// logs a password-reset link for the first admin, loudly.
func (s *Store) Bootstrap(ctx context.Context, publicURL string, recovery bool, log *slog.Logger) error {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM user_tokens WHERE kind = 'setup'`); err != nil {
			return err
		}
		_, token, _, err := s.createToken(ctx, s.db, KindSetup, 0, 0, "", "", SetupTTL)
		if err != nil {
			return err
		}
		log.Info("no account yet: open this link within an hour to create the first admin", "link", publicURL+"/setup/"+token)
		return nil
	}
	if !recovery {
		return nil
	}
	var admin int64
	err := s.db.QueryRowContext(ctx, `SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).Scan(&admin)
	if errors.Is(err, sql.ErrNoRows) {
		log.Warn("admin_recovery is on, but there is no admin account")
		return nil
	}
	if err != nil {
		return err
	}
	token, _, err := s.CreateReset(ctx, 0, admin)
	if err != nil {
		return err
	}
	if err := s.audit(ctx, s.db, EventResetSent, admin, 0, "", "admin_recovery"); err != nil {
		return err
	}
	log.Warn("ADMIN RECOVERY IS ON: anyone who can read this log can take over the first admin account. "+
		"Use this link within an hour to choose a new password, then turn admin_recovery off and restart Saldo.",
		"link", publicURL+"/nieuw-wachtwoord/"+token)
	return nil
}

// ChangePassword sets a new password after checking the current one, and
// signs out every other device of the user (keep is the current device).
func (s *Store) ChangePassword(ctx context.Context, user, keep int64, current, next, ip string) error {
	var hash sql.NullString
	var email string
	err := s.db.QueryRowContext(ctx, `SELECT password_hash, email FROM users WHERE id = ?`, user).Scan(&hash, &email)
	if errors.Is(err, sql.ErrNoRows) {
		return apperr.ErrNotFound
	}
	if err != nil {
		return err
	}
	if !hash.Valid || !VerifyPassword(hash.String, current) {
		if err := s.audit(ctx, s.db, EventPasswordFailed, user, keep, ip, ""); err != nil {
			return err
		}
		return ErrWrongPassword
	}
	if err := CheckPassword(next, email); err != nil {
		return err
	}
	newHash := HashPassword(next)
	now := stamp(s.now())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, newHash, user); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE devices SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`, now, user, keep); err != nil {
		return err
	}
	if err := s.audit(ctx, tx, EventPasswordChanged, user, keep, ip, ""); err != nil {
		return err
	}
	return tx.Commit()
}
