// Package users reads and changes a user's profile and display preferences.
// Sign-in, devices and invitations are in package auth.
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

// CheckName trims a display name and checks its length (1–40 characters).
func CheckName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < 1 || n > 40 {
		return "", apperr.Invalid("De naam moet tussen 1 en 40 tekens lang zijn.")
	}
	// The name goes into e-mail subjects and bodies.
	if strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return "", apperr.Invalid("De naam mag geen regeleinden of andere stuurtekens bevatten.")
	}
	return name, nil
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

// List returns every user, in the order they joined.
func List(ctx context.Context, db *sql.DB) ([]User, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, display_name, email, role FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Role); err != nil {
			return nil, err
		}
		u.Initial = Initial(u.Name)
		list = append(list, u)
	}
	return list, rows.Err()
}

// SetName changes the display name and returns the user.
func SetName(ctx context.Context, db *sql.DB, id int64, name string) (User, error) {
	name, err := CheckName(name)
	if err != nil {
		return User{}, err
	}
	res, err := db.ExecContext(ctx, `UPDATE users SET display_name = ? WHERE id = ?`, name, id)
	if err != nil {
		return User{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return User{}, apperr.ErrNotFound
	}
	u, _, err := Get(ctx, db, id)
	return u, err
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
