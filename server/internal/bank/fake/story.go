package fake

import (
	"fmt"
	"slices"
	"strings"
	"sync"
)

// row is one transaction of the story.
type row struct {
	account string // IBAN of the account it is booked on
	date    string
	amount  int64
	name    string // counterparty
	iban    string // counterparty IBAN, set for transfers between demo accounts
	comm    string
	pending bool
	ref     string // entry reference; empty while pending
	order   int    // display position within the day, lowest first
}

var months = [...]string{"januari", "februari", "maart", "april", "mei", "juni", "juli",
	"augustus", "september", "oktober", "november", "december"}

// recent are the 16 rows of 12–18 November 2026, in the order of the design
// (analysis/screens/transacties.md, "Demo rows").
var recent = []row{
	{account: IBANBertCurrent, date: "2026-11-18", amount: -2499, name: "Bol.com", comm: "Bestelling 4471-2210", pending: true},
	{account: IBANShared, date: "2026-11-18", amount: -8642, name: "Colruyt Laagste Prijzen", comm: "Bancontact · Colruyt Gent-Dampoort"},
	{account: IBANBertCurrent, date: "2026-11-17", amount: -6210, name: "TotalEnergies", comm: "Bancontact · TotalEnergies Merelbeke"},
	{account: IBANBertCurrent, date: "2026-11-17", amount: -1199, name: "Spotify", comm: "Spotify Premium"},
	{account: IBANBertCurrent, date: "2026-11-17", amount: -840, name: "Bakkerij De Graankorrel", comm: "Bancontact"},
	{account: IBANBertCurrent, date: "2026-11-16", amount: -20000, name: "Naar spaarrekening", iban: IBANSavings, comm: "Maandelijks sparen"},
	{account: IBANBertCurrent, date: "2026-11-16", amount: 1850, name: "CM Ziekenfonds", comm: "Terugbetaling raadpleging"},
	{account: IBANShared, date: "2026-11-16", amount: -5437, name: "Delhaize", comm: "Bancontact · Delhaize Gent"},
	{account: IBANBertCurrent, date: "2026-11-15", amount: -2400, name: "Kinepolis", comm: "Kinepolis Gent · 2 tickets"},
	{account: IBANBertCurrent, date: "2026-11-15", amount: -1450, name: "Frituur 't Pleintje", comm: "Payconiq"},
	{account: IBANBertCurrent, date: "2026-11-14", amount: -4290, name: "Decathlon", comm: "Bancontact · Decathlon Gent"},
	{account: IBANBertCurrent, date: "2026-11-14", amount: -1960, name: "NMBS", comm: "Treinticket Gent – Brussel"},
	{account: IBANShared, date: "2026-11-13", amount: -3214, name: "Albert Heijn", comm: "Bancontact · AH Gent Zuid"},
	{account: IBANBertCurrent, date: "2026-11-13", amount: -1835, name: "Apotheek Van Damme", comm: "Bancontact"},
	{account: IBANBertCurrent, date: "2026-11-12", amount: -1399, name: "Netflix", comm: "Netflix.com"},
	{account: IBANShared, date: "2026-11-12", amount: -2265, name: "Carrefour Express", comm: "Bancontact · Carrefour Gent"},
}

// recentFrom is the first day of the recent rows. Before it, the accounts Bert
// can see get their monthly template; Partner's own account gets it up to
// StoryEnd.
const recentFrom = "2026-11-12"

// slot is one line of the monthly template.
type slot struct {
	account string
	day     int
	name    string
	iban    string
	comm    func(m month) string
	amount  func(m month) int64
	when    func(m month) bool // nil = every month
}

// month is a month of history: index 0 is November 2025.
type month struct {
	index int
	year  int
	month int // 1–12
}

func (m month) name() string { return months[m.month-1] }
func (m month) ym() string   { return fmt.Sprintf("%04d-%02d", m.year, m.month) }

func fixed(c int64) func(month) int64  { return func(month) int64 { return c } }
func text(s string) func(month) string { return func(month) string { return s } }

// vary returns base plus a deterministic monthly variation of at most 4 steps.
func vary(base, step int64, seed int) func(month) int64 {
	return func(m month) int64 { return base + int64((m.index*7+seed*5)%9-4)*step }
}

func everyOther(offset int) func(month) bool {
	return func(m month) bool { return m.index%2 == offset }
}

var template = []slot{
	// Bert's Zichtrekening.
	{account: IBANBertCurrent, day: 1, name: "Immo Verhaeghe", amount: fixed(-100500),
		comm: func(m month) string { return fmt.Sprintf("Huur %s %d", m.name(), m.year) }},
	{account: IBANBertCurrent, day: 1, name: "Naar gedeelde rekening", iban: IBANShared, amount: fixed(-45000),
		comm: func(m month) string { return "Bijdrage " + m.name() }},
	{account: IBANBertCurrent, day: 2, name: "Werkgever NV", amount: fixed(285000),
		comm: func(m month) string { return "Loon " + m.name() }},
	{account: IBANBertCurrent, day: 8, name: "TotalEnergies", amount: vary(-5840, 150, 1), comm: text("Bancontact · TotalEnergies Merelbeke")},
	{account: IBANBertCurrent, day: 10, name: "CM Ziekenfonds", amount: fixed(5000), comm: text("Terugbetaling raadpleging"),
		when: func(m month) bool { return m.ym() == "2026-10" }},
	{account: IBANBertCurrent, day: 12, name: "Netflix", amount: fixed(-1399), comm: text("Netflix.com")},
	{account: IBANBertCurrent, day: 14, name: "NMBS", amount: fixed(-1960), comm: text("Treinticket Gent – Brussel"), when: everyOther(1)},
	{account: IBANBertCurrent, day: 16, name: "Naar spaarrekening", iban: IBANSavings, amount: fixed(-20000), comm: text("Maandelijks sparen"),
		when: func(m month) bool { return m.ym() != "2026-07" }},
	{account: IBANBertCurrent, day: 17, name: "Spotify", amount: fixed(-1199), comm: text("Spotify Premium")},
	{account: IBANBertCurrent, day: 20, name: "Kinepolis", amount: fixed(-2400), comm: text("Kinepolis Gent · 2 tickets"), when: everyOther(0)},
	{account: IBANBertCurrent, day: 22, name: "TotalEnergies", amount: vary(-6050, 120, 2), comm: text("Bancontact · TotalEnergies Merelbeke")},
	{account: IBANBertCurrent, day: 24, name: "Standaard Boekhandel", amount: fixed(-2795), comm: text("Bancontact · Standaard Boekhandel Gent"), when: everyOther(1)},
	{account: IBANBertCurrent, day: 25, name: "Bol.com", amount: vary(-2499, 700, 3), when: everyOther(0),
		comm: func(m month) string { return fmt.Sprintf("Bestelling %04d-%04d", 3100+m.index*97, 1200+m.index*131) }},
	{account: IBANBertCurrent, day: 27, name: "Decathlon", amount: fixed(-4290), comm: text("Bancontact · Decathlon Gent"),
		when: func(m month) bool { return m.index%3 == 1 }},
	{account: IBANBertCurrent, day: 28, name: "Naar spaarrekening", iban: IBANSavings, amount: fixed(-20000), comm: text("Extra sparen"),
		when: func(m month) bool { return m.ym() == "2026-08" }},

	// Gedeelde rekening: both contributions, the household costs and groceries.
	{account: IBANShared, day: 1, name: "Bert", iban: IBANBertCurrent, amount: fixed(45000),
		comm: func(m month) string { return "Bijdrage " + m.name() }},
	{account: IBANShared, day: 1, name: "Partner", iban: IBANPartnerCurrent, amount: fixed(45000),
		comm: func(m month) string { return "Bijdrage " + m.name() }},
	{account: IBANShared, day: 3, name: "Luminus", amount: fixed(-14500),
		comm: func(m month) string { return "Voorschot energie " + m.name() }},
	{account: IBANShared, day: 5, name: "Colruyt Laagste Prijzen", amount: vary(-7418, 260, 4), comm: text("Bancontact · Colruyt Gent-Dampoort")},
	{account: IBANShared, day: 9, name: "Proximus", amount: fixed(-4298), comm: text("Internet en tv")},
	{account: IBANShared, day: 11, name: "Carrefour Express", amount: vary(-2265, 180, 5), comm: text("Bancontact · Carrefour Gent")},
	{account: IBANShared, day: 13, name: "Albert Heijn", amount: vary(-3214, 210, 6), comm: text("Bancontact · AH Gent Zuid")},
	{account: IBANShared, day: 20, name: "Delhaize", amount: vary(-5437, 230, 7), comm: text("Bancontact · Delhaize Gent")},
	{account: IBANShared, day: 23, name: "Action", amount: vary(-6202, 90, 8), comm: text("Bancontact · Action Gentbrugge")},
	{account: IBANShared, day: 26, name: "Colruyt Laagste Prijzen", amount: vary(-8642, 300, 9), comm: text("Bancontact · Colruyt Gent-Dampoort")},

	// Partner's own Zichtrekening: only Partner ever sees these.
	{account: IBANPartnerCurrent, day: 1, name: "Naar gedeelde rekening", iban: IBANShared, amount: fixed(-45000),
		comm: func(m month) string { return "Bijdrage " + m.name() }},
	{account: IBANPartnerCurrent, day: 2, name: "Werkgever BV", amount: fixed(246000),
		comm: func(m month) string { return "Loon " + m.name() }},
	{account: IBANPartnerCurrent, day: 7, name: "Lidl", amount: vary(-4630, 190, 10), comm: text("Bancontact · Lidl Gent")},
	{account: IBANPartnerCurrent, day: 14, name: "De Lijn", amount: fixed(-2200), comm: text("Abonnement De Lijn")},
	{account: IBANPartnerCurrent, day: 18, name: "Zara", amount: vary(-3995, 500, 11), comm: text("Bancontact · Zara Gent"), when: everyOther(0)},
	{account: IBANPartnerCurrent, day: 21, name: "Basic-Fit", amount: fixed(-2999), comm: text("Lidmaatschap Basic-Fit")},
}

var (
	storyOnce sync.Once
	storyRows []row
)

// story returns every row, newest first and within a day in display order.
// Booked rows get an entry reference that encodes the day and that order.
func story() []row {
	storyOnce.Do(func() { storyRows = build() })
	return storyRows
}

func build() []row {
	var rows []row
	for i := range 13 { // November 2025 … November 2026
		m := month{index: i, year: 2025 + (10+i)/12, month: (10+i)%12 + 1}
		for n, s := range template {
			if s.when != nil && !s.when(m) {
				continue
			}
			date := fmt.Sprintf("%s-%02d", m.ym(), s.day)
			if date > StoryEnd || (date >= recentFrom && s.account != IBANPartnerCurrent) {
				continue
			}
			rows = append(rows, row{
				account: s.account, date: date, amount: s.amount(m), name: s.name, iban: s.iban,
				comm: s.comm(m), order: 100 + n,
			})
		}
	}
	for n, r := range recent {
		r.order = n
		rows = append(rows, r)
	}
	slices.SortStableFunc(rows, func(a, b row) int {
		if c := strings.Compare(b.date, a.date); c != 0 {
			return c
		}
		return a.order - b.order
	})
	pos := map[string]int{}
	for i := range rows {
		r := &rows[i]
		pos[r.date]++
		if !r.pending {
			r.ref = fmt.Sprintf("DEMO-%s-%02d", strings.ReplaceAll(r.date, "-", ""), pos[r.date])
		}
	}
	return rows
}
