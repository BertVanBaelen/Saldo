package auth

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Login is the outcome of the password step. Challenge is always set, also
// for an unknown address or a wrong password, so the answer never tells them
// apart. Code is set only when it must be e-mailed to Email.
type Login struct {
	Challenge string
	Code      string
	Email     string
	SentAt    time.Time
}

// StartLogin checks the password and, when it is right and the user has not
// had CodesPerWindow codes in the last CodeTTL, creates a code for device.
func (s *Store) StartLogin(ctx context.Context, email, password, device, ip string) (Login, error) {
	challenge, challengeHash := NewToken()
	l := Login{Challenge: challenge}

	var id int64
	var hash sql.NullString
	var addr string
	err := s.db.QueryRowContext(ctx, `SELECT id, password_hash, email FROM users WHERE email = ?`, email).
		Scan(&id, &hash, &addr)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return l, err
	}
	encoded := dummyHash
	if hash.Valid {
		encoded = hash.String
	}
	if !VerifyPassword(encoded, password) || !hash.Valid {
		return l, s.audit(ctx, s.db, EventLoginFailed, id, 0, ip, "password")
	}

	now := s.now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return l, err
	}
	defer tx.Rollback()
	var recent int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM login_codes WHERE user_id = ? AND created_at > ?`,
		id, stamp(now.Add(-CodeTTL))).Scan(&recent); err != nil {
		return l, err
	}
	if recent >= CodesPerWindow {
		// Answer as for a wrong password: a 429 here would confirm the password.
		if err := s.audit(ctx, tx, EventRateLimited, id, 0, ip, "codes"); err != nil {
			return l, err
		}
		return l, tx.Commit()
	}
	// Only the newest code works: the browser holds only the newest challenge.
	if _, err := tx.ExecContext(ctx, `UPDATE login_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL`,
		stamp(now), id); err != nil {
		return l, err
	}
	code := newCode()
	if _, err := tx.ExecContext(ctx, `INSERT INTO login_codes
		(user_id, code_hash, challenge_hash, device_label, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, codeHash(challenge, code), challengeHash, device, nullText(ip), stamp(now), stamp(now.Add(CodeTTL))); err != nil {
		return l, err
	}
	if err := s.audit(ctx, tx, EventCodeSent, id, 0, ip, ""); err != nil {
		return l, err
	}
	if err := tx.Commit(); err != nil {
		return l, err
	}
	l.Code, l.Email, l.SentAt = code, addr, now
	return l, nil
}

// Session is a signed-in device. Token is set only right after sign-in.
type Session struct {
	UserID   int64
	DeviceID int64
	Token    string
}

// VerifyCode checks the code of a challenge and, when it is right, trusts
// the device: it returns the new device's session with its cookie token.
func (s *Store) VerifyCode(ctx context.Context, challenge, code, device, ip string) (Session, error) {
	now := s.now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback()
	fail := func(user int64) (Session, error) {
		if err := s.audit(ctx, tx, EventLoginFailed, user, 0, ip, "code"); err != nil {
			return Session{}, err
		}
		if err := tx.Commit(); err != nil {
			return Session{}, err
		}
		return Session{}, ErrInvalidCode
	}

	var id, user int64
	var stored, expires string
	var attempts int
	var used sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT id, user_id, code_hash, attempts, expires_at, used_at FROM login_codes WHERE challenge_hash = ?`,
		HashToken(challenge)).Scan(&id, &user, &stored, &attempts, &expires, &used)
	if errors.Is(err, sql.ErrNoRows) {
		return fail(0)
	}
	if err != nil {
		return Session{}, err
	}
	if used.Valid || !now.Before(parseStamp(expires)) || attempts >= CodeAttempts {
		return fail(user)
	}
	code = strings.Join(strings.Fields(code), "") // "4829 1736" as mailed
	if subtle.ConstantTimeCompare([]byte(stored), []byte(codeHash(challenge, code))) != 1 {
		if _, err := tx.ExecContext(ctx, `UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?`, id); err != nil {
			return Session{}, err
		}
		return fail(user)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE login_codes SET used_at = ? WHERE id = ?`, stamp(now), id); err != nil {
		return Session{}, err
	}
	token, tokenHash := NewToken()
	res, err := tx.ExecContext(ctx,
		`INSERT INTO devices (user_id, name, token_hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)`,
		user, device, tokenHash, stamp(now), stamp(now))
	if err != nil {
		return Session{}, err
	}
	dev, err := res.LastInsertId()
	if err != nil {
		return Session{}, err
	}
	if err := s.audit(ctx, tx, EventLoginOK, user, dev, ip, ""); err != nil {
		return Session{}, err
	}
	if err := s.audit(ctx, tx, EventNewDevice, user, dev, ip, device); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(); err != nil {
		return Session{}, err
	}
	return Session{UserID: user, DeviceID: dev, Token: token}, nil
}
