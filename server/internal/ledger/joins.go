package ledger

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// Join (0.6-1a, docs/api.md "Join"). Linking an IBAN that already exists as
// an account the viewer does not hold records a join offer for that consent
// (package banklink); accepting it makes the viewer a member. An offer is
// the viewer's own, names no account, and reveals only the masked IBAN.

// OfferTTL is how long a join offer can be accepted after the consent listed it.
const OfferTTL = 24 * time.Hour

const msgOfferStale = "Koppel de rekening opnieuw om aan te sluiten."

// JoinOffer is a pending offer as GET /api/join-offers shows it.
type JoinOffer struct {
	ID        int64  `json:"id"`
	IBAN      string `json:"iban"` // masked
	Bank      string `json:"bank"` // the bank of the viewer's own connection
	CreatedAt string `json:"createdAt"`
}

// JoinOffers lists the viewer's own offers younger than OfferTTL.
func (s *Store) JoinOffers(ctx context.Context, viewer int64, now time.Time) ([]JoinOffer, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT o.id, COALESCE(a.iban, ''), c.aspsp_name, o.created_at
		FROM join_offers o
		JOIN accounts a ON a.id = o.account_id
		JOIN provider_connections c ON c.id = o.connection_id AND c.user_id = o.user_id AND c.status <> 'revoked'
		WHERE o.user_id = ? AND o.created_at > ?
		  AND NOT EXISTS (SELECT 1 FROM account_access x WHERE x.account_id = o.account_id AND x.user_id = o.user_id)
		ORDER BY o.id`, viewer, now.Add(-OfferTTL).UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []JoinOffer{}
	for rows.Next() {
		var o JoinOffer
		var iban, created string
		if err := rows.Scan(&o.ID, &iban, &o.Bank, &created); err != nil {
			return nil, err
		}
		o.IBAN = MaskIBAN(iban)
		o.CreatedAt, _, _ = formatTimestamp(created)
		list = append(list, o)
	}
	return list, rows.Err()
}

// DeclineJoin deletes one of the viewer's offers; anything else is
// apperr.ErrNotFound.
func (s *Store) DeclineJoin(ctx context.Context, viewer, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM join_offers WHERE id = ? AND user_id = ?`, id, viewer)
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

// AcceptJoin makes the viewer a member with edit permission of the offer's
// account, in one transaction: the access, a fallback source on the offer's
// connection (not fetched until 0.6-1d), the notices for the other members,
// and the offer is used up. An offer that is not the viewer's or was used is
// apperr.ErrNotFound; an expired offer or a connection that is no longer
// active is invalid and changes nothing.
func (s *Store) AcceptJoin(ctx context.Context, viewer, id int64, now time.Time) (Account, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, err
	}
	defer tx.Rollback()
	// Claiming the offer first makes a second accept a clean not found.
	var conn, account int64
	var external, created string
	err = tx.QueryRowContext(ctx, `DELETE FROM join_offers WHERE id = ? AND user_id = ?
		RETURNING connection_id, account_id, external_account_id, created_at`, id, viewer).Scan(&conn, &account, &external, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, apperr.ErrNotFound
	}
	if err != nil {
		return Account{}, err
	}
	if t, err := time.Parse(time.RFC3339, created); err != nil || now.Sub(t) > OfferTTL {
		return Account{}, apperr.Invalid(msgOfferStale)
	}
	var status, validUntil string
	err = tx.QueryRowContext(ctx, `SELECT status, COALESCE(valid_until, '') FROM provider_connections WHERE id = ? AND user_id = ?`,
		conn, viewer).Scan(&status, &validUntil)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, apperr.Invalid(msgOfferStale)
	}
	if err != nil {
		return Account{}, err
	}
	if status != "active" || consentLapsed(validUntil, now) {
		return Account{}, apperr.Invalid(msgOfferStale)
	}
	var members int
	var manager sql.NullInt64
	var holds bool
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*), MAX(CASE WHEN role = 'manager' THEN user_id END), COALESCE(MAX(user_id = ?), 0)
		FROM account_access WHERE account_id = ?`, viewer, account).Scan(&members, &manager, &holds); err != nil {
		return Account{}, err
	}
	// Already a member, or an account without a manager (the invariant says
	// it cannot exist): nothing to join.
	if holds || !manager.Valid {
		return Account{}, apperr.ErrNotFound
	}
	stamp := now.UTC().Format(time.RFC3339)
	if _, err := tx.ExecContext(ctx, `INSERT INTO account_access (account_id, user_id, role, permission, joined_at)
		VALUES (?, ?, 'member', 'edit', ?)`, account, viewer, stamp); err != nil {
		return Account{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO account_sources (account_id, connection_id, priority, external_account_id)
		VALUES (?, ?, 'fallback', ?)
		ON CONFLICT (account_id, connection_id) DO UPDATE SET external_account_id = excluded.external_account_id`,
		account, conn, external); err != nil {
		return Account{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO account_notices (user_id, account_id, type, actor_id, created_at)
		SELECT user_id, account_id, 'member', ?, ? FROM account_access WHERE account_id = ? AND user_id <> ?`,
		viewer, stamp, account, viewer); err != nil {
		return Account{}, err
	}
	// A user rule only applies to an account with one member: from now on the
	// manager's user rules are dead for this account (categorise.RulesFor).
	if members == 1 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO account_notices (user_id, account_id, type, actor_id, created_at)
			SELECT ?, ?, 'rules', ?, ? WHERE EXISTS (SELECT 1 FROM rules WHERE user_id = ?)`,
			manager.Int64, account, viewer, stamp, manager.Int64); err != nil {
			return Account{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Account{}, err
	}
	return s.Account(ctx, viewer, account, now)
}

// noticeAlerts are the viewer's unread notices about accounts the viewer
// still holds, as alerts: the warnings and the information.
func (s *Store) noticeAlerts(ctx context.Context, viewer int64) (warn, info []Alert, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT n.id, n.type, n.account_id, a.name, COALESCE(u.display_name, ''), COALESCE(x.permission, '')
		FROM account_notices n
		JOIN account_access me ON me.account_id = n.account_id AND me.user_id = n.user_id
		JOIN accounts a ON a.id = n.account_id
		LEFT JOIN users u ON u.id = n.actor_id
		LEFT JOIN account_access x ON x.account_id = n.account_id AND x.user_id = n.actor_id
		WHERE n.user_id = ? AND n.read_at IS NULL
		ORDER BY n.id`, viewer)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var a Alert
		var kind, account, actor, permission string
		if err := rows.Scan(&a.NoticeID, &kind, &a.AccountID, &account, &actor, &permission); err != nil {
			return nil, nil, err
		}
		if actor == "" {
			actor = "Iemand"
		}
		a.Type, a.Href = kind, fmt.Sprintf("/rekeningen/%d", a.AccountID)
		if kind == "rules" {
			a.Kind = "warn"
			a.Title = "Je regels voor " + account + " gelden niet meer"
			a.Note = "Een regel van jezelf geldt alleen op een rekening met één lid · zet ze om naar regels van de rekening"
			warn = append(warn, a)
			continue
		}
		a.Kind = "ok"
		a.Title = actor + " sluit aan bij " + account
		// The actor's permission now, not at joining: the manager may have changed it.
		may := " mag bewerken"
		if permission == "read" {
			may = " mag alleen lezen"
		}
		a.Note = actor + may + " · ziet de geschiedenis van deze rekening, nooit je persoonlijke rekeningen"
		info = append(info, a)
	}
	return warn, info, rows.Err()
}

// ReadNotice marks one of the viewer's notices read for the viewer; a notice
// addressed to someone else is apperr.ErrNotFound.
func (s *Store) ReadNotice(ctx context.Context, viewer, id int64, now time.Time) error {
	res, err := s.db.ExecContext(ctx, `UPDATE account_notices SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?`,
		now.UTC().Format(time.RFC3339), id, viewer)
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

// convertible are the user rules of the manager (me) of a shared account
// that have no equal account rule on it yet: same conditions and category,
// priority aside. convertibleRules and ConvertRules share it, so the count
// and the copy agree.
const convertible = ` FROM account_access me JOIN rules u ON u.user_id = me.user_id
	WHERE me.role = 'manager'
	  AND (SELECT COUNT(*) FROM account_access m WHERE m.account_id = me.account_id) > 1
	  AND NOT EXISTS (SELECT 1 FROM rules ar WHERE ar.account_id = me.account_id
	      AND ar.counterparty_match IS u.counterparty_match AND ar.counterparty_exact = u.counterparty_exact
	      AND ar.counterparty_iban IS u.counterparty_iban AND ar.communication_contains IS u.communication_contains
	      AND ar.communication_regex IS u.communication_regex AND ar.amount_min IS u.amount_min
	      AND ar.amount_max IS u.amount_max AND ar.category_id = u.category_id)`

// loadConvertible sets convertibleRules on the shared accounts the viewer manages.
func (s *Store) loadConvertible(ctx context.Context, viewer int64, list []Account, index map[int64]int) error {
	rows, err := s.db.QueryContext(ctx, `SELECT me.account_id, COUNT(*)`+convertible+` AND me.user_id = ? GROUP BY me.account_id`, viewer)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return err
		}
		if i, ok := index[id]; ok {
			list[i].ConvertibleRules = n
		}
	}
	return rows.Err()
}

// ConvertRules copies the manager's convertible user rules as rules of the
// shared account and returns how many it copied (0 when all were). The user
// rules stay for the manager's personal accounts. A hidden account is
// apperr.ErrNotFound, a member apperr.ErrForbidden.
func (s *Store) ConvertRules(ctx context.Context, viewer, id int64) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return 0, err
	}
	if err := a.manage(); err != nil {
		return 0, err
	}
	var members, existing int
	if err := tx.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM account_access WHERE account_id = ?1),
		(SELECT COUNT(*) FROM rules WHERE account_id = ?1)`, id).Scan(&members, &existing); err != nil {
		return 0, err
	}
	if members < 2 {
		return 0, apperr.Invalid("Je regels gelden al voor deze rekening: alleen een gedeelde rekening heeft regels van de rekening nodig.")
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO rules (account_id, name, priority, counterparty_match, counterparty_exact,
		    counterparty_iban, communication_contains, communication_regex, amount_min, amount_max, category_id, created_by)
		SELECT me.account_id, u.name, u.priority, u.counterparty_match, u.counterparty_exact, u.counterparty_iban,
		    u.communication_contains, u.communication_regex, u.amount_min, u.amount_max, u.category_id, me.user_id`+
		convertible+` AND me.user_id = ? AND me.account_id = ?`, viewer, id)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	if existing+int(n) > categorise.MaxRulesPerOwner {
		return 0, apperr.Invalid("Er zijn al 200 regels voor deze rekening. Verwijder er eerst een.")
	}
	return int(n), tx.Commit()
}
