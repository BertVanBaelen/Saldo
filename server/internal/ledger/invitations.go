package ledger

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/users"
)

// Shared flag and invitations (0.8-0b, plan 00b). The manager of a shared
// account invites another user of the instance; the invitee who accepts is a
// member at once, with edit and without a source. Before accepting, the
// invitee learns only the account's name and the inviter's name (the alert).

// InvitationTTL is how long an invitation stays open: older ones are ignored
// on read and deleted by the next write on their account.
const InvitationTTL = 30 * 24 * time.Hour

// Invitation is an open invitation as the account's manager sees it.
type Invitation struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

// InvitableUser is one row of GET /api/accounts/{id}/invitable: another user
// of the instance, by display name and initial only. State is member, invited
// or free; InvitationID is set while invited.
type InvitableUser struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Initial      string `json:"initial"`
	State        string `json:"state"`
	InvitationID *int64 `json:"invitationId"`
}

// openSince is the oldest created_at of an open invitation at now.
func openSince(now time.Time) string {
	return now.Add(-InvitationTTL).UTC().Format(time.RFC3339)
}

// pruneInvitations deletes the expired invitations of an account.
func pruneInvitations(ctx context.Context, tx *sql.Tx, account int64, now time.Time) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM account_invitations WHERE account_id = ? AND created_at <= ?`, account, openSince(now))
	return err
}

// setShared sets the shared flag of an account its manager patches. Switching
// it off is refused while another member or an open invitation exists; the
// flag stays when the last other member leaves (only this switches it off).
func setShared(ctx context.Context, tx *sql.Tx, a access, account int64, on bool, now time.Time) error {
	if err := pruneInvitations(ctx, tx, account, now); err != nil {
		return err
	}
	if !on {
		if a.members > 1 {
			return apperr.Invalid("Een rekening met meer leden blijft gedeeld.")
		}
		var open bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM account_invitations WHERE account_id = ?)`, account).Scan(&open); err != nil {
			return err
		}
		if open {
			return apperr.Invalid("Trek eerst de uitnodiging in.")
		}
	}
	_, err := tx.ExecContext(ctx, `UPDATE accounts SET shared = ? WHERE id = ?`, on, account)
	return err
}

// loadInvitations sets the open invitations of the accounts the viewer manages.
func (s *Store) loadInvitations(ctx context.Context, viewer int64, list []Account, index map[int64]int, now time.Time) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT i.account_id, i.id, i.user_id, u.display_name, i.created_at
		FROM account_invitations i
		JOIN account_access me ON me.account_id = i.account_id AND me.user_id = ? AND me.role = 'manager'
		JOIN users u ON u.id = i.user_id
		WHERE i.created_at > ?
		ORDER BY i.account_id, i.id`, viewer, openSince(now))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var account int64
		var inv Invitation
		var created string
		if err := rows.Scan(&account, &inv.ID, &inv.UserID, &inv.Name, &created); err != nil {
			return err
		}
		inv.CreatedAt, _, _ = formatTimestamp(created)
		if i, ok := index[account]; ok {
			list[i].Invitations = append(list[i].Invitations, inv)
		}
	}
	return rows.Err()
}

// Invitable lists every other user of the instance for the account's manager,
// by name, with their state on the account. A hidden account is
// apperr.ErrNotFound, a member who does not manage it ErrNotManager.
func (s *Store) Invitable(ctx context.Context, viewer, account int64, now time.Time) ([]InvitableUser, error) {
	a, err := accessOf(ctx, s.db, viewer, account)
	if err != nil {
		return nil, err
	}
	if err := a.manage(); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.display_name,
		       EXISTS (SELECT 1 FROM account_access x WHERE x.account_id = ?1 AND x.user_id = u.id),
		       (SELECT i.id FROM account_invitations i WHERE i.account_id = ?1 AND i.user_id = u.id AND i.created_at > ?3)
		FROM users u WHERE u.id <> ?2
		ORDER BY u.display_name COLLATE NOCASE, u.id`, account, viewer, openSince(now))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []InvitableUser{}
	for rows.Next() {
		var u InvitableUser
		var member bool
		if err := rows.Scan(&u.ID, &u.Name, &member, &u.InvitationID); err != nil {
			return nil, err
		}
		u.Initial = users.Initial(u.Name)
		switch {
		case member:
			u.State, u.InvitationID = "member", nil
		case u.InvitationID != nil:
			u.State = "invited"
		default:
			u.State = "free"
		}
		list = append(list, u)
	}
	return list, rows.Err()
}

// Invite invites user to a shared account the viewer manages. A hidden
// account or an unknown user is apperr.ErrNotFound, a member ErrNotManager; a
// personal account, yourself or a member is invalid; an open invitation of
// the same user is apperr.Conflict (it stands).
func (s *Store) Invite(ctx context.Context, viewer, account, user int64, now time.Time) (Invitation, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Invitation{}, err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, account)
	if err != nil {
		return Invitation{}, err
	}
	if err := a.manage(); err != nil {
		return Invitation{}, err
	}
	if !a.shared() {
		return Invitation{}, apperr.Invalid("Zet de rekening eerst op gedeeld.")
	}
	if user == viewer {
		return Invitation{}, apperr.Invalid("Je kunt jezelf niet uitnodigen.")
	}
	inv := Invitation{UserID: user}
	var member bool
	err = tx.QueryRowContext(ctx, `SELECT display_name, EXISTS (SELECT 1 FROM account_access WHERE account_id = ? AND user_id = users.id)
		FROM users WHERE id = ?`, account, user).Scan(&inv.Name, &member)
	if errors.Is(err, sql.ErrNoRows) {
		return Invitation{}, apperr.ErrNotFound
	}
	if err != nil {
		return Invitation{}, err
	}
	if member {
		return Invitation{}, apperr.Invalid(inv.Name + " is al lid.")
	}
	if err := pruneInvitations(ctx, tx, account, now); err != nil {
		return Invitation{}, err
	}
	stamp := now.UTC().Format(time.RFC3339)
	err = tx.QueryRowContext(ctx, `INSERT INTO account_invitations (account_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (account_id, user_id) DO NOTHING RETURNING id`, account, user, viewer, stamp).Scan(&inv.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return Invitation{}, apperr.Conflict(inv.Name + " is al uitgenodigd.")
	}
	if err != nil {
		return Invitation{}, err
	}
	inv.CreatedAt, _, _ = formatTimestamp(stamp)
	return inv, tx.Commit()
}

// AcceptInvitation makes the viewer a member of the invitation's account at
// once (edit, no source) and returns the account as the viewer now sees it.
// An invitation that is not the viewer's, used or expired is
// apperr.ErrNotFound.
func (s *Store) AcceptInvitation(ctx context.Context, viewer, id int64, now time.Time) (Account, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback()
	var account int64
	err = tx.QueryRowContext(ctx, `DELETE FROM account_invitations WHERE id = ? AND user_id = ? AND created_at > ?
		RETURNING account_id`, id, viewer, openSince(now)).Scan(&account)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, apperr.ErrNotFound
	}
	if err != nil {
		return Account{}, err
	}
	if err := addMember(ctx, tx, account, viewer, now); err != nil {
		return Account{}, err
	}
	if err := tx.Commit(); err != nil {
		return Account{}, err
	}
	return s.Account(ctx, viewer, account, now)
}

// DeleteInvitation declines (the invitee) or revokes (the account's manager)
// an open invitation; nobody gets a notice. Anything else is
// apperr.ErrNotFound.
func (s *Store) DeleteInvitation(ctx context.Context, viewer, id int64, now time.Time) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM account_invitations WHERE id = ?1 AND created_at > ?3
		AND (user_id = ?2 OR EXISTS (SELECT 1 FROM account_access m
		    WHERE m.account_id = account_invitations.account_id AND m.user_id = ?2 AND m.role = 'manager'))`,
		id, viewer, openSince(now))
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return apperr.ErrNotFound
	}
	return nil
}

// JoinByInvitation is the bank link's auto-accept (package banklink): when
// user links the IBAN of account through connection (provider id external)
// and holds an open invitation for it, the invitation is used and user joins
// at once with that connection as a fallback source, instead of a join offer.
// It reports whether it joined; without an invitation it changes nothing.
func JoinByInvitation(ctx context.Context, tx *sql.Tx, account, user, connection int64, external string, now time.Time) (bool, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `DELETE FROM account_invitations WHERE account_id = ? AND user_id = ? AND created_at > ?
		RETURNING id`, account, user, openSince(now)).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := addMember(ctx, tx, account, user, now); err != nil {
		return false, err
	}
	return true, addFallback(ctx, tx, account, connection, external)
}

// addMember makes user a member with edit of account (a join, 0.6-1a, or an
// accepted invitation, 0.8-0b): the access, the shared flag on, the contribution shares back to
// equal, an open invitation of user used up, a member notice for every other
// member and, when the account goes from one person to two, the rules notice
// for the manager. An account user already holds is apperr.ErrNotFound.
func addMember(ctx context.Context, tx *sql.Tx, account, user int64, now time.Time) error {
	var members int
	var manager sql.NullInt64
	var holds bool
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*), MAX(CASE WHEN role = 'manager' THEN user_id END), COALESCE(MAX(user_id = ?), 0)
		FROM account_access WHERE account_id = ?`, user, account).Scan(&members, &manager, &holds); err != nil {
		return err
	}
	// Already a member, or an account without a manager (the invariant says
	// it cannot exist): nothing to join.
	if holds || !manager.Valid {
		return apperr.ErrNotFound
	}
	stamp := now.UTC().Format(time.RFC3339)
	if _, err := tx.ExecContext(ctx, `INSERT INTO account_access (account_id, user_id, role, permission, joined_at)
		VALUES (?, ?, 'member', 'edit', ?)`, account, user, stamp); err != nil {
		return err
	}
	// Once someone has joined, the account stays shared (0.8-0b), also after
	// the other members leave.
	if _, err := tx.ExecContext(ctx, `UPDATE accounts SET shared = 1 WHERE id = ?`, account); err != nil {
		return err
	}
	if err := resetContributions(ctx, tx, account, user); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM account_invitations WHERE account_id = ? AND user_id = ?`, account, user); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO account_notices (user_id, account_id, type, actor_id, created_at)
		SELECT user_id, account_id, 'member', ?, ? FROM account_access WHERE account_id = ? AND user_id <> ?`,
		user, stamp, account, user); err != nil {
		return err
	}
	// A user rule only applies to an account with one member: from now on the
	// manager's user rules are dead for this account (categorise.RulesFor).
	if members == 1 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO account_notices (user_id, account_id, type, actor_id, created_at)
			SELECT ?, ?, 'rules', ?, ? WHERE EXISTS (SELECT 1 FROM rules WHERE user_id = ?)`,
			manager.Int64, account, user, stamp, manager.Int64); err != nil {
			return err
		}
	}
	return nil
}

// addFallback adds connection as a fallback source of account (not fetched
// until 0.6-1d), or refreshes its provider id.
func addFallback(ctx context.Context, tx *sql.Tx, account, connection int64, external string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO account_sources (account_id, connection_id, priority, external_account_id)
		VALUES (?, ?, 'fallback', ?)
		ON CONFLICT (account_id, connection_id) DO UPDATE SET external_account_id = excluded.external_account_id`,
		account, connection, external)
	return err
}

// invitationAlerts are the viewer's open invitations as alerts: the account's
// name and the inviter's display name, nothing else (no account id).
func (s *Store) invitationAlerts(ctx context.Context, viewer int64, now time.Time) ([]Alert, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT i.id, a.name, COALESCE(u.display_name, '')
		FROM account_invitations i
		JOIN accounts a ON a.id = i.account_id
		LEFT JOIN users u ON u.id = i.invited_by
		WHERE i.user_id = ? AND i.created_at > ?
		ORDER BY i.id`, viewer, openSince(now))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Alert
	for rows.Next() {
		var a Alert
		var account, inviter string
		if err := rows.Scan(&a.InvitationID, &account, &inviter); err != nil {
			return nil, err
		}
		if inviter == "" {
			inviter = "Iemand"
		}
		a.Kind, a.Type = "ok", "invite"
		a.Title = inviter + " nodigt je uit voor " + account
		a.Note = "Voeg de rekening toe om ze samen te volgen"
		a.Href = fmt.Sprintf("/rekeningen?uitnodiging=%d", a.InvitationID)
		out = append(out, a)
	}
	return out, rows.Err()
}
