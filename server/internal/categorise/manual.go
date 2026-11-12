package categorise

import (
	"context"
	"errors"
)

// ErrSplit is SetManual's answer for a transaction with split parts: its
// categories are the parts', so the row's own category is not set by hand.
var ErrSplit = errors.New("categorise: the transaction is split")

// SetManual is the single manual write of a stored transaction's category
// (phase 0.4-3): category set, origin "manual", no rule. It refuses a split
// row (ErrSplit) and reports whether the row changed; the same manual
// category again changes nothing. A rule's, a suggestion's or an imported
// category picked again by hand becomes manual.
func SetManual(ctx context.Context, db DB, txID, categoryID int64) (bool, error) {
	res, err := db.ExecContext(ctx, `UPDATE transactions SET category_id = ?1, category_origin = 'manual', rule_id = NULL
		WHERE id = ?2 AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = transactions.id)
		  AND (category_id IS NOT ?1 OR category_origin IS NOT 'manual' OR rule_id IS NOT NULL)`, categoryID, txID)
	if err != nil {
		return false, err
	}
	if n, err := res.RowsAffected(); err != nil || n > 0 {
		return n > 0, err
	}
	var split bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM transaction_splits WHERE transaction_id = ?)`, txID).Scan(&split); err != nil {
		return false, err
	}
	if split {
		return false, ErrSplit
	}
	return false, nil
}
