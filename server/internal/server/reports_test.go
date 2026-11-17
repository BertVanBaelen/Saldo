package server

import (
	"fmt"
	"maps"
	"net/http"
	"slices"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// GET /api/reports/months (0.7-1) on the demo story: Bert holds 1 (current),
// 2 and 3 (savings) and manages the shared account 4; Partner holds 5 and 4.
// The numbers are the golden ones of ledger.TestReportMonthsDemo, read here
// through the route.

const reportsPath = "/api/reports/months"

func report(t *testing.T, h http.Handler, query string) ledger.Report {
	t.Helper()
	r := do(t, h, "GET", reportsPath+query, "")
	if r.status != http.StatusOK {
		t.Fatalf("GET %s%s: %d %s", reportsPath, query, r.status, r.body)
	}
	return decode[ledger.Report](t, r.body)
}

func monthNames(rep ledger.Report) []string {
	var out []string
	for _, m := range rep.Months {
		out = append(out, m.Month)
	}
	return out
}

func TestReportMonthsDefault(t *testing.T) {
	h, _ := demoServer(t)
	r := do(t, h, "GET", reportsPath, "")
	if r.status != http.StatusOK || r.header.Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("status %d, content type %q", r.status, r.header.Get("Content-Type"))
	}
	for query, accounts := range map[string][]int64{
		"":                             {1, 4},
		"?scope=alles":                 {1, 4},
		"?scope=persoonlijk":           {1},
		"?scope=gedeeld":               {4},
		"?scope=persoonlijk&account=4": {4}, // an account wins over the scope
	} {
		rep := report(t, h, query)
		months := monthNames(rep)
		if !slices.Equal(rep.Accounts, accounts) || rep.FirstMonth == nil || *rep.FirstMonth != "2025-11" ||
			rep.FirstDate == nil || *rep.FirstDate != "2025-11-01" ||
			len(months) != 13 || months[0] != "2025-11" || months[12] != "2026-11" {
			t.Errorf("%q: accounts %v, first %v %v, months %v", query, rep.Accounts, rep.FirstMonth, rep.FirstDate, months)
		}
	}
}

func TestReportMonthsGolden(t *testing.T) {
	h, _ := demoServer(t)
	for _, c := range []struct {
		query    string
		income   int64
		saved    int64
		expenses map[string]int64
	}{
		{"?scope=alles&from=2026-10&to=2026-10", 335000, 20000, map[string]int64{"1": 115000, "2": 25236, "3": 2795, "4": 14060, "5": 6896, "6": 6562}},
		{"?from=2026-10&to=2026-10", 335000, 20000, map[string]int64{"1": 115000, "2": 25236, "3": 2795, "4": 14060, "5": 6896, "6": 6562}},
		{"?scope=persoonlijk&from=2026-10&to=2026-10", 290000, 20000, map[string]int64{"1": 100500, "3": 2795, "4": 14060, "5": 2598, "toShared": 45000}},
		{"?scope=gedeeld&from=2026-10&to=2026-10", 90000, 0, map[string]int64{"1": 14500, "2": 25236, "5": 4298, "6": 6562}},
		{"?scope=alles&from=2026-11&to=2026-11", 331850, 20000, map[string]int64{"1": 115000, "2": 29521, "3": 6690, "4": 13410, "5": 6896, "none": 4125}},
		{"?account=1&from=2026-10&to=2026-10", 290000, 20000, map[string]int64{"1": 100500, "3": 2795, "4": 14060, "5": 2598, "toShared": 45000}},
		{"?account=4&from=2026-10&to=2026-10", 90000, 0, map[string]int64{"1": 14500, "2": 25236, "5": 4298, "6": 6562}},
	} {
		rep := report(t, h, c.query)
		if len(rep.Months) != 1 {
			t.Errorf("%s: %d months", c.query, len(rep.Months))
			continue
		}
		m := rep.Months[0]
		if m.Income != c.income || m.Saved != c.saved || !maps.Equal(m.Expenses, c.expenses) {
			t.Errorf("%s: income %d saved %d expenses %v; want %d %d %v", c.query, m.Income, m.Saved, m.Expenses, c.income, c.saved, c.expenses)
		}
	}

	// Alles lists the accounts of the selection too (their incomes add up to
	// the footnote of Overzicht); a single account carries no such list.
	oct := report(t, h, "?from=2026-10&to=2026-10").Months[0]
	if len(oct.Accounts) != 2 || oct.Accounts[0].ID != 1 || oct.Accounts[1].ID != 4 ||
		oct.Accounts[0].Income != 290000 || oct.Accounts[0].Saved != 20000 ||
		!maps.Equal(oct.Accounts[0].Expenses, map[string]int64{"1": 100500, "3": 2795, "4": 14060, "5": 2598, "toShared": 45000}) ||
		oct.Accounts[1].Income != 90000 || oct.Accounts[1].Saved != 0 ||
		!maps.Equal(oct.Accounts[1].Expenses, map[string]int64{"1": 14500, "2": 25236, "5": 4298, "6": 6562}) {
		t.Errorf("October per account: %+v", oct.Accounts)
	}
	if one := report(t, h, "?account=1&from=2026-10&to=2026-10").Months[0]; one.Accounts != nil {
		t.Errorf("one account carries a per-account list: %+v", one.Accounts)
	}
}

func TestReportMonthsRange(t *testing.T) {
	h, _ := demoServer(t)
	for _, c := range []struct {
		query string
		want  []string
	}{
		{"?from=2026-10", []string{"2026-10", "2026-11"}},
		{"?to=2026-01", []string{"2025-11", "2025-12", "2026-01"}},
		{"?from=2026-10&to=2026-10", []string{"2026-10"}},
		{"?from=2026-11&to=2026-11", []string{"2026-11"}},
		{"?from=2019-12&to=2020-02", []string{"2019-12", "2020-01", "2020-02"}}, // before the history: zeros
	} {
		if got := monthNames(report(t, h, c.query)); !slices.Equal(got, c.want) {
			t.Errorf("%s: months %v, want %v", c.query, got, c.want)
		}
	}

	// A `to` before the history without `from`: nothing to show (200, no
	// months), while an explicit `from` after `to` is the 400 of the error test.
	if rep := report(t, h, "?to=2025-10"); rep.FirstMonth == nil || *rep.FirstMonth != "2025-11" || len(rep.Months) != 0 {
		t.Errorf("to before the history: %+v", rep)
	}

	// A month before the history is all zeros, and the wire shape is pinned:
	// an empty expenses object, no per-account list for one account.
	r := do(t, h, "GET", reportsPath+"?account=1&from=2020-01&to=2020-01", "")
	equalJSON(t, r.body, `{"accounts": [1], "firstMonth": "2025-11", "firstDate": "2025-11-01",
		"months": [{"month": "2020-01", "income": 0, "saved": 0, "expenses": {}}]}`)
}

func TestReportMonthsErrors(t *testing.T) {
	p := newPair(t)
	var invest int64
	if err := p.db.QueryRow(`INSERT INTO accounts (type, source, name, created_by) VALUES ('investment', 'manual', 'Beleggen', 1) RETURNING id`).Scan(&invest); err != nil {
		t.Fatal(err)
	}
	p.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, 1, 'manager', 'edit')`, invest)

	const month, order, noCurrent = "Kies een maand als JJJJ-MM.", "De beginmaand ligt na de eindmaand.", "Kies een betaalrekening."
	for query, want := range map[string]string{
		"?from=2026-1":                   month,
		"?from=2026-13":                  month,
		"?from=2026-11-01":               month,
		"?to=abc":                        month,
		"?to=2026-00":                    month,
		"?to=2026-12":                    "De eindmaand ligt na deze maand.",
		"?from=2026-11&to=2026-10":       order,
		"?from=2027-01":                  order, // from after the default to (the current month)
		"?account=2":                     noCurrent,
		"?account=3":                     noCurrent,
		"?account=" + fmt.Sprint(invest): noCurrent,
		"?scope=iedereen":                "Kies alles, persoonlijk of gedeeld.",
	} {
		if msg := expectError(t, p.bert("GET", reportsPath+query, ""), http.StatusBadRequest, "invalid"); msg != want {
			t.Errorf("%s: %q, want %q", query, msg, want)
		}
	}

	// Another user's account, an unknown id and a malformed one are the same 404.
	missing := p.bert("GET", reportsPath+"?account=999999", "")
	if msg := expectError(t, missing, http.StatusNotFound, "not_found"); msg != msgAccountNotFound {
		t.Errorf("missing account: %q", msg)
	}
	for _, query := range []string{"?account=5", "?account=abc", "?account=0", "?account=-1", "?account=1.5"} {
		if r := p.bert("GET", reportsPath+query, ""); r.status != missing.status || r.body != missing.body {
			t.Errorf("%s: %d %s, want the answer of a missing account: %d %s", query, r.status, r.body, missing.status, missing.body)
		}
	}
	// Partner cannot reach Bert's account 1, nor his savings account 2 (404, not the 400 of a savings account).
	for _, query := range []string{"?account=1", "?account=2"} {
		if r := p.partner("GET", reportsPath+query, ""); r.status != missing.status || r.body != missing.body {
			t.Errorf("Partner %s: %d %s", query, r.status, r.body)
		}
	}
	// A month error comes before the account is looked at.
	expectError(t, p.bert("GET", reportsPath+"?account=5&to=2026-12", ""), http.StatusBadRequest, "invalid")

	// POST and the like are not routes.
	expectError(t, p.bert("POST", reportsPath, ""), http.StatusMethodNotAllowed, "method_not_allowed")
}

func TestReportMonthsAsPartner(t *testing.T) {
	p := newPair(t)
	// Bert's contribution comes from an account Partner cannot see: income.
	rep := report(t, p.partnerH, "?scope=persoonlijk&from=2026-10&to=2026-10")
	m := rep.Months[0]
	if !slices.Equal(rep.Accounts, []int64{5}) || m.Income != 246000 || m.Expenses["toShared"] != 45000 {
		t.Errorf("Partner persoonlijk: %v %+v", rep.Accounts, m)
	}
	if rep := report(t, p.partnerH, "?from=2026-10&to=2026-10"); rep.Months[0].Income != 291000 || !slices.Equal(rep.Accounts, []int64{4, 5}) {
		t.Errorf("Partner alles: %v %+v", rep.Accounts, rep.Months[0])
	}
}

func TestReportMonthsEmpty(t *testing.T) {
	p := newPair(t)
	// Partner without the shared account has no shared current account.
	p.exec(`DELETE FROM account_access WHERE account_id = 4 AND user_id = 2`)
	r := p.partner("GET", reportsPath+"?scope=gedeeld", "")
	if r.status != http.StatusOK {
		t.Fatalf("%d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{"accounts": [], "firstMonth": null, "firstDate": null, "months": []}`)
	if rep := report(t, p.partnerH, "?scope=gedeeld&from=2026-10"); len(rep.Accounts) != 0 || len(rep.Months) != 0 {
		t.Errorf("empty selection with from: %+v", rep)
	}

	// A current account without booked rows: no first month, no months unless
	// from is given, then every month zeros included.
	var empty int64
	if err := p.db.QueryRow(`INSERT INTO accounts (type, source, name, created_by) VALUES ('current', 'manual', 'Leeg', 1) RETURNING id`).Scan(&empty); err != nil {
		t.Fatal(err)
	}
	p.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, 1, 'manager', 'edit')`, empty)
	equalJSON(t, p.bert("GET", reportsPath+"?account="+fmt.Sprint(empty), "").body,
		fmt.Sprintf(`{"accounts": [%d], "firstMonth": null, "firstDate": null, "months": []}`, empty))
	rep := report(t, p.bertH, "?account="+fmt.Sprint(empty)+"&from=2026-10")
	if rep.FirstMonth != nil || !slices.Equal(monthNames(rep), []string{"2026-10", "2026-11"}) || rep.Months[0].Income != 0 || len(rep.Months[0].Expenses) != 0 {
		t.Errorf("no rows with from: %+v", rep)
	}
}
