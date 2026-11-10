package categorise

import (
	"context"
	"database/sql"
	"fmt"
	"math"
)

// PreviewID is the id a rule that is not stored yet takes in a Plan: it wins
// priority ties, like a rule created now.
const PreviewID = math.MaxInt64

// Skipped counts the rows that match a rule but stay as they are, per reason:
// a manual category, an imported one (or one of unknown origin), split parts,
// or another rule that outranks it. Rows that already have the rule's
// category count in none of them.
type Skipped struct {
	Manual int `json:"manual"`
	Import int `json:"import"`
	Split  int `json:"split"`
	Rule   int `json:"rule"`
}

// Result is what one rule does over its accounts: Matches is every stored row
// that matches its conditions (whatever its category, split or not), Changes
// the rows whose category it would change.
type Result struct {
	Rule    Rule
	Matches int
	Changes []int64
	Skipped Skipped
}

// Plan works out, without writing, what rule r does to the stored rows (pending
// too) of its accounts: an account rule's own account; for a user rule every
// account where its user is the only member and may edit (where RulesFor
// applies it). On each account r competes with the account's other rules, with
// r in place of a stored rule of the same id. The row except (0: none) is left
// out. It is the one engine of "apply to similar" and the rule preview.
func Plan(ctx context.Context, db DB, r Rule, except int64) (Result, error) {
	res := Result{Rule: r}
	accounts, err := scope(ctx, db, r)
	if err != nil {
		return res, err
	}
	alone := Prepare([]Rule{r})
	if len(alone) == 0 { // a pattern that no longer compiles matches nothing
		return res, nil
	}
	for _, account := range accounts {
		stored, err := RulesFor(ctx, db, account)
		if err != nil {
			return res, err
		}
		all := []Rule{r}
		for _, s := range stored {
			if s.ID != r.ID {
				all = append(all, s)
			}
		}
		all = Prepare(all)
		if err := planAccount(ctx, db, account, except, alone, all, &res); err != nil {
			return res, err
		}
	}
	return res, nil
}

func planAccount(ctx context.Context, db DB, account, except int64, alone, all []Rule, res *Result) error {
	rows, err := db.QueryContext(ctx, `SELECT id, counterparty_name, COALESCE(counterparty_iban, ''), communication, amount,
		    category_id, COALESCE(category_origin, ''),
		    EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = transactions.id)
		FROM transactions WHERE account_id = ? AND id <> ?`, account, except)
	if err != nil {
		return err
	}
	defer rows.Close()
	r := alone[0]
	for rows.Next() {
		var id int64
		var c Candidate
		var category sql.NullInt64
		var origin string
		var split bool
		if err := rows.Scan(&id, &c.Counterparty, &c.CounterpartyIBAN, &c.Communication, &c.Amount, &category, &origin, &split); err != nil {
			return err
		}
		if Match(alone, c) == nil {
			continue
		}
		res.Matches++
		switch {
		case split:
			res.Skipped.Split++
		case category.Valid && category.Int64 == r.CategoryID:
			// already right
		case category.Valid && origin == "manual":
			res.Skipped.Manual++
		case category.Valid && origin != "rule" && origin != "suggestion": // the guard of Eligible
			res.Skipped.Import++
		case Match(all, c).ID != r.ID:
			res.Skipped.Rule++
		case r.CategoryID != 0:
			res.Changes = append(res.Changes, id)
		}
	}
	return rows.Err()
}

// Apply writes a plan's changes through Assign (origin rule, so the guard of
// Eligible is repeated in the write) and returns how many rows changed. The
// rule must be stored.
func Apply(ctx context.Context, db DB, res Result) (int, error) {
	if res.Rule.ID == 0 || res.Rule.ID == PreviewID {
		return 0, fmt.Errorf("categorise: apply needs a stored rule")
	}
	n := 0
	for _, tx := range res.Changes {
		changed, err := Assign(ctx, db, tx, res.Rule.CategoryID, res.Rule.ID, "rule")
		if err != nil {
			return n, err
		}
		if changed {
			n++
		}
	}
	return n, nil
}

// scope is the accounts a rule applies to (see Plan).
func scope(ctx context.Context, db DB, r Rule) ([]int64, error) {
	if r.AccountID != 0 {
		return []int64{r.AccountID}, nil
	}
	rows, err := db.QueryContext(ctx, `SELECT me.account_id FROM account_access me
		WHERE me.user_id = ? AND me.permission = 'edit'
		  AND (SELECT COUNT(*) FROM account_access m WHERE m.account_id = me.account_id) = 1
		ORDER BY me.account_id`, r.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
