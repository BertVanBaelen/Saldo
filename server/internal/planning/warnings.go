package planning

// The month-end warnings (plan 0.8 decisions 2, 4 and 14; plan 0.9-3 step 1):
// one rule shared by Start's alerts (GET /api/alerts) and the notification
// scheduler.

// AccountWarnings are the red and the buffer warning of one account's
// forecast, each nil when there is none.
type AccountWarnings struct{ Red, Buffer *Warning }

// Warning is one month-end warning with what an alert and a notification say.
type Warning struct {
	Month       string // "2026-11"
	End         int64  // the month's end balance
	Buffer      int64  // the account's buffer
	UnderBuffer int64  // Buffer - End (also for a red warning)
	LowDate     string // the month's lowest day (Month.Low), "" without days
	LowBalance  int64
	// RedFrom is the first day of the run of red days that continues to the
	// month's last day (red warning only; "" for a buffer warning or a
	// forecast without days). A dip earlier in the month that recovers does
	// not count, so RedFrom can lie after LowDate.
	RedFrom string
	// Cause is the largest outgoing item still expected in the month, nil when
	// there is none. See largestOut.
	Cause *Item
}

// Warnings applies the month-end rule to the running month and the look months
// after it: the first month whose end is below 0 is the red warning, the first
// month before that one whose end is below the buffer the buffer warning.
// Month ends only (plan 0.8 decision 14).
func Warnings(f AccountForecast, look int) AccountWarnings {
	var out AccountWarnings
	months := f.Months[:min(max(look+1, 0), len(f.Months))]
	first := len(months) // the first red month
	for i, m := range months {
		if m.End < 0 {
			first = i
			break
		}
	}
	if first < len(months) {
		out.Red = warning(f, months[first])
		out.Red.RedFrom = redFrom(f.Days[months[first].Month])
	}
	for _, m := range months[:first] {
		if m.End < f.Buffer {
			out.Buffer = warning(f, m)
			break
		}
	}
	return out
}

func warning(f AccountForecast, m Month) *Warning {
	return &Warning{Month: m.Month, End: m.End, Buffer: f.Buffer, UnderBuffer: f.Buffer - m.End,
		LowDate: m.Low.Date, LowBalance: m.Low.Balance, Cause: largestOut(f.Days[m.Month])}
}

// redFrom is the first day of the run of red days that ends on the last day.
func redFrom(days []Day) string {
	i := len(days)
	for i > 0 && days[i-1].Balance < 0 {
		i--
	}
	if i == len(days) {
		return ""
	}
	return days[i].Date
}

// largestOut is the month's largest outgoing item still to come: the
// recurring items (kinds recurring and late; saving items included, they leave
// the account) and the planned items of the forecast's days. Lines only hold
// sums and labels, so the days are the source. The parts of one item in the
// month (a planned item spread over the month, rule 6b) are added up per kind
// and id, late counting as recurring. Booked rows (already happened), pending
// rows, the variable spending and missed items do not count. The largest is
// the most negative total; on a tie the one that appears first in the month
// (day order, then the order of the day's items). nil when the month has no
// outgoing recurring or planned item.
func largestOut(days []Day) *Item {
	type key struct {
		planned bool
		id      int64
	}
	var order []key
	total := map[key]*Item{}
	for _, d := range days {
		for _, it := range d.Items {
			if it.Kind != "recurring" && it.Kind != "late" && it.Kind != "planned" {
				continue
			}
			k := key{it.Kind == "planned", it.ID}
			if total[k] == nil {
				kind := it.Kind
				if kind == "late" {
					kind = "recurring"
				}
				total[k] = &Item{Kind: kind, Label: it.Label, ID: it.ID}
				order = append(order, k)
			}
			total[k].Amount += it.Amount
		}
	}
	var best *Item
	for _, k := range order { // date order: the first on a tie
		it := total[k]
		if it.Amount >= 0 {
			continue
		}
		if best == nil || it.Amount < best.Amount {
			best = it
		}
	}
	return best
}
