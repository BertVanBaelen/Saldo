package ledger

import (
	"context"
	"fmt"
	"time"
)

// Alert is one alert on Start (docs/api.md).
type Alert struct {
	Kind      string `json:"kind"` // neg, warn or ok
	Type      string `json:"type"` // consent, sync, categorise, member, rules, left, manager, deleted, invite or planning
	Title     string `json:"title"`
	Note      string `json:"note"`
	Href      string `json:"href"`
	AccountID int64  `json:"accountId,omitempty"` // only the alerts about one account that still exists (types sync, member, rules, left, manager, planning)
	// NoticeID is the stored notice behind the alert (types member, rules,
	// left, manager and deleted); POST /api/notices/{id}/read dismisses it.
	NoticeID int64 `json:"noticeId,omitempty"`
	// InvitationID is the open invitation behind an invite alert (0.8-0b):
	// POST /api/invitations/{id}/accept or DELETE /api/invitations/{id}.
	InvitationID int64 `json:"invitationId,omitempty"`
}

const (
	hrefConnections   = "/bankkoppelingen"
	hrefUncategorised = "/transacties?filter=niet-gecategoriseerd"
)

// Alerts returns the viewer's alerts, errors first, then warnings (stale
// accounts before the consent that is ending), then information. They only
// cover the viewer's own connections and the accounts the viewer can see. The
// scope ("", "alles", "persoonlijk" or "gedeeld", else an apperr.Invalid)
// narrows only the "te categoriseren" count: the alerts about one account
// carry its id and the client hides them when it is outside the scope.
// planning are the forecast alerts (0.8-4), computed by the server layer
// because ledger does not import planning; they come after the stale
// accounts (alert 3 of analysis/screens/start.md), before the consent that is
// ending.
func (s *Store) Alerts(ctx context.Context, viewer int64, scope string, now time.Time, planning ...Alert) ([]Alert, error) {
	conns, err := s.Connections(ctx, viewer, now)
	if err != nil {
		return nil, err
	}
	accounts, err := s.Accounts(ctx, viewer, now)
	if err != nil {
		return nil, err
	}
	uncategorised, err := s.UncategorisedCount(ctx, viewer, scope)
	if err != nil {
		return nil, err
	}
	noticeWarn, noticeInfo, err := s.noticeAlerts(ctx, viewer)
	if err != nil {
		return nil, err
	}
	invites, err := s.invitationAlerts(ctx, viewer, now)
	if err != nil {
		return nil, err
	}

	var neg, stale, consent, ok []Alert
	broken := map[int64]bool{} // the viewer's connections that already raise an error
	for _, c := range conns {
		switch c.Status {
		case ConnExpired:
			broken[c.ID] = true
			neg = append(neg, Alert{Kind: "neg", Type: "consent",
				Title: "Toestemming voor " + c.Bank + " is verlopen",
				Note:  "Synchronisatie gestopt · opnieuw autoriseren", Href: hrefConnections})
			continue
		case ConnPending:
			continue // linking not finished: no dates, nothing synced yet
		}
		switch {
		case c.Stopped(now):
			// Failing or silent for three days: the same verdict as the
			// "Synchronisatie gestopt" mail.
			broken[c.ID] = true
			note := "Nog nooit gesynchroniseerd · bekijk de koppeling"
			if c.LastSync != nil {
				note = "Niet bijgewerkt sinds " + whenDutch(c.lastGood, now) + " · bekijk de koppeling"
			}
			neg = append(neg, Alert{Kind: "neg", Type: "sync",
				Title: "Synchronisatie gestopt · " + c.Bank, Note: note, Href: hrefConnections})
		case c.Status == ConnFailed:
			broken[c.ID] = true
			note := "Bekijk de koppeling"
			if !c.lastAttempt.IsZero() {
				note = "Laatste poging " + whenDutch(c.lastAttempt, now) + " · bekijk de koppeling"
			}
			neg = append(neg, Alert{Kind: "neg", Type: "sync",
				Title: "Synchronisatie mislukt · " + c.Bank, Note: note, Href: hrefConnections})
		}
		if c.DaysLeft != nil && *c.DaysLeft >= 0 && *c.DaysLeft <= ConsentWarnDays {
			title := fmt.Sprintf("Toestemming verloopt over %d %s", *c.DaysLeft, plural(*c.DaysLeft, "dag", "dagen"))
			if *c.DaysLeft == 0 {
				title = "Toestemming verloopt vandaag"
			}
			consent = append(consent, Alert{Kind: "warn", Type: "consent", Title: title,
				Note: c.Bank + " · opnieuw autoriseren", Href: hrefConnections})
		}
	}

	for _, a := range accounts {
		if a.Source != "bank" || a.SyncStatus == nil {
			continue
		}
		bankName := "De bank"
		if a.Bank != nil {
			bankName = *a.Bank
		}
		switch *a.SyncStatus {
		case "failed":
			if coveredBy(a.sources, broken) {
				continue
			}
			note := bankName + " · bekijk de koppeling"
			if t, ok := parseAPITime(a.LastSync); ok {
				note = "Laatst bijgewerkt " + whenDutch(t, now) + " · bekijk de koppeling"
			}
			neg = append(neg, Alert{Kind: "neg", Type: "sync",
				Title: a.Name + " wordt niet meer gesynchroniseerd", Note: note, Href: hrefConnections, AccountID: a.ID})
		case "stale":
			if coveredBy(a.sources, broken) {
				continue
			}
			title := a.Name + " is nog niet gesynchroniseerd"
			if t, ok := parseAPITime(a.LastSync); ok {
				title = a.Name + " niet bijgewerkt sinds " + whenDutch(t, now)
			}
			stale = append(stale, Alert{Kind: "warn", Type: "sync", Title: title,
				Note: bankName + " stuurde geen nieuwe gegevens · bekijk de koppeling", Href: hrefConnections, AccountID: a.ID})
		}
	}

	ok = append(append(ok, invites...), noticeInfo...)
	if uncategorised > 0 {
		ok = append(ok, Alert{Kind: "ok", Type: "categorise",
			Title: fmt.Sprintf("%d %s te categoriseren", uncategorised, plural(uncategorised, "transactie", "transacties")),
			Href:  hrefUncategorised})
	}
	out := append(append(append(append(append(neg, stale...), planning...), consent...), noticeWarn...), ok...)
	if out == nil {
		out = []Alert{}
	}
	return out, nil
}

func coveredBy(sources []int64, broken map[int64]bool) bool {
	for _, id := range sources {
		if broken[id] {
			return true
		}
	}
	return false
}

// SharedAtRisk is a shared account that a connection feeds and that no other
// healthy source covers, with its manager (0.9-3b, risk 5b).
type SharedAtRisk struct {
	Account int64
	Manager int64
}

// UncoveredShared lists the shared accounts (IsShared: the flag or more than
// one member) that connection feeds and that no other healthy source covers:
// another source of the account, on another connection, whose own status is
// ok and whose connection's status (as its owner's Connections computes it) is
// ok. It is the counterpart of coveredBy: that one hides an account's alert
// when a broken connection already explains it, this one tells who depends on
// a broken connection. Ordered by account.
func (s *Store) UncoveredShared(ctx context.Context, connection int64, now time.Time) ([]SharedAtRisk, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, m.user_id FROM account_sources src
		JOIN accounts a ON a.id = src.account_id
		JOIN account_access m ON m.account_id = a.id AND m.role = 'manager'
		WHERE src.connection_id = ?
		  AND (a.shared = 1 OR (SELECT COUNT(*) FROM account_access x WHERE x.account_id = a.id) > 1)
		ORDER BY a.id`, connection)
	if err != nil {
		return nil, err
	}
	var list []SharedAtRisk
	for rows.Next() {
		var r SharedAtRisk
		if err := rows.Scan(&r.Account, &r.Manager); err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	healthy := map[int64]bool{} // connection id → status ok, per owner's view
	owners := map[int64]bool{}  // owners whose connections are loaded
	var out []SharedAtRisk
	for _, r := range list {
		others, err := s.db.QueryContext(ctx, `
			SELECT c.id, c.user_id FROM account_sources src JOIN provider_connections c ON c.id = src.connection_id
			WHERE src.account_id = ? AND src.connection_id <> ? AND src.status = 'ok' AND c.status = 'active'`, r.Account, connection)
		if err != nil {
			return nil, err
		}
		type other struct{ id, owner int64 }
		var cands []other
		for others.Next() {
			var o other
			if err := others.Scan(&o.id, &o.owner); err != nil {
				others.Close()
				return nil, err
			}
			cands = append(cands, o)
		}
		others.Close()
		if err := others.Err(); err != nil {
			return nil, err
		}
		covered := false
		for _, o := range cands {
			if !owners[o.owner] {
				conns, err := s.Connections(ctx, o.owner, now)
				if err != nil {
					return nil, err
				}
				for _, c := range conns {
					healthy[c.ID] = c.Status == ConnOK
				}
				owners[o.owner] = true
			}
			if healthy[o.id] {
				covered = true
				break
			}
		}
		if !covered {
			out = append(out, r)
		}
	}
	return out, nil
}

func parseAPITime(s *string) (time.Time, bool) {
	if s == nil {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, *s)
	return t, err == nil
}
