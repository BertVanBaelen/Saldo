package ledger

import (
	"context"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// Backfill (phase 0.5-6, docs/api.md "Suggestions"): categorise the rows that
// still wait, from the learned history. It is the offered suggestions (the
// same categorise.Suggest, so the same training, thresholds and decisions)
// seen as one list with a preview, and applied for the groups the viewer
// picks through categorise.Confirm (Assign, origin "suggestion"). It stores
// nothing of its own: no decision, no rule, and no batch, so an undo of an
// import does not touch it.

const (
	// BackfillMaxRows is the most rows one apply categorises; more is refused.
	BackfillMaxRows = 2000
	// BackfillMaxItems is the most groups one apply may name.
	BackfillMaxItems = 200
	// backfillExamples is the number of example rows shown per group.
	backfillExamples = 3
)

// BackfillCategory is the proposed category of a group.
type BackfillCategory struct {
	ID     int64   `json:"id"`
	Name   string  `json:"name"`
	Icon   *string `json:"icon"`
	Colour string  `json:"colour"`
}

// BackfillExample is one waiting row of a group: no raw payload, no card text.
type BackfillExample struct {
	Date   string `json:"date"`
	Amount int64  `json:"amount"`
}

// BackfillGroup is what the backfill would do for one counterparty (the
// newest spelling, with the normalised key).
type BackfillGroup struct {
	CounterpartyKey string            `json:"counterpartyKey"`
	Counterparty    string            `json:"counterparty"`
	Category        BackfillCategory  `json:"category"`
	Level           string            `json:"level"`
	Confidence      int               `json:"confidence"`
	Rows            int               `json:"rows"`
	Examples        []BackfillExample `json:"examples"`
}

// BackfillPreview is the answer of GET /api/suggestions/backfill: Rows would
// be categorised, Left stay without a category; Limit is the most rows and
// GroupLimit the most groups one apply takes.
type BackfillPreview struct {
	Groups     []BackfillGroup `json:"groups"`
	Rows       int             `json:"rows"`
	Left       int             `json:"left"`
	Limit      int             `json:"limit"`
	GroupLimit int             `json:"groupLimit"`
}

// BackfillInput is the body of POST /api/suggestions/backfill: the groups the
// viewer confirmed.
type BackfillInput struct {
	Items []SuggestionInput `json:"items"`
}

// BackfillResult is the answer of POST /api/suggestions/backfill: rows
// categorised, groups applied and groups that no longer match what the
// learning proposes ("niet meer geldig"), which are skipped.
type BackfillResult struct {
	Categorised int `json:"categorised"`
	Groups      int `json:"groups"`
	Stale       int `json:"stale"`
}

// BackfillPreview lists the groups that would be categorised; nothing is written.
func (s *Store) BackfillPreview(ctx context.Context, viewer int64) (BackfillPreview, error) {
	list, err := suggestions(ctx, s.db, viewer)
	if err != nil {
		return BackfillPreview{}, err
	}
	cats, err := s.db.QueryContext(ctx, `SELECT id, name, icon, colour FROM categories`)
	if err != nil {
		return BackfillPreview{}, err
	}
	defer cats.Close()
	byID := map[int64]BackfillCategory{}
	for cats.Next() {
		var c BackfillCategory
		if err := cats.Scan(&c.ID, &c.Name, &c.Icon, &c.Colour); err != nil {
			return BackfillPreview{}, err
		}
		byID[c.ID] = c
	}
	if err := cats.Err(); err != nil {
		return BackfillPreview{}, err
	}
	out := BackfillPreview{Groups: make([]BackfillGroup, len(list)), Limit: BackfillMaxRows, GroupLimit: BackfillMaxItems}
	byKey := map[string]*BackfillGroup{}
	for i, sg := range list {
		out.Groups[i] = BackfillGroup{CounterpartyKey: sg.CounterpartyKey, Counterparty: sg.Counterparty, Category: byID[sg.CategoryID],
			Level: sg.Level, Confidence: sg.Confidence, Rows: sg.Open, Examples: []BackfillExample{}}
		byKey[sg.CounterpartyKey] = &out.Groups[i]
		out.Rows += sg.Open
	}
	// One pass over the waiting rows, newest first: the examples and the total.
	rows, err := s.db.QueryContext(ctx, `SELECT t.counterparty_name, t.booking_date, t.amount
		FROM transactions t JOIN account_access me ON me.account_id = t.account_id AND me.user_id = ? AND me.permission = 'edit'
		WHERE t.category_id IS NULL AND `+noSplit+`
		ORDER BY t.booking_date DESC, t.id DESC`, viewer)
	if err != nil {
		return BackfillPreview{}, err
	}
	defer rows.Close()
	total := 0
	for rows.Next() {
		var name string
		var e BackfillExample
		if err := rows.Scan(&name, &e.Date, &e.Amount); err != nil {
			return BackfillPreview{}, err
		}
		total++
		if g := byKey[categorise.Normalise(name)]; g != nil && len(g.Examples) < backfillExamples {
			g.Examples = append(g.Examples, e)
		}
	}
	out.Left = total - out.Rows
	return out, rows.Err()
}

// Backfill categorises, in one database transaction, the waiting rows of the
// groups the viewer picked. Each pair is checked against what the learning
// proposes now; one that does not match is skipped and counted as stale (a
// pair named twice counts once). More than BackfillMaxRows rows in one call is refused
// (apperr.Invalid) before anything is written. Only rows without a category
// and without splits on accounts the viewer may edit change (Confirm).
func (s *Store) Backfill(ctx context.Context, viewer int64, in BackfillInput) (BackfillResult, error) {
	if len(in.Items) == 0 || len(in.Items) > BackfillMaxItems {
		return BackfillResult{}, apperr.Invalid("Kies minstens één en hoogstens 200 groepen.")
	}
	for _, it := range in.Items {
		if it.CounterpartyKey == "" || len(it.CounterpartyKey) > 200 || it.CategoryID <= 0 {
			return BackfillResult{}, apperr.Invalid("De gegevens kloppen niet.")
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return BackfillResult{}, err
	}
	defer tx.Rollback()
	list, err := suggestions(ctx, tx, viewer)
	if err != nil {
		return BackfillResult{}, err
	}
	current := map[SuggestionInput]int{}
	for _, sg := range list {
		current[SuggestionInput{sg.CounterpartyKey, sg.CategoryID}] = sg.Open
	}
	var out BackfillResult
	var todo []SuggestionInput
	rows := 0
	named := map[SuggestionInput]bool{}
	for _, it := range in.Items {
		if named[it] {
			continue // a pair named twice counts once
		}
		named[it] = true
		open, ok := current[it]
		if !ok {
			out.Stale++
			continue
		}
		rows += open
		todo = append(todo, it)
	}
	if rows > BackfillMaxRows {
		return BackfillResult{}, apperr.Invalid("Dat zijn te veel transacties in één keer. Kies minder groepen (hoogstens 2000 transacties).")
	}
	accounts, err := editableAccounts(ctx, tx, viewer)
	if err != nil {
		return BackfillResult{}, err
	}
	for _, it := range todo {
		n, err := categorise.Confirm(ctx, tx, accounts, it.CounterpartyKey, it.CategoryID)
		if err != nil {
			return BackfillResult{}, err
		}
		out.Categorised += n
		out.Groups++
	}
	return out, tx.Commit()
}
