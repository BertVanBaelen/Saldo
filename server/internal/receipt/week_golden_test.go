package receipt

import (
	"encoding/json"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/demo"
)

// weekGolden is the receipt of the week 9-15 November 2026 on the demo (Bert, scope
// alles, today 2026-11-18), the figures of plan 0.9-3c step 5. They were derived by
// the lead on 24 Nov 2026 with a throwaway script that sums the raw rows of
// `GET /api/transactions` for both weeks (skipping transfers, rolling subcategories
// up to their top category, uncategorised outflow as its own row) and never reads
// the report code: week 46 spent 259,16 (Boodschappen 82,84, Vrije tijd 66,90,
// Abonnementen 56,97, niet gecategoriseerd 32,85, Vervoer 19,60) with no income and
// nothing saved; the week before (2-8 November) took in 2.850,00 (the salary) and
// spent 268,98, so Boodschappen is +16 % (82,84 against 71,58), Vervoer -63 %
// (19,60 against 52,40), the total -4 %, and the new groups are "nieuw". Wonen
// (145,00, paid in the previous week) is in the previous total but has no row now.
// `stand` and `emoji` are left out: the first is the clock, the second is decoration.
const weekGolden = `{
  "period": "week", "from": "2026-11-09", "to": "2026-11-15", "label": "Week 46 · 9–15 nov 2026",
  "scope": "alles", "scopeLabel": "Alle rekeningen samen · ter info", "running": false, "partialFrom": null,
  "income": {"total": 0, "prev": 285000, "rows": []},
  "expenses": {"total": 25916, "prev": 26898, "trend": {"pct": -4, "kind": "flat"}, "groups": [
    {"key": "2", "name": "Boodschappen", "amount": 8284, "prev": 7158, "trend": {"pct": 16, "kind": "up"}},
    {"key": "3", "name": "Vrije tijd", "amount": 6690, "prev": 0, "trend": {"kind": "new"}},
    {"key": "5", "name": "Abonnementen", "amount": 5697, "prev": 0, "trend": {"kind": "new"}},
    {"key": "none", "name": "Niet gecategoriseerd", "amount": 3285, "prev": 0, "trend": {"kind": "new"}},
    {"key": "4", "name": "Vervoer", "amount": 1960, "prev": 5240, "trend": {"pct": -63, "kind": "down"}}
  ]},
  "saved": {"total": 0, "prev": 0, "rows": []},
  "result": {"total": -25916, "prev": 258102},
  "notes": [], "empty": false
}`

func TestWeekGolden(t *testing.T) {
	d, s := seeded(t)
	m := build(t, d, s, demo.Bert, Query{Period: Week(day("2026-11-09")), Now: demoNow})

	norm := func(raw []byte) string {
		var v map[string]any
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatal(err)
		}
		delete(v, "stand")
		if ex, ok := v["expenses"].(map[string]any); ok {
			if groups, ok := ex["groups"].([]any); ok {
				for _, g := range groups {
					delete(g.(map[string]any), "emoji")
				}
			}
		}
		out, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return string(out)
	}
	got, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if g, w := norm(got), norm([]byte(weekGolden)); g != w {
		t.Errorf("week 9-15 November\n got %s\nwant %s", g, w)
	}
}

// Ties between names read as the web's localeCompare reads them (found by the web cross-check:
// Overzicht puts "bakker" before "Zout", byte order alone would not).
func TestNameOrder(t *testing.T) {
	if nameOrder("bakker", "Zout") >= 0 || nameOrder("Zout", "bakker") <= 0 {
		t.Error("names are not ordered ignoring case")
	}
	if nameOrder("Boodschappen", "Boodschappen") != 0 || nameOrder("abc", "ABC") == 0 {
		t.Error("equal names tie, names that differ only in case still have an order")
	}
}
