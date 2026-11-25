package notify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// "Bijdrage ontbreekt" (plan 0.9-3b step 5 and the 0.8.1 note, README decision
// 6): once a day from 07:00 Brussels, from the 3rd of the month on. For each
// shared account with at least two parties (members and contributors without
// Saldo) and a running-month need above 0, each party's required part
// (planning.MemberPart, as the Bijdragen card) against what arrived this
// month (ledger.AccountContributions). A member below their part is told
// ("Je bijdrage van € 436 is er nog niet") and so is every manager other than
// that member ("Partners bijdrage is er nog niet"); a contributor without
// Saldo has no channel, so only the managers are told. Once per account,
// month and party. Not in the month the member joined (or the contributor was
// added), not for a share or a need of 0; a member who left is no party any
// more. The messages name the account and the month, never a personal
// account. Default off/off: most rows are suppressed.

const (
	contribHour    = 7
	contribFromDay = 3
	contribCutoff  = 10 // as planningCutoff
)

func contribKey(account int64, month, party string) string {
	return fmt.Sprintf("contrib:%d|%s|%s", account, month, party)
}

// Contrib runs the contribution check when it is due at now.
func (s *Service) Contrib(ctx context.Context, now time.Time) error {
	local := now.In(clock.Brussels)
	today := local.Format(time.DateOnly)
	if local.Hour() < contribHour || local.Day() < contribFromDay {
		return nil
	}
	day, err := s.runDay(ctx, "contrib")
	if err != nil || day == today {
		return err
	}
	if err := s.contrib(ctx, now, false); err != nil && local.Hour() < contribCutoff {
		return err
	} else if err != nil {
		s.log.Warn("contribution check: not everything went out; the rest is tried tomorrow", "error", err)
		return errors.Join(err, s.setRunDay(ctx, "contrib", today))
	}
	return s.setRunDay(ctx, "contrib", today)
}

// baselineContrib suppresses the contributions missing at the upgrade (from
// the 3rd of the month; before it nothing is missing yet).
func (s *Service) baselineContrib(ctx context.Context, now time.Time) error {
	if now.In(clock.Brussels).Day() < contribFromDay {
		return nil
	}
	return s.contrib(ctx, now, true)
}

// contribParty is one who owes a part: a member (user) or a contributor.
type contribParty struct {
	key      string // the last part of the repeat key: the user id or c<id>
	user     int64  // 0 for a contributor
	name     string
	share    *int
	received int64
	since    string // joined (member) or added (contributor), RFC 3339
}

func (s *Service) contrib(ctx context.Context, now time.Time, baseline bool) error {
	local := now.In(clock.Brussels)
	today, month := local.Format(time.DateOnly), local.Format("2006-01")
	rows, err := s.db.QueryContext(ctx, `SELECT a.id FROM accounts a WHERE a.type = 'current'
		AND (a.shared = 1 OR (SELECT COUNT(*) FROM account_access x WHERE x.account_id = a.id) > 1) ORDER BY a.id`)
	if err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	var accounts []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("notify: %w", err)
		}
		accounts = append(accounts, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("notify: %w", err)
	}

	var failed []error
	for _, id := range accounts {
		ac, err := s.store.AccountContributions(ctx, id, month)
		if err != nil {
			return fmt.Errorf("notify: %w", err)
		}
		var parties []contribParty
		var managers []int64
		for _, m := range ac.Members {
			parties = append(parties, contribParty{fmt.Sprint(m.UserID), m.UserID, m.Name, m.Share, m.Received, m.JoinedAt})
			if m.Role == "manager" {
				managers = append(managers, m.UserID)
			}
		}
		for _, c := range ac.Contributors {
			parties = append(parties, contribParty{fmt.Sprintf("c%d", c.ID), 0, c.Name, c.Share, c.Received, c.CreatedAt})
		}
		if len(parties) < 2 {
			continue
		}
		f, err := planning.Forecast(ctx, s.db, id, today, 0)
		if errors.Is(err, planning.ErrNoBalance) {
			continue
		}
		if err != nil {
			s.log.Error("contribution check: forecast failed", "account", id, "error", err)
			failed = append(failed, fmt.Errorf("account %d: %w", id, err))
			continue
		}
		if len(f.Months) == 0 || f.Months[0].Month != month || f.Months[0].Need.Amount <= 0 {
			continue
		}
		need := f.Months[0].Need.Amount
		for _, p := range parties {
			_, required := planning.MemberPart(need, p.share, len(parties))
			if required <= 0 || p.received >= required || sameMonth(p.since, month) {
				continue
			}
			var recipients []int64
			if p.user != 0 {
				recipients = append(recipients, p.user)
			}
			for _, mgr := range managers {
				if mgr != p.user {
					recipients = append(recipients, mgr)
				}
			}
			for _, r := range recipients {
				m := Message{User: r, Type: TypeContrib, Key: contribKey(id, month, p.key), Account: id, Month: month}
				if baseline {
					if err := s.suppressAll(ctx, now, m); err != nil {
						return err
					}
					continue
				}
				handled, err := s.handled(ctx, m)
				if err != nil {
					return err
				}
				if handled {
					continue
				}
				m, ok, err := s.contribMessage(ctx, now, m, p, required, r == p.user)
				if err != nil {
					return err
				}
				if !ok {
					continue
				}
				if _, err := s.Deliver(ctx, now, m); err != nil {
					return err
				}
			}
		}
	}
	return errors.Join(failed...)
}

// sameMonth reports whether the RFC 3339 moment at falls in month (Brussels).
func sameMonth(at, month string) bool {
	t, err := time.Parse(time.RFC3339, at)
	return err == nil && t.In(clock.Brussels).Format("2006-01") == month
}

// contribMessage fills the push and the e-mail for recipient m.User: the
// member's own variant (self) or the manager's. ok is false when the
// recipient no longer sees the account.
func (s *Service) contribMessage(ctx context.Context, now time.Time, m Message, p contribParty, required int64, self bool) (Message, bool, error) {
	a, err := s.store.Account(ctx, m.User, m.Account, now)
	if errors.Is(err, apperr.ErrNotFound) {
		return m, false, nil
	}
	if err != nil {
		return m, false, err
	}
	month, err := time.ParseInLocation("2006-01", m.Month, clock.Brussels)
	if err != nil {
		return m, false, fmt.Errorf("notify: month %q: %w", m.Month, err)
	}
	path := fmt.Sprintf("/rekeningen/%d", m.Account)
	em, err := mail.ContributionMissing("", mail.ContributionMissingData{Links: s.links(), Account: accountRef(a), Member: p.name,
		Required: required, Received: p.received, Month: month.Month(), ForSelf: self, ActionURL: s.abs(path)})
	if err != nil {
		return m, false, err
	}
	pl := Payload(TypeContrib, Text{Account: a.Name, Month: ledger.MonthLabel(m.Month, m.Month), Amount: required - p.received}, Detail)
	pl.URL, pl.Tag = path, fmt.Sprintf("contrib-%d-%s", m.Account, p.key)
	m.Push, m.Email = &pl, &em
	return m, true, nil
}
