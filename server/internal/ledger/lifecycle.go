package ledger

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

// Lifecycle (0.6-1c, docs/api.md "Lifecycle"): leave an account, delete a
// shared account, delete a user. Every action keeps the invariant (plan 0.6-1,
// decision 4): each account has at least one member and exactly one manager,
// who edits. account_access cascades on user delete, so the hand-over is done
// here, explicitly, in the caller's transaction.

const msgLastMember = "Je bent het laatste lid. Verwijder de rekening of haal je koppeling weg."

// HandOver is the member who became manager when the manager left.
type HandOver struct {
	UserID int64  `json:"userId"`
	Name   string `json:"name"`
}

// Leave takes the viewer off a shared account (POST /api/accounts/{id}/leave)
// and returns the new manager when the viewer was the manager (else nil). The
// viewer's connection stays and keeps its other accounts. A hidden account is
// apperr.ErrNotFound; the last member cannot leave.
func (s *Store) Leave(ctx context.Context, viewer, id int64, now time.Time) (*HandOver, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return nil, err
	}
	if a.members < 2 {
		return nil, apperr.Invalid(msgLastMember)
	}
	h, err := removeMember(ctx, tx, id, viewer, now)
	if err != nil {
		return nil, err
	}
	return h, tx.Commit()
}

// removeMember takes user off an account that keeps at least one other
// member: their access, their own sources of it and their private rows about
// it go; the manager role passes to the longest-standing member (joined_at,
// then user id), who edits; the oldest fallback becomes primary when the
// primary went; the members left get a notice.
func removeMember(ctx context.Context, tx *sql.Tx, account, user int64, now time.Time) (*HandOver, error) {
	var role, actor string
	err := tx.QueryRowContext(ctx, `SELECT x.role, u.display_name FROM account_access x JOIN users u ON u.id = x.user_id
		WHERE x.account_id = ? AND x.user_id = ?`, account, user).Scan(&role, &actor)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apperr.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	for _, q := range []string{
		`DELETE FROM account_access WHERE account_id = ?1 AND user_id = ?2`,
		`DELETE FROM account_sources WHERE account_id = ?1 AND connection_id IN (SELECT id FROM provider_connections WHERE user_id = ?2)`,
		`DELETE FROM account_notices WHERE account_id = ?1 AND user_id = ?2`,
		// "X sluit aan" is stale once X left.
		`DELETE FROM account_notices WHERE account_id = ?1 AND actor_id = ?2 AND type = 'member'`,
		`DELETE FROM join_offers WHERE account_id = ?1 AND user_id = ?2`,
		`DELETE FROM recurring_items WHERE account_id = ?1 AND user_id = ?2`,
		`DELETE FROM transfer_overrides WHERE user_id = ?2 AND transaction_id IN (SELECT id FROM transactions WHERE account_id = ?1)`,
	} {
		if _, err := tx.ExecContext(ctx, q, account, user); err != nil {
			return nil, err
		}
	}
	var next *HandOver
	if role == "manager" {
		var h HandOver
		err := tx.QueryRowContext(ctx, `SELECT x.user_id, u.display_name FROM account_access x JOIN users u ON u.id = x.user_id
			WHERE x.account_id = ? ORDER BY x.joined_at, x.user_id LIMIT 1`, account).Scan(&h.UserID, &h.Name)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("ledger: account %d would be left without a member", account)
		}
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE account_access SET role = 'manager', permission = 'edit'
			WHERE account_id = ? AND user_id = ?`, account, h.UserID); err != nil {
			return nil, err
		}
		next = &h
	}
	if err := promotePrimary(ctx, tx, account); err != nil {
		return nil, err
	}
	stamp := now.UTC().Format(time.RFC3339)
	if _, err := tx.ExecContext(ctx, `INSERT INTO account_notices (user_id, account_id, type, actor_id, actor_name, created_at)
		SELECT user_id, account_id, 'left', ?, ?, ? FROM account_access WHERE account_id = ?`, user, actor, stamp, account); err != nil {
		return nil, err
	}
	if next != nil {
		if _, err := tx.ExecContext(ctx, `INSERT INTO account_notices (user_id, account_id, type, actor_id, actor_name, created_at)
			VALUES (?1, ?2, 'manager', ?1, ?3, ?4)`, next.UserID, account, next.Name, stamp); err != nil {
			return nil, err
		}
	}
	return next, nil
}

// promotePrimary makes the oldest fallback the primary source of an account
// that has sources but no primary any more. Oldest is the fallback whose
// owner joined the account first (account_sources has no timestamp), then the
// lowest connection id. Its pending rows follow the new primary, as when a
// link becomes primary in banklink.match (only the source of a pending row
// replaces it). Leave, RemoveConnection and RemoveUser share it.
func promotePrimary(ctx context.Context, tx *sql.Tx, account int64) error {
	res, err := tx.ExecContext(ctx, `UPDATE account_sources SET priority = 'primary'
		WHERE account_id = ?1
		  AND NOT EXISTS (SELECT 1 FROM account_sources p WHERE p.account_id = ?1 AND p.priority = 'primary')
		  AND connection_id = (SELECT s.connection_id FROM account_sources s
		      JOIN provider_connections c ON c.id = s.connection_id
		      LEFT JOIN account_access x ON x.account_id = s.account_id AND x.user_id = c.user_id
		      WHERE s.account_id = ?1 ORDER BY x.joined_at IS NULL, x.joined_at, s.connection_id LIMIT 1)`, account)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE transactions SET source_connection_id =
		    (SELECT connection_id FROM account_sources WHERE account_id = ?1 AND priority = 'primary')
		WHERE account_id = ?1 AND status = 'pending'`, account)
	return err
}

// dropAccount deletes an account for everyone. Its notices go first (they
// would outlive it with account_id NULL); transactions, splits, balances,
// access, sources and join offers cascade.
func dropAccount(ctx context.Context, tx *sql.Tx, account int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM account_notices WHERE account_id = ?`, account); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM accounts WHERE id = ?`, account)
	return err
}

// DeleteAccount deletes an account of which the viewer is the manager, for
// everyone, with its history. An account with more than one member needs
// confirm, its name (trimmed, any case), and its other members get a notice
// that outlives it. A single-member manual account needs no confirmation; a
// single-member bank account is removed through its link. A hidden account is
// apperr.ErrNotFound, a member who does not manage it ErrNotManager.
func (s *Store) DeleteAccount(ctx context.Context, viewer, id int64, confirm string, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return err
	}
	if a.members < 2 && a.source != "manual" {
		return apperr.Invalid("Een bankrekening verwijder je door haar koppeling te verwijderen.")
	}
	if err := a.manage(); err != nil {
		return err
	}
	if a.members > 1 {
		var name, actor string
		if err := tx.QueryRowContext(ctx, `SELECT a.name, u.display_name FROM accounts a, users u WHERE a.id = ? AND u.id = ?`,
			id, viewer).Scan(&name, &actor); err != nil {
			return err
		}
		if !strings.EqualFold(strings.TrimSpace(confirm), strings.TrimSpace(name)) {
			return apperr.Invalid("Typ de naam van de rekening om te bevestigen.")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO account_notices (user_id, account_id, type, actor_id, actor_name, account_name, created_at)
			SELECT user_id, NULL, 'deleted', ?, ?, ?, ? FROM account_access WHERE account_id = ? AND user_id <> ?`,
			viewer, actor, name, now.UTC().Format(time.RFC3339), id, viewer); err != nil {
			return err
		}
	}
	if err := dropAccount(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit()
}

// UserRemoval is what deleting a user does (or did), in counts only: an
// admin learns nothing about accounts they do not hold (no names, no ids).
type UserRemoval struct {
	DeletedAccounts int `json:"deletedAccounts"` // accounts without another member, deleted with their history
	LeftAccounts    int `json:"leftAccounts"`    // shared accounts that stay for the other members
	Connections     int `json:"connections"`     // links revoked
}

// RemoveUser deletes target on behalf of the admin actor (the caller checks
// the admin role), in one transaction: their accounts without another member
// go with their history, their shared accounts are left with the hand-over,
// their links are revoked with the secrets wiped, their offers go and then
// the user row (devices, tokens, preferences, rules and notices cascade; the
// audit log and created_by columns keep the row with NULL). With commit false
// it changes nothing and returns what it would do: the preview (counts). Unknown user
// apperr.ErrNotFound; yourself or the last admin is invalid.
func (s *Store) RemoveUser(ctx context.Context, actor, target int64, now time.Time, commit bool) (UserRemoval, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return UserRemoval{}, err
	}
	defer tx.Rollback()
	var role string
	var admins int
	err = tx.QueryRowContext(ctx, `SELECT role, (SELECT COUNT(*) FROM users WHERE role = 'admin') FROM users WHERE id = ?`,
		target).Scan(&role, &admins)
	if errors.Is(err, sql.ErrNoRows) {
		return UserRemoval{}, apperr.ErrNotFound
	}
	if err != nil {
		return UserRemoval{}, err
	}
	if target == actor {
		return UserRemoval{}, apperr.Invalid("Je kunt jezelf niet verwijderen.")
	}
	if role == "admin" && admins < 2 {
		return UserRemoval{}, apperr.Invalid("Je kunt de laatste beheerder niet verwijderen.")
	}

	type held struct {
		id      int64
		members int
	}
	rows, err := tx.QueryContext(ctx, `SELECT me.account_id, (SELECT COUNT(*) FROM account_access x WHERE x.account_id = me.account_id)
		FROM account_access me WHERE me.user_id = ? ORDER BY me.account_id`, target)
	if err != nil {
		return UserRemoval{}, err
	}
	var list []held
	for rows.Next() {
		var h held
		if err := rows.Scan(&h.id, &h.members); err != nil {
			rows.Close()
			return UserRemoval{}, err
		}
		list = append(list, h)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return UserRemoval{}, err
	}
	var out UserRemoval
	for _, h := range list {
		if h.members < 2 {
			if err := dropAccount(ctx, tx, h.id); err != nil {
				return UserRemoval{}, err
			}
			out.DeletedAccounts++
			continue
		}
		if _, err := removeMember(ctx, tx, h.id, target, now); err != nil {
			return UserRemoval{}, err
		}
		out.LeftAccounts++
	}

	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM provider_connections WHERE user_id = ? AND status <> 'revoked'`,
		target).Scan(&out.Connections); err != nil {
		return UserRemoval{}, err
	}
	for _, q := range []string{
		`UPDATE provider_connections SET status = 'revoked', session_id_enc = NULL, private_key_enc = NULL, application_id = NULL
			WHERE user_id = ?`,
		`DELETE FROM join_offers WHERE user_id = ?`,
		// The connections and anything left of their sources cascade.
		`DELETE FROM users WHERE id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, q, target); err != nil {
			return UserRemoval{}, err
		}
	}
	if !commit {
		return out, nil
	}
	return out, tx.Commit()
}
