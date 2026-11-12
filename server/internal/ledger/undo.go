package ledger

import (
	"context"
	"database/sql"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

// Messages for an undo that has nothing to do.
const (
	msgUndone      = "Deze import is al ongedaan gemaakt."
	msgNothingToDo = "Deze import heeft niets toegevoegd, dus er valt niets ongedaan te maken."
)

// UndoPreview is what an undo would remove, counted before the user confirms
// (0.5-5). Rows are all the transactions of the batches; Changed those the
// user changed after the import: a category set by hand (origin "manual") or
// by confirming a suggestion, or a split. A rule's category is not counted
// (rules also fire during the import) and neither is a note (an imported
// note cannot be told from a typed one). Categorised is how many rows have
// a category.
type UndoPreview struct {
	Batches     int `json:"batches"`
	Rows        int `json:"rows"`
	Changed     int `json:"changed"`
	Categorised int `json:"categorised"`
}

// undoBatches finds the batches an undo of id covers, after checking that the
// viewer may edit every account involved: the batch itself, or with run every
// batch of the same file import (one file split over several accounts is one
// run: same file hash, creator and creation second). An unknown or hidden
// batch is apperr.ErrNotFound, a read-only account apperr.ErrForbidden.
// Batches that are undone already or brought nothing are left out; when none
// is left that is an invalid request with the reason.
func undoBatches(ctx context.Context, tx *sql.Tx, viewer, id int64, run bool) ([]int64, error) {
	q := `SELECT id, account_id, rows_imported, undone_at IS NOT NULL FROM import_batches WHERE id = ?1`
	if run {
		q = `SELECT r.id, r.account_id, r.rows_imported, r.undone_at IS NOT NULL FROM import_batches r
			JOIN import_batches b ON b.id = ?1 AND r.file_hash = b.file_hash AND r.created_at = b.created_at AND r.created_by IS b.created_by
			ORDER BY r.id`
	}
	rows, err := tx.QueryContext(ctx, q, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	var accounts []int64
	undone := false
	found := false
	for rows.Next() {
		var bid, account int64
		var imported int
		var gone bool
		if err := rows.Scan(&bid, &account, &imported, &gone); err != nil {
			return nil, err
		}
		found = true
		accounts = append(accounts, account)
		undone = undone || gone
		if !gone && imported > 0 {
			ids = append(ids, bid)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !found {
		return nil, apperr.ErrNotFound
	}
	for _, account := range accounts {
		a, err := accessOf(ctx, tx, viewer, account)
		if err != nil {
			return nil, err
		}
		if a.permission != "edit" {
			return nil, apperr.ErrForbidden
		}
	}
	if len(ids) == 0 {
		if undone {
			return nil, apperr.Invalid(msgUndone)
		}
		return nil, apperr.Invalid(msgNothingToDo)
	}
	return ids, nil
}

// UndoPreview counts what Undo would remove, without changing anything.
func (s *Store) UndoPreview(ctx context.Context, viewer, id int64, run bool) (UndoPreview, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return UndoPreview{}, err
	}
	defer tx.Rollback()
	ids, err := undoBatches(ctx, tx, viewer, id, run)
	if err != nil {
		return UndoPreview{}, err
	}
	p := UndoPreview{Batches: len(ids)}
	for _, b := range ids {
		var rows, changed, categorised int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*),
			COALESCE(SUM(category_origin IN ('manual', 'suggestion') OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)), 0),
			COALESCE(SUM(category_id IS NOT NULL), 0)
			FROM transactions t WHERE import_batch_id = ?`, b).Scan(&rows, &changed, &categorised); err != nil {
			return UndoPreview{}, err
		}
		p.Rows, p.Changed, p.Categorised = p.Rows+rows, p.Changed+changed, p.Categorised+categorised
	}
	return p, nil
}

// Undo removes every transaction of a batch (or, with run, of every batch of
// its file import) and marks the batches undone, all in one database
// transaction; the batch rows stay for the history. Splits and transfer
// overrides go with their transactions (ON DELETE CASCADE). Only rows with the
// batch's id are removed: manual and synced transactions, and the stored
// category mapping, stay. Categories created by the import and categories
// handed to existing transactions (0.5-4) stay too. It returns the number of
// removed transactions; errors as undoBatches.
func (s *Store) Undo(ctx context.Context, viewer, id int64, run bool, now time.Time) (batches, removed int, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()
	ids, err := undoBatches(ctx, tx, viewer, id, run)
	if err != nil {
		return 0, 0, err
	}
	for _, b := range ids {
		res, err := tx.ExecContext(ctx, `DELETE FROM transactions WHERE import_batch_id = ?`, b)
		if err != nil {
			return 0, 0, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return 0, 0, err
		}
		removed += int(n)
		if _, err := tx.ExecContext(ctx, `UPDATE import_batches SET undone_at = ? WHERE id = ?`, now.UTC().Format(time.RFC3339), b); err != nil {
			return 0, 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return len(ids), removed, nil
}
