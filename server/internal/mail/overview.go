package mail

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// The week and month overviews (0.9-3e) carry a static receipt block: a
// monospace table in the paper's single ink colour, dotted leaders drawn as a
// border, every category with its amount and trend and, indented, its
// subcategories, and on months a budget line under a category. The printer
// animation exists only on the in-app page. The input mirrors the JSON model
// of GET /api/reports/receipt (plan 0.9-3c); the mail package imports neither
// receipt nor ledger, so a later step maps receipt.Model onto these structs.

// OverviewTrend is the change against the previous period as the receipt
// prints it. Kind is "up", "down", "flat" or "new"; empty means there is no
// comparison. Pct is the rounded percentage.
type OverviewTrend struct {
	Kind string
	Pct  int
}

// OverviewBudget is the second line under a month category: "budget 550,00 ·
// 117 %" (Kind "budget"), "gemiddeld 520,00 · 54 %" (Kind "average") or "budget en gemiddelde
// 520,00 · 54 %" (Kind "mixed").
type OverviewBudget struct {
	Kind   string
	Amount int64
	Pct    int
}

// OverviewChild is a subcategory row.
type OverviewChild struct {
	Name   string
	Amount int64
}

// OverviewLine is one row of a section: an income row, a category of the
// expenses (with Children and, on months, Budget) or a saved row. Amounts are
// cents; a zero row should be left out by the caller, as the receipt does.
type OverviewLine struct {
	Name     string
	Amount   int64
	Trend    OverviewTrend
	Budget   *OverviewBudget
	Children []OverviewChild
}

// OverviewSection is INKOMEN, UITGAVEN or GESPAARD: its total, its trend and
// its rows in the order to print (largest first, "Niet gecategoriseerd" and the
// transfer rows last).
type OverviewSection struct {
	Total int64
	Trend OverviewTrend
	Rows  []OverviewLine
}

// OverviewData is everything WeekOverview and MonthOverview show.
type OverviewData struct {
	Links
	// Label is the period ("Week 47 · 16–22 nov 2026", "Oktober 2026"); the
	// subject takes its short form ("week 47", "oktober 2026").
	Label string
	// ScopeLabel is "Alle rekeningen samen · ter info".
	ScopeLabel string
	Income     OverviewSection
	Expenses   OverviewSection
	Saved      OverviewSection
	// Result is income − expenses − saved; PrevResult is the previous
	// period's, nil when there is no comparison.
	Result     int64
	PrevResult *int64
	// Notes are the model's notes, printed under the receipt.
	Notes []string
	// Stand is the snapshot line ("Stand zondag 22 nov, 19:00"), see
	// StandLine; empty leaves it out.
	Stand string
	// ReceiptURL opens the in-app receipt (button "Bekijk de bon"); empty
	// leaves the button out.
	ReceiptURL string
}

var longDays = [...]string{"zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"}

// StandLine is "Stand zondag 22 nov, 19:00" for the moment the snapshot was
// taken, in Brussels.
func StandLine(t time.Time) string {
	t = t.In(clock.Brussels)
	return fmt.Sprintf("Stand %s %d %s, %s", longDays[t.Weekday()], t.Day(), shortMonths[t.Month()-1], t.Format("15:04"))
}

// WeekOverview is "Weekoverzicht": the week that is ending, about the
// recipient's own accounts, with the receipt block.
func WeekOverview(to string, d OverviewData) (Message, error) {
	return overview(to, d, overviewKind{
		Name: "Weekoverzicht", Lower: "weekoverzicht", Period: "deze week", Prev: "Vorige week",
	})
}

// MonthOverview is "Maandoverzicht": the month that is ending, with the
// budget lines.
func MonthOverview(to string, d OverviewData) (Message, error) {
	return overview(to, d, overviewKind{
		Name: "Maandoverzicht", Lower: "maandoverzicht", Period: "deze maand", Prev: "Vorige maand",
	})
}

type overviewKind struct{ Name, Lower, Period, Prev string }

func overview(to string, d OverviewData, k overviewKind) (Message, error) {
	label := oneLine(d.Label)
	short := strings.ToLower(strings.TrimSpace(strings.SplitN(label, " · ", 2)[0]))
	subject := "Je " + k.Lower
	if short != "" {
		subject += " · " + short
	}
	spent := euro(d.Expenses.Total)
	l := layout{
		Subject: subject,
		Preheader: fmt.Sprintf("Je bon staat klaar: %s uitgegeven, %s gespaard, %s over.",
			spent, euro(d.Saved.Total), euro(d.Result)),
		Kicker:      k.Name,
		Heading:     "Je " + k.Lower,
		Figure:      "Over: " + euro(d.Result),
		FigureNote:  "Inkomen " + minus + " uitgaven " + minus + " gespaard",
		Intro:       "Dit kwam er " + k.Period + " binnen, ging eruit en ging opzij, over al je rekeningen samen.",
		Receipt:     newReceipt(d, label, k.Prev),
		Note:        oneLine(d.Stand),
		Why:         `Je krijgt dit omdat "` + k.Name + `" aanstaat.`,
		BaseURL:     d.BaseURL,
		SettingsURL: d.SettingsURL,
	}
	if d.ReceiptURL != "" {
		l.Button, l.ButtonURL = "Bekijk de bon", d.ReceiptURL
	}
	return render(to, l)
}

// receiptView is the receipt block, flattened to one list of lines that both
// the HTML and the plain-text template range over, so the two parts cannot
// disagree on which categories they show.
type receiptView struct {
	Label, Scope string
	Lines        []receiptLine
	Notes        []string
}

// receiptLine kinds.
const (
	lineHead   = "head"   // INKOMEN / UITGAVEN / GESPAARD with the section total
	lineRow    = "row"    // a category, income row or saved row
	lineSub    = "sub"    // a subcategory, indented
	lineBudget = "budget" // "budget 550,00 · 117 %" under a category
	lineRule   = "rule"   // a dotted rule (HTML only)
	lineResult = "result" // OVER
	linePrev   = "prev"   // the previous period's result
)

type receiptLine struct {
	Kind          string
	Name          string // for lineBudget the whole text
	Amount, Trend string // formatted: "1.033,47", "−7 %"
	Bold, Top     bool   // section and result rows: bold, with space above
	Child         bool   // indented
	Leader        bool   // short enough to draw a dotted leader between name and amount
}

// maxLeaderRunes is how long a name may be (in the 11 px monospace of the
// receipt) to stay on one line with its leader on a 375 px phone; longer names
// wrap and the row gets a dotted rule under it instead of a leader.
const maxLeaderRunes = 22

func newReceipt(d OverviewData, label, prevLabel string) *receiptView {
	v := &receiptView{Label: label, Scope: oneLine(d.ScopeLabel)}
	add := func(l receiptLine) { v.Lines = append(v.Lines, l) }
	section := func(name string, s OverviewSection) {
		add(receiptLine{Kind: lineHead, Name: name, Amount: amount(s.Total), Trend: trendText(s.Trend), Bold: true, Top: true, Leader: true})
		for _, r := range s.Rows {
			rn := oneLine(r.Name)
			add(receiptLine{Kind: lineRow, Name: rn, Amount: amount(r.Amount), Trend: trendText(r.Trend), Leader: utf8.RuneCountInString(rn) <= maxLeaderRunes})
			if r.Budget != nil {
				add(receiptLine{Kind: lineBudget, Name: budgetText(*r.Budget), Child: true})
			}
			for _, c := range r.Children {
				cn := oneLine(c.Name)
				add(receiptLine{Kind: lineSub, Name: cn, Amount: amount(c.Amount), Child: true, Leader: utf8.RuneCountInString(cn) <= maxLeaderRunes-2})
			}
		}
	}
	section("INKOMEN", d.Income)
	section("UITGAVEN", d.Expenses)
	section("GESPAARD", d.Saved)
	add(receiptLine{Kind: lineRule})
	add(receiptLine{Kind: lineResult, Name: "OVER", Amount: amount(d.Result), Bold: true, Leader: true})
	if d.PrevResult != nil {
		add(receiptLine{Kind: linePrev, Name: prevLabel, Amount: amount(*d.PrevResult), Leader: true})
	}
	for _, n := range d.Notes {
		if n = oneLine(n); n != "" {
			v.Notes = append(v.Notes, n)
		}
	}
	return v
}

// trendText is "+12 %", "−7 %", "= 0 %" or "nieuw"; "" when there is no
// comparison. The sign comes from the percentage; the kind only matters for
// "new".
func trendText(t OverviewTrend) string {
	switch {
	case t.Kind == "":
		return ""
	case t.Kind == "new":
		return "nieuw"
	case t.Pct > 0:
		return fmt.Sprintf("+%d%s%%", t.Pct, nbsp)
	case t.Pct < 0:
		return fmt.Sprintf("%s%d%s%%", minus, -t.Pct, nbsp)
	}
	return "=" + nbsp + "0" + nbsp + "%"
}

// budgetText is "budget 550,00 · 117 %", "gemiddeld 520,00 · 54 %" or, for accounts of which
// some have a budget and some an average, "budget en gemiddelde 520,00 · 54 %" (the wording
// of the receipt page).
func budgetText(b OverviewBudget) string {
	word := "budget"
	switch b.Kind {
	case "average":
		word = "gemiddeld"
	case "mixed":
		word = "budget en gemiddelde"
	}
	return fmt.Sprintf("%s %s · %d%s%%", word, amount(b.Amount), b.Pct, nbsp)
}
