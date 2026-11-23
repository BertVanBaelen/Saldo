package planning

import (
	"cmp"
	"context"
	"database/sql"
	"slices"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// DetectReport is the answer of GET /api/planning/detection: every group of
// one account's rows with its runs and verdict (the real-data check).
type DetectReport struct {
	AccountID int64         `json:"accountId"`
	Groups    []DetectGroup `json:"groups"`
}

// DetectSuggestions lists the suggestions of the current accounts of the
// scope the viewer holds, by account, then seen (most first), then key.
// The scope is checked by ledger (PlanningItems), the access by the
// viewer's own account list.
func DetectSuggestions(ctx context.Context, db *sql.DB, st *ledger.Store, viewer int64, scope string, now time.Time) ([]DetectSuggestion, error) {
	if _, err := st.PlanningItems(ctx, viewer, scope); err != nil { // checks the scope
		return nil, err
	}
	accounts, err := st.Accounts(ctx, viewer, now)
	if err != nil {
		return nil, err
	}
	out := []DetectSuggestion{}
	for _, a := range accounts {
		if a.Type != "current" || scope == "persoonlijk" && a.Kind != "personal" || scope == "gedeeld" && a.Kind != "shared" {
			continue
		}
		groups, err := detectAccount(ctx, db, viewer, a, now)
		if err != nil {
			return nil, err
		}
		var mine []DetectSuggestion
		for _, g := range groups {
			if g.Suggestion != nil {
				mine = append(mine, *g.Suggestion)
			}
		}
		// groups come by key; keep that order among equal counts
		slices.SortStableFunc(mine, func(x, y DetectSuggestion) int { return cmp.Compare(y.Seen, x.Seen) })
		out = append(out, mine...)
	}
	return out, nil
}

// DetectionReport is the detection report of one current account the viewer
// holds: another user's account (of any type) is apperr.ErrNotFound, one of
// the viewer's own that is not a current account is "Kies een
// betaalrekening.".
func DetectionReport(ctx context.Context, db *sql.DB, st *ledger.Store, viewer, account int64, now time.Time) (DetectReport, error) {
	a, err := st.Account(ctx, viewer, account, now)
	if err != nil {
		return DetectReport{}, err
	}
	if a.Type != "current" {
		return DetectReport{}, apperr.Invalid("Kies een betaalrekening.")
	}
	groups, err := detectAccount(ctx, db, viewer, a, now)
	if err != nil {
		return DetectReport{}, err
	}
	return DetectReport{AccountID: account, Groups: groups}, nil
}

// detectAccount reads one account's booked rows (with the saving flag of
// their top category) and the facts its kinds depend on, and runs Detect.
func detectAccount(ctx context.Context, db *sql.DB, viewer int64, a ledger.Account, now time.Time) ([]DetectGroup, error) {
	today := now.In(clock.Brussels).Format(time.DateOnly)
	acc := DetectAccount{ID: a.ID, Shared: a.Kind == "shared"}
	if acc.Shared {
		acc.Senders = map[string]bool{}
		// The members' senders and the contributors without Saldo (0.8.1-7): both pay contributions.
		if err := detectQuery(ctx, db, `SELECT iban, '' FROM contribution_senders WHERE account_id = ?
			UNION ALL SELECT iban, '' FROM contributors WHERE account_id = ?`, func(iban, _ string) {
			acc.Senders[ledger.NormalizeIBAN(iban)] = true
		}, a.ID, a.ID); err != nil {
			return nil, err
		}
	} else {
		acc.OwnSavings, acc.OwnCurrent = map[string]bool{}, map[string]bool{}
		if err := detectQuery(ctx, db, `SELECT COALESCE(a.iban, ''), a.type FROM account_access x JOIN accounts a ON a.id = x.account_id
			WHERE x.user_id = ? AND a.id <> ?`, func(iban, typ string) {
			if iban = ledger.NormalizeIBAN(iban); iban == "" {
				return
			}
			if typ == "current" {
				acc.OwnCurrent[iban] = true
			} else {
				acc.OwnSavings[iban] = true
			}
		}, viewer, a.ID); err != nil {
			return nil, err
		}
	}
	rows, err := db.QueryContext(ctx, `SELECT t.booking_date, t.amount, t.counterparty_name, COALESCE(t.counterparty_iban, ''),
		COALESCE(p.saving, c.saving, 0) = 1
		FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
		WHERE t.account_id = ? AND t.status = 'booked' AND t.amount <> 0 AND t.booking_date <= ?
		ORDER BY t.booking_date, t.id`, a.ID, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []DetectRow
	for rows.Next() {
		var r DetectRow
		if err := rows.Scan(&r.Date, &r.Amount, &r.Name, &r.IBAN, &r.Saving); err != nil {
			return nil, err
		}
		r.IBAN = ledger.NormalizeIBAN(r.IBAN)
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items, err := db.QueryContext(ctx, `SELECT counterparty, COALESCE(counterparty_iban, ''), amount, state FROM recurring_items WHERE account_id = ?`, a.ID)
	if err != nil {
		return nil, err
	}
	defer items.Close()
	var own []DetectItem
	for items.Next() {
		var it DetectItem
		if err := items.Scan(&it.Counterparty, &it.IBAN, &it.Amount, &it.State); err != nil {
			return nil, err
		}
		it.IBAN = ledger.NormalizeIBAN(it.IBAN)
		own = append(own, it)
	}
	if err := items.Err(); err != nil {
		return nil, err
	}
	return Detect(today, acc, list, own), nil
}

// detectQuery runs a query of two text columns and hands each row to f.
func detectQuery(ctx context.Context, db *sql.DB, q string, f func(a, b string), args ...any) error {
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var a, b string
		if err := rows.Scan(&a, &b); err != nil {
			return err
		}
		f(a, b)
	}
	return rows.Err()
}
