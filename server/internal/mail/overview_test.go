package mail

import (
	"html"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// demoOverview is the model of plan 0.9-3c, week or month: income, expense
// categories with subcategories, saved rows, the result and its predecessor.
// A month has budget lines ("budget 550,00 · 117 %", "gemiddeld 180,00 · 54 %").
func demoOverview(month bool) OverviewData {
	prev := int64(40000)
	d := OverviewData{
		Label:      "Week 47 · 16–22 nov 2026",
		ScopeLabel: "Alle rekeningen samen · ter info",
		Income: OverviewSection{Total: 335000, Trend: OverviewTrend{"up", 2}, Rows: []OverviewLine{
			{Name: "Salaris", Amount: 330000},
			{Name: "Terugbetaling", Amount: 5000},
		}},
		Expenses: OverviewSection{Total: 275997, Trend: OverviewTrend{"up", 8}, Rows: []OverviewLine{
			{Name: "Wonen", Amount: 120000, Trend: OverviewTrend{"flat", 0}, Children: []OverviewChild{{"Huur", 110000}, {"Energie", 10000}}},
			{Name: "Boodschappen", Amount: 64200, Trend: OverviewTrend{"down", -7}, Children: []OverviewChild{{"Supermarkt", 52000}, {"Zonder subcategorie", 12200}}},
			{Name: "Vrije tijd", Amount: 9800, Trend: OverviewTrend{Kind: "new"}},
			{Name: "Niet gecategoriseerd", Amount: 1200},
			{Name: "Naar gedeelde rekening", Amount: 43600},
		}},
		Saved:      OverviewSection{Total: 20000, Rows: []OverviewLine{{Name: "Sparen", Amount: 15000}, {Name: "Spaarrekening", Amount: 5000}}},
		Result:     39003,
		PrevResult: &prev,
		Notes: []string{
			"Loopt nog, tot zo 22 nov: de bank geeft de transacties van vandaag pas morgen door.",
			"Niet volledig: Zichtrekening is niet bijgewerkt sinds ma 16 nov.",
		},
		Stand:      StandLine(time.Date(2026, 11, 22, 19, 0, 0, 0, clock.Brussels)),
		ReceiptURL: testBase + "/overzicht/bon/week/2026-11-16?scope=alles",
	}
	if month {
		d.Label = "Oktober 2026"
		d.Expenses.Rows[1].Budget = &OverviewBudget{"budget", 55000, 117}
		d.Expenses.Rows[2].Budget = &OverviewBudget{"average", 18000, 54}
		d.ReceiptURL = testBase + "/overzicht/bon/maand/2026-10-01?scope=alles"
	}
	return d
}

// names lists every category, subcategory, income and saved row of a model.
func (d OverviewData) names() []string {
	var out []string
	for _, s := range []OverviewSection{d.Income, d.Expenses, d.Saved} {
		for _, r := range s.Rows {
			out = append(out, r.Name)
			for _, c := range r.Children {
				out = append(out, c.Name)
			}
		}
	}
	return out
}

const weekGolden = `Saldo · Weekoverzicht

Je weekoverzicht

Over: €~390,03
Inkomen − uitgaven − gespaard

Dit kwam er deze week binnen, ging eruit en ging opzij, over al je rekeningen samen.

Week 47 · 16–22 nov 2026
Alle rekeningen samen · ter info
bedragen in €

INKOMEN: 3.350,00 (+2~%)
Salaris: 3.300,00
Terugbetaling: 50,00

UITGAVEN: 2.759,97 (+8~%)
Wonen: 1.200,00 (=~0~%)
  Huur: 1.100,00
  Energie: 100,00
Boodschappen: 642,00 (−7~%)
  Supermarkt: 520,00
  Zonder subcategorie: 122,00
Vrije tijd: 98,00 (nieuw)
Niet gecategoriseerd: 12,00
Naar gedeelde rekening: 436,00

GESPAARD: 200,00
Sparen: 150,00
Spaarrekening: 50,00

OVER: 390,03
Vorige week: 400,00

Loopt nog, tot zo 22 nov: de bank geeft de transacties van vandaag pas morgen door.
Niet volledig: Zichtrekening is niet bijgewerkt sinds ma 16 nov.

Bekijk de bon:
https://saldo.example.com/overzicht/bon/week/2026-11-16?scope=alles

Stand zondag 22 nov, 19:00

--
Je krijgt dit omdat "Weekoverzicht" aanstaat.
Meldingen aanpassen: https://saldo.example.com/meldingen
Saldo draait op je eigen Home Assistant.
`

func TestWeekOverviewMatchesTheDesign(t *testing.T) {
	d := demoOverview(false)
	d.Links = Links{BaseURL: testBase, SettingsURL: testBase + "/meldingen"}
	m, err := WeekOverview("bert@example.com", d)
	if err != nil {
		t.Fatal(err)
	}
	if m.Text != nb(weekGolden) {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, nb(weekGolden))
	}
	if m.Subject != "Je weekoverzicht · week 47" || m.To != "bert@example.com" {
		t.Errorf("subject %q, to %q", m.Subject, m.To)
	}
	inBoth(t, "week", m, nb("Over: €~390,03"), "Inkomen − uitgaven − gespaard", "Bekijk de bon", "Stand zondag 22 nov, 19:00",
		"Weekoverzicht", "Week 47 · 16–22 nov 2026", "Alle rekeningen samen · ter info", "bedragen in €",
		`Je krijgt dit omdat "Weekoverzicht" aanstaat.`, "Vorige week", "400,00")
}

func TestMonthOverviewHasBudgetLines(t *testing.T) {
	d := demoOverview(true)
	d.Links = Links{BaseURL: testBase, SettingsURL: testBase + "/meldingen"}
	m, err := MonthOverview("bert@example.com", d)
	if err != nil {
		t.Fatal(err)
	}
	if m.Subject != "Je maandoverzicht · oktober 2026" {
		t.Errorf("subject %q", m.Subject)
	}
	inBoth(t, "month", m, nb("budget 550,00 · 117~%"), nb("gemiddeld 180,00 · 54~%"), "Maandoverzicht", "Oktober 2026",
		`Je krijgt dit omdat "Maandoverzicht" aanstaat.`, "Vorige maand", "400,00")
	// The budget line sits right under its category, before the subcategories.
	if !strings.Contains(m.Text, nb("Boodschappen: 642,00 (−7~%)\n  budget 550,00 · 117~%\n  Supermarkt: 520,00\n  Zonder subcategorie: 122,00\n")) {
		t.Errorf("budget line not under its category:\n%s", m.Text)
	}
	// A week has no budget lines.
	w, _ := WeekOverview("bert@example.com", demoOverview(false))
	if strings.Contains(w.Text, "budget") || strings.Contains(w.Text, "gemiddeld") || strings.Contains(w.HTML, "budget") {
		t.Error("a week shows a budget line")
	}
}

// Every category and subcategory of the model is in both parts, with its
// amount, and the HTML and text parts carry the same figures.
func TestOverviewShowsEveryCategoryInBothParts(t *testing.T) {
	for _, month := range []bool{false, true} {
		d := demoOverview(month)
		send := WeekOverview
		if month {
			send = MonthOverview
		}
		m, err := send("bert@example.com", d)
		if err != nil {
			t.Fatal(err)
		}
		facts := d.names()
		if len(facts) != 13 {
			t.Fatalf("the demo has %d names, want 13", len(facts))
		}
		for _, s := range []OverviewSection{d.Income, d.Expenses, d.Saved} {
			facts = append(facts, amount(s.Total), trendText(s.Trend))
			for _, r := range s.Rows {
				facts = append(facts, amount(r.Amount))
				for _, c := range r.Children {
					facts = append(facts, amount(c.Amount))
				}
			}
		}
		facts = append(facts, "INKOMEN", "UITGAVEN", "GESPAARD", "OVER", amount(d.Result), amount(*d.PrevResult))
		facts = append(facts, d.Notes...)
		inBoth(t, "overview", m, facts...)
	}
	// Subcategories are indented two spaces in the text part and by padding in the HTML part.
	m, _ := WeekOverview("bert@example.com", demoOverview(false))
	if !strings.Contains(m.Text, "\n  Huur: 1.100,00\n  Energie: 100,00\n") {
		t.Errorf("subcategories not indented by two spaces:\n%s", m.Text)
	}
	if !strings.Contains(m.HTML, `padding:0 0 0 12px;white-space:nowrap;color:#27272A;">Huur</td>`) ||
		!strings.Contains(m.HTML, `padding:0 0 0 0;white-space:nowrap;color:#27272A;">Wonen</td>`) {
		t.Error("subcategory not indented in the HTML part")
	}
	// No padded columns in the text part: no two spaces inside a line apart
	// from the indent, so a proportional font cannot misalign anything.
	for _, line := range strings.Split(m.Text, "\n") {
		if strings.Contains(strings.TrimLeft(line, " "), "  ") {
			t.Errorf("padded column in %q", line)
		}
	}
}

// The block is a static table in the one layout: monospace, one ink colour on
// light paper, dotted leaders as a border, no classes the dark-mode rules
// could recolour.
func TestOverviewReceiptBlockShape(t *testing.T) {
	d := demoOverview(true)
	d.Links = Links{BaseURL: testBase, SettingsURL: testBase + "/meldingen"}
	m, _ := MonthOverview("bert@example.com", d)
	start := strings.Index(m.HTML, `bgcolor="#FAFAF7"`)
	if start < 0 {
		t.Fatal("no receipt paper")
	}
	end := start + strings.Index(m.HTML[start:], "</td></tr></table>")
	block := m.HTML[start:end]
	if start < strings.Index(m.HTML, `class="sx-card"`) || end > strings.Index(m.HTML, `class="sx-px sx-foot"`) {
		t.Error("the receipt is not inside the card")
	}
	if !strings.Contains(block, "font-family:'Geist Mono', ui-monospace, Menlo, Consolas, 'Courier New', monospace") {
		t.Error("no monospace stack")
	}
	if !strings.Contains(block, "border-bottom:1px dotted") {
		t.Error("no dotted leader")
	}
	if strings.Contains(block, "class=") {
		t.Error("a class inside the receipt: the dark-mode rules would recolour it")
	}
	for _, c := range regexp.MustCompile(`(?:^|[;" ])color:(#[0-9A-Fa-f]{6})`).FindAllStringSubmatch(block, -1) {
		if c[1] != "#27272A" {
			t.Errorf("a second ink colour %s", c[1])
		}
	}
	for _, bad := range []string{"#B42323", "#166534", "#8A5A00", "color:red", "color:green"} {
		if strings.Contains(block, bad) {
			t.Errorf("a verdict colour %s on the paper", bad)
		}
	}
	// Short names get a leader between name and amount, long ones wrap.
	if !strings.Contains(block, `white-space:nowrap;color:#27272A;">Salaris</td>`) {
		t.Error("a short name has no leader row")
	}
}

func TestOverviewKeyFigureAndEdges(t *testing.T) {
	d := demoOverview(false)
	d.Result, d.PrevResult = -12000, nil
	d.Notes, d.Stand, d.ReceiptURL = nil, "", ""
	m, err := WeekOverview("bert@example.com", d)
	if err != nil {
		t.Fatal(err)
	}
	inBoth(t, "negative", m, nb("Over: −€~120,00"), nb("−120,00"))
	if strings.Contains(m.Text, "Vorige week") || strings.Contains(m.HTML, "Vorige week") {
		t.Error("a previous-period line without a previous result")
	}
	if strings.Contains(m.Text, "Bekijk de bon") || strings.Contains(m.HTML, "Bekijk de bon") || strings.Contains(m.HTML, "<a href") {
		t.Error("a button without a receipt address")
	}
	// A negative result is still the info tone: no verdict.
	if !strings.Contains(m.HTML, `bgcolor="#DCFCE7"`) || strings.Contains(m.HTML, `bgcolor="#FBE9E9"`) {
		t.Error("the key figure is not in the info tone")
	}
	if strings.Contains(m.Text, "Stand") {
		t.Error("a Stand line without Stand")
	}
	// An empty group list still renders the three sections.
	d = OverviewData{Label: "Oktober 2026"}
	m, err = MonthOverview("bert@example.com", d)
	if err != nil {
		t.Fatal(err)
	}
	inBoth(t, "empty", m, "INKOMEN", "UITGAVEN", "GESPAARD", "OVER", "0,00")
	for _, line := range []string{"INKOMEN: 0,00", "UITGAVEN: 0,00", "GESPAARD: 0,00", "OVER: 0,00"} {
		if !strings.Contains(m.Text, line) {
			t.Errorf("text part lacks %q", line)
		}
	}
}

func TestOverviewEscapesNames(t *testing.T) {
	evil := `<b>Eve</b> & "Co" 'x'`
	d := demoOverview(true)
	d.ScopeLabel = evil
	d.Expenses.Rows[0].Name = evil + "\r\nBcc: eve@example.com"
	d.Expenses.Rows[0].Children[0].Name = evil
	d.Income.Rows[0].Name = evil
	d.Notes = []string{evil}
	m, err := MonthOverview("bert@example.com", d)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(m.HTML, "<b>Eve</b>") || strings.Count(m.HTML, "&lt;b&gt;Eve&lt;/b&gt; &amp; &#34;Co&#34; &#39;x&#39;") < 5 {
		t.Errorf("names are not escaped in the HTML part (%d escaped)", strings.Count(m.HTML, "&lt;b&gt;Eve&lt;/b&gt;"))
	}
	if !strings.Contains(m.Text, evil+" Bcc: eve@example.com: ") || strings.Contains(m.Text, "\nBcc:") {
		t.Errorf("the name adds a line to the text part:\n%s", m.Text)
	}
	if strings.ContainsAny(m.Subject, "\r\n") {
		t.Errorf("subject %q", m.Subject)
	}
	// A label with markup cannot break the subject or the heading either.
	d = demoOverview(false)
	d.Label = `Week 47 <i>x</i> · 16–22 nov`
	m, _ = WeekOverview("bert@example.com", d)
	if strings.Contains(m.HTML, "<i>x</i>") || m.Subject != "Je weekoverzicht · week 47 <i>x</i>" {
		t.Errorf("label: subject %q", m.Subject)
	}
}

// A very long category name wraps inside its row (the leader gives way to a
// dotted rule under the row) and the 520 px card never grows.
func TestOverviewLongNamesDoNotBreakTheTable(t *testing.T) {
	longWord := strings.Repeat("Abonnementen", 14)                                       // 168 characters, no space
	longPhrase := strings.TrimSpace(strings.Repeat("Boodschappen en nog veel meer ", 6)) // many words
	d := demoOverview(true)
	d.Expenses.Rows[0].Name = longWord
	d.Expenses.Rows[0].Children[0].Name = longPhrase
	d.Income.Rows[0].Name = longWord + "-inkomen"
	m, err := MonthOverview("bert@example.com", d)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(m.Text, zwsp) {
		t.Error("an invisible character in the text part")
	}
	if !strings.Contains(m.Text, longWord) || !strings.Contains(m.Text, longPhrase) {
		t.Error("the text part lacks a long name")
	}
	start := strings.Index(m.HTML, `bgcolor="#FAFAF7"`)
	block := m.HTML[start : start+strings.Index(m.HTML[start:], "</td></tr></table>")]
	var tokens []string
	for _, n := range htmlTextNode.FindAllStringSubmatch(block, -1) {
		text := html.UnescapeString(n[1])
		for _, tok := range strings.FieldsFunc(text, func(r rune) bool { return r == ' ' || r == ' ' || r == '​' }) {
			tokens = append(tokens, tok)
		}
	}
	for _, tok := range tokens {
		if n := len([]rune(tok)); n > 16 {
			t.Errorf("a run of %d characters in the receipt: %.30q...", n, tok)
		}
	}
	// The name is intact once the invisible breaks are gone.
	if !strings.Contains(strings.ReplaceAll(html.UnescapeString(block), zwsp, ""), longWord) {
		t.Error("the long name was changed")
	}
	// The row of a long name has no nowrap name cell and may wrap anywhere.
	i := strings.Index(block, longWord[:16])
	cell := block[strings.LastIndex(block[:i], "<td"):i]
	if strings.Contains(cell, "nowrap") || !strings.Contains(cell, "overflow-wrap:anywhere") || !strings.Contains(cell, "word-break:break-word") {
		t.Errorf("the long name's cell cannot wrap: %s", cell)
	}
	// Fixed widths are only the card, the two amount columns and the icons.
	for _, w := range regexp.MustCompile(`width="(\d+)"`).FindAllStringSubmatch(m.HTML, -1) {
		switch w[1] {
		case "520", "74", "46", "28", "30", "16":
		default:
			t.Errorf("unexpected fixed width %s", w[1])
		}
	}
}

// Without a BaseURL the overview has the text brand and no images, with a
// button; without any address it has no anchors at all.
func TestOverviewWithoutBaseURL(t *testing.T) {
	d := demoOverview(false)
	m, err := WeekOverview("bert@example.com", d)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(m.HTML, "<img") || strings.Contains(m.HTML, "/mail/") || strings.Contains(m.HTML, "Meldingen aanpassen") {
		t.Error("images or a mute link without BaseURL and SettingsURL")
	}
	if !strings.Contains(m.HTML, `<a href="`+d.ReceiptURL+`"`) || !strings.Contains(m.HTML, ">Saldo</td></tr>") {
		t.Error("the button or the text brand is missing")
	}
	d.ReceiptURL = ""
	m, _ = WeekOverview("bert@example.com", d)
	if strings.Contains(m.HTML, "<a ") || strings.Contains(m.Text, "http") {
		t.Error("an address without any URL")
	}
}
