package planning

import (
	"cmp"
	"slices"
	"time"
)

// Recurring-item detection (plan 0.8-2): pure functions that turn an
// account's booked rows into suggested recurring items and a report per
// group of rows saying why it was or was not suggested. Suggestions are
// computed on read and never stored. Every threshold is a constant here, so
// the real-data check changes them in one place (with a fixture case in
// TestDetect for each change).

const (
	// detectTolerance is how far (percent) a row's amount may lie from the
	// run's median and still count as "the same amount".
	detectTolerance = 10
	// detectShare is the percentage of a run's kept rows that must lie
	// within detectTolerance of the median.
	detectShare = 75
	// detectExtrasDivisor: a run may hold at most kept/detectExtrasDivisor
	// (rounded down) extra rows, so a twice-a-month pattern is refused.
	detectExtrasDivisor = 4
)

// detectFreq is one frequency the detection tries: the gap in days between
// two kept rows, the minimum number of kept rows and how old (days before
// today) the run's last kept row may be.
type detectFreq struct {
	name             string
	minGap, maxGap   int
	minRows, maxAge  int
	monthOfLastInRun bool // quarterly and yearly carry a month
}

// detectFrequencies are tried in this order; the first whose candidate run
// passes every test wins.
var detectFrequencies = []detectFreq{
	{name: "monthly", minGap: 25, maxGap: 35, minRows: 3, maxAge: 45},
	{name: "quarterly", minGap: 80, maxGap: 100, minRows: 3, maxAge: 100, monthOfLastInRun: true},
	{name: "yearly", minGap: 350, maxGap: 380, minRows: 2, maxAge: 400, monthOfLastInRun: true},
}

// The verdicts of the detection report.
const (
	DetectSuggested = "suggested"
	DetectCovered   = "covered" // a confirmed item of the account has the group's key and sign
	DetectIgnored   = "ignored" // an ignored item has them
	DetectTooFew    = "too few" // no run long enough
	DetectStale     = "stale"   // the run's last row is too old
	DetectAmount    = "amount"  // too few rows within the tolerance of the median
	DetectExtras    = "extras"  // more extra rows than a quarter of the kept ones
)

// DetectRow is one booked row of the account (amount ≠ 0, dated today or
// earlier).
type DetectRow struct {
	Date   string // YYYY-MM-DD
	Amount int64
	Name   string // counterparty name as the bank wrote it
	IBAN   string // normalised counterparty IBAN, "" when the row has none
	Saving bool   // its top category is a saving category
}

// DetectAccount is what the kind of a suggestion depends on. OwnSavings and
// OwnCurrent (the viewer's other accounts by normalised IBAN) are used on a
// personal account only, Senders (the claimed contribution senders) on a
// shared one only.
type DetectAccount struct {
	ID                     int64
	Shared                 bool
	OwnSavings, OwnCurrent map[string]bool
	Senders                map[string]bool
}

// DetectSuggestion is a suggested recurring item (GET
// /api/planning/suggestions). It never carries the counterparty IBAN.
type DetectSuggestion struct {
	AccountID    int64  `json:"accountId"`
	Counterparty string `json:"counterparty"` // the raw name of the run's newest row
	Description  string `json:"description"`  // the same text; the user renames it
	Amount       int64  `json:"amount"`       // the run's median
	AmountRule   string `json:"amountRule"`   // fixed | average
	Frequency    string `json:"frequency"`
	Day          int    `json:"day"`
	Month        *int   `json:"month"` // nil for monthly
	Kind         string `json:"kind"`
	Seen         int    `json:"seen"`
}

// DetectRun is the candidate run of one frequency in the report.
type DetectRun struct {
	Frequency string `json:"frequency"`
	Length    int    `json:"length"` // kept rows; 0 without a candidate
	Extras    int    `json:"extras"`
	First     string `json:"first,omitempty"`
	Last      string `json:"last,omitempty"`
	Median    int64  `json:"median"`
	Within    int    `json:"within"` // rounded percent of the kept rows within the tolerance
	Verdict   string `json:"verdict"`
}

// DetectGroup is one group of rows (same key, sign and counterparty IBAN)
// with its runs and verdict. Suggestion is set when the verdict is
// suggested.
type DetectGroup struct {
	Key        string            `json:"key"`
	Sign       int               `json:"sign"`
	Rows       int               `json:"rows"`
	Newest     string            `json:"newest"`
	Verdict    string            `json:"verdict"`
	Runs       []DetectRun       `json:"runs"`
	Suggestion *DetectSuggestion `json:"suggestion,omitempty"`

	iban string
}

// Detect groups the rows (by Key of the counterparty name, sign and IBAN;
// rows with an empty key are skipped), finds per frequency the candidate run
// and judges it. items are the account's confirmed and ignored items: a
// group that one covers (detectCovers) is not suggested. today is the
// Brussels date. Groups are ordered by key, sign (income first) and IBAN.
func Detect(today string, acc DetectAccount, rows []DetectRow, items []DetectItem) []DetectGroup {
	now := detectDay(today)
	byGroup := map[[3]string][]DetectRow{}
	var order [][3]string
	for _, r := range rows {
		k := Key(r.Name)
		if k == "" || r.Amount == 0 || r.Date > today {
			continue
		}
		id := [3]string{k, detectSignText(r.Amount), r.IBAN}
		if _, ok := byGroup[id]; !ok {
			order = append(order, id)
		}
		byGroup[id] = append(byGroup[id], r)
	}
	// Rows without an IBAN (a Bilance import) join the one IBAN group of their
	// key and sign, so a mixed history is one run; with two IBAN groups (one
	// name to the shared account and to savings) they stay apart.
	all := slices.Clone(order)
	order = slices.DeleteFunc(order, func(id [3]string) bool {
		if id[2] != "" {
			return false
		}
		var into [][3]string
		for _, o := range all {
			if o[0] == id[0] && o[1] == id[1] && o[2] != "" {
				into = append(into, o)
			}
		}
		if len(into) != 1 {
			return false
		}
		byGroup[into[0]] = append(byGroup[into[0]], byGroup[id]...)
		return true
	})
	slices.SortFunc(order, func(a, b [3]string) int {
		return cmp.Or(cmp.Compare(a[0], b[0]), cmp.Compare(a[1], b[1]), cmp.Compare(a[2], b[2]))
	})
	out := make([]DetectGroup, 0, len(order))
	for _, id := range order {
		g := byGroup[id]
		slices.SortStableFunc(g, func(a, b DetectRow) int { return cmp.Compare(a.Date, b.Date) })
		group := DetectGroup{Key: id[0], Sign: 1, Rows: len(g), Newest: g[len(g)-1].Date, iban: id[2]}
		if g[0].Amount < 0 {
			group.Sign = -1
		}
		for _, f := range detectFrequencies {
			run, s := detectJudge(g, f, now, acc)
			group.Runs = append(group.Runs, run)
			if group.Verdict == "" && run.Length > 0 || run.Verdict == DetectSuggested && group.Suggestion == nil {
				group.Verdict = run.Verdict // the first frequency with a candidate run gives the reason
			}
			if s != nil && group.Suggestion == nil {
				group.Suggestion = s
			}
		}
		if group.Verdict == "" {
			group.Verdict = DetectTooFew
		}
		found := group.Suggestion
		for _, it := range items {
			if group.Verdict != DetectCovered && detectCovers(it, id, g, found) { // confirmed wins over ignored
				group.Verdict, group.Suggestion = map[string]string{"confirmed": DetectCovered, "ignored": DetectIgnored}[it.State], nil
			}
		}
		out = append(out, group)
	}
	return out
}

// DetectItem is a confirmed or ignored item of the account as detection
// needs it, with the counterparty IBAN it stores (never shown).
type DetectItem struct {
	Counterparty, IBAN string
	Amount             int64
	State              string
}

// detectCovers says whether an item hides a group (key, sign, IBAN): the same
// key and sign and, when the item stores an IBAN, the same IBAN; an item
// without one only when the group's amount (the suggestion's, else the median
// of its rows) lies within detectTolerance of the item's. So a holder's € 200
// savings order does not hide the € 450 contribution under the same name.
func detectCovers(it DetectItem, id [3]string, g []DetectRow, s *DetectSuggestion) bool {
	if k := Key(it.Counterparty); k == "" || it.Amount == 0 || k != id[0] || detectSignText(it.Amount) != id[1] {
		return false
	}
	if it.IBAN != "" {
		return it.IBAN == id[2]
	}
	var amount int64
	if s != nil {
		amount = s.Amount
	} else {
		all := make([]int64, len(g))
		for i, r := range g {
			all[i] = r.Amount
		}
		amount = detectMedian(all)
	}
	return 100*detectAbs(amount-it.Amount) <= detectTolerance*detectAbs(it.Amount)
}

// detectJudge finds the candidate run of one frequency in a group's rows
// (sorted by date) and judges it; the suggestion is non-nil when it passes.
func detectJudge(g []DetectRow, f detectFreq, now time.Time, acc DetectAccount) (DetectRun, *DetectSuggestion) {
	run := DetectRun{Frequency: f.name, Verdict: DetectTooFew}
	var kept []DetectRow
	var extras int
	var curKept []DetectRow
	var curExtras int
	for _, r := range g {
		if len(curKept) > 0 {
			gap := detectDays(curKept[len(curKept)-1].Date, r.Date)
			if gap < f.minGap {
				curExtras++
				if len(curKept) >= f.minRows {
					extras = curExtras // an extra after the run's last kept row
				}
				continue
			}
			if gap > f.maxGap {
				curKept, curExtras = nil, 0
			}
		}
		curKept = append(curKept, r)
		if len(curKept) >= f.minRows {
			kept, extras = curKept, curExtras // the latest run long enough
		}
	}
	if kept == nil {
		return run, nil
	}
	amounts := make([]int64, len(kept))
	for i, r := range kept {
		amounts[i] = r.Amount
	}
	median := detectMedian(amounts)
	within := 0
	for _, a := range amounts {
		if 100*detectAbs(a-median) <= detectTolerance*detectAbs(median) {
			within++
		}
	}
	last := kept[len(kept)-1]
	run.Length, run.Extras, run.First, run.Last, run.Median = len(kept), extras, kept[0].Date, last.Date, median
	run.Within = (200*within + len(kept)) / (2 * len(kept)) // rounded percent
	switch {
	case detectDays(last.Date, now.Format(time.DateOnly)) > f.maxAge:
		run.Verdict = DetectStale
	case extras > len(kept)/detectExtrasDivisor:
		run.Verdict = DetectExtras
	case 100*within < detectShare*len(kept):
		run.Verdict = DetectAmount
	default:
		run.Verdict = DetectSuggested
	}
	if run.Verdict != DetectSuggested {
		return run, nil
	}
	rule := "fixed"
	for _, a := range amounts {
		if a != amounts[0] {
			rule = "average"
		}
	}
	days := make([]int, len(kept))
	for i, r := range kept {
		days[i] = detectDay(r.Date).Day()
	}
	slices.Sort(days)
	s := &DetectSuggestion{AccountID: acc.ID, Counterparty: last.Name, Description: last.Name, Amount: median, AmountRule: rule,
		Frequency: f.name, Day: days[(len(days)-1)/2], Kind: detectKind(acc, last, median), Seen: len(kept)}
	if f.monthOfLastInRun {
		m := int(detectDay(last.Date).Month())
		s.Month = &m
	}
	return run, s
}

// detectKind prefills the kind of a suggestion from the run's newest row. On
// a shared account the counterparty IBAN only says "claimed contribution
// sender" (an account-level fact); it is never compared with a member's own
// accounts. Every kind returned passes the item validation of 0.8-1.
func detectKind(acc DetectAccount, newest DetectRow, amount int64) string {
	switch {
	case newest.Saving && amount < 0:
		return "saving"
	case acc.Shared:
		if amount > 0 && newest.IBAN != "" && acc.Senders[newest.IBAN] {
			return "contribution"
		}
	case newest.IBAN != "" && acc.OwnSavings[newest.IBAN]:
		if amount < 0 {
			return "saving"
		}
		return "transfer"
	case newest.IBAN != "" && acc.OwnCurrent[newest.IBAN]:
		return "transfer"
	}
	if amount > 0 {
		return "income"
	}
	return "expense"
}

// detectMedian is the median of the amounts; for an even count the mean of
// the two middle values, rounded half away from zero to a cent.
func detectMedian(amounts []int64) int64 {
	s := slices.Clone(amounts)
	slices.Sort(s)
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	sum := s[n/2-1] + s[n/2]
	if sum >= 0 {
		return (sum + 1) / 2
	}
	return (sum - 1) / 2
}

func detectAbs(a int64) int64 {
	if a < 0 {
		return -a
	}
	return a
}

func detectSignText(a int64) string {
	if a < 0 {
		return "-"
	}
	return "+"
}

// detectDay parses a YYYY-MM-DD date (UTC, for day counts).
func detectDay(d string) time.Time {
	t, _ := time.Parse(time.DateOnly, d)
	return t
}

// detectDays is the number of days from a to b.
func detectDays(a, b string) int {
	return int(detectDay(b).Sub(detectDay(a)).Hours() / 24)
}
