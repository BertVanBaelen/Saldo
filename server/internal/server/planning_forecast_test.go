package server

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// GET /api/planning, the planning alerts and the required contribution (0.8-4)
// on the demo seed, today 18 November 2026. The numbers are the golden ones of
// plan 0.8-3 and 0.8-4. Bert holds the Zichtrekening (1) and manages the
// Gedeelde rekening (4); Partner holds her own Zichtrekening (5) and is a
// member of 4. Field names match case-insensitively, so the structs carry no tags.

type fcMonth struct {
	Month, State                         string
	Start, End, Left, Income, Out, Saved int64
	Low                                  struct {
		Date    string
		Balance int64
		State   string
	}
	Lines []struct {
		Key    string
		Amount int64
	}
	Contribution *fcContribution
}

type fcContribution struct {
	Need, Costs, OtherIncome, BufferGap int64
	Members                             []struct {
		UserID   int64
		Name     string
		Me       bool
		Share    int
		Required int64
	}
}

type fcAccount struct {
	ID, Buffer, Balance   int64
	BalanceDate, DataDate string
	Months                []fcMonth
	Days                  []struct {
		Date    string
		Balance int64
		State   string
	}
	Missed []struct{ ItemID int64 }
}

type fcAnswer struct {
	Today    string
	Accounts []fcAccount
	Missing  []int64
}

// forecast asks GET /api/planning as h and decodes the answer; the body is
// also checked for a JSON null (every list is [], never null).
func (p *pair) forecast(h func(string, string, string) response, query string) (fcAnswer, string) {
	p.t.Helper()
	r := h("GET", "/api/planning"+query, "")
	if r.status != http.StatusOK {
		p.t.Fatalf("planning%s: %d %s", query, r.status, r.body)
	}
	if strings.Contains(r.body, "null") {
		p.t.Errorf("planning%s holds a null: %s", query, r.body)
	}
	return decode[fcAnswer](p.t, r.body), r.body
}

// shape is "id:month=end/state ..." per account: the month ends of an answer.
func (a fcAnswer) shape() string {
	var out []string
	for _, acc := range a.Accounts {
		s := fmt.Sprint(acc.ID, ":")
		for _, m := range acc.Months {
			s += fmt.Sprintf(" %s=%d/%s", m.Month, m.End, m.State)
		}
		out = append(out, s)
	}
	return strings.Join(out, " | ")
}

// ids lists the account ids of an answer.
func (a fcAnswer) ids() []int64 {
	out := []int64{}
	for _, acc := range a.Accounts {
		out = append(out, acc.ID)
	}
	return out
}

// sameButMe tells whether two bodies are the same once `me` is normalised.
func sameButMe(a, b string) bool {
	n := strings.NewReplacer(`"me":true`, `"me":false`)
	return n.Replace(a) == n.Replace(b)
}

func TestPlanningAPIDemo(t *testing.T) {
	p := newPair(t)
	const zicht = "1: 2026-11=120685/ok 2026-12=108789/ok 2027-01=63493/buffer 2027-02=-113403/red"
	const gedeeld = "4: 2026-11=62882/ok 2026-12=72837/ok 2027-01=82792/ok 2027-02=92747/ok"

	// Defaults: horizon 3, the running month, the days of November only.
	a, _ := p.forecast(p.bert, "")
	if a.shape() != zicht+" | "+gedeeld || a.Today != "2026-11-18" || len(a.Missing) != 0 {
		t.Errorf("alles: %s, today %s, missing %v", a.shape(), a.Today, a.Missing)
	}
	z, g := a.Accounts[0], a.Accounts[1]
	if z.Buffer != 90000 || z.Balance != 196882 || z.BalanceDate != "2026-11-18" || z.DataDate != "2026-11-18" || len(z.Missed) != 0 {
		t.Errorf("Zichtrekening: %+v", z)
	}
	if len(z.Days) != 30 || z.Days[0].Date != "2026-11-01" || z.Days[0].Balance != -43145 || z.Days[0].State != "red" || len(g.Days) != 30 {
		t.Errorf("November days: %d, first %+v", len(z.Days), z.Days[0])
	}
	nov := z.Months[0]
	lines := map[string]int64{}
	for _, l := range nov.Lines {
		lines[l.Key] = l.Amount
	}
	if nov.Start != 102355 || nov.Left != 30685 || nov.Income != 286850 || nov.Out != 248520 || nov.Saved != 20000 ||
		nov.Low.Date != "2026-11-01" || nov.Low.Balance != -43145 || nov.Low.State != "red" ||
		lines["today"] != 196882 || lines["pending"] != -2499 || lines["variable"] != -73698 || lines["free"] != 30685 || nov.Contribution != nil {
		t.Errorf("Zichtrekening November: %+v, lines %v", nov, lines)
	}
	if g.Months[0].Contribution == nil {
		t.Error("the Gedeelde rekening has no contribution")
	}

	// month=2027-02: that month's days, 10 February the first day of the last red run.
	a, _ = p.forecast(p.bert, "?month=2027-02")
	for _, acc := range a.Accounts {
		if len(acc.Days) != 28 || acc.Days[0].Date != "2027-02-01" {
			t.Errorf("account %d: %d days from %s", acc.ID, len(acc.Days), acc.Days[0].Date)
		}
	}
	run := len(a.Accounts[0].Days)
	for run > 0 && a.Accounts[0].Days[run-1].State == "red" {
		run--
	}
	if d := a.Accounts[0].Days[run].Date; d != "2027-02-10" {
		t.Errorf("the last red run starts on %s", d)
	}

	// Scopes, and the other horizons.
	for q, want := range map[string]string{"?scope=persoonlijk": "[1]", "?scope=gedeeld": "[4]", "?scope=alles": "[1 4]"} {
		if a, _ := p.forecast(p.bert, q); fmt.Sprint(a.ids()) != want {
			t.Errorf("%s: accounts %v, want %s", q, a.ids(), want)
		}
	}
	for horizon, months := range map[string]int{"6": 7, "12": 13, "24": 25} {
		if a, _ := p.forecast(p.bert, "?horizon="+horizon); len(a.Accounts[0].Months) != months {
			t.Errorf("horizon %s: %d months, want %d", horizon, len(a.Accounts[0].Months), months)
		}
	}

	// Partner: her own Zichtrekening in persoonlijk, and the shared account
	// exactly as Bert gets it (decision 2), also after she marked one of its
	// rows "is een overschrijving" (a per-viewer fact the forecast never reads).
	if a, _ := p.forecast(p.partner, "?scope=persoonlijk"); fmt.Sprint(a.ids()) != "[5]" || a.Accounts[0].Balance != 143215 {
		t.Errorf("Partner persoonlijk: %v", a.ids())
	}
	same := func(label, query string) {
		t.Helper()
		_, bert := p.forecast(p.bert, query)
		_, partner := p.forecast(p.partner, query)
		if !sameButMe(bert, partner) {
			t.Errorf("%s: the shared forecast differs between Bert and Partner", label)
		}
	}
	same("gedeeld", "?scope=gedeeld")
	row := p.count(`SELECT id FROM transactions WHERE account_id = 4 AND booking_date = '2026-10-26' AND amount < 0 ORDER BY id LIMIT 1`)
	if r := p.partner("PUT", fmt.Sprintf("/api/transactions/%d/transfer", row), `{"transfer":true}`); r.status != http.StatusOK {
		t.Fatalf("mark a row as a transfer: %d %s", r.status, r.body)
	}
	same("gedeeld after Partner's override", "?scope=gedeeld&horizon=6")
}

func TestPlanningAPIRequests(t *testing.T) {
	p := newPair(t)
	for _, c := range []struct{ query, msg string }{
		{"?horizon=5", msgPlanHorizon}, {"?horizon=abc", msgPlanHorizon}, {"?horizon=03", msgPlanHorizon}, {"?horizon=48", msgPlanHorizon},
		{"?month=2027-03", msgPlanMonth}, {"?month=2026-10", msgPlanMonth}, {"?month=2026-13", msgPlanMonth}, {"?month=nov", msgPlanMonth},
		{"?horizon=6&month=2027-06", msgPlanMonth}, {"?scope=iedereen", msgPlanScope},
	} {
		if got := expectError(t, p.bert("GET", "/api/planning"+c.query, ""), http.StatusBadRequest, "invalid"); got != c.msg {
			t.Errorf("%s: %q, want %q", c.query, got, c.msg)
		}
	}
	for _, query := range []string{"?horizon=6&month=2027-05", "?horizon=24&month=2028-11", "?month=2026-11", "?scope=gedeeld&month=2027-02"} {
		if r := p.bert("GET", "/api/planning"+query, ""); r.status != http.StatusOK {
			t.Errorf("%s: %d %s", query, r.status, r.body)
		}
	}

	// An account without a balance is "missing"; savings accounts are never listed.
	p.exec(`INSERT INTO accounts (id, type, source, name) VALUES (20, 'current', 'manual', 'Leeg')`)
	p.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (20, 1, 'manager', 'edit')`)
	for q, want := range map[string]string{"": "[20]", "?scope=persoonlijk": "[20]", "?scope=gedeeld": "[]"} {
		a, _ := p.forecast(p.bert, q)
		if fmt.Sprint(a.Missing) != want || strings.Contains(fmt.Sprint(a.ids()), "20") {
			t.Errorf("missing %s: %v, want %s (accounts %v)", q, a.Missing, want, a.ids())
		}
	}
	if a, _ := p.forecast(p.bert, ""); fmt.Sprint(a.ids()) != "[1 4]" {
		t.Errorf("the demo's savings accounts are listed: %v", a.ids())
	}

	// An empty scope: no accounts, and the month is still checked.
	p.exec(`INSERT INTO users (id, email, display_name, role) VALUES (7, 'leeg@example.com', 'Leeg', 'user')`)
	empty := p.as(7)
	r := do(t, empty, "GET", "/api/planning", "")
	equalJSON(t, r.body, `{"today": "2026-11-18", "accounts": [], "missing": []}`)
	expectError(t, do(t, empty, "GET", "/api/planning?month=2030-01", ""), http.StatusBadRequest, "invalid")
}

func TestPlanningContribution(t *testing.T) {
	p := newPair(t)
	// need and required per month, as the answer of a member sees it.
	figures := func(h func(string, string, string) response, month string) string {
		t.Helper()
		a, _ := p.forecast(h, "?scope=gedeeld&horizon=3")
		for _, m := range a.Accounts[0].Months {
			if m.Month == month {
				c := m.Contribution
				s := fmt.Sprintf("need %d", c.Need)
				for _, x := range c.Members {
					s += fmt.Sprintf(" %s %d%%=%d", x.Name, x.Share, x.Required)
				}
				return s
			}
		}
		return "no month " + month
	}

	// Equal shares (seeded 50/50): November 87118 rounds up to 87200, 43600 each.
	a, _ := p.forecast(p.bert, "?scope=gedeeld&horizon=3")
	c := a.Accounts[0].Months[0].Contribution
	if c.Need != 87200 || c.Costs != 80045 || c.OtherIncome != 0 || c.BufferGap != 7073 || len(c.Members) != 2 ||
		c.Members[0].UserID != 1 || !c.Members[0].Me || c.Members[1].UserID != 2 || c.Members[1].Me {
		t.Errorf("November contribution: %+v", c)
	}
	if got := figures(p.bert, "2026-11"); got != "need 87200 Bert 50%=43600 Partner 50%=43600" {
		t.Errorf("November: %s", got)
	}
	for _, month := range []string{"2026-12", "2027-01", "2027-02"} {
		if got := figures(p.bert, month); got != "need 80100 Bert 50%=40100 Partner 50%=40100" {
			t.Errorf("%s: %s", month, got)
		}
	}
	if z, _ := p.forecast(p.bert, "?scope=persoonlijk"); z.Accounts[0].Months[0].Contribution != nil {
		t.Error("the personal Zichtrekening has a contribution")
	}

	// The contributions endpoint: need and required, covered from what arrived.
	got := p.contributions(p.bert, "2026-11")
	if got.Need == nil || *got.Need != 87200 || *got.Members[0].Required != 43600 || *got.Members[1].Required != 43600 ||
		got.Members[0].Received != 0 || *got.Members[0].Covered || *got.Members[1].Covered {
		t.Errorf("before a claim: %+v", got)
	}
	p.claim(p.bert, `{"fromAccountId": 1}`)
	got = p.contributions(p.bert, "2026-11")
	if got.Members[0].Received != 45000 || !*got.Members[0].Covered || *got.Members[1].Covered || !got.Members[0].Confirmed {
		t.Errorf("after Bert's claim: %+v", got.Members)
	}

	// Outside the forecast, and for an account that has no forecast: null.
	for _, month := range []string{"2026-10", "2028-12", "2030-01"} {
		if got := p.contributions(p.bert, month); got.Need != nil || got.Members[0].Required != nil || got.Members[0].Covered != nil {
			t.Errorf("%s: %+v", month, got)
		}
	}
	if got := p.contributions(p.bert, "2028-11"); got.Need == nil { // the last month of the 24-month horizon
		t.Error("2028-11 is inside the forecast")
	}
	p.exec(`DELETE FROM balance_snapshots WHERE account_id = 4`)
	if got := p.contributions(p.bert, "2026-11"); got.Need != nil || got.Members[0].Required != nil {
		t.Errorf("without a balance: %+v", got)
	}
	if a, _ := p.forecast(p.bert, "?scope=gedeeld"); fmt.Sprint(a.Missing) != "[4]" {
		t.Errorf("the shared account without a balance: missing %v", a.Missing)
	}
}

func TestPlanningContributionShares(t *testing.T) {
	p := newPair(t)
	figures := func(h func(string, string, string) response, month string) string {
		t.Helper()
		var parts []string // by name: the third member joined before Partner
		for _, x := range p.contributions(h, month).Members {
			share := "-" // no share stored: equal
			if x.Share != nil {
				share = fmt.Sprint(*x.Share, "%")
			}
			parts = append(parts, fmt.Sprintf("%s %s=%d", x.Name, share, *x.Required))
		}
		slices.Sort(parts)
		return " " + strings.Join(parts, " ")
	}
	// Unequal shares: 87118 gives ⌈609,826⌉ and ⌈261,354⌉ euros, 80045 gives ⌈560,315⌉ and ⌈240,135⌉.
	if r := p.bert("PUT", sharesPath, `{"shares": {"1": 70, "2": 30}}`); r.status != http.StatusOK || !strings.Contains(r.body, `"required":61000`) {
		t.Fatalf("shares: %d %s", r.status, r.body)
	}
	if got := figures(p.bert, "2026-11"); got != " Bert 70%=61000 Partner 30%=26200" {
		t.Errorf("November: %s", got)
	}
	if got := figures(p.bert, "2026-12"); got != " Bert 70%=56100 Partner 30%=24100" {
		t.Errorf("December: %s", got)
	}
	// Partner's answer equals Bert's but for `me`, also on Lezen (shares stay the manager's).
	_, bert := p.forecast(p.bert, "?scope=gedeeld&horizon=6")
	_, partner := p.forecast(p.partner, "?scope=gedeeld&horizon=6")
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	_, readOnly := p.forecast(p.partner, "?scope=gedeeld&horizon=6")
	if !sameButMe(bert, partner) || partner != readOnly || !strings.Contains(readOnly, `"required":61000`) {
		t.Error("Partner's answer differs from Bert's")
	}

	// Three members and no shares stored: ⌈need / 3⌉ for each (87118 / 3 = 290,39 euros).
	p.third("user", "edit")
	p.exec(`UPDATE account_access SET contribution_share = NULL WHERE account_id = 4`)
	if got := figures(p.bert, "2026-11"); got != " Bert -=29100 Derde -=29100 Partner -=29100" {
		t.Errorf("three members: %s", got)
	}
	if a, _ := p.forecast(p.bert, "?scope=gedeeld"); a.Accounts[0].Months[0].Contribution.Members[0].Share != 33 { // the wire shows 100 / 3
		t.Errorf("equal share of three: %+v", a.Accounts[0].Months[0].Contribution.Members)
	}
	// A share of 0 asks nothing; a flagged account with one member gets that member at 100 %.
	p.exec(`UPDATE account_access SET contribution_share = CASE user_id WHEN 1 THEN 100 ELSE 0 END WHERE account_id = 4`)
	if got := figures(p.bert, "2026-11"); got != " Bert 100%=87200 Derde 0%=0 Partner 0%=0" {
		t.Errorf("shares 100/0/0: %s", got)
	}
	p.exec(`DELETE FROM account_access WHERE account_id = 4 AND user_id <> 1`)
	p.exec(`UPDATE accounts SET shared = 1 WHERE id = 4`)
	p.exec(`UPDATE account_access SET contribution_share = NULL WHERE account_id = 4`)
	a, _ := p.forecast(p.bert, "?scope=gedeeld")
	if c := a.Accounts[0].Months[0].Contribution; c == nil || len(c.Members) != 1 || c.Members[0].Share != 100 || c.Members[0].Required != c.Need {
		t.Errorf("a flagged account with one member: %+v", c)
	}
}

func TestPlanningAlerts(t *testing.T) {
	p := newPair(t)
	planningAlerts := func(h func(string, string, string) response, query string) []ledger.Alert {
		t.Helper()
		var out []ledger.Alert
		for _, a := range decode[[]ledger.Alert](t, h("GET", "/api/alerts"+query, "").body) {
			if a.Type == "planning" {
				out = append(out, a)
			}
		}
		return out
	}
	const (
		red    = `neg planning "Zichtrekening staat rood in februari" "Verwacht eindsaldo −€ 1.134 · bekijk de planning" /planning?maand=2027-02#maanden 1`
		buffer = `warn planning "Zichtrekening zakt in de buffer in januari" "Verwacht € 635, € 265 onder de buffer van € 900" /planning?maand=2027-01#maanden 1`
	)
	list := func(alerts []ledger.Alert) []string {
		out := []string{}
		for _, a := range alerts {
			out = append(out, fmt.Sprintf("%s %s %q %q %s %d", a.Kind, a.Type, a.Title, a.Note, a.Href, a.AccountID))
		}
		return out
	}

	// The demo: look-ahead 3 (the default) has both, none for the Gedeelde rekening; Partner has none.
	if got := list(planningAlerts(p.bert, "")); fmt.Sprint(got) != fmt.Sprint([]string{red, buffer}) {
		t.Errorf("Bert: %v", got)
	}
	if got := planningAlerts(p.partner, ""); len(got) != 0 {
		t.Errorf("Partner: %v", got)
	}
	// The scope narrows them to its accounts.
	if got := planningAlerts(p.bert, "?scope=gedeeld"); len(got) != 0 {
		t.Errorf("gedeeld: %v", got)
	}
	if got := planningAlerts(p.bert, "?scope=persoonlijk"); len(got) != 2 {
		t.Errorf("persoonlijk: %v", got)
	}
	// Look-ahead 1: November and December end above the buffer. 6: still the first red and buffer months.
	p.exec(`UPDATE users SET lookahead_months = 1 WHERE id = 1`)
	if got := planningAlerts(p.bert, ""); len(got) != 0 {
		t.Errorf("look-ahead 1: %v", got)
	}
	p.exec(`UPDATE users SET lookahead_months = 6 WHERE id = 1`)
	if got := list(planningAlerts(p.bert, "")); fmt.Sprint(got) != fmt.Sprint([]string{red, buffer}) {
		t.Errorf("look-ahead 6: %v", got)
	}
	// The order: after the stale and failed accounts, before the consent that is ending.
	var types []string
	for _, a := range decode[[]ledger.Alert](t, p.bert("GET", "/api/alerts", "").body) {
		types = append(types, a.Type)
	}
	if fmt.Sprint(types) != "[planning planning consent categorise]" {
		t.Errorf("alert order: %v", types)
	}

	// Partner's own account going red gives her an alert and Bert none (account 5 is hers alone).
	p.exec(`UPDATE balance_snapshots SET balance = -50000000 WHERE account_id = 5`)
	if got := planningAlerts(p.partner, ""); len(got) == 0 || got[0].AccountID != 5 || got[0].Kind != "neg" {
		t.Errorf("Partner on a red account: %v", got)
	}
	for _, a := range planningAlerts(p.bert, "") {
		if a.AccountID == 5 {
			t.Errorf("Bert got an alert about Partner's account: %+v", a)
		}
	}
}

func TestPlanningAlertHelpers(t *testing.T) {
	// Eur0 and MonthLabel are tested in ledger (dutch_test.go).
	// A hand-built chain: the buffer alert is the first month before the red one, months after it count for nothing.
	chain := func(buffer int64, ends ...int64) planning.AccountForecast {
		f := planning.AccountForecast{Buffer: buffer}
		for i, e := range ends {
			f.Months = append(f.Months, planning.Month{Month: planMonths("2026-11", i), End: e})
		}
		return f
	}
	for _, c := range []struct {
		name    string
		f       planning.AccountForecast
		look    int
		red, bf string // the month in the href, "" for none
	}{
		{"red in the running month: no buffer alert", chain(100, -1, 50), 3, "2026-11", ""},
		{"buffer, then red", chain(100, 500, 50, -1), 3, "2027-01", "2026-12"},
		{"buffer after the red month is ignored", chain(100, 500, -1, 50), 3, "2026-12", ""},
		{"beyond the look-ahead", chain(100, 500, 500, -1), 1, "", ""},
		{"a year ahead", chain(0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, -1), 12, "2027-11", ""},
		{"no buffer, never in the buffer", chain(0, 0, 10), 3, "", ""},
	} {
		red, buffer := accountPlanningAlerts(1, "Rek", c.f, c.look)
		month := func(a *ledger.Alert) string {
			if a == nil {
				return ""
			}
			return a.Href[len("/planning?maand=") : len("/planning?maand=")+7]
		}
		if month(red) != c.red || month(buffer) != c.bf {
			t.Errorf("%s: red %q, buffer %q; want %q, %q", c.name, month(red), month(buffer), c.red, c.bf)
		}
	}
	if red, _ := accountPlanningAlerts(1, "Rek", chain(0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, -1), 12); red == nil || red.Title != "Rek staat rood in november 2027" {
		t.Errorf("a year ahead: %+v", red)
	}
}

// TestPlanningBudgetTotals is the budget as a total on the wire (plan 0.9.1-4): every budgets entry has total and
// recurring; on the demo (nothing assigned) total is plan for a budget and 0 for an average, recurring 0; an assigned
// item moves recurring and plan, and the shared account's need follows.
func TestPlanningBudgetTotals(t *testing.T) {
	p := newPair(t)
	type budget struct {
		CategoryID, Plan, Total, Recurring int64
		Source                             string
	}
	type answer struct {
		Accounts []struct {
			ID     int64
			Months []struct {
				Month        string
				Budgets      []budget
				Contribution *struct{ Costs int64 }
			}
		}
	}
	read := func() (answer, string) {
		r := p.bert("GET", "/api/planning?horizon=24", "")
		if r.status != http.StatusOK {
			t.Fatalf("planning: %d %s", r.status, r.body)
		}
		return decode[answer](t, r.body), r.body
	}

	a, body := read()
	if !strings.Contains(body, `{"categoryId":2,"plan":55000,"source":"budget","spent":29521,"rest":25479,"average":26821,"total":55000,"recurring":0}`) {
		t.Errorf("the shared account's Boodschappen entry is not on the wire as expected: %s", body)
	}
	var budgets, averages int
	for _, acc := range a.Accounts {
		for _, m := range acc.Months {
			for _, b := range m.Budgets {
				switch {
				case b.Recurring != 0:
					t.Errorf("account %d %s category %d: recurring %d, the seed assigns nothing", acc.ID, m.Month, b.CategoryID, b.Recurring)
				case b.Source == "budget" && b.Total == b.Plan:
					budgets++
				case b.Source == "average" && b.Total == 0:
					averages++
				default:
					t.Errorf("account %d %s: %+v", acc.ID, m.Month, b)
				}
			}
		}
	}
	if budgets == 0 || averages == 0 {
		t.Errorf("%d budget and %d average entries, want both", budgets, averages)
	}

	// Energie of the shared account goes to Boodschappen (budget 550): that category costs max(total, recurring) in
	// the need, not total + recurring, so every month's costs drop by the item's amount.
	energie := int64(p.count(`SELECT -amount FROM recurring_items WHERE account_id = 4 AND description = 'Energie'`))
	p.exec(`UPDATE recurring_items SET category_id = 2 WHERE account_id = 4 AND description = 'Energie'`)
	b, _ := read()
	for i, acc := range b.Accounts {
		if acc.ID != 4 {
			continue
		}
		for j, m := range acc.Months {
			was := a.Accounts[i].Months[j]
			if m.Contribution == nil || m.Contribution.Costs != was.Contribution.Costs-energie {
				t.Errorf("%s: costs %+v, want %d less %d", m.Month, m.Contribution, was.Contribution.Costs, energie)
			}
			for k, x := range m.Budgets {
				y := was.Budgets[k]
				if x.CategoryID == 2 && (x.Total != 55000 || x.Recurring != energie || x.Plan != 55000-energie) {
					t.Errorf("%s Boodschappen: %+v, want total 55000, recurring %d, plan %d", m.Month, x, energie, 55000-energie)
				}
				if x.CategoryID != 2 && x != y {
					t.Errorf("%s category %d changed: %+v, was %+v", m.Month, x.CategoryID, x, y)
				}
			}
		}
	}
}
