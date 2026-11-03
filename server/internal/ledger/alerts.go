package ledger

import (
	"context"
	"fmt"
	"time"
)

// Alert is one alert on Start (docs/api.md).
type Alert struct {
	Kind  string `json:"kind"` // neg, warn or ok
	Type  string `json:"type"` // consent, sync or categorise
	Title string `json:"title"`
	Note  string `json:"note"`
	Href  string `json:"href"`
}

const (
	hrefConnections   = "/bankkoppelingen"
	hrefUncategorised = "/transacties?filter=niet-gecategoriseerd"
)

// Alerts returns the viewer's alerts, errors first, then warnings, then
// information. They only cover the viewer's own connections and the accounts
// the viewer can see.
func (s *Store) Alerts(ctx context.Context, viewer int64, now time.Time) ([]Alert, error) {
	conns, err := s.Connections(ctx, viewer, now)
	if err != nil {
		return nil, err
	}
	accounts, err := s.Accounts(ctx, viewer, now)
	if err != nil {
		return nil, err
	}
	uncategorised, err := s.UncategorisedCount(ctx, viewer)
	if err != nil {
		return nil, err
	}

	var neg, warn, ok []Alert
	broken := map[int64]bool{} // the viewer's connections that already raise an error
	for _, c := range conns {
		switch c.Status {
		case ConnExpired:
			broken[c.ID] = true
			neg = append(neg, Alert{Kind: "neg", Type: "consent",
				Title: "Toestemming voor " + c.Bank + " is verlopen",
				Note:  "Synchronisatie gestopt · opnieuw autoriseren", Href: hrefConnections})
			continue
		case ConnFailed:
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
			warn = append(warn, Alert{Kind: "warn", Type: "consent", Title: title,
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
				Title: a.Name + " wordt niet meer gesynchroniseerd", Note: note, Href: hrefConnections})
		case "stale":
			title := a.Name + " is nog niet gesynchroniseerd"
			if t, ok := parseAPITime(a.LastSync); ok {
				title = a.Name + " niet bijgewerkt sinds " + whenDutch(t, now)
			}
			warn = append(warn, Alert{Kind: "warn", Type: "sync", Title: title,
				Note: bankName + " stuurde geen nieuwe gegevens · bekijk de koppeling", Href: hrefConnections})
		}
	}

	if uncategorised > 0 {
		ok = append(ok, Alert{Kind: "ok", Type: "categorise",
			Title: fmt.Sprintf("%d %s te categoriseren", uncategorised, plural(uncategorised, "transactie", "transacties")),
			Href:  hrefUncategorised})
	}
	out := append(append(neg, warn...), ok...)
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

func parseAPITime(s *string) (time.Time, bool) {
	if s == nil {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, *s)
	return t, err == nil
}
