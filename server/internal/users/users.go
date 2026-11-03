// Package users reads a user's profile and stores their display preferences.
// Sign-in, devices and invitations arrive with phase 0.2-4.
package users

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

// User is the viewer's profile as the API shows it.
type User struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Email   string `json:"email"`
	Role    string `json:"role"`
	Initial string `json:"initial"`
}

// Preferences are the user's last scope and theme.
type Preferences struct {
	Scope string `json:"scope"`
	Theme string `json:"theme"`
}

// Scopes and themes the API accepts.
var (
	Scopes = []string{"alles", "persoonlijk", "gedeeld"}
	Themes = []string{"system", "light", "dark"}
)

// Initial is the upper-case first letter of a name, for avatars.
func Initial(name string) string {
	r, _ := utf8.DecodeRuneInString(strings.TrimSpace(name))
	if r == utf8.RuneError {
		return "?"
	}
	return string(unicode.ToUpper(r))
}

// Get returns the user and their preferences.
func Get(ctx context.Context, db *sql.DB, id int64) (User, Preferences, error) {
	var u User
	var p Preferences
	err := db.QueryRowContext(ctx,
		`SELECT id, display_name, email, role, last_scope, theme FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Name, &u.Email, &u.Role, &p.Scope, &p.Theme)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, Preferences{}, apperr.ErrNotFound
	}
	if err != nil {
		return User{}, Preferences{}, err
	}
	u.Initial = Initial(u.Name)
	return u, p, nil
}

// SetPreferences changes the scope and/or theme (nil leaves a value as is)
// and returns the stored preferences.
func SetPreferences(ctx context.Context, db *sql.DB, id int64, scope, theme *string) (Preferences, error) {
	if scope == nil && theme == nil {
		return Preferences{}, apperr.Invalid("Geef een weergave of een thema op.")
	}
	if scope != nil && !slices.Contains(Scopes, *scope) {
		return Preferences{}, apperr.Invalid("Kies alles, persoonlijk of gedeeld.")
	}
	if theme != nil && !slices.Contains(Themes, *theme) {
		return Preferences{}, apperr.Invalid("Kies systeem, licht of donker.")
	}
	res, err := db.ExecContext(ctx,
		`UPDATE users SET last_scope = COALESCE(?, last_scope), theme = COALESCE(?, theme) WHERE id = ?`,
		scope, theme, id)
	if err != nil {
		return Preferences{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Preferences{}, apperr.ErrNotFound
	}
	_, p, err := Get(ctx, db, id)
	return p, err
}
