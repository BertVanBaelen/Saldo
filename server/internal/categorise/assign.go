package categorise

import (
	"context"
	"fmt"
)

// Eligible is the SQL condition (on the table transactions) of a row an
// automatic writer may change: no split parts, and no category yet or one
// that a rule or a suggestion set. 'manual', 'import' and unknown origins
// are never changed automatically.
const Eligible = `NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = transactions.id)
	AND (transactions.category_id IS NULL OR transactions.category_origin IN ('rule', 'suggestion'))`

// Assign is the single automatic write of a stored transaction's category
// (origin "rule" with its rule, or "suggestion" with ruleID 0). It writes
// only when the row is Eligible at the moment of the write and something
// changes; a suggestion never replaces a rule's category (precedence:
// manual > rule > suggestion). It reports whether the row changed.
func Assign(ctx context.Context, db DB, txID, categoryID, ruleID int64, origin string) (bool, error) {
	guard := Eligible
	var rule any
	switch origin {
	case "rule":
		if ruleID == 0 {
			return false, fmt.Errorf("categorise: a rule category needs its rule")
		}
		rule = ruleID
	case "suggestion":
		guard += ` AND (transactions.category_id IS NULL OR transactions.category_origin = 'suggestion')`
	default:
		return false, fmt.Errorf("categorise: %q is not an automatic origin", origin)
	}
	res, err := db.ExecContext(ctx, `UPDATE transactions SET category_id = ?1, category_origin = ?2, rule_id = ?3
		WHERE id = ?4 AND `+guard+`
		  AND (category_id IS NOT ?1 OR category_origin IS NOT ?2 OR rule_id IS NOT ?3)`, categoryID, origin, rule, txID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ApplyAccount runs the rules that apply to an account over its eligible
// rows and returns how many changed. A row no rule matches keeps what it
// has; running it again changes nothing.
func ApplyAccount(ctx context.Context, db DB, accountID int64) (int, error) {
	rules, err := RulesFor(ctx, db, accountID)
	if err != nil || len(rules) == 0 {
		return 0, err
	}
	rows, err := db.QueryContext(ctx, `SELECT id, counterparty_name, COALESCE(counterparty_iban, ''), communication, amount
		FROM transactions WHERE account_id = ? AND `+Eligible, accountID)
	if err != nil {
		return 0, err
	}
	type hit struct{ tx, category, rule int64 }
	var hits []hit
	for rows.Next() {
		var id int64
		var c Candidate
		if err := rows.Scan(&id, &c.Counterparty, &c.CounterpartyIBAN, &c.Communication, &c.Amount); err != nil {
			rows.Close()
			return 0, err
		}
		if r := Match(rules, c); r != nil {
			hits = append(hits, hit{id, r.CategoryID, r.ID})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, h := range hits {
		changed, err := Assign(ctx, db, h.tx, h.category, h.rule, "rule")
		if err != nil {
			return n, err
		}
		if changed {
			n++
		}
	}
	return n, nil
}
