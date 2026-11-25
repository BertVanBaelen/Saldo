package planning_test

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// sgRender is the suggestions as "item → category" by item id, so an item
// without one shows by its absence.
func sgRender(got map[int64]int64, items map[int64]string, categories map[int64]string) string {
	var ids []int64
	for id := range got {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	var b []string
	for _, id := range ids {
		b = append(b, fmt.Sprintf("%s → %s", items[id], categories[got[id]]))
	}
	return strings.Join(b, ", ")
}

// TestSuggestCategories (plan 0.9.1-3) on planningWorld W1, today 2026-11-18:
// Huur → Wonen (both rows), Gym → Vrije tijd (the 14 October row); Krant,
// Verzekering, Water have no matched row in the window and Salaris and Toelage
// are income: no entry. Two items exist in memory only, so planningWorld and
// TestWorld stay as they are: Hema −4000 on the 3rd matches the split row of
// 3 November (parts Boodschappen −3000 and Vrije tijd −1000, one part each:
// the tie falls to the lower id, Boodschappen), and the saving item Spaarpot
// matches the Sparen row of 10 October. A row in a subcategory is suggested
// as that subcategory, not as its top.
func TestSuggestCategories(t *testing.T) {
	w := planningWorld(t)
	facts, err := planning.LoadFacts(context.Background(), w.db, w.W1, fcToday)
	if err != nil {
		t.Fatal(err)
	}
	items := map[int64]string{100: "Hema", 101: "Spaarpot", 102: "Brood"}
	for _, it := range facts.Items {
		items[it.ID] = it.Description
	}
	facts.Items = append(facts.Items,
		planning.FactItem{ID: 100, Description: "Hema", Counterparty: "Hema", Amount: -4000, Frequency: "monthly", Day: 3, Kind: "expense"},
		planning.FactItem{ID: 101, Description: "Spaarpot", Counterparty: "Spaarpot", Amount: -2000, Frequency: "monthly", Day: 10, Kind: "saving"},
		planning.FactItem{ID: 102, Description: "Brood", Counterparty: "Bakkerij Jan", Amount: -1200, Frequency: "monthly", Day: 9, Kind: "expense"})
	facts.Rows = append(facts.Rows, planning.FactRow{ID: 9000, Date: "2026-11-09", Amount: -1200, Name: "Bakkerij Jan",
		Parts: []planning.FactPart{{Category: w.cat["Boodschappen"], Amount: -1200, Variable: true, Own: w.cat["Supermarkt"]}}})

	names := fcCategories(t, w.db)
	fcCompare(t, "W1 suggestions", sgRender(planning.SuggestCategories(facts, fcToday), items, names),
		"Huur → Wonen, Gym → Vrije tijd, Hema → Boodschappen, Spaarpot → Sparen, Brood → Supermarkt")
}

// TestSuggestCategoriesRules are the counting rules on hand-built facts: the
// most parts win, a tie goes to the newest row, a pending row and a part that
// does not fit the kind or has no category do not vote, and only expense and
// saving items get a suggestion.
func TestSuggestCategoriesRules(t *testing.T) {
	row := func(id int64, date string, amount int64, name string, own int64, saving bool) planning.FactRow {
		return planning.FactRow{ID: id, Date: date, Amount: amount, Name: name,
			Parts: []planning.FactPart{{Category: own, Amount: amount, Variable: own != 0 && !saving, Saving: saving, Own: own}}}
	}
	gas := func(id int64, name string) planning.FactItem {
		return planning.FactItem{ID: id, Description: name, Counterparty: name, Amount: -5000, Frequency: "monthly", Day: 5, Kind: "expense"}
	}
	for _, c := range []struct {
		name  string
		items []planning.FactItem
		rows  []planning.FactRow
		want  string
	}{
		{"the most parts win over a newer row", []planning.FactItem{gas(1, "Eneco")},
			[]planning.FactRow{row(1, "2026-09-05", -5000, "Eneco", 10, false), row(2, "2026-10-05", -5000, "Eneco", 10, false), row(3, "2026-11-05", -5000, "Eneco", 11, false)},
			"Eneco → 10"},
		{"a tie goes to the newest row, not the lower id", []planning.FactItem{gas(1, "Eneco")},
			[]planning.FactRow{row(1, "2026-09-05", -5000, "Eneco", 10, false), row(2, "2026-10-05", -5000, "Eneco", 11, false)},
			"Eneco → 11"},
		{"a pending row does not vote", []planning.FactItem{gas(1, "Eneco")},
			[]planning.FactRow{row(1, "2026-10-05", -5000, "Eneco", 10, false), fcPending(row(2, "2026-11-10", -5000, "Eneco", 11, false))},
			"Eneco → 10"},
		{"a saving part does not vote for an expense item, nor an uncategorised one", []planning.FactItem{gas(1, "Eneco")},
			[]planning.FactRow{row(1, "2026-10-05", -5000, "Eneco", 26, true), row(2, "2026-11-05", -5000, "Eneco", 0, false)},
			""},
		{"an expense part does not vote for a saving item", []planning.FactItem{{ID: 1, Description: "Pot", Counterparty: "Pot", Amount: -5000, Frequency: "monthly", Day: 5, Kind: "saving"}},
			[]planning.FactRow{row(1, "2026-10-05", -5000, "Pot", 10, false)},
			""},
		{"income, transfer and contribution items get none", []planning.FactItem{
			{ID: 1, Description: "Loon", Counterparty: "Loon", Amount: 5000, Frequency: "monthly", Day: 5, Kind: "income"},
			{ID: 2, Description: "Naar", Counterparty: "Naar", Amount: -5000, Frequency: "monthly", Day: 5, Kind: "transfer"},
			{ID: 3, Description: "Bijdrage", Counterparty: "Bijdrage", Amount: 5000, Frequency: "monthly", Day: 5, Kind: "contribution"}},
			[]planning.FactRow{row(1, "2026-10-05", 5000, "Loon", 10, false), row(2, "2026-10-05", -5000, "Naar", 10, false), row(3, "2026-10-05", 5000, "Bijdrage", 10, false)},
			""},
	} {
		names := map[int64]string{}
		for _, it := range c.items {
			names[it.ID] = it.Description
		}
		got := sgRender(planning.SuggestCategories(fcFacts(fcToday, c.items, c.rows...), fcToday), names, map[int64]string{10: "10", 11: "11"})
		fcCompare(t, c.name, got, c.want)
	}
}

// TestSuggestCategoriesDemo (plan 0.9.1-3): the demo's Zichtrekening and
// Gedeelde rekening on 18 November. Familiale verzekering has no counterparty
// and no payment of exactly its amount, the transfer, the saving order and the
// contributions are uncategorised or no expense: no entry.
func TestSuggestCategoriesDemo(t *testing.T) {
	d := fcDemo(t)
	names := fcCategories(t, d)
	var got []string
	for _, account := range []int64{1, 4} {
		facts, err := planning.LoadFacts(context.Background(), d, account, fcToday)
		if err != nil {
			t.Fatal(err)
		}
		items := map[int64]string{}
		for _, it := range facts.Items {
			items[it.ID] = it.Description
		}
		got = append(got, sgRender(planning.SuggestCategories(facts, fcToday), items, names))
	}
	fcCompare(t, "demo suggestions", strings.Join(got, " | "), "Huur → Wonen, Netflix → Abonnementen, Spotify → Abonnementen | Energie → Wonen, Internet en tv → Abonnementen")
}
