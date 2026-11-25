package planning

import (
	"cmp"
	"slices"
	"strings"
	"time"
)

// The forecast engine (plan 0.8-3): Project turns the viewer-free facts of one
// current account into its month chain, daily line, states, free to spend and
// required contribution. Pure: every rule is tested on hand-built Facts.

// AccountForecast is every planning number of one current account.
type AccountForecast struct {
	AccountID   int64
	Buffer      int64
	Balance     int64            // the start: snapshot + booked rows after the snapshot date, up to today
	BalanceDate string           // the snapshot's date
	DataDate    string           // the newest date Saldo has the account's rows for (rule 5)
	Months      []Month          // running month first, then horizon months
	Days        map[string][]Day // per month "YYYY-MM": every day of that month
	Missed      []Missed         // expected but not seen, no longer counted (rule 5b)
}

// Missed is an occurrence "Verwacht, niet gezien".
type Missed struct {
	ItemID int64
	Label  string
	Date   string
	Amount int64
}

// Need is a shared account's required contribution for a month (rule 12).
type Need struct{ Amount, Costs, OtherIncome, BufferGap int64 }

// Month is one month of the chain.
type Month struct {
	Month              string // "2026-11"
	Start, End         int64  // start: end of the previous month (running month: the real end of last month)
	Left               int64  // End - Buffer: free to spend (negative: Tekort)
	State              string // ok | buffer | red, from End
	Income, Out, Saved int64  // Start + Income - Out - Saved == End
	Low                Day    // the lowest end-of-day balance (earliest on a tie)
	Lines              []Line
	Budgets            []Budget
	Need               Need
}

// Day is the end-of-day balance of one date and what happens on it.
type Day struct {
	Date    string
	Balance int64
	State   string
	Items   []Item
}

// Item is one entry of a day. Kind: booked | pending | late | missed |
// recurring | planned | variable. ID is the transaction id (booked, a pending
// row without an occurrence), the recurring item id (recurring, late, missed, a
// pending row matched to an occurrence), the planned item id (planned), 0 for
// variable. A missed item does not change the balance.
type Item struct {
	Kind   string
	Label  string
	Amount int64
	ID     int64
}

// Line is one row of a month's breakdown; keys: today (running month) or
// start, recurringIn, recurringOut, pending, planned, variable, saving, end,
// buffer, free, and missed (running month only, amount 0).
type Line struct {
	Key    string
	Amount int64
	Labels []string
}

// Budget is a variable category's plan for a month. Source: budget | average.
// A budget row is the month's total for the category (plan 0.9.1-4): Plan is
// the extra on top of Recurring, max(0, Total - Recurring); without a row Plan
// is the variable average and Total is 0. Spent is the running month's (0
// later); Rest = max(0, Plan - Spent).
type Budget struct {
	CategoryID int64
	Plan       int64
	Source     string
	Spent      int64
	Rest       int64
	Average    int64 // the category's history average (variable spending), whatever Source is
	Total      int64 // the budget row in effect (0 for average)
	Recurring  int64 // the month's occurrences of the confirmed expense items assigned to the category
}

// Facts are what the forecast of one account is built on, all account-level.
type Facts struct {
	AccountID   int64
	Buffer      int64
	Balance     int64  // the latest snapshot's balance
	BalanceDate string // its date
	DataDate    string // see rule 5: newest ok sync (bank) or the later of snapshot and newest booked row
	FirstBooked string // the account's first booked row ever, "" without one
	Rows        []FactRow
	Items       []FactItem // confirmed only
	Budgets     []FactBudget
	Planned     []FactPlanned
}

// FactRow is a transaction of the account; Parts are its category parts (one
// part with the whole amount when it is not split).
type FactRow struct {
	ID      int64
	Date    string
	Amount  int64
	Pending bool
	Name    string // counterparty name
	IBAN    string // counterparty IBAN, normalised
	Parts   []FactPart
}

// FactPart is an amount in a top category (0: uncategorised). Variable: an
// expense top category that is not saving. Saving: a saving top category. Own
// is the part's own category, a subcategory or a top one (0: uncategorised);
// only SuggestCategories reads it.
type FactPart struct {
	Category int64
	Amount   int64
	Variable bool
	Saving   bool
	Own      int64
}

// FactItem is a confirmed recurring item.
type FactItem struct {
	ID           int64
	Description  string
	Counterparty string
	IBAN         string
	Amount       int64
	Average      bool   // amount_rule average
	Frequency    string // monthly | quarterly | yearly
	Day          int
	Month        int    // anchor (quarterly) or month (yearly); 0 for monthly
	EndDate      string // "" none
	Kind         string // income | expense | saving | transfer | contribution
	Category     int64  // the top expense category the item is assigned to (0: none; the loader sets it for expense items only)
}

// FactBudget is a budget row of a valid category; Amount nil: use the average.
type FactBudget struct {
	Category int64
	From     string // YYYY-MM
	Amount   *int64
}

// FactPlanned is a planned one-off item. WholeMonth: no day, Date is the
// month's 1st and the amount is spread over the month (rule 6b, plan 0.8.1-9).
type FactPlanned struct {
	ID          int64
	Date        string
	Amount      int64
	Description string
	WholeMonth  bool
}

const (
	fcMatchDays   = 7  // rule 4: a row within ±7 days matches; rule 5: late for 7 days
	fcPendingDays = 14 // rule 4: pending rows of the last 14 days count
	fcHistory     = 6  // rule 7: at most 6 complete months of history
	// VariableLabel is the label of the spread variable spending.
	VariableLabel = "Dagelijkse uitgaven (schatting)"
)

// Dates: YYYY-MM-DD strings, arithmetic on UTC midnight (no DST).
func fcDate(s string) time.Time { t, _ := time.Parse(time.DateOnly, s); return t }
func fcDay(s string) int        { return int(fcDate(s).Unix() / 86400) }
func fcAddDays(s string, n int) string {
	return fcDate(s).AddDate(0, 0, n).Format(time.DateOnly)
}
func fcAddMonths(ym string, n int) string {
	t, _ := time.Parse("2006-01", ym)
	return t.AddDate(0, n, 0).Format("2006-01")
}
func fcDaysIn(ym string) int {
	t, _ := time.Parse("2006-01", ym)
	return t.AddDate(0, 1, -1).Day()
}

// fcOn is the date of day d in month ym, clamped to the month's last day.
func fcOn(ym string, d int) string {
	return ym + "-" + time.Date(2000, 1, min(d, fcDaysIn(ym)), 0, 0, 0, 0, time.UTC).Format("02")
}

// fcFalls says whether a recurring item has an occurrence in month ym (rule 3).
func fcFalls(it FactItem, ym string) bool {
	t, _ := time.Parse("2006-01", ym)
	switch it.Frequency {
	case "quarterly":
		return ((int(t.Month())-it.Month)%3+3)%3 == 0
	case "yearly":
		return int(t.Month()) == it.Month
	}
	return true
}

// fcStep is the number of months between occurrences.
func fcStep(it FactItem) int {
	switch it.Frequency {
	case "quarterly":
		return 3
	case "yearly":
		return 12
	}
	return 1
}

// fcDivRound divides rounding half away from zero.
func fcDivRound(sum, n int64) int64 {
	if sum < 0 {
		return -((-2*sum + n) / (2 * n))
	}
	return (2*sum + n) / (2 * n)
}

func fcState(balance, buffer int64) string {
	switch {
	case balance < 0:
		return "red"
	case balance < buffer:
		return "buffer"
	}
	return "ok"
}

type fcRow struct {
	FactRow
	day   int
	key   string
	match int // index of the occurrence it matched, -1
}

type fcOcc struct {
	item   int // index in Facts.Items
	date   string
	amount int64
	row    int // index of the matched row, -1
}

// fcEvent is something expected after today: an item on a date with the line
// it belongs to.
type fcEvent struct {
	date   string
	item   Item
	line   string // recurringIn | recurringOut | pending | planned | saving
	saving bool
}

// fcPass is the result of the match pass: the rows of the window, the
// occurrences up to the last month, which row each occurrence matched (and
// which occurrence each row), the history months and the fit test.
type fcPass struct {
	rows   []fcRow
	occs   []fcOcc
	hist   []string
	isHist map[string]bool
	fits   func(int, fcRow) bool
}

// fcMatch is the match pass of Project (rules 3, 4 and 7's history months),
// also run by SuggestCategories: rows, occurrences up to lastMonth, matching.
func fcMatch(f Facts, today, lastMonth string) fcPass {
	run := today[:7]
	pendingFrom := fcAddDays(today, -fcPendingDays)

	// Rows: booked up to today, pending of the last 14 days (rule 4).
	var rows []fcRow
	for _, r := range f.Rows {
		if r.Date > today || r.Pending && r.Date < pendingFrom {
			continue
		}
		rows = append(rows, fcRow{FactRow: r, day: fcDay(r.Date), key: Key(r.Name), match: -1})
	}
	slices.SortFunc(rows, func(a, b fcRow) int { return cmp.Or(cmp.Compare(a.Date, b.Date), cmp.Compare(a.ID, b.ID)) })

	// History months (rule 7).
	booked := map[string]bool{}
	for _, r := range rows {
		if !r.Pending {
			booked[r.Date[:7]] = true
		}
	}
	hist := HistoryMonths(f.FirstBooked, booked, today)
	isHist := map[string]bool{}
	for _, m := range hist {
		isHist[m] = true
	}

	// Occurrences from the first history month (the running month without
	// history; never later than today - 7, so a late item is seen) to the
	// last month of the answer (rule 3).
	occStart := run + "-01"
	if len(hist) > 0 {
		occStart = hist[0] + "-01"
	}
	occStart = min(occStart, fcAddDays(today, -fcMatchDays))
	var occs []fcOcc
	for i, it := range f.Items {
		for m := occStart[:7]; m <= lastMonth; m = fcAddMonths(m, 1) {
			if !fcFalls(it, m) {
				continue
			}
			d := fcOn(m, it.Day)
			if d < occStart || it.EndDate != "" && d > it.EndDate {
				continue
			}
			occs = append(occs, fcOcc{item: i, date: d, amount: it.Amount, row: -1})
		}
	}
	slices.SortFunc(occs, func(a, b fcOcc) int {
		return cmp.Or(cmp.Compare(a.date, b.date), cmp.Compare(f.Items[a.item].ID, f.Items[b.item].ID))
	})

	// Matching (rule 4): one pass in date order across months.
	keys := make([]string, len(f.Items))
	for i, it := range f.Items {
		keys[i] = Key(it.Counterparty)
	}
	fits := func(i int, r fcRow) bool {
		it := f.Items[i]
		switch {
		case r.Amount == 0 || (r.Amount > 0) != (it.Amount > 0):
			return false
		case it.IBAN != "" && r.IBAN != "":
			return r.IBAN == it.IBAN
		case it.IBAN != "": // a row without an IBAN (a Bilance import): key and an amount within 10 %
			return keys[i] != "" && r.key == keys[i] && 10*fcAbs64(r.Amount-it.Amount) <= fcAbs64(it.Amount)
		case strings.TrimSpace(it.Counterparty) != "":
			return keys[i] != "" && r.key == keys[i]
		}
		return r.Amount == it.Amount
	}
	matchUntil := fcAddDays(today, fcMatchDays)
	for o := range occs {
		oc := &occs[o]
		if oc.date > matchUntil {
			break
		}
		od, best := fcDay(oc.date), -1
		var bestDist, bestDiff int64
		for j, r := range rows {
			dist := int64(fcAbs(r.day - od))
			if r.match >= 0 || dist > fcMatchDays || !fits(oc.item, r) {
				continue
			}
			diff := fcAbs64(r.Amount - f.Items[oc.item].Amount)
			if best < 0 || dist < bestDist || dist == bestDist && diff < bestDiff {
				best, bestDist, bestDiff = j, dist, diff
			}
		}
		if best >= 0 {
			oc.row, rows[best].match = best, o
		}
	}
	return fcPass{rows: rows, occs: occs, hist: hist, isHist: isHist, fits: fits}
}

// Project computes the forecast from the facts (rules 1–12 of plan 0.8-3).
// horizon is clamped to 3 … 24.
func Project(f Facts, today string, horizon int) AccountForecast {
	horizon = min(max(horizon, 3), 24)
	run := today[:7]
	months := make([]string, horizon+1)
	for i := range months {
		months[i] = fcAddMonths(run, i)
	}
	lastMonth := months[horizon]
	tomorrow := fcAddDays(today, 1)
	dataDate := min(cmp.Or(f.DataDate, today), today)
	pass := fcMatch(f, today, lastMonth)
	rows, occs, hist, isHist, fits := pass.rows, pass.occs, pass.hist, pass.isHist, pass.fits

	// Amounts (rule 6): an average item counts the mean of its matched rows in
	// the 6 complete months before the running month.
	windowStart := fcAddMonths(run, -fcHistory)
	inWindow := func(d string) bool { return d >= windowStart && d < run }
	for i, it := range f.Items {
		if !it.Average {
			continue
		}
		var sum, n int64
		for _, oc := range occs {
			if oc.item == i && oc.row >= 0 && !rows[oc.row].Pending && inWindow(rows[oc.row].Date[:7]) {
				sum += rows[oc.row].Amount
				n++
			}
		}
		if n > 0 {
			avg := fcDivRound(sum, n)
			for o := range occs {
				if occs[o].item == i {
					occs[o].amount = avg
				}
			}
		}
	}

	// Assigned costs (plan 0.9.1-4): per top category and month, every occurrence
	// of its assigned items, paid, late, missed or still to come alike (known
	// limits: a missed one frees its part of the total).
	recurring := map[int64]map[string]int64{}
	for _, oc := range occs {
		if c := f.Items[oc.item].Category; c != 0 {
			if recurring[c] == nil {
				recurring[c] = map[string]int64{}
			}
			recurring[c][oc.date[:7]] -= oc.amount
		}
	}

	// What still comes (rule 5) and what was missed (5b).
	var events []fcEvent
	itemLine := func(it FactItem, amount int64) string {
		switch {
		case it.Kind == "saving":
			return "saving"
		case amount > 0:
			return "recurringIn"
		}
		return "recurringOut"
	}
	var missed []Missed
	for o, oc := range occs {
		it := f.Items[oc.item]
		withCP := strings.TrimSpace(it.Counterparty) != "" || it.IBAN != ""
		ev := fcEvent{date: oc.date, saving: it.Kind == "saving", item: Item{Label: it.Description, Amount: oc.amount, ID: it.ID}}
		switch {
		case oc.row >= 0 && rows[oc.row].Pending:
			ev.date, ev.item.Kind, ev.item.Amount = tomorrow, "pending", rows[oc.row].Amount
			ev.line = "pending"
			if ev.saving {
				ev.line = "saving"
			}
		case oc.row >= 0:
			continue
		case oc.date > today:
			ev.item.Kind, ev.line = "recurring", itemLine(it, oc.amount)
		case oc.date > dataDate, withCP && oc.date >= fcAddDays(today, -fcMatchDays):
			ev.date, ev.item.Kind, ev.line = tomorrow, "late", itemLine(it, oc.amount)
		case !withCP:
			continue // assumed paid
		default:
			if fcMissed(f, o, occs, rows, fits, today) {
				missed = append(missed, Missed{ItemID: it.ID, Label: it.Description, Date: oc.date, Amount: oc.amount})
			}
			continue
		}
		events = append(events, ev)
	}
	for _, r := range rows {
		if r.Pending && r.match < 0 {
			events = append(events, fcEvent{date: tomorrow, line: "pending", item: Item{Kind: "pending", Label: r.Name, Amount: r.Amount, ID: r.ID}})
		}
	}
	spreadOn := map[string][]fcEvent{} // rule 6b: dayless items, per day after the variable item
	for _, p := range f.Planned {
		ev := fcEvent{date: max(p.Date, tomorrow), line: "planned", item: Item{Kind: "planned", Label: p.Description, Amount: p.Amount, ID: p.ID}}
		if p.WholeMonth {
			m := p.Date[:7]
			if m < run || m > lastMonth {
				continue
			}
			first, n := 1, fcDaysIn(m)
			if m == run {
				first = fcDate(today).Day() + 1
			}
			d := int64(n - first + 1)
			if d <= 0 { // the running month's last day: the whole amount on tomorrow
				events = append(events, ev)
				continue
			}
			v := p.Amount / d
			for k := first; k <= n; k++ {
				part := v
				if k == n {
					part = p.Amount - v*(d-1)
				}
				if part != 0 {
					e := ev
					e.date, e.item.Amount = fcOn(m, k), part
					spreadOn[e.date] = append(spreadOn[e.date], e)
				}
			}
			continue
		}
		if p.Date < today || p.Date[:7] > lastMonth {
			continue
		}
		events = append(events, ev)
	}
	slices.SortStableFunc(events, func(a, b fcEvent) int { return cmp.Compare(a.date, b.date) })
	byDate := map[string][]fcEvent{}
	for _, ev := range events {
		byDate[ev.date] = append(byDate[ev.date], ev)
	}
	missedOn := map[string][]Item{}
	for _, m := range missed {
		missedOn[m.Date] = append(missedOn[m.Date], Item{Kind: "missed", Label: m.Label, Amount: m.Amount, ID: m.ItemID})
	}

	// Variable spending (rule 7).
	spent := map[int64]map[string]int64{}
	cats := map[int64]bool{}
	for _, r := range rows {
		m := r.Date[:7]
		if r.match >= 0 || !(isHist[m] && !r.Pending || m == run) {
			continue
		}
		for _, p := range r.Parts {
			if !p.Variable {
				continue
			}
			if spent[p.Category] == nil {
				spent[p.Category] = map[string]int64{}
			}
			spent[p.Category][m] -= p.Amount
			cats[p.Category] = true
		}
	}
	for _, b := range f.Budgets {
		cats[b.Category] = true
	}
	for c := range recurring {
		cats[c] = true
	}
	catList := make([]int64, 0, len(cats))
	for c := range cats {
		catList = append(catList, c)
	}
	slices.Sort(catList)
	avg := map[int64]int64{}
	for _, c := range catList {
		var sum int64
		for _, m := range hist {
			sum += spent[c][m]
		}
		if len(hist) > 0 {
			avg[c] = max(0, fcDivRound(sum, int64(len(hist))))
		}
	}

	// Balance (rule 1) and the real start of the running month (rule 2).
	var bookedRows []DayAmount
	for _, r := range rows {
		if !r.Pending {
			bookedRows = append(bookedRows, DayAmount{Date: r.Date, Amount: r.Amount})
		}
	}
	balance := BalanceOn(f.Balance, f.BalanceDate, bookedRows, today)
	past := PastBalances(balance, bookedRows, run+"-01", today)
	pastOn := map[string]int64{}
	for _, p := range past[1:] {
		pastOn[p.Date] = p.Balance
	}
	bookedOn := map[string][]fcRow{}
	for _, r := range rows {
		if !r.Pending && r.Date[:7] == run {
			bookedOn[r.Date] = append(bookedOn[r.Date], r)
		}
	}

	out := AccountForecast{AccountID: f.AccountID, Buffer: f.Buffer, Balance: balance, BalanceDate: f.BalanceDate,
		DataDate: dataDate, Days: map[string][]Day{}, Missed: missed}
	if out.Missed == nil {
		out.Missed = []Missed{}
	}
	bal := past[0].Balance // the real end of last month (rule 2)
	for _, m := range months {
		mo := Month{Month: m, Start: bal}
		n := fcDaysIn(m)
		sums := map[string]int64{}
		labels := map[string][]string{}

		// Budgets and the variable spending to spread.
		var varTotal, planTotal int64
		var spreadDays int
		for _, c := range catList {
			b := Budget{CategoryID: c, Plan: avg[c], Source: "average", Average: avg[c], Recurring: recurring[c][m]}
			if total, ok := BudgetFor(f.Budgets, c, m); ok { // the total: the plan is what is left above the assigned costs
				b.Total, b.Plan, b.Source = total, max(0, total-b.Recurring), "budget"
			}
			planTotal += b.Plan
			b.Rest = b.Plan
			if m == run {
				b.Spent = spent[c][run]
				b.Rest = max(0, b.Plan-b.Spent)
			}
			if b.Plan != 0 || b.Spent != 0 || b.Source == "budget" || b.Recurring != 0 {
				mo.Budgets = append(mo.Budgets, b)
			}
			varTotal += b.Rest
		}
		first := 1
		if m == run {
			first = fcDate(today).Day() + 1
		}
		spreadDays = n - first + 1
		if spreadDays <= 0 {
			varTotal = 0
		}

		days := make([]Day, 0, n)
		for d := 1; d <= n; d++ {
			date := fcOn(m, d)
			day := Day{Date: date}
			if date <= today {
				for _, r := range bookedOn[date] {
					label := r.Name
					if r.match >= 0 {
						label = f.Items[occs[r.match].item].Description
					}
					day.Items = append(day.Items, Item{Kind: "booked", Label: label, Amount: r.Amount, ID: r.ID})
					bal = pastOn[date] // rule 2
					saved := r.match >= 0 && f.Items[occs[r.match].item].Kind == "saving"
					for _, p := range r.Parts {
						switch {
						case saved || p.Saving:
							mo.Saved -= p.Amount
						case p.Amount > 0:
							mo.Income += p.Amount
						default:
							mo.Out -= p.Amount
						}
					}
				}
			} else {
				expect := func(ev fcEvent) {
					day.Items = append(day.Items, ev.item)
					bal += ev.item.Amount
					sums[ev.line] += ev.item.Amount
					labels[ev.line] = fcAppendNew(labels[ev.line], ev.item.Label)
					switch {
					case ev.saving:
						mo.Saved -= ev.item.Amount
					case ev.item.Amount > 0:
						mo.Income += ev.item.Amount
					default:
						mo.Out -= ev.item.Amount
					}
				}
				for _, ev := range byDate[date] {
					expect(ev)
				}
				if varTotal > 0 && d >= first {
					v := varTotal / int64(spreadDays)
					if d == n {
						v = varTotal - v*int64(spreadDays-1)
					}
					if v != 0 {
						day.Items = append(day.Items, Item{Kind: "variable", Label: VariableLabel, Amount: -v})
						bal -= v
						mo.Out += v
						sums["variable"] -= v
					}
				}
				for _, ev := range spreadOn[date] {
					expect(ev)
				}
			}
			day.Items = append(day.Items, missedOn[date]...)
			if day.Items == nil {
				day.Items = []Item{}
			}
			day.Balance, day.State = bal, fcState(bal, f.Buffer)
			if d == 1 || bal < mo.Low.Balance {
				mo.Low = day
			}
			days = append(days, day)
		}
		out.Days[m] = days
		mo.End, mo.Left, mo.State = bal, bal-f.Buffer, fcState(bal, f.Buffer)

		first0 := Line{Key: "start", Amount: mo.Start}
		if m == run {
			first0 = Line{Key: "today", Amount: balance}
		}
		mo.Lines = []Line{first0}
		for _, k := range []string{"recurringIn", "recurringOut", "pending", "planned", "variable", "saving"} {
			mo.Lines = append(mo.Lines, Line{Key: k, Amount: sums[k], Labels: fcLabels(labels[k])})
		}
		mo.Lines = append(mo.Lines, Line{Key: "end", Amount: mo.End, Labels: []string{}}, Line{Key: "buffer", Amount: -f.Buffer, Labels: []string{}},
			Line{Key: "free", Amount: mo.Left, Labels: []string{}})
		if m == run {
			var names []string
			for _, ms := range missed {
				names = fcAppendNew(names, ms.Label)
			}
			mo.Lines = append(mo.Lines, Line{Key: "missed", Labels: fcLabels(names)})
		}
		if mo.Budgets == nil {
			mo.Budgets = []Budget{}
		}

		// Required contribution (rule 12).
		need := Need{Costs: planTotal}
		for _, oc := range occs {
			if oc.date[:7] != m {
				continue
			}
			switch it := f.Items[oc.item]; {
			case oc.amount < 0:
				need.Costs -= oc.amount
			case it.Kind != "contribution":
				need.OtherIncome += oc.amount
			}
		}
		for _, p := range f.Planned {
			switch {
			case p.Date[:7] != m:
			case p.Amount < 0:
				need.Costs -= p.Amount
			default:
				need.OtherIncome += p.Amount
			}
		}
		need.BufferGap = max(0, f.Buffer-mo.Start)
		need.Amount = max(0, need.Costs-need.OtherIncome+need.BufferGap)
		mo.Need = need

		out.Months = append(out.Months, mo)
	}
	return out
}

// fcMissed applies rule 5b to the unmatched occurrence o: listed while no
// booked row fitting the item is dated on or after its date minus 7 days, and
// while the item's next date lies after today.
func fcMissed(f Facts, o int, occs []fcOcc, rows []fcRow, fits func(int, fcRow) bool, today string) bool {
	oc := occs[o]
	it := f.Items[oc.item]
	t, _ := time.Parse("2006-01", oc.date[:7])
	if fcOn(t.AddDate(0, fcStep(it), 0).Format("2006-01"), it.Day) <= today {
		return false
	}
	from := fcAddDays(oc.date, -fcMatchDays)
	for _, r := range rows {
		if !r.Pending && r.Date >= from && fits(oc.item, r) {
			return false
		}
	}
	return true
}

func fcAppendNew(list []string, s string) []string {
	if slices.Contains(list, s) {
		return list
	}
	return append(list, s)
}

func fcLabels(l []string) []string {
	if l == nil {
		return []string{}
	}
	return l
}

func fcAbs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func fcAbs64(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}
