package categorise

import (
	"cmp"
	"context"
	"slices"
)

// Suggestions (phase 0.4-4, CAT-5): for a counterparty the viewer has
// categorised by hand (or imported) at least MinSeen times, the category
// they chose most often, offered for the rows of that counterparty that
// still wait for a category. Computed on read; only the viewer's decision
// to confirm or dismiss one is stored (by the caller).
const (
	MinSeen       = 2
	MinConfidence = 40
)

// Group counts the rows of one raw counterparty name: of one category (the
// training rows) or, with CategoryID 0, those without a category (open).
// Newest is a key that sorts the group's newest row last.
type Group struct {
	Counterparty string
	CategoryID   int64
	Rows         int
	Newest       string
}

// Suggestion is one offered category for a normalised counterparty (Key).
// Counterparty is the raw spelling of its newest open row, Seen the number
// of training rows, Confidence the winner's share of them in percent and
// Open the rows waiting for a category.
type Suggestion struct {
	CounterpartyKey string `json:"counterpartyKey"`
	Counterparty    string `json:"counterparty"`
	CategoryID      int64  `json:"categoryId"`
	Confidence      int    `json:"confidence"`
	Seen            int    `json:"seen"`
	Open            int    `json:"open"`
}

// Suggest merges the groups per normalised counterparty and returns the
// offered suggestions: Seen >= MinSeen, Confidence >= MinConfidence, at
// least one open row, and not decided (confirmed or dismissed) before. The
// winning category has the most rows; on a tie the newest row, then the
// lower id. Order: confidence desc, open desc, key.
func Suggest(training, open []Group, decided func(key string, categoryID int64) bool) []Suggestion {
	type tally struct {
		rows   int
		newest string
	}
	cats := map[string]map[int64]*tally{}
	seen := map[string]int{}
	for _, g := range training {
		k := Normalise(g.Counterparty)
		if k == "" {
			continue
		}
		if cats[k] == nil {
			cats[k] = map[int64]*tally{}
		}
		t := cats[k][g.CategoryID]
		if t == nil {
			t = &tally{}
			cats[k][g.CategoryID] = t
		}
		t.rows += g.Rows
		t.newest = max(t.newest, g.Newest)
		seen[k] += g.Rows
	}
	type wait struct {
		rows         int
		newest, name string
	}
	waiting := map[string]*wait{}
	for _, g := range open {
		k := Normalise(g.Counterparty)
		w := waiting[k]
		if w == nil {
			w = &wait{}
			waiting[k] = w
		}
		w.rows += g.Rows
		if g.Newest > w.newest {
			w.newest, w.name = g.Newest, g.Counterparty
		}
	}
	out := []Suggestion{}
	for k, byCat := range cats {
		w := waiting[k]
		if w == nil || seen[k] < MinSeen {
			continue
		}
		var best int64
		var top tally
		for c, t := range byCat {
			if best == 0 || t.rows > top.rows || t.rows == top.rows && (t.newest > top.newest || t.newest == top.newest && c < best) {
				best, top = c, *t
			}
		}
		confidence := (200*top.rows + seen[k]) / (2 * seen[k]) // rounded half up
		if confidence < MinConfidence || decided(k, best) {
			continue
		}
		out = append(out, Suggestion{CounterpartyKey: k, Counterparty: w.name, CategoryID: best,
			Confidence: confidence, Seen: seen[k], Open: w.rows})
	}
	slices.SortFunc(out, func(a, b Suggestion) int {
		return cmp.Or(cmp.Compare(b.Confidence, a.Confidence), cmp.Compare(b.Open, a.Open), cmp.Compare(a.CounterpartyKey, b.CounterpartyKey))
	})
	return out
}

// Confirm gives the open rows (no category, no split parts) of the accounts
// whose counterparty normalises to key the category, through Assign with
// origin "suggestion", and returns how many changed. Rows with a category,
// whatever its origin, and split rows stay as they are.
func Confirm(ctx context.Context, db DB, accounts []int64, key string, categoryID int64) (int, error) {
	var ids []int64
	for _, account := range accounts {
		rows, err := db.QueryContext(ctx, `SELECT id, counterparty_name FROM transactions
			WHERE account_id = ? AND category_id IS NULL
			  AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = transactions.id)`, account)
		if err != nil {
			return 0, err
		}
		for rows.Next() {
			var id int64
			var name string
			if err := rows.Scan(&id, &name); err != nil {
				rows.Close()
				return 0, err
			}
			if Normalise(name) == key {
				ids = append(ids, id)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return 0, err
		}
	}
	n := 0
	for _, id := range ids {
		changed, err := Assign(ctx, db, id, categoryID, 0, "suggestion")
		if err != nil {
			return n, err
		}
		if changed {
			n++
		}
	}
	return n, nil
}
