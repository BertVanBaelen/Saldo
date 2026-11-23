package server

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
)

// GET /api/reports/balances (0.8.1-5) on the demo seed, today 18 November 2026:
// Bert holds the Zichtrekening (1) and manages the Gedeelde rekening (4); Partner
// holds her own Zichtrekening (5) and is a member of 4. The points are the
// engine's past balances (planning/history.go); the goldens are 0.8-3's.

const balancesPath = "/api/reports/balances"

type balAnswerT struct {
	Accounts []balAccountT
}

type balAccountT struct {
	ID, Buffer int64
	FirstDate  *string
	Missing    bool
	Points     []struct {
		Date    string
		Balance int64
	}
}

func balancesOf(t *testing.T, r response) balAnswerT {
	t.Helper()
	if r.status != http.StatusOK {
		t.Fatalf("%d %s", r.status, r.body)
	}
	if strings.Contains(r.body, `"points":null`) || strings.Contains(r.body, `"accounts":null`) {
		t.Errorf("the answer holds a null list: %s", r.body)
	}
	return decode[balAnswerT](t, r.body)
}

// get is the account with that id.
func (a balAnswerT) get(t *testing.T, id int64) balAccountT {
	t.Helper()
	for _, acc := range a.Accounts {
		if acc.ID == id {
			return acc
		}
	}
	t.Fatalf("no account %d in %+v", id, a)
	return balAccountT{}
}

// points are the account's points as "date:balance", space separated.
func (a balAccountT) points() string {
	var s []string
	for _, p := range a.Points {
		s = append(s, fmt.Sprint(p.Date, ":", p.Balance))
	}
	return strings.Join(s, " ")
}

// month reads one month of the line the way the chart does: the lowest point in it (date and balance), the balance at
// its end (the last point up to the month's last day) and the days whose balance is under the buffer.
func (a balAccountT) month(month string) (lowDate string, low, end int64, under int) {
	start := func(day int) string { return fmt.Sprintf("%s-%02d", month, day) }
	for day := 1; day <= 31; day++ {
		bal, seen := int64(0), false
		for _, p := range a.Points {
			if p.Date <= start(day) {
				bal, seen = p.Balance, true
			}
		}
		if !seen {
			continue
		}
		end = bal
		if bal < a.Buffer {
			under++
		}
	}
	first := true
	for _, p := range a.Points {
		if strings.HasPrefix(p.Date, month) && (first || p.Balance < low) {
			lowDate, low, first = p.Date, p.Balance, false
		}
	}
	return lowDate, low, end, under
}

func TestReportBalancesDemo(t *testing.T) {
	p := newPair(t)
	for _, c := range []struct {
		name, query string
		account     int64
		firstDate   string
		buffer      int64
		points      string
	}{
		{"Zichtrekening November", "?account=1&from=2026-11", 1, "2025-11-01", 90000,
			"2026-10-31:102355 2026-11-01:-43145 2026-11-02:241855 2026-11-08:236615 2026-11-12:235216 2026-11-13:233381 2026-11-14:227131 2026-11-15:223281 2026-11-16:205131 2026-11-17:196882"},
		{"Gedeelde rekening November", "?account=4&from=2026-11", 4, "2025-11-01", 60000,
			"2026-10-31:52927 2026-11-01:142927 2026-11-03:128427 2026-11-05:121269 2026-11-09:116971 2026-11-11:114166 2026-11-12:111901 2026-11-13:108687 2026-11-16:103250 2026-11-18:94608"},
		// The line stops with the last selected month: October alone has no November point.
		{"Zichtrekening October", "?account=1&from=2026-10&to=2026-10", 1, "2025-11-01", 90000,
			"2026-09-30:-2692 2026-10-01:-148192 2026-10-02:136808 2026-10-08:130518 2026-10-10:135518 2026-10-12:134119 2026-10-14:132159 2026-10-16:112159 2026-10-17:110960 2026-10-22:105150 2026-10-24:102355"},
		// No line before the first booked row (1 November 2025): the first point is that day's end.
		{"before the first booked row", "?account=1&from=2025-10&to=2025-11", 1, "2025-11-01", 90000,
			"2025-11-01:-1237315 2025-11-02:-952315 2025-11-08:-958005 2025-11-12:-959404 2025-11-16:-979404 2025-11-17:-980603 2025-11-20:-983003 2025-11-22:-989413 2025-11-25:-990512"},
	} {
		acc := balancesOf(t, p.bert("GET", balancesPath+c.query, "")).get(t, c.account)
		if got := acc.points(); got != c.points {
			t.Errorf("%s: points\n%s\nwant\n%s", c.name, got, c.points)
		}
		if acc.Buffer != c.buffer || acc.Missing || acc.FirstDate == nil || *acc.FirstDate != c.firstDate {
			t.Errorf("%s: buffer %d, missing %v, firstDate %v", c.name, acc.Buffer, acc.Missing, acc.FirstDate)
		}
	}

	// Identity (0.8-3 rule 2): the running month's points are the forecast's own past days and the point before it is
	// the month's start, read from GET /api/planning for each account.
	type planned struct {
		Accounts []struct {
			ID     int64
			Months []struct{ Start int64 }
			Days   []struct {
				Date    string
				Balance int64
			}
		}
	}
	plan := decode[planned](t, p.bert("GET", "/api/planning", "").body)
	line := balancesOf(t, p.bert("GET", balancesPath+"?from=2026-11", ""))
	for _, pa := range plan.Accounts {
		acc, days := line.get(t, pa.ID), map[string]int64{}
		for _, d := range pa.Days {
			days[d.Date] = d.Balance
		}
		if len(acc.Points) < 2 || acc.Points[0].Date != "2026-10-31" || acc.Points[0].Balance != pa.Months[0].Start {
			t.Errorf("account %d: first point %+v, the month's start %d", pa.ID, acc.Points, pa.Months[0].Start)
		}
		for _, pt := range acc.Points[1:] {
			if want, ok := days[pt.Date]; !ok || pt.Balance != want {
				t.Errorf("account %d on %s: point %d, forecast day %d (found %v)", pa.ID, pt.Date, pt.Balance, want, ok)
			}
		}
	}

	// What the chart's stats read from the points (Overzicht's Saldo card).
	z := balancesOf(t, p.bert("GET", balancesPath+"?account=1&from=2026-10", "")).get(t, 1)
	if date, low, end, under := z.month("2026-10"); date != "2026-10-01" || low != -148192 || end != 102355 || under != 1 {
		t.Errorf("October: low %d on %s, end %d, %d days under the buffer", low, date, end, under)
	}
	if date, low, end, under := z.month("2026-11"); date != "2026-11-01" || low != -43145 || end != 196882 || under != 1 {
		t.Errorf("November: low %d on %s, end %d, %d days under the buffer", low, date, end, under)
	}

	// Several accounts: one entry each, in the report's account order, never a sum; the scope narrows them.
	for query, ids := range map[string][]int64{"?from=2026-11": {1, 4}, "?scope=alles&from=2026-11": {1, 4}, "?scope=persoonlijk&from=2026-11": {1}, "?scope=gedeeld&from=2026-11": {4}} {
		var got []int64
		for _, acc := range balancesOf(t, p.bert("GET", balancesPath+query, "")).Accounts {
			got = append(got, acc.ID)
		}
		if !slices.Equal(got, ids) {
			t.Errorf("%s: accounts %v, want %v", query, got, ids)
		}
	}
	// Without from the line starts at the first booked month of the selection.
	if acc := balancesOf(t, p.bert("GET", balancesPath+"?account=1", "")).get(t, 1); len(acc.Points) == 0 || acc.Points[0].Date != *acc.FirstDate {
		t.Errorf("default range: %s", acc.points())
	}

	// An account without a balance snapshot answers an explicit marker and no point (its buffer stays).
	p.exec(`DELETE FROM balance_snapshots WHERE account_id = 1`)
	a := balancesOf(t, p.bert("GET", balancesPath+"?from=2026-11", ""))
	if z := a.get(t, 1); !z.Missing || len(z.Points) != 0 || z.Buffer != 90000 || z.points() != "" {
		t.Errorf("without a balance: %+v", z)
	}
	if g := a.get(t, 4); g.Missing || g.points() == "" {
		t.Errorf("the other account follows its own balance: %+v", g)
	}
	if !strings.Contains(p.bert("GET", balancesPath+"?account=1", "").body, `"points":[]`) {
		t.Error("a missing balance has no points array")
	}

	// A selection without accounts: an empty list, never null.
	p.exec(`DELETE FROM account_access WHERE account_id = 4 AND user_id = 2`)
	r := p.partner("GET", balancesPath+"?scope=gedeeld", "")
	equalJSON(t, r.body, `{"accounts": []}`)
}

func TestReportBalancesErrors(t *testing.T) {
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
		if msg := expectError(t, p.bert("GET", balancesPath+query, ""), http.StatusBadRequest, "invalid"); msg != want {
			t.Errorf("%s: %q, want %q", query, msg, want)
		}
	}
	// Another user's account, an unknown id and a malformed one are the same 404; a month error comes first.
	missing := p.bert("GET", balancesPath+"?account=999999", "")
	if msg := expectError(t, missing, http.StatusNotFound, "not_found"); msg != msgAccountNotFound {
		t.Errorf("missing account: %q", msg)
	}
	for _, query := range []string{"?account=5", "?account=abc", "?account=0", "?account=-1"} {
		if r := p.bert("GET", balancesPath+query, ""); r.status != missing.status || r.body != missing.body {
			t.Errorf("%s: %d %s, want the answer of a missing account", query, r.status, r.body)
		}
	}
	for _, query := range []string{"?account=1", "?account=2"} {
		if r := p.partner("GET", balancesPath+query, ""); r.status != missing.status || r.body != missing.body {
			t.Errorf("Partner %s: %d %s", query, r.status, r.body)
		}
	}
	expectError(t, p.bert("GET", balancesPath+"?account=5&to=2026-12", ""), http.StatusBadRequest, "invalid")
	expectError(t, p.bert("POST", balancesPath, ""), http.StatusMethodNotAllowed, "method_not_allowed")

	// The shared account answers Bert and Partner byte for byte (the history is account-level).
	const shared = "?account=4&from=2026-09"
	bert, partner := p.bert("GET", balancesPath+shared, ""), p.partner("GET", balancesPath+shared, "")
	if bert.status != http.StatusOK || bert.body != partner.body {
		t.Errorf("shared account differs between the members:\n%s\n%s", bert.body, partner.body)
	}
	// Partner's own account is hers alone, and her balance never reaches Bert's answer.
	own := balancesOf(t, p.partner("GET", balancesPath+"?account=5&from=2026-11", "")).get(t, 5)
	if len(own.Points) == 0 {
		t.Fatalf("Partner's own account has no line: %+v", own)
	}
	for _, query := range []string{"", "?from=2026-11", "?scope=persoonlijk", "?scope=gedeeld"} {
		for _, acc := range balancesOf(t, p.bert("GET", balancesPath+query, "")).Accounts {
			if acc.ID != 1 && acc.ID != 4 {
				t.Errorf("Bert's answer %q holds account %d", query, acc.ID)
			}
		}
	}
}
