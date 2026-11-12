package categorise

import (
	"context"
	"errors"
	"slices"
	"testing"
)

func state(t *testing.T, ctx context.Context, d DB) string {
	t.Helper()
	var s string
	if err := d.QueryRowContext(ctx, `SELECT group_concat(id || ':' || COALESCE(category_id, '-') || ':' || COALESCE(category_origin, '-') || ':' || COALESCE(rule_id, '-'), '|')
		FROM (SELECT * FROM transactions ORDER BY id)`).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSetManual(t *testing.T) {
	ctx := context.Background()
	d := ledgerDB(t)
	exec(t, d, `INSERT INTO rules (id, account_id, counterparty_match, category_id) VALUES (1, 1, 'x', 1)`)
	addTx(t, d, 1, 1, "open", nil, nil)
	addTx(t, d, 2, 1, "ruled", 1, "rule")
	exec(t, d, `UPDATE transactions SET rule_id = 1 WHERE id = 2`)
	addTx(t, d, 3, 1, "manual", 2, "manual")
	addTx(t, d, 4, 1, "import", 2, "import")
	addTx(t, d, 5, 1, "split", 2, "manual")
	exec(t, d, `INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (5, 1, -600), (5, 3, -400)`)
	for _, c := range []struct {
		tx, category int64
		want         bool
		err          error
	}{
		{1, 1, true, nil},
		{1, 1, false, nil}, // the same again: nothing
		{2, 1, true, nil},  // a rule's category picked by hand becomes manual
		{3, 2, false, nil}, // already this manual category
		{3, 3, true, nil},  // another manual category
		{4, 2, true, nil},  // an imported one picked by hand becomes manual
		{5, 1, false, ErrSplit},
		{99, 1, false, nil}, // no such row
	} {
		got, err := SetManual(ctx, d, c.tx, c.category)
		if got != c.want || !errors.Is(err, c.err) {
			t.Errorf("SetManual(%d, %d): %v, %v; want %v, %v", c.tx, c.category, got, err, c.want, c.err)
		}
	}
	if got, want := state(t, ctx, d), "1:1:manual:-|2:1:manual:-|3:3:manual:-|4:2:manual:-|5:2:manual:-"; got != want {
		t.Errorf("rows %s, want %s", got, want)
	}
}

// One engine: matches, changes and the skipped reasons of a rule over its
// accounts, with a rule that is not stored yet and with a stored one.
func TestPlanAndApply(t *testing.T) {
	ctx := context.Background()
	d := ledgerDB(t)
	exec(t, d, `INSERT INTO rules (id, user_id, priority, counterparty_match, category_id) VALUES (1, 1, 0, 'winkel', 1)`)
	exec(t, d, `INSERT INTO rules (id, account_id, priority, counterparty_match, category_id) VALUES (2, 1, 5, 'winkel noord', 3)`)
	addTx(t, d, 10, 1, "Winkel Zuid", nil, nil)
	addTx(t, d, 11, 1, "Winkel Noord", nil, nil) // rule 2 outranks
	addTx(t, d, 12, 1, "WINKEL  Óost", 1, "manual")
	addTx(t, d, 13, 1, "Winkel West", 1, "import")
	addTx(t, d, 14, 1, "Winkel Split", nil, nil)
	exec(t, d, `INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (14, 1, -600), (14, 3, -400)`)
	addTx(t, d, 15, 1, "Winkel Al", 2, "rule") // already right
	addTx(t, d, 16, 1, "Winkel Regel", 1, "rule")
	addTx(t, d, 17, 1, "Bakker", nil, nil)
	addTx(t, d, 18, 1, "winkel pending", nil, nil)
	exec(t, d, `UPDATE transactions SET status = 'pending' WHERE id = 18`)
	addTx(t, d, 19, 1, "Winkel Klik", nil, nil) // the clicked row: left out
	addTx(t, d, 20, 3, "Winkel Samen", nil, nil)
	addTx(t, d, 21, 2, "Winkel B", nil, nil)
	addTx(t, d, 22, 1, "Winkel Hand", 2, "manual") // already right, also manual

	before := state(t, ctx, d)
	for _, c := range []struct {
		name    string
		rule    Rule
		matches int
		changes []int64
		skipped Skipped
	}{
		{"new user rule", Rule{ID: PreviewID, UserID: 1, Counterparty: "Winkel", CategoryID: 2},
			9, []int64{10, 16, 18}, Skipped{Manual: 1, Import: 1, Split: 1, Rule: 1}},
		{"new account rule of the shared account", Rule{ID: PreviewID, AccountID: 3, Counterparty: "winkel", CategoryID: 2},
			1, []int64{20}, Skipped{}},
		{"user 2's rule never reaches user 1's rows", Rule{ID: PreviewID, UserID: 2, Counterparty: "winkel", CategoryID: 2},
			1, []int64{21}, Skipped{}},
		{"a stored rule with a new category takes its own rows", Rule{ID: 1, UserID: 1, Counterparty: "winkel", CategoryID: 3},
			9, []int64{10, 15, 16, 18}, Skipped{Manual: 2, Import: 1, Split: 1, Rule: 1}},
		{"exact counterparty", Rule{ID: PreviewID, UserID: 1, Counterparty: "winkel zuid", CounterpartyExact: true, CategoryID: 2},
			1, []int64{10}, Skipped{}},
		{"no category: no changes", Rule{ID: PreviewID, UserID: 1, Counterparty: "winkel"},
			9, nil, Skipped{Manual: 2, Import: 1, Split: 1, Rule: 1}},
	} {
		res, err := Plan(ctx, d, c.rule, 19)
		if err != nil {
			t.Fatal(err)
		}
		if res.Matches != c.matches || !slices.Equal(res.Changes, c.changes) || res.Skipped != c.skipped {
			t.Errorf("%s: matches %d changes %v skipped %+v; want %d %v %+v", c.name, res.Matches, res.Changes, res.Skipped,
				c.matches, c.changes, c.skipped)
		}
	}
	if got := state(t, ctx, d); got != before {
		t.Fatalf("a plan wrote: %s, was %s", got, before)
	}
	if _, err := Apply(ctx, d, Result{Rule: Rule{ID: PreviewID, CategoryID: 2}, Changes: []int64{10}}); err == nil {
		t.Error("applied a rule that is not stored")
	}

	exec(t, d, `INSERT INTO rules (id, user_id, counterparty_match, category_id) VALUES (5, 1, 'winkel', 2)`)
	r := Rule{ID: 5, UserID: 1, Counterparty: "winkel", CategoryID: 2}
	res, err := Plan(ctx, d, r, 19)
	if err != nil || !slices.Equal(res.Changes, []int64{10, 16, 18}) {
		t.Fatalf("stored rule: %v, %v", res.Changes, err)
	}
	// A row changed between plan and apply is guarded by Assign.
	exec(t, d, `UPDATE transactions SET category_id = 3, category_origin = 'manual' WHERE id = 16`)
	if n, err := Apply(ctx, d, res); err != nil || n != 2 {
		t.Errorf("apply: %d, %v; want 2", n, err)
	}
	if res, _ := Plan(ctx, d, r, 19); len(res.Changes) != 0 {
		t.Errorf("after apply: changes %v", res.Changes)
	}
	want := "10:2:rule:5|11:-:-:-|12:1:manual:-|13:1:import:-|14:-:-:-|15:2:rule:-|16:3:manual:-|17:-:-:-|18:2:rule:5|19:-:-:-|20:-:-:-|21:-:-:-|22:2:manual:-"
	if got := state(t, ctx, d); got != want {
		t.Errorf("rows %s, want %s", got, want)
	}
}
