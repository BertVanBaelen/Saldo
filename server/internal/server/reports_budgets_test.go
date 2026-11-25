package server

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
)

// GET /api/reports/budgets (0.8.1-2) on the demo seed, today 18 November 2026:
// Bert holds the Zichtrekening (1) and manages the Gedeelde rekening (4);
// Partner holds her own Zichtrekening (5) and is a member of 4. Categories as in
// the report: 1 Wonen, 2 Boodschappen, 3 Vrije tijd, 4 Vervoer, 5 Abonnementen,
// 6 Overig. Field names match case-insensitively, so the structs carry no tags.

const budgetsPath = "/api/reports/budgets"

type refCat struct {
	CategoryID, Reference int64
	Source                string
}

type refAnswerT struct {
	Months []struct {
		Month    string
		Accounts []struct {
			ID         int64
			Categories []refCat
		}
	}
}

func budgetsOf(t *testing.T, r response) refAnswerT {
	t.Helper()
	if r.status != http.StatusOK {
		t.Fatalf("%d %s", r.status, r.body)
	}
	if strings.Contains(r.body, "null") {
		t.Errorf("the answer holds a null: %s", r.body)
	}
	return decode[refAnswerT](t, r.body)
}

// ref is the reference of a category of one account in one month, as "amount source", "" when it has none.
func (a refAnswerT) ref(t *testing.T, month string, account, category int64) string {
	t.Helper()
	for _, m := range a.Months {
		if m.Month != month {
			continue
		}
		for _, acc := range m.Accounts {
			if acc.ID != account {
				continue
			}
			for _, c := range acc.Categories {
				if c.CategoryID == category {
					return fmt.Sprint(c.Reference, " ", c.Source)
				}
			}
			return ""
		}
	}
	t.Fatalf("no month %s with account %d", month, account)
	return ""
}

// planAverages reads the engine's `average` of the running month's budgets from GET /api/planning, by account and category.
func (p *pair) planAverages() map[[2]int64]int64 {
	p.t.Helper()
	type answer struct {
		Accounts []struct {
			ID     int64
			Months []struct {
				Month   string
				Budgets []struct{ CategoryID, Average int64 }
			}
		}
	}
	r := p.bert("GET", "/api/planning", "")
	if r.status != http.StatusOK {
		p.t.Fatalf("planning: %d %s", r.status, r.body)
	}
	out := map[[2]int64]int64{}
	for _, a := range decode[answer](p.t, r.body).Accounts {
		for _, b := range a.Months[0].Budgets {
			out[[2]int64{a.ID, b.CategoryID}] = b.Average
		}
	}
	return out
}

func TestReportBudgetsDemo(t *testing.T) {
	p := newPair(t)
	z := budgetsOf(t, p.bert("GET", budgetsPath+"?account=1&from=2026-10&to=2026-11", ""))
	g := budgetsOf(t, p.bert("GET", budgetsPath+"?account=4&from=2026-10&to=2026-11", ""))
	if len(z.Months) != 2 || z.Months[0].Month != "2026-10" || z.Months[1].Month != "2026-11" || len(z.Months[0].Accounts) != 1 {
		t.Fatalf("shape: %+v", z)
	}

	// November has the budget rows (from 2026-11); the categories without one run on the average.
	for category, want := range map[int64]string{3: "35000 budget", 4: "30000 budget", 6: "28798 budget"} {
		if got := z.ref(t, "2026-11", 1, category); got != want {
			t.Errorf("Zichtrekening November category %d: %q, want %q", category, got, want)
		}
	}
	if got := g.ref(t, "2026-11", 4, 2); got != "55000 budget" {
		t.Errorf("Gedeelde rekening November Boodschappen: %q", got)
	}
	// October has no budget row yet (they start in November): every reference is an average.
	for _, a := range []refAnswerT{z, g} {
		for _, c := range a.Months[0].Accounts[0].Categories {
			if c.Source != "average" {
				t.Errorf("October account %d category %d: %s", a.Months[0].Accounts[0].ID, c.CategoryID, c.Source)
			}
		}
	}

	// Where no confirmed recurring item sits in the category, the full amount is the engine's average; where one does
	// (Wonen: the rent), the reference counts it and the engine's variable-only average does not.
	engine := p.planAverages()
	byAccount := map[int64]refAnswerT{1: z, 4: g}
	var equal, differ []string
	for _, c := range []struct{ account, category int64 }{{1, 3}, {1, 4}, {4, 6}} {
		got := byAccount[c.account].ref(t, "2026-10", c.account, c.category)
		if want := fmt.Sprint(engine[[2]int64{c.account, c.category}], " average"); got != want {
			t.Errorf("account %d category %d: reference %q, engine average %q", c.account, c.category, got, want)
		}
		equal = append(equal, fmt.Sprint(c.account, "/", c.category, "=", got))
	}
	for _, c := range []struct{ account, category int64 }{{1, 1}, {1, 5}, {4, 1}, {4, 5}} {
		got := byAccount[c.account].ref(t, "2026-10", c.account, c.category)
		if !strings.HasSuffix(got, " average") || strings.HasPrefix(got, "0 ") {
			t.Errorf("account %d category %d: no average reference: %q", c.account, c.category, got)
		}
		differ = append(differ, fmt.Sprint(c.account, "/", c.category, "=", got, " (engine ", engine[[2]int64{c.account, c.category}], ")"))
	}
	if engine[[2]int64{1, 1}] != 0 {
		t.Errorf("Wonen on the Zichtrekening: engine average %d, want 0 (the rent is matched to a recurring item)", engine[[2]int64{1, 1}])
	}
	t.Logf("October Overig on the Zichtrekening %s, Boodschappen on the Gedeelde rekening %s", z.ref(t, "2026-10", 1, 6), g.ref(t, "2026-10", 4, 2))
	t.Logf("October, equal to the engine's average: %s", strings.Join(equal, " "))
	t.Logf("October, with recurring items (reference, engine average): %s", strings.Join(differ, " "))
	t.Logf("November Zichtrekening: Wonen %s, Abonnementen %s | Gedeelde rekening: Boodschappen %s, Overig %s, Wonen %s, Abonnementen %s",
		z.ref(t, "2026-11", 1, 1), z.ref(t, "2026-11", 1, 5), g.ref(t, "2026-11", 4, 2), g.ref(t, "2026-11", 4, 6), g.ref(t, "2026-11", 4, 1), g.ref(t, "2026-11", 4, 5))

	// Before the account's first booked month (2025-11) there is no category, though the account is listed; from that
	// month on the average is the same for every month (it is defined relative to today), October's here.
	before := budgetsOf(t, p.bert("GET", budgetsPath+"?account=1&from=2025-10&to=2025-11", ""))
	if len(before.Months) != 2 || len(before.Months[0].Accounts) != 1 || len(before.Months[0].Accounts[0].Categories) != 0 {
		t.Errorf("2025-10: %+v", before.Months)
	}
	if got, want := before.ref(t, "2025-11", 1, 1), z.ref(t, "2026-10", 1, 1); got != want || got == "" {
		t.Errorf("Wonen in 2025-11 %q, in 2026-10 %q", got, want)
	}
}

func TestReportBudgetsAllAccounts(t *testing.T) {
	p := newPair(t)
	// Alles holds both of Bert's current accounts in every month, in the report's account order; Persoonlijk and Gedeeld one each.
	for query, ids := range map[string][]int64{"?from=2026-10": {1, 4}, "?scope=alles&from=2026-10": {1, 4}, "?scope=persoonlijk&from=2026-10": {1}, "?scope=gedeeld&from=2026-10": {4}} {
		a := budgetsOf(t, p.bert("GET", budgetsPath+query, ""))
		if len(a.Months) != 2 {
			t.Fatalf("%s: %d months", query, len(a.Months))
		}
		for _, m := range a.Months {
			var got []int64
			for _, acc := range m.Accounts {
				got = append(got, acc.ID)
				if !slices.IsSortedFunc(acc.Categories, func(x, y refCat) int { return int(x.CategoryID - y.CategoryID) }) {
					t.Errorf("%s %s account %d: categories not ordered by id: %+v", query, m.Month, acc.ID, acc.Categories)
				}
			}
			if !slices.Equal(got, ids) {
				t.Errorf("%s %s: accounts %v, want %v", query, m.Month, got, ids)
			}
		}
	}
	// The default range is the report's: from the first booked month of the selection to the running month.
	if a := budgetsOf(t, p.bert("GET", budgetsPath, "")); len(a.Months) != 13 || a.Months[0].Month != "2025-11" || a.Months[12].Month != "2026-11" {
		t.Errorf("default range: %d months", len(a.Months))
	}
	// A selection without history: no months, never null.
	p.exec(`DELETE FROM account_access WHERE account_id = 4 AND user_id = 2`)
	r := p.partner("GET", budgetsPath+"?scope=gedeeld", "")
	equalJSON(t, r.body, `{"months": []}`)
}

func TestReportBudgetsErrors(t *testing.T) {
	p := newPair(t)
	const month, order, noCurrent = "Kies een maand als JJJJ-MM.", "De beginmaand ligt na de eindmaand.", "Kies een betaalrekening."
	for query, want := range map[string]string{
		"?from=2026-1":             month,
		"?to=abc":                  month,
		"?to=2026-12":              "De eindmaand ligt na deze maand.",
		"?from=2026-11&to=2026-10": order,
		"?account=2":               noCurrent,
		"?account=3":               noCurrent,
		"?scope=iedereen":          "Kies alles, persoonlijk of gedeeld.",
	} {
		if msg := expectError(t, p.bert("GET", budgetsPath+query, ""), http.StatusBadRequest, "invalid"); msg != want {
			t.Errorf("%s: %q, want %q", query, msg, want)
		}
	}
	// Another user's account, an unknown id and a malformed one are the same 404; a month error comes first.
	missing := p.bert("GET", budgetsPath+"?account=999999", "")
	if msg := expectError(t, missing, http.StatusNotFound, "not_found"); msg != msgAccountNotFound {
		t.Errorf("missing account: %q", msg)
	}
	for _, query := range []string{"?account=5", "?account=abc", "?account=0", "?account=-1"} {
		if r := p.bert("GET", budgetsPath+query, ""); r.status != missing.status || r.body != missing.body {
			t.Errorf("%s: %d %s, want the answer of a missing account", query, r.status, r.body)
		}
	}
	for _, query := range []string{"?account=1", "?account=2"} {
		if r := p.partner("GET", budgetsPath+query, ""); r.status != missing.status || r.body != missing.body {
			t.Errorf("Partner %s: %d %s", query, r.status, r.body)
		}
	}
	expectError(t, p.bert("GET", budgetsPath+"?account=5&to=2026-12", ""), http.StatusBadRequest, "invalid")
	expectError(t, p.bert("POST", budgetsPath, ""), http.StatusMethodNotAllowed, "method_not_allowed")

	// The shared account answers Bert and Partner byte for byte (budgets are account-level, no override in the seed).
	const shared = "?account=4&from=2026-09"
	bert, partner := p.bert("GET", budgetsPath+shared, ""), p.partner("GET", budgetsPath+shared, "")
	if bert.status != http.StatusOK || bert.body != partner.body {
		t.Errorf("shared account differs between the members:\n%s\n%s", bert.body, partner.body)
	}
	// Partner's own account is hers alone: Bert's answer names his own accounts only.
	for _, m := range budgetsOf(t, p.bert("GET", budgetsPath, "")).Months {
		for _, acc := range m.Accounts {
			if acc.ID != 1 && acc.ID != 4 {
				t.Errorf("Bert's answer holds account %d", acc.ID)
			}
		}
	}
}

// TestReportBudgetsAverage is average=1 (0.9.1-4): every category also carries its full-amount 6-month average, 0 without
// history and also when the source is a budget; without the flag (or with any other value) the answer is what it was.
func TestReportBudgetsAverage(t *testing.T) {
	p := newPair(t)
	type avgCat struct {
		CategoryID, Reference, Average int64
		Source                         string
	}
	type avgAnswer struct {
		Months []struct {
			Accounts []struct {
				ID         int64
				Categories []avgCat
			}
		}
	}
	const november = "?account=1&from=2026-11&to=2026-11"
	plainAnswer := p.bert("GET", budgetsPath+november, "")
	if strings.Contains(plainAnswer.body, `"average":`) {
		t.Errorf("the answer without the flag has an average: %s", plainAnswer.body)
	}
	for _, other := range []string{"&average=0", "&average=true", "&average="} {
		if r := p.bert("GET", budgetsPath+november+other, ""); r.status != http.StatusOK || r.body != plainAnswer.body {
			t.Errorf("%s: %d %s, want the answer without the flag", other, r.status, r.body)
		}
	}

	// Vrije tijd (3) has a budget of 350 and an average of 40,28: the reference stays the budget, the average is there too.
	a := decode[avgAnswer](t, p.bert("GET", budgetsPath+november+"&average=1", "").body)
	got := map[int64]avgCat{}
	for _, c := range a.Months[0].Accounts[0].Categories {
		got[c.CategoryID] = c
	}
	if c := got[3]; c != (avgCat{CategoryID: 3, Reference: 35000, Source: "budget", Average: 4028}) {
		t.Errorf("Vrije tijd: %+v", c)
	}
	plain := budgetsOf(t, plainAnswer)
	for _, c := range plain.Months[0].Accounts[0].Categories { // the same categories, references and sources
		g, ok := got[c.CategoryID]
		if !ok || g.Reference != c.Reference || g.Source != c.Source {
			t.Errorf("category %d: %+v with the flag, %+v without", c.CategoryID, g, c)
		}
		if c.Source == "average" && g.Average != c.Reference { // an average reference is the average
			t.Errorf("category %d: average %d, reference %d", c.CategoryID, g.Average, c.Reference)
		}
	}
	if len(got) != len(plain.Months[0].Accounts[0].Categories) {
		t.Errorf("%d categories with the flag, %d without", len(got), len(plain.Months[0].Accounts[0].Categories))
	}

	// A budget on a category without history carries average 0 (never left out). The demo's Zichtrekening has no
	// Boodschappen history (a seed change that adds one fails here, on purpose).
	if plain.ref(t, "2026-11", 1, 2) != "" {
		t.Fatalf("Boodschappen has a reference on the Zichtrekening: %s", plain.ref(t, "2026-11", 1, 2))
	}
	p.exec(`INSERT INTO budgets (account_id, category_id, monthly_amount, from_month) VALUES (1, 2, 12300, '2026-11')`)
	a = decode[avgAnswer](t, p.bert("GET", budgetsPath+november+"&average=1", "").body)
	for _, c := range a.Months[0].Accounts[0].Categories {
		if c.CategoryID == 2 && c != (avgCat{CategoryID: 2, Reference: 12300, Source: "budget", Average: 0}) {
			t.Errorf("Boodschappen with a budget and no history: %+v", c)
		}
	}
	if r := p.bert("GET", budgetsPath+november+"&average=1", ""); !strings.Contains(r.body, `{"categoryId":2,"reference":12300,"source":"budget","average":0}`) {
		t.Errorf("average 0 is not on the wire: %s", r.body)
	}

	// Every member of the shared account gets the same answer (no override in the seed), and a hidden account the same 404.
	const shared = "?account=4&from=2026-09&average=1"
	if bert, partner := p.bert("GET", budgetsPath+shared, ""), p.partner("GET", budgetsPath+shared, ""); bert.status != http.StatusOK || bert.body != partner.body {
		t.Errorf("shared account differs between the members:\n%s\n%s", bert.body, partner.body)
	}
	missing := p.bert("GET", budgetsPath+"?account=999999", "")
	if r := p.bert("GET", budgetsPath+"?account=5&average=1", ""); r.status != missing.status || r.body != missing.body {
		t.Errorf("a hidden account with average=1: %d %s", r.status, r.body)
	}
}
