package ledger

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// MaxBalance bounds a balance typed by hand (€ 10.000.000.000).
const MaxBalance = 1_000_000_000_000

// NewAccount is the body of POST /api/accounts: a manual account.
type NewAccount struct {
	Name    string  `json:"name"`
	Type    string  `json:"type"`
	Colour  string  `json:"colour"`
	Buffer  int64   `json:"buffer"`
	IBAN    *string `json:"iban"`
	Balance *int64  `json:"balance"`
}

// CreateAccount adds a manual account (analysis 6.3): private to its creator,
// who manages it. Its IBAN only recognises transfers to it; it never matches
// or joins a bank account, and several users may register the same one. An
// opening balance is stored as today's manual snapshot.
func (s *Store) CreateAccount(ctx context.Context, viewer int64, n NewAccount, now time.Time) (Account, error) {
	name, err := validName(n.Name)
	if err != nil {
		return Account{}, err
	}
	if n.Type != "current" && n.Type != "savings" {
		return Account{}, apperr.Invalid("Kies een spaarrekening of een zichtrekening.")
	}
	if n.Colour == "" {
		n.Colour = Colours[0]
	}
	if !slices.Contains(Colours, n.Colour) {
		return Account{}, apperr.Invalid("Kies een van de acht rekeningkleuren.")
	}
	if err := validBuffer(n.Type, n.Buffer); err != nil {
		return Account{}, err
	}
	iban, err := manualIBAN(n.IBAN)
	if err != nil {
		return Account{}, err
	}
	if n.Balance != nil {
		if err := validBalance(*n.Balance); err != nil {
			return Account{}, err
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `INSERT INTO accounts (type, source, iban, name, colour, buffer, created_by)
		VALUES (?, 'manual', ?, ?, ?, ?, ?)`, n.Type, iban, name, n.Colour, n.Buffer, viewer)
	if err != nil {
		return Account{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Account{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO account_access (account_id, user_id, role, permission)
		VALUES (?, ?, 'manager', 'edit')`, id, viewer); err != nil {
		return Account{}, err
	}
	if n.Balance != nil {
		if err := putSnapshot(ctx, tx, id, *n.Balance, now.In(clock.Brussels).Format(time.DateOnly)); err != nil {
			return Account{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Account{}, err
	}
	return s.Account(ctx, viewer, id, now)
}

// manualIBAN normalises an optional IBAN; nil or blank is none (nil).
func manualIBAN(raw *string) (any, error) {
	if raw == nil {
		return nil, nil
	}
	iban := NormalizeIBAN(*raw)
	if iban == "" {
		return nil, nil
	}
	if !ValidIBAN(iban) {
		return nil, apperr.Invalid("Dit lijkt geen geldig IBAN. Kijk het na of laat het leeg.")
	}
	return iban, nil
}

// ValidIBAN checks a normalised IBAN's shape and its mod-97 check digits.
func ValidIBAN(iban string) bool {
	if len(iban) < 15 || len(iban) > 34 {
		return false
	}
	for i, r := range iban {
		letter := r >= 'A' && r <= 'Z'
		digit := r >= '0' && r <= '9'
		if (i < 2 && !letter) || (i >= 2 && i < 4 && !digit) || (!letter && !digit) {
			return false
		}
	}
	rem := 0
	for _, r := range iban[4:] + iban[:4] {
		if r >= 'A' {
			rem = (rem*100 + int(r-'A'+10)) % 97
		} else {
			rem = (rem*10 + int(r-'0')) % 97
		}
	}
	return rem == 1
}

func validBalance(b int64) error {
	if b > MaxBalance || b < -MaxBalance {
		return apperr.Invalid("Dit saldo is te groot.")
	}
	return nil
}

// putSnapshot stores the manual balance of a day: one per account and day,
// a later update of the same day replaces it.
func putSnapshot(ctx context.Context, tx *sql.Tx, account, balance int64, date string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO balance_snapshots (account_id, balance, date, origin) VALUES (?, ?, ?, 'manual')
		ON CONFLICT (account_id, date, origin) DO UPDATE SET balance = excluded.balance,
		    created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`, account, balance, date)
	return err
}

// access is the viewer's hold on one account.
type access struct {
	source, typ, permission, role string
	members                       int  // people: leave, delete and hand-over rules
	flag                          bool // accounts.shared; use shared()
}

// shared is the account's personal-or-shared label (IsShared).
func (a access) shared() bool { return IsShared(a.flag, a.members) }

// accessOf reads the viewer's access to an account; a hidden one is
// apperr.ErrNotFound.
func accessOf(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, viewer, id int64) (access, error) {
	var a access
	err := q.QueryRowContext(ctx, `SELECT a.source, a.type, me.permission, me.role,
		    (SELECT COUNT(*) FROM account_access x WHERE x.account_id = a.id), a.shared = 1
		FROM account_access me JOIN accounts a ON a.id = me.account_id
		WHERE me.user_id = ? AND a.id = ?`, viewer, id).Scan(&a.source, &a.typ, &a.permission, &a.role, &a.members, &a.flag)
	if errors.Is(err, sql.ErrNoRows) {
		return a, apperr.ErrNotFound
	}
	return a, err
}

// edit is the one check before any write to an account's data: edit
// permission (the manager always has it, plan 0.6-1 invariant), else
// apperr.ErrForbidden. The SQL filters "me.permission = 'edit'" say the same.
func (a access) edit() error {
	if a.permission != "edit" {
		return apperr.ErrForbidden
	}
	return nil
}

// manage is the check before changing the account itself: its manager only,
// else ErrNotManager.
func (a access) manage() error {
	if a.role != "manager" {
		return ErrNotManager
	}
	return nil
}

// ErrNotManager is apperr.ErrForbidden for an action only the manager may take.
var ErrNotManager = fmt.Errorf("%w: not the manager", apperr.ErrForbidden)

// SetBalance records a manual account's balance on a date (today when
// empty, never in the future) and returns the account.
func (s *Store) SetBalance(ctx context.Context, viewer, id, balance int64, date string, now time.Time) (Account, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return Account{}, err
	}
	if err := a.edit(); err != nil {
		return Account{}, err
	}
	if a.source != "manual" {
		return Account{}, apperr.Invalid("Het saldo van een bankrekening komt van de bank.")
	}
	if err := validBalance(balance); err != nil {
		return Account{}, err
	}
	today := now.In(clock.Brussels).Format(time.DateOnly)
	if date == "" {
		date = today
	}
	if _, err := time.Parse(time.DateOnly, date); err != nil || date > today {
		return Account{}, apperr.Invalid("Kies vandaag of een dag in het verleden.")
	}
	if err := putSnapshot(ctx, tx, id, balance, date); err != nil {
		return Account{}, err
	}
	if err := tx.Commit(); err != nil {
		return Account{}, err
	}
	return s.Account(ctx, viewer, id, now)
}

// SetPermission sets a member's permission ("read" or "edit") on an account
// the viewer manages and returns the account. A hidden account or a user who
// is not a member is apperr.ErrNotFound, a viewer who is not the manager
// ErrNotManager; the manager's own row cannot change (the manager always edits).
func (s *Store) SetPermission(ctx context.Context, viewer, id, user int64, permission string, now time.Time) (Account, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return Account{}, err
	}
	if err := a.manage(); err != nil {
		return Account{}, err
	}
	var role string
	err = tx.QueryRowContext(ctx, `SELECT role FROM account_access WHERE account_id = ? AND user_id = ?`, id, user).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, apperr.ErrNotFound
	}
	if err != nil {
		return Account{}, err
	}
	if role == "manager" {
		return Account{}, apperr.Invalid("De beheerder kan niet op Alleen lezen gezet worden.")
	}
	if permission != "read" && permission != "edit" {
		return Account{}, apperr.Invalid("Kies Lezen of Bewerken.")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE account_access SET permission = ? WHERE account_id = ? AND user_id = ?`,
		permission, id, user); err != nil {
		return Account{}, err
	}
	if err := tx.Commit(); err != nil {
		return Account{}, err
	}
	return s.Account(ctx, viewer, id, now)
}

// Balance is one point of an account's balance history.
type Balance struct {
	Date    string `json:"date"`
	Balance int64  `json:"balance"`
	Origin  string `json:"origin"`
}

// Balances returns the balance history of an account the viewer can see,
// oldest first: one point per date (a manual update wins over the bank's).
func (s *Store) Balances(ctx context.Context, viewer, id int64) ([]Balance, error) {
	if _, err := accessOf(ctx, s.db, viewer, id); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT date, balance, origin FROM balance_snapshots WHERE account_id = ?
		ORDER BY date, origin = 'manual', id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Balance{}
	for rows.Next() {
		var b Balance
		if err := rows.Scan(&b.Date, &b.Balance, &b.Origin); err != nil {
			return nil, err
		}
		if n := len(list); n > 0 && list[n-1].Date == b.Date {
			list[n-1] = b
			continue
		}
		list = append(list, b)
	}
	return list, rows.Err()
}

// OwnConnection is nil when id is a link of the viewer that is not revoked,
// else apperr.ErrNotFound.
func (s *Store) OwnConnection(ctx context.Context, viewer, id int64) error {
	return ownConnection(ctx, s.db, viewer, id)
}

func ownConnection(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, viewer, id int64) error {
	var found bool
	if err := q.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM provider_connections
		WHERE id = ? AND user_id = ? AND status <> 'revoked')`, id, viewer).Scan(&found); err != nil {
		return err
	}
	if !found {
		return apperr.ErrNotFound
	}
	return nil
}

// Removed is the outcome of removing a bank link.
type Removed struct {
	Deleted []int64 `json:"deleted"` // accounts deleted with their history
	Kept    []int64 `json:"kept"`    // accounts kept without this source
}

// RemoveConnection removes the viewer's own bank link (analysis 4.8): the
// connection is revoked and its sealed session and key are wiped, and the
// accounts it fed lose it as a source. With deleteHistory, the accounts that
// only this link feeds and that have no other member are deleted with their
// transactions, balances and splits; an account another member still sees
// is always kept, and when this link was its primary source the oldest
// fallback becomes primary (promotePrimary). One database
// transaction: everything or nothing.
func (s *Store) RemoveConnection(ctx context.Context, viewer, id int64, deleteHistory bool) (Removed, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Removed{}, err
	}
	defer tx.Rollback()
	if err := ownConnection(ctx, tx, viewer, id); err != nil {
		return Removed{}, err
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT s.account_id,
		       (SELECT COUNT(*) FROM account_sources o WHERE o.account_id = s.account_id AND o.connection_id <> s.connection_id),
		       (SELECT COUNT(*) FROM account_access m WHERE m.account_id = s.account_id),
		       EXISTS (SELECT 1 FROM account_access m WHERE m.account_id = s.account_id AND m.user_id = ?)
		FROM account_sources s WHERE s.connection_id = ? ORDER BY s.account_id`, viewer, id)
	if err != nil {
		return Removed{}, err
	}
	out := Removed{Deleted: []int64{}, Kept: []int64{}}
	for rows.Next() {
		var account int64
		var otherSources, members int
		var mine bool
		if err := rows.Scan(&account, &otherSources, &members, &mine); err != nil {
			rows.Close()
			return Removed{}, err
		}
		if deleteHistory && otherSources == 0 && members == 1 && mine {
			out.Deleted = append(out.Deleted, account)
		} else {
			out.Kept = append(out.Kept, account)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return Removed{}, err
	}

	for _, account := range out.Deleted {
		if err := dropAccount(ctx, tx, account); err != nil {
			return Removed{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM account_sources WHERE connection_id = ?`, id); err != nil {
		return Removed{}, err
	}
	// A kept account fed by a fallback goes on from it.
	for _, account := range out.Kept {
		if err := promotePrimary(ctx, tx, account); err != nil {
			return Removed{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE provider_connections
		SET status = 'revoked', session_id_enc = NULL, private_key_enc = NULL, application_id = NULL WHERE id = ?`, id); err != nil {
		return Removed{}, err
	}
	return out, tx.Commit()
}
