package ledger_test

import (
	"context"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// "Telt als gespaard" (plan 0.8-0a): only a top expense category stores it, a
// subcategory reads its parent's, and a category that becomes saving, moves
// under another one or turns income loses its budgets; a merge moves budgets
// only to a top expense category that is not saving. The demo's Sparen is 26.
func TestCategorySaving(t *testing.T) {
	ctx := context.Background()
	d, s := seeded(t)
	on := ledger.Opt[bool]{Set: true, V: true}
	effective := func(id int64) bool {
		t.Helper()
		list, err := s.Categories(ctx, bert)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range list {
			if c.ID == id {
				return c.Saving
			}
		}
		t.Fatalf("category %d is gone", id)
		return false
	}
	count := func(q string, args ...any) (n int) {
		t.Helper()
		if err := d.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	budget := func(category int64) {
		t.Helper()
		if _, err := d.Exec(`INSERT INTO budgets (account_id, category_id, monthly_amount, from_month) VALUES (1, ?, 10000, '2026-10')`, category); err != nil {
			t.Fatal(err)
		}
	}
	budgets := func(category int64) int { return count(`SELECT COUNT(*) FROM budgets WHERE category_id = ?`, category) }
	update := func(id int64, in ledger.CategoryInput) ledger.TreeCategory {
		t.Helper()
		c, err := s.UpdateCategory(ctx, bert, id, in)
		if err != nil {
			t.Fatalf("update %d: %v", id, err)
		}
		return c
	}
	newTop := func(name string) int64 {
		t.Helper()
		c, err := s.CreateCategory(ctx, bert, ledger.CategoryInput{Name: ledger.Opt[string]{Set: true, V: name},
			Type: ledger.Opt[string]{Set: true, V: "expense"}, Saving: on})
		if err != nil || !c.Saving {
			t.Fatalf("create %s: %+v, %v", name, c, err)
		}
		budget(c.ID)
		return c.ID
	}

	// Set on Vrije tijd (3): its subcategory Uitgaan (17) reads it, the budgets of both go.
	budget(3)
	budget(17)
	if c := update(3, ledger.CategoryInput{Saving: on}); !c.Saving || !effective(17) || budgets(3)+budgets(17) != 0 {
		t.Errorf("flag on 3: %+v, sub %v, budgets %d %d", c, effective(17), budgets(3), budgets(17))
	}
	if count(`SELECT saving FROM categories WHERE id = 17`) != 0 {
		t.Error("a subcategory stores the flag")
	}
	for _, c := range []struct {
		id      int64
		message string
	}{{17, "Een subcategorie telt mee via haar hoofdcategorie."}, {7, "Een inkomstencategorie kan niet als gespaard tellen."}} {
		if _, err := s.UpdateCategory(ctx, bert, c.id, ledger.CategoryInput{Saving: on}); err == nil || err.Error() != apperr.Invalid(c.message).Error() {
			t.Errorf("flag on %d: %v, want %q", c.id, err, c.message)
		}
	}
	// A sub of a saving category moved to the top: false.
	if c := update(17, ledger.CategoryInput{ParentID: ledger.Opt[int64]{Set: true, Null: true}}); c.Saving {
		t.Errorf("sub to the top: %+v", c)
	}
	// A saving top moved under Wonen drops its own flag and its budget.
	pot := newTop("Pot")
	if c := update(pot, ledger.CategoryInput{ParentID: ledger.Opt[int64]{Set: true, V: 1}}); c.Saving ||
		count(`SELECT saving FROM categories WHERE id = ?`, pot) != 0 || budgets(pot) != 0 {
		t.Errorf("moved under Wonen: %+v, budgets %d", c, budgets(pot))
	}
	// A type change to income clears the flag and the budget.
	pot = newTop("Pot2")
	if c := update(pot, ledger.CategoryInput{Type: ledger.Opt[string]{Set: true, V: "income"}}); c.Saving || budgets(pot) != 0 {
		t.Errorf("to income: %+v, budgets %d", c, budgets(pot))
	}
	// Merges: into Sparen the budgets go, into Vervoer (4) they follow (the demo's own Vervoer budget stays: 2).
	budget(21)
	budget(22)
	if err := s.RemoveCategory(ctx, 21, 26); err != nil || budgets(26) != 0 {
		t.Errorf("merge into Sparen: %v, budgets %d", err, budgets(26))
	}
	if err := s.RemoveCategory(ctx, 22, 4); err != nil || budgets(4) != 2 {
		t.Errorf("merge into Vervoer: %v, budgets %d", err, budgets(4))
	}
}
