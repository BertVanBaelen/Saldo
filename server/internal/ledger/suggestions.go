package ledger

import (
	"context"
	"database/sql"
	"errors"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// Suggestions (phase 0.4-4, docs/api.md "Suggestions"): computed on read
// from the viewer's own rows by categorise.Suggest; the viewer's decisions
// are stored in category_suggestions (user_id = the viewer).

// SuggestionInput is the body of POST /api/suggestions/confirm and /dismiss.
type SuggestionInput struct {
	CounterpartyKey string `json:"counterpartyKey"`
	CategoryID      int64  `json:"categoryId"`
}

const (
	noSplit = `NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)`
	// newest sorts a group's newest row (booking date, then id) last.
	newest = `MAX(t.booking_date || printf('%020d', t.id))`
)

// Suggestions are the suggestions offered to the viewer; nothing is written.
func (s *Store) Suggestions(ctx context.Context, viewer int64) ([]categorise.Suggestion, error) {
	return suggestions(ctx, s.db, viewer)
}

// suggestions trains on the viewer's manual and imported choices on every
// account they hold, and offers them for the rows without a category on the
// accounts they may edit.
func suggestions(ctx context.Context, q categorise.DB, viewer int64) ([]categorise.Suggestion, error) {
	training, err := groups(ctx, q, `SELECT t.counterparty_name, t.category_id, COUNT(*), `+newest+`
		FROM transactions t JOIN account_access me ON me.account_id = t.account_id AND me.user_id = ?
		JOIN categories c ON c.id = t.category_id
		WHERE t.category_origin IN ('manual', 'import') AND `+noSplit+`
		GROUP BY t.counterparty_name, t.category_id`, viewer)
	if err != nil {
		return nil, err
	}
	open, err := groups(ctx, q, `SELECT t.counterparty_name, 0, COUNT(*), `+newest+`
		FROM transactions t JOIN account_access me ON me.account_id = t.account_id AND me.user_id = ? AND me.permission = 'edit'
		WHERE t.category_id IS NULL AND `+noSplit+`
		GROUP BY t.counterparty_name`, viewer)
	if err != nil {
		return nil, err
	}
	rows, err := q.QueryContext(ctx, `SELECT counterparty_key, category_id FROM category_suggestions
		WHERE user_id = ? AND state IN ('confirmed', 'dismissed')`, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type decision struct {
		key      string
		category int64
	}
	decided := map[decision]bool{}
	for rows.Next() {
		var d decision
		if err := rows.Scan(&d.key, &d.category); err != nil {
			return nil, err
		}
		decided[d] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return categorise.Suggest(training, open, func(k string, c int64) bool { return decided[decision{k, c}] }), nil
}

func groups(ctx context.Context, q categorise.DB, query string, viewer int64) ([]categorise.Group, error) {
	rows, err := q.QueryContext(ctx, query, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []categorise.Group
	for rows.Next() {
		var g categorise.Group
		if err := rows.Scan(&g.Counterparty, &g.CategoryID, &g.Rows, &g.Newest); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// DecideSuggestion stores the viewer's decision on an offered suggestion,
// state "confirmed" or "dismissed", in one database transaction. Confirming
// first gives its open rows on the accounts the viewer may edit the category
// (categorise.Confirm) and returns how many changed. A suggestion that is not
// offered is apperr.ErrNotFound, unless the same decision is stored already
// (a repeated request changes nothing).
func (s *Store) DecideSuggestion(ctx context.Context, viewer int64, in SuggestionInput, state string) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	list, err := suggestions(ctx, tx, viewer)
	if err != nil {
		return 0, err
	}
	var found *categorise.Suggestion
	for i := range list {
		if list[i].CounterpartyKey == in.CounterpartyKey && list[i].CategoryID == in.CategoryID {
			found = &list[i]
		}
	}
	if found == nil {
		var stored string
		err := tx.QueryRowContext(ctx, `SELECT state FROM category_suggestions WHERE user_id = ? AND counterparty_key = ? AND category_id = ?`,
			viewer, in.CounterpartyKey, in.CategoryID).Scan(&stored)
		switch {
		case err == nil && stored == state:
			return 0, nil
		case err != nil && !errors.Is(err, sql.ErrNoRows):
			return 0, err
		}
		return 0, apperr.ErrNotFound
	}
	n := 0
	if state == "confirmed" {
		accounts, err := editableAccounts(ctx, tx, viewer)
		if err != nil {
			return 0, err
		}
		if n, err = categorise.Confirm(ctx, tx, accounts, found.CounterpartyKey, found.CategoryID); err != nil {
			return 0, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO category_suggestions (user_id, counterparty_key, category_id, confidence, times_seen, state)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id, counterparty_key, category_id) WHERE user_id IS NOT NULL DO UPDATE SET
		    confidence = excluded.confidence, times_seen = excluded.times_seen, state = excluded.state,
		    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		viewer, found.CounterpartyKey, found.CategoryID, found.Confidence, found.Seen, state); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}
