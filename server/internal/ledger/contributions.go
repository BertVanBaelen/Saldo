package ledger

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

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
	// msgIBANInUse is the one answer for an IBAN already used on this account,
	// whoever holds it (a member's sender or a contributor): it names nobody.
	msgIBANInUse    = "Deze IBAN kan je hier niet gebruiken."
	msgEveryShare   = "Geef elk lid precies één aandeel."
	msgLinkToMember = "Kies een lid van deze rekening."
)

// Contributions is GET /api/accounts/{id}/contributions.
type Contributions struct {
	Month string `json:"month"`
	// Need is what the account needs that month, rounded up to whole euros
	// (0.8-4); nil outside the forecast or without a balance. The server layer
	// fills it: ledger does not import planning.
	Need      *int64               `json:"need"`
	Members   []ContributionMember `json:"members"`
	MySenders []Sender             `json:"mySenders"`
	// Contributors are the account's contributors without Saldo (0.8.1-7),
	// after the members; LinkOffers the manager's offers to link one of them
	// to the viewer. Both are left out when empty (0.8.0 answers unchanged).
	Contributors []Contributor `json:"contributors,omitempty"`
	LinkOffers   []LinkOffer   `json:"linkOffers,omitempty"`
}

// Contributor is a contributor without Saldo in a month: a name, a share and
// what their IBAN paid into the account. IBAN (masked) only for the member who
// added them and the manager; LinkUserID (a pending offer) only for the
// manager. Required and Covered as a member's.
type Contributor struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Share      *int   `json:"share"`
	IBAN       string `json:"iban,omitempty"`
	LinkUserID *int64 `json:"linkUserId,omitempty"`
	Received   int64  `json:"received"`
	Confirmed  bool   `json:"confirmed"`
	Required   *int64 `json:"required"`
	Covered    *bool  `json:"covered"`
}

// LinkOffer asks the viewer whether a contributor's IBAN (masked) is theirs.
type LinkOffer struct {
	ContributorID int64  `json:"contributorId"`
	Name          string `json:"name"`
	IBAN          string `json:"iban"`
}

// ContributionMember is one member's contribution in a month. Share is the
// agreed percentage (nil = equal). Senders is a count: nobody sees another
// member's sender IBANs. Confirmed is "something was received this month", not
// "paid their part". Required is the member's part of Need in whole euros and
// Covered is Received >= Required (0.8-4; both nil as Need is).
type ContributionMember struct {
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	Me        bool   `json:"me"`
	Share     *int   `json:"share"`
	Senders   int    `json:"senders"`
	Received  int64  `json:"received"`
	Confirmed bool   `json:"confirmed"`
	Required  *int64 `json:"required"`
	Covered   *bool  `json:"covered"`
}

// Sender is one of the viewer's own claimed senders, IBAN masked.
type Sender struct {
	ID   int64  `json:"id"`
	IBAN string `json:"iban"`
	// Replaced is the contributor this claim replaced (0.8.1-7), for the audit line.
	Replaced int64 `json:"-"`
}

// ContributionLabel marks an incoming booked row of a shared account whose
// sender is a member's claim ("Bijdrage van Partner") or a contributor's IBAN
// (ContributorID set, Me false).
type ContributionLabel struct {
	Name          string `json:"name"`
	Me            bool   `json:"me"`
	ContributorID *int64 `json:"contributorId,omitempty"`
}

// Contributions answers a month ("YYYY-MM"; "" is the current month in
// Brussels) of an account the viewer holds. A personal account has no members
// here (a flagged account with one member has that one member).
// A hidden account is apperr.ErrNotFound.
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
	if !a.shared() {
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
	if err := mine.Err(); err != nil {
		return Contributions{}, err
	}
	mine.Close()
	return out, s.loadContributors(ctx, &out, a, viewer, id, from, to)
}

// loadContributors adds the account's contributors without Saldo and the
// viewer's link offers. The IBAN, masked, goes to the creator and the manager
// only, and to the member a link is offered to (in their offer).
func (s *Store) loadContributors(ctx context.Context, out *Contributions, a access, viewer, id int64, from, to string) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.name, c.iban, c.share, c.created_by, c.link_user,
		       COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = c.account_id AND t.counterparty_iban = c.iban
		           AND t.status = 'booked' AND t.amount > 0 AND t.booking_date >= ? AND t.booking_date < ?), 0)
		FROM contributors c WHERE c.account_id = ? ORDER BY c.id`, from, to, id)
	if err != nil {
		return err
	}
	defer rows.Close()
	manager := a.manage() == nil
	for rows.Next() {
		var c Contributor
		var iban string
		var share, creator, link sql.NullInt64
		if err := rows.Scan(&c.ID, &c.Name, &iban, &share, &creator, &link, &c.Received); err != nil {
			return err
		}
		if share.Valid {
			v := int(share.Int64)
			c.Share = &v
		}
		if manager || creator.Valid && creator.Int64 == viewer {
			c.IBAN = MaskIBAN(iban)
		}
		if manager && link.Valid {
			c.LinkUserID = &link.Int64
		}
		if link.Valid && link.Int64 == viewer {
			out.LinkOffers = append(out.LinkOffers, LinkOffer{ContributorID: c.ID, Name: c.Name, IBAN: MaskIBAN(iban)})
		}
		c.Confirmed = c.Received > 0
		out.Contributors = append(out.Contributors, c)
	}
	return rows.Err()
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
	if !a.shared() {
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
	// A contributor without Saldo on this IBAN (0.8.1-7): a member's own
	// account replaces it (nobody can block a member's sender by naming it
	// someone else's); a received payment never does.
	err = tx.QueryRowContext(ctx, `SELECT id FROM contributors WHERE account_id = ? AND iban = ?`, id, iban).Scan(&out.Replaced)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return Sender{}, err
	case transaction > 0:
		return Sender{}, apperr.Conflict(msgIBANInUse)
	default:
		if _, err := tx.ExecContext(ctx, `DELETE FROM contributors WHERE id = ?`, out.Replaced); err != nil {
			return Sender{}, err
		}
		if err := resetShares(ctx, tx, id); err != nil {
			return Sender{}, err
		}
	}
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
// share NULL). The shares set each member's required part of the need
// (0.8-4). A hidden account is apperr.ErrNotFound, a member ErrNotManager.
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
	if !a.shared() {
		return apperr.Invalid(msgPersonalNoShare)
	}
	if len(raw) == 0 {
		return apperr.Invalid("Geef elk lid precies één aandeel.")
	}
	if string(raw) == "null" {
		if err := resetShares(ctx, tx, id); err != nil {
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
	// The parties: members by user id ("2"), contributors by "c" and their id
	// ("c7"); the key maps to the UPDATE that stores its share.
	parties := map[string]string{}
	rows, err := tx.QueryContext(ctx, `
		SELECT user_id, 'UPDATE account_access SET contribution_share = ? WHERE account_id = ? AND user_id = ?' FROM account_access WHERE account_id = ?
		UNION ALL
		SELECT 'c' || id, 'UPDATE contributors SET share = ? WHERE account_id = ? AND id = ?' FROM contributors WHERE account_id = ?`, id, id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var key, update string
		if err := rows.Scan(&key, &update); err != nil {
			rows.Close()
			return err
		}
		parties[key] = update
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(shares) != len(parties) {
		return apperr.Invalid(msgEveryShare)
	}
	values := map[string]int{}
	sum := 0
	for key, n := range shares {
		if _, ok := parties[key]; !ok {
			return apperr.Invalid(msgEveryShare)
		}
		v, err := strconv.Atoi(n.String())
		if err != nil || v < 0 || v > 100 {
			return apperr.Invalid("Elk aandeel is een geheel getal van 0 tot 100.")
		}
		values[key] = v
		sum += v
	}
	if sum != 100 {
		return apperr.Invalid("De aandelen moeten samen 100 % zijn.")
	}
	for key, v := range values {
		if _, err := tx.ExecContext(ctx, parties[key], v, id, strings.TrimPrefix(key, "c")); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// resetShares puts every share of an account back to equal, the members' and
// the contributors'.
func resetShares(ctx context.Context, tx *sql.Tx, account int64) error {
	if _, err := tx.ExecContext(ctx, `UPDATE account_access SET contribution_share = NULL WHERE account_id = ?`, account); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE contributors SET share = NULL WHERE account_id = ?`, account)
	return err
}

// resetContributions takes a member's claims and link offers off an account
// and puts every share of it (contributors' too) back to equal: shares stop
// adding up when the members change. Leave, removeMember (delete user) and
// join share it.
func resetContributions(ctx context.Context, tx *sql.Tx, account, user int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM contribution_senders WHERE account_id = ? AND user_id = ?`, account, user); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE contributors SET link_user = NULL WHERE account_id = ? AND link_user = ?`, account, user); err != nil {
		return err
	}
	return resetShares(ctx, tx, account)
}

// Contributors without Saldo (0.8.1-7). A contributor is a name and the IBAN
// their transfers come from, account-level: any member with edit permission
// adds, renames, re-points and removes them; adding and removing reset every
// share to equal. The IBAN is typed (checksum) or taken by the server from an
// incoming row of this account; it is matched against this account's own rows
// only and never returned in full.

// ContributorInput is the body of a contributor write: Name, and the IBAN
// typed or from TransactionID (on an update each is optional, nil/0 = keep).
type ContributorInput struct {
	Name          *string
	IBAN          *string
	TransactionID int64
}

// contributorAccess opens a write to a shared account's contributors.
func contributorAccess(ctx context.Context, tx *sql.Tx, viewer, id int64) (access, error) {
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return a, err
	}
	if err := a.edit(); err != nil {
		return a, err
	}
	if !a.shared() {
		return a, apperr.Invalid(msgPersonalNoShare)
	}
	return a, nil
}

// contributorName trims a name of 1 to 60 characters.
func contributorName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if n := utf8.RuneCountInString(name); n < 1 || n > 60 {
		return "", apperr.Invalid("Geef een naam van 1 tot 60 tekens.")
	}
	return name, nil
}

// contributorIBAN resolves the IBAN of a write: typed (checked), or the
// sender of an incoming row of this account (the generic refusal of
// ClaimSender otherwise), and refuses one already used on this account by a
// member's sender or another contributor, with one text whoever holds it.
// An IBAN of an account in Saldo is accepted: nothing outside this account is
// looked up.
func contributorIBAN(ctx context.Context, tx *sql.Tx, id int64, in ContributorInput, self int64) (string, error) {
	var iban string
	switch {
	case in.IBAN != nil && in.TransactionID > 0:
		return "", apperr.Invalid("Geef een IBAN of een ontvangen betaling.")
	case in.IBAN != nil:
		if iban = NormalizeIBAN(*in.IBAN); !ValidIBAN(iban) {
			return "", apperr.Invalid("Dit lijkt geen geldig IBAN. Kijk het na.")
		}
	default:
		err := tx.QueryRowContext(ctx, `SELECT COALESCE(counterparty_iban, '') FROM transactions
			WHERE id = ? AND account_id = ? AND amount > 0`, in.TransactionID, id).Scan(&iban)
		if errors.Is(err, sql.ErrNoRows) {
			return "", apperr.Invalid(msgNotOwnSender)
		}
		if err != nil {
			return "", err
		}
		if iban = NormalizeIBAN(iban); iban == "" {
			return "", apperr.Invalid(msgNotOwnSender)
		}
	}
	var used bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM contribution_senders WHERE account_id = ? AND iban = ?)
		OR EXISTS (SELECT 1 FROM contributors WHERE account_id = ? AND iban = ? AND id <> ?)`, id, iban, id, iban, self).Scan(&used); err != nil {
		return "", err
	}
	if used {
		return "", apperr.Conflict(msgIBANInUse)
	}
	return iban, nil
}

// AddContributor adds a contributor without Saldo to a shared account and
// resets every share to equal. It returns the new id.
func (s *Store) AddContributor(ctx context.Context, viewer, id int64, in ContributorInput) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err := contributorAccess(ctx, tx, viewer, id); err != nil {
		return 0, err
	}
	if in.Name == nil {
		return 0, apperr.Invalid("Geef een naam van 1 tot 60 tekens.")
	}
	name, err := contributorName(*in.Name)
	if err != nil {
		return 0, err
	}
	if in.IBAN == nil && in.TransactionID <= 0 {
		return 0, apperr.Invalid("Geef een IBAN of een ontvangen betaling.")
	}
	iban, err := contributorIBAN(ctx, tx, id, in, 0)
	if err != nil {
		return 0, err
	}
	var cid int64
	if err := tx.QueryRowContext(ctx, `INSERT INTO contributors (account_id, name, iban, created_by) VALUES (?, ?, ?, ?) RETURNING id`,
		id, name, iban, viewer).Scan(&cid); err != nil {
		return 0, err
	}
	if err := resetShares(ctx, tx, id); err != nil {
		return 0, err
	}
	return cid, tx.Commit()
}

// contributorOf checks that a contributor belongs to the account: else
// apperr.ErrNotFound.
func contributorOf(ctx context.Context, tx *sql.Tx, id, contributor int64) (link sql.NullInt64, iban string, err error) {
	err = tx.QueryRowContext(ctx, `SELECT link_user, iban FROM contributors WHERE id = ? AND account_id = ?`, contributor, id).Scan(&link, &iban)
	if errors.Is(err, sql.ErrNoRows) {
		err = apperr.ErrNotFound
	}
	return link, iban, err
}

// UpdateContributor renames a contributor or changes their IBAN (shares stay).
func (s *Store) UpdateContributor(ctx context.Context, viewer, id, contributor int64, in ContributorInput) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := contributorAccess(ctx, tx, viewer, id); err != nil {
		return err
	}
	if _, _, err := contributorOf(ctx, tx, id, contributor); err != nil {
		return err
	}
	if in.Name != nil {
		name, err := contributorName(*in.Name)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE contributors SET name = ? WHERE id = ?`, name, contributor); err != nil {
			return err
		}
	}
	if in.IBAN != nil || in.TransactionID > 0 {
		iban, err := contributorIBAN(ctx, tx, id, in, contributor)
		if err != nil {
			return err
		}
		// A pending link offer showed the old IBAN: it goes (a member's sender only with her own yes to what she saw).
		if _, err := tx.ExecContext(ctx, `UPDATE contributors SET iban = ?, link_user = NULL WHERE id = ?`, iban, contributor); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RemoveContributor deletes a contributor and resets every share to equal.
func (s *Store) RemoveContributor(ctx context.Context, viewer, id, contributor int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := contributorAccess(ctx, tx, viewer, id); err != nil {
		return err
	}
	if _, _, err := contributorOf(ctx, tx, id, contributor); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM contributors WHERE id = ?`, contributor); err != nil {
		return err
	}
	if err := resetShares(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit()
}

// OfferLink is the manager's offer to link a contributor to a member of the
// account (user), or its withdrawal (user 0). Anyone but a member who may edit
// (answering needs edit), a user who does not exist included, is one invalid answer.
func (s *Store) OfferLink(ctx context.Context, viewer, id, contributor, user int64) error {
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
	if !a.shared() {
		return apperr.Invalid(msgPersonalNoShare)
	}
	if _, _, err := contributorOf(ctx, tx, id, contributor); err != nil {
		return err
	}
	var link any
	if user != 0 {
		var member bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM account_access WHERE account_id = ? AND user_id = ? AND permission = 'edit')`, id, user).Scan(&member); err != nil {
			return err
		}
		if !member {
			return apperr.Invalid(msgLinkToMember)
		}
		link = user
	}
	if _, err := tx.ExecContext(ctx, `UPDATE contributors SET link_user = ? WHERE id = ?`, link, contributor); err != nil {
		return err
	}
	return tx.Commit()
}

// AnswerLink is the offered member's answer: yes makes the contributor's IBAN
// the viewer's own contribution sender, deletes the contributor and resets
// every share to equal (one transaction); no clears the offer. A contributor
// not offered to the viewer is apperr.ErrNotFound. It tells whether it linked.
func (s *Store) AnswerLink(ctx context.Context, viewer, id, contributor int64, yes bool) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	a, err := accessOf(ctx, tx, viewer, id)
	if err != nil {
		return false, err
	}
	link, iban, err := contributorOf(ctx, tx, id, contributor)
	if err != nil {
		return false, err
	}
	if !link.Valid || link.Int64 != viewer {
		return false, apperr.ErrNotFound
	}
	if err := a.edit(); err != nil {
		return false, err
	}
	if !yes {
		if _, err := tx.ExecContext(ctx, `UPDATE contributors SET link_user = NULL WHERE id = ?`, contributor); err != nil {
			return false, err
		}
		return false, tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM contributors WHERE id = ?`, contributor); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO contribution_senders (account_id, user_id, iban) VALUES (?, ?, ?)`, id, viewer, iban); err != nil {
		return false, err
	}
	if err := resetShares(ctx, tx, id); err != nil {
		return false, err
	}
	return true, tx.Commit()
}
