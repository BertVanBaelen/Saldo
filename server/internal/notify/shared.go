package notify

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
)

// The shared-account messages (plan 0.9-3b steps 1 to 3): the manager's copy
// of a bank reminder, "Iemand sluit aan" and the invitation.

// managerKey is the repeat key of a bank reminder's manager variant: the
// owner's episode key and the manager.
func managerKey(conn int64, typ, state string, manager int64) string {
	return fmt.Sprintf("%s|m%d", connectionKey(conn, typ, state), manager)
}

// managerReminders delivers (or, in the baseline, suppresses) the manager
// variant of reminder d of owner o to the manager of every shared account the
// link feeds that no other healthy source covers (ledger.UncoveredShared).
// One message per manager, naming only the shared accounts as the manager
// sees them; a manager who is the owner gets the owner's message only.
func (s *Service) managerReminders(ctx context.Context, now time.Time, o owner, d due, baseline bool) error {
	risks, err := s.store.UncoveredShared(ctx, d.conn.ID, now)
	if err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	var managers []int64
	byManager := map[int64][]int64{}
	for _, r := range risks {
		if r.Manager == o.id {
			continue
		}
		if _, ok := byManager[r.Manager]; !ok {
			managers = append(managers, r.Manager)
		}
		byManager[r.Manager] = append(byManager[r.Manager], r.Account)
	}
	for _, mgr := range managers {
		accounts, err := s.store.Accounts(ctx, mgr, now)
		if err != nil {
			return err
		}
		var refs []mail.AccountRef
		var first int64
		for _, id := range byManager[mgr] {
			for _, a := range accounts {
				if a.ID == id && a.Kind == "shared" {
					refs = append(refs, accountRef(a))
					if first == 0 {
						first = id
					}
				}
			}
		}
		if len(refs) == 0 {
			continue
		}
		m := Message{User: mgr, Type: d.typ, Key: managerKey(d.conn.ID, d.typ, d.state, mgr), Account: first, State: d.state}
		if baseline {
			if err := s.suppressAll(ctx, now, m); err != nil {
				return err
			}
			continue
		}
		path := fmt.Sprintf("/rekeningen/%d", first)
		em, err := s.bankMail(d, o.name, refs, s.abs(path))
		if err != nil {
			return err
		}
		text := Text{Bank: d.conn.Bank, Account: refs[0].Name}
		if d.typ == TypeConsent {
			text.Days = *d.conn.DaysLeft
		}
		p := Payload(d.typ, text, Detail)
		p.URL, p.Tag = path, fmt.Sprintf("bank-%d", d.conn.ID)
		m.Push, m.Email = &p, &em
		if _, err := s.Deliver(ctx, now, m); err != nil {
			return err
		}
	}
	return nil
}

// "Iemand sluit aan" ------------------------------------------------------------

// notice is a member notice (addMember) for an account's manager.
type notice struct {
	id, user, account, actor int64
	created                  time.Time
}

// joinNotices are the member notices of the last EventExpiry whose recipient
// manages the account now and whose joiner is still a member: the other
// members' notices stay in-app only; a notice whose account is gone or whose
// recipient no longer manages it is dropped.
func (s *Service) joinNotices(ctx context.Context, now time.Time) ([]notice, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT n.id, n.user_id, n.account_id, n.actor_id, n.created_at FROM account_notices n
		JOIN account_access me ON me.account_id = n.account_id AND me.user_id = n.user_id AND me.role = 'manager'
		JOIN account_access j ON j.account_id = n.account_id AND j.user_id = n.actor_id
		WHERE n.type = 'member' AND n.created_at > ? ORDER BY n.id`, now.Add(-EventExpiry).UTC().Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	defer rows.Close()
	var out []notice
	for rows.Next() {
		var n notice
		var created string
		if err := rows.Scan(&n.id, &n.user, &n.account, &n.actor, &created); err != nil {
			return nil, fmt.Errorf("notify: %w", err)
		}
		if n.created, err = time.Parse(time.RFC3339, created); err != nil {
			continue
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// noticeKey is the repeat key of a member notice: its id and when it was made.
// SQLite gives a new row the highest id + 1, so a deleted newest row's id comes
// back; the moment keeps a new row from inheriting an old key.
func noticeKey(id int64, created time.Time) string {
	return fmt.Sprintf("notice:%d@%s", id, created.UTC().Format(time.RFC3339))
}

// Joined tells the manager of a shared account that someone joined it, once
// per notice (key notice:<id>), within EventExpiry of the join.
func (s *Service) Joined(ctx context.Context, now time.Time) error {
	list, err := s.joinNotices(ctx, now)
	if err != nil {
		return err
	}
	for _, n := range list {
		m := Message{User: n.user, Type: TypeJoined, Key: noticeKey(n.id, n.created), Account: n.account, Expires: n.created.Add(EventExpiry)}
		handled, err := s.handled(ctx, m)
		if err != nil || handled {
			if err != nil {
				return err
			}
			continue
		}
		if m, err = s.joinedMessage(ctx, now, m, n); errors.Is(err, apperr.ErrNotFound) || errors.Is(err, sql.ErrNoRows) {
			continue // gone between the read and now
		} else if err != nil {
			return err
		}
		if _, err := s.Deliver(ctx, now, m); err != nil {
			return err
		}
	}
	return nil
}

// baselineJoined suppresses the open member notices of the managers.
func (s *Service) baselineJoined(ctx context.Context, now time.Time) error {
	list, err := s.joinNotices(ctx, now)
	if err != nil {
		return err
	}
	for _, n := range list {
		if err := s.suppressAll(ctx, now, Message{User: n.user, Type: TypeJoined, Key: noticeKey(n.id, n.created), Account: n.account}); err != nil {
			return err
		}
	}
	return nil
}

// joinedMessage fills the push and the e-mail: the variant is read now (the
// joiner has an own link on the account: "heeft de rekening ook gekoppeld",
// else "heeft je uitnodiging aangenomen").
func (s *Service) joinedMessage(ctx context.Context, now time.Time, m Message, n notice) (Message, error) {
	a, err := s.store.Account(ctx, n.user, n.account, now)
	if err != nil {
		return m, err
	}
	var who, permission, joined, bank string
	if err := s.db.QueryRowContext(ctx, `SELECT u.display_name, x.permission, x.joined_at,
		COALESCE((SELECT c.aspsp_name FROM account_sources src JOIN provider_connections c ON c.id = src.connection_id
		          WHERE src.account_id = x.account_id AND c.user_id = x.user_id ORDER BY c.id LIMIT 1), '')
		FROM account_access x JOIN users u ON u.id = x.user_id WHERE x.account_id = ? AND x.user_id = ?`,
		n.account, n.actor).Scan(&who, &permission, &joined, &bank); err != nil {
		return m, fmt.Errorf("notify: %w", err) // sql.ErrNoRows stays visible to the caller
	}
	since, _ := time.Parse(time.RFC3339, joined)
	via := mail.JoinedByInvitation
	if bank != "" {
		via = mail.JoinedByLink
	}
	path := fmt.Sprintf("/rekeningen/%d", n.account)
	em, err := mail.MemberJoined("", mail.MemberJoinedData{Links: s.links(), Account: accountRef(a), Who: who, Bank: bank, Via: via,
		ReadOnly: permission == "read", Since: since, MembersURL: s.abs(path)})
	if err != nil {
		return m, err
	}
	p := Payload(TypeJoined, Text{Account: a.Name, Who: who}, Detail)
	p.URL, p.Tag = path, fmt.Sprintf("joined-%d", n.id)
	m.Push, m.Email = &p, &em
	return m, nil
}

// The invitation ------------------------------------------------------------

// invitation is an open invitation of the last EventExpiry.
type invitation struct {
	id, user         int64
	account, inviter string
	created          time.Time
}

func (s *Service) openInvitations(ctx context.Context, now time.Time) ([]invitation, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT i.id, i.user_id, a.name, COALESCE(u.display_name, ''), i.created_at FROM account_invitations i
		JOIN accounts a ON a.id = i.account_id LEFT JOIN users u ON u.id = i.invited_by
		WHERE i.created_at > ? ORDER BY i.id`, now.Add(-EventExpiry).UTC().Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	defer rows.Close()
	var out []invitation
	for rows.Next() {
		var i invitation
		var created string
		if err := rows.Scan(&i.id, &i.user, &i.account, &i.inviter, &created); err != nil {
			return nil, fmt.Errorf("notify: %w", err)
		}
		if i.created, err = time.Parse(time.RFC3339, created); err != nil {
			continue
		}
		if i.inviter == "" {
			i.inviter = "Iemand"
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

// invitationKey is the repeat key of an invitation: its id and when it was
// made (a withdrawn invitation's id is given to the next one, see noticeKey).
func invitationKey(id int64, created time.Time) string {
	return fmt.Sprintf("invitation:%d@%s", id, created.UTC().Format(time.RFC3339))
}

// Invitations tells an invited user about an open invitation, once (key
// invitation:<id>). A withdrawn or accepted invitation has no row and sends
// nothing, also a push that was still waiting for quiet hours to end. The
// message has no account to check: the invitee does not see it yet and
// learns only its name and the inviter's (as the alert on Start).
func (s *Service) Invitations(ctx context.Context, now time.Time) error {
	list, err := s.openInvitations(ctx, now)
	if err != nil {
		return err
	}
	for _, i := range list {
		m := Message{User: i.user, Type: TypeInvite, Key: invitationKey(i.id, i.created), Expires: i.created.Add(EventExpiry)}
		handled, err := s.handled(ctx, m)
		if err != nil || handled {
			if err != nil {
				return err
			}
			continue
		}
		path := fmt.Sprintf("/rekeningen?uitnodiging=%d", i.id)
		em, err := mail.SharedInvitation("", mail.SharedInvitationData{Links: s.links(), Inviter: i.inviter, Account: i.account, ActionURL: s.abs(path)})
		if err != nil {
			return err
		}
		p := Payload(TypeInvite, Text{Account: i.account, Who: i.inviter}, Detail)
		p.URL, p.Tag = path, fmt.Sprintf("invite-%d", i.id)
		m.Push, m.Email = &p, &em
		if _, err := s.Deliver(ctx, now, m); err != nil {
			return err
		}
	}
	return nil
}

// baselineInvite suppresses the invitations open at the upgrade.
func (s *Service) baselineInvite(ctx context.Context, now time.Time) error {
	list, err := s.openInvitations(ctx, now)
	if err != nil {
		return err
	}
	for _, i := range list {
		if err := s.suppressAll(ctx, now, Message{User: i.user, Type: TypeInvite, Key: invitationKey(i.id, i.created)}); err != nil {
			return err
		}
	}
	return nil
}
