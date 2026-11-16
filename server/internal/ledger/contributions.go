package ledger

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// Contributions (0.6-5, docs/api.md "Contributions"). Each member of a shared
// account declares, from their own side, which sender IBANs pay their
// contribution into it. The figure is the sum of the shared account's own
// booked incoming rows from those senders: no rule, no category, and never
// another member's personal accounts. The server takes a sender's IBAN from
// something the viewer holds, never from the request.

const (
	msgNotOwnSender    = "Dit is geen afzender die je zelf kunt kiezen. Kies je eigen rekening."
	msgPersonalNoShare = "Een persoonlijke rekening heeft geen bijdragen."
)

// Contributions is GET /api/accounts/{id}/contributions.
type Contributions struct {
	Month     string               `json:"month"`
	Members   []ContributionMember `json:"members"`
	MySenders []Sender             `json:"mySenders"`
}

// ContributionMember is one member's contribution in a month. Share is the
// agreed percentage (nil = equal); it has no effect yet (0.8-4). Senders is a
// count: nobody sees another member's sender IBANs. Confirmed is "something
// was received this month", not "paid their part".
type ContributionMember struct {
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	Me        bool   `json:"me"`
	Share     *int   `json:"share"`
	Senders   int    `json:"senders"`
	Received  int64  `json:"received"`
	Confirmed bool   `json:"confirmed"`
}

// Sender is one of the viewer's own claimed senders, IBAN masked.
type Sender struct {
	ID   int64  `json:"id"`
	IBAN string `json:"iban"`
}

// ContributionLabel marks an incoming booked row of a shared account whose
// sender is a member's claim ("Bijdrage van Partner").
type ContributionLabel struct {
	Name string `json:"name"`
	Me   bool   `json:"me"`
}

// Contributions answers a month ("YYYY-MM"; "" is the current month in
// Brussels) of an account the viewer holds. A personal account has no members
// here. A hidden account is apperr.ErrNotFound.
func (s *Store) Contributions(ctx context.Context, viewer, id int64, month string, now time.Time) (Contributions, error) {
	if month == "" {
		month = now.In(clock.Brussels).Format("2006-01")
	}
	start, err := time.Parse("2006-01", month)
	if err != nil || start.Format("2006-01") != month {
		return Contributions{}, apperr.Invalid("Kies een maand als JJJJ-MM.")
	}
	a, err := accessOf(ctx, s.db, viewer, id)
	if err != nil {
		return Contributions{}, err
	}
	out := Contributions{Month: month, Members: []ContributionMember{}, MySenders: []Sender{}}
	if a.members < 2 {
		return out, nil
	}
	from, to := month+"-01", start.AddDate(0, 1, 0).Format("2006-01")+"-01"
	rows, err := s.db.QueryContext(ctx, `
		SELECT x.user_id, u.display_name, x.contribution_share,
		       (SELECT COUNT(*) FROM contribution_senders cs WHERE cs.account_id = x.account_id AND cs.user_id = x.user_id),
		       COALESCE((SELECT SUM(t.amount) FROM contribution_senders cs
		           JOIN transactions t ON t.account_id = cs.account_id AND t.counterparty_iban = cs.iban
		           WHERE cs.account_id = x.account_id AND cs.user_id = x.user_id
		             AND t.status = 'booked' AND t.amount > 0 AND t.booking_date >= ? AND t.booking_date < ?), 0)
		FROM account_access x JOIN users u ON u.id = x.user_id
		WHERE x.account_id = ? ORDER BY x.joined_at, u.id`, from, to, id)
	if err != nil {
		return Contributions{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var m ContributionMember
		var share sql.NullInt64
		if err := rows.Scan(&m.UserID, &m.Name, &share, &m.Senders, &m.Received); err != nil {
			return Contributions{}, err
		}
		if share.Valid {
			v := int(share.Int64)
			m.Share = &v
		}
		m.Me, m.Confirmed = m.UserID == viewer, m.Received > 0
		out.Members = append(out.Members, m)
	}
	if err := rows.Err(); err != nil {
		return Contributions{}, err
	}
	rows.Close()
	mine, err := s.db.QueryContext(ctx, `SELECT id, iban FROM contribution_senders WHERE account_id = ? AND user_id = ? ORDER BY id`, id, viewer)
	if err != nil {
		return Contributions{}, err
	}
	defer mine.Close()
	for mine.Next() {
		var c Sender
		var iban string
		if err := mine.Scan(&c.ID, &iban); err != nil {
			return Contributions{}, err
		}
		c.IBAN = MaskIBAN(iban)
		out.MySenders = append(out.MySenders, c)
	}
	return out, mine.Err()
}

// ClaimSender records a sender of the viewer's contribution to a shared
// account, proven by exactly one of: fromAccount, an account the viewer holds
// with an IBAN that is not this account; or transaction, an incoming row of
// this account whose sender IBAN is no account in Saldo. Every other proof
// (missing, another user's, outgoing, without IBAN, a Saldo account) answers
// the one generic refusal, so it reveals nothing. A sender another member (or
// the viewer) already claimed is apperr.Conflict.
func (s *Store) ClaimSender(ctx context.Context, viewer, id, fromAccount, transaction int64) (Sender, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Sender{}, err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return Sender{}, err
	}
	if err := a.edit(); err != nil {
		return Sender{}, err
	}
	if a.members < 2 {
		return Sender{}, apperr.Invalid(msgPersonalNoShare)
	}
	if (fromAccount > 0) == (transaction > 0) {
		return Sender{}, apperr.Invalid("Kies je eigen rekening of een ontvangen betaling.")
	}
	var iban string
	if fromAccount > 0 {
		err = tx.QueryRowContext(ctx, `SELECT COALESCE(a.iban, '') FROM account_access x JOIN accounts a ON a.id = x.account_id
			WHERE x.user_id = ? AND a.id = ? AND a.id <> ?`, viewer, fromAccount, id).Scan(&iban)
	} else {
		err = tx.QueryRowContext(ctx, `SELECT COALESCE(counterparty_iban, '') FROM transactions
			WHERE id = ? AND account_id = ? AND amount > 0`, transaction, id).Scan(&iban)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return Sender{}, apperr.Invalid(msgNotOwnSender)
	}
	if err != nil {
		return Sender{}, err
	}
	if iban = NormalizeIBAN(iban); iban == "" {
		return Sender{}, apperr.Invalid(msgNotOwnSender)
	}
	if transaction > 0 {
		// Equality only, and the same refusal whoever holds it.
		var inSaldo bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM accounts WHERE iban = ?)`, iban).Scan(&inSaldo); err != nil {
			return Sender{}, err
		}
		if inSaldo {
			return Sender{}, apperr.Invalid(msgNotOwnSender)
		}
	}
	out := Sender{IBAN: MaskIBAN(iban)}
	err = tx.QueryRowContext(ctx, `INSERT INTO contribution_senders (account_id, user_id, iban) VALUES (?, ?, ?)
		ON CONFLICT (account_id, iban) DO NOTHING RETURNING id`, id, viewer, iban).Scan(&out.ID)
	if errors.Is(err, sql.ErrNoRows) {
		var holder int64
		var name string
		if err := tx.QueryRowContext(ctx, `SELECT cs.user_id, u.display_name FROM contribution_senders cs JOIN users u ON u.id = cs.user_id
			WHERE cs.account_id = ? AND cs.iban = ?`, id, iban).Scan(&holder, &name); err != nil {
			return Sender{}, err
		}
		if holder == viewer {
			return Sender{}, apperr.Conflict("Deze afzender is al ingesteld als jouw bijdrage.")
		}
		return Sender{}, apperr.Conflict("Deze afzender is al ingesteld als bijdrage van " + name + ".")
	}
	if err != nil {
		return Sender{}, err
	}
	return out, tx.Commit()
}

// RemoveSender deletes a claimed sender of a shared account: the claimant's
// own (with edit permission) or anyone's by the manager. A hidden account or
// a sender that is not this account's is apperr.ErrNotFound, another
// member's sender ErrNotManager.
func (s *Store) RemoveSender(ctx context.Context, viewer, id, sender int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return err
	}
	if err := a.edit(); err != nil {
		return err
	}
	var claimant int64
	err = tx.QueryRowContext(ctx, `SELECT user_id FROM contribution_senders WHERE id = ? AND account_id = ?`, sender, id).Scan(&claimant)
	if errors.Is(err, sql.ErrNoRows) {
		return apperr.ErrNotFound
	}
	if err != nil {
		return err
	}
	if claimant != viewer {
		if err := a.manage(); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM contribution_senders WHERE id = ?`, sender); err != nil {
		return err
	}
	return tx.Commit()
}

// SetShares sets the contribution split of a shared account the viewer
// manages: raw is a JSON object naming every member exactly once (user id as
// a string) with an integer 0..100, summing to 100, or null for equal (every
// share NULL). The shares have no effect yet (0.8-4). A hidden account is
// apperr.ErrNotFound, a member ErrNotManager.
func (s *Store) SetShares(ctx context.Context, viewer, id int64, raw json.RawMessage) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return err
	}
	if err := a.manage(); err != nil {
		return err
	}
	if a.members < 2 {
		return apperr.Invalid(msgPersonalNoShare)
	}
	if len(raw) == 0 {
		return apperr.Invalid("Geef elk lid precies één aandeel.")
	}
	if string(raw) == "null" {
		_, err := tx.ExecContext(ctx, `UPDATE account_access SET contribution_share = NULL WHERE account_id = ?`, id)
		if err != nil {
			return err
		}
		return tx.Commit()
	}
	var shares map[string]json.Number
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&shares); err != nil || shares == nil {
		return apperr.Invalid("De gegevens kloppen niet.")
	}
	members := map[int64]bool{}
	rows, err := tx.QueryContext(ctx, `SELECT user_id FROM account_access WHERE account_id = ?`, id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var u int64
		if err := rows.Scan(&u); err != nil {
			rows.Close()
			return err
		}
		members[u] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(shares) != len(members) {
		return apperr.Invalid("Geef elk lid precies één aandeel.")
	}
	values := map[int64]int{}
	sum := 0
	for key, n := range shares {
		user, err := strconv.ParseInt(key, 10, 64)
		if err != nil || strconv.FormatInt(user, 10) != key || !members[user] {
			return apperr.Invalid("Geef elk lid precies één aandeel.")
		}
		v, err := strconv.Atoi(n.String())
		if err != nil || v < 0 || v > 100 {
			return apperr.Invalid("Elk aandeel is een geheel getal van 0 tot 100.")
		}
		values[user] = v
		sum += v
	}
	if sum != 100 {
		return apperr.Invalid("De aandelen moeten samen 100 % zijn.")
	}
	for user, v := range values {
		if _, err := tx.ExecContext(ctx, `UPDATE account_access SET contribution_share = ? WHERE account_id = ? AND user_id = ?`, v, id, user); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// resetContributions takes a member's claims off an account and puts every
// share of it back to equal: shares stop adding up when the members change.
// Leave, removeMember (delete user) and join share it.
func resetContributions(ctx context.Context, tx *sql.Tx, account, user int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM contribution_senders WHERE account_id = ? AND user_id = ?`, account, user); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE account_access SET contribution_share = NULL WHERE account_id = ?`, account)
	return err
}
