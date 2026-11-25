package server

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/receipt"
)

// GET /api/reports/receipt (0.9-3c) on the demo story, today Wednesday 18
// November 2026 (week 47, 16-22 November): the route reads and validates the
// query, receipt.Build (tested in its own package) makes the model.

const receiptPath = "/api/reports/receipt"

func receiptOf(t *testing.T, r response) receipt.Model {
	t.Helper()
	if r.status != http.StatusOK {
		t.Fatalf("%d %s", r.status, r.body)
	}
	return decode[receipt.Model](t, r.body)
}

func TestReportReceiptRoute(t *testing.T) {
	p := newPair(t)
	r := p.bert("GET", receiptPath+"?periode=maand&van=2026-10-15", "")
	if r.header.Get("Content-Type") != "application/json; charset=utf-8" || r.header.Get("Cache-Control") != "no-store" {
		t.Errorf("headers %v", r.header)
	}
	oct := receiptOf(t, r)
	if oct.Period != "maand" || oct.From != "2026-10-01" || oct.To != "2026-10-31" || oct.Label != "Oktober 2026" ||
		oct.Scope != "alles" || oct.Running || oct.Empty {
		t.Errorf("October: %+v", oct)
	}

	// van is any date inside the period: the answer is the same, byte for byte.
	for _, q := range []string{"?periode=maand&van=2026-10-01", "?periode=maand&van=2026-10-31", "?periode=maand&van=2026-10-15&scope=alles"} {
		if again := p.bert("GET", receiptPath+q, ""); again.body != r.body {
			t.Errorf("%s differs from the month asked with van=2026-10-15:\n%s\n%s", q, again.body, r.body)
		}
	}
	mon := p.bert("GET", receiptPath+"?periode=week&van=2026-11-16", "")
	for _, day := range []string{"2026-11-17", "2026-11-18", "2026-11-22"} {
		if again := p.bert("GET", receiptPath+"?periode=week&van="+day, ""); again.body != mon.body {
			t.Errorf("week van=%s differs from van=2026-11-16", day)
		}
	}

	// The running week and month are fine; the model says so.
	week := receiptOf(t, mon)
	if week.Period != "week" || week.From != "2026-11-16" || week.To != "2026-11-22" || week.Label != "Week 47 · 16–22 nov 2026" ||
		!week.Running || week.Stand != "2026-11-18T20:00:00+01:00" || week.Account != 0 {
		t.Errorf("running week: %+v", week)
	}
	if now := receiptOf(t, p.bert("GET", receiptPath+"?periode=maand&van=2026-11-18", "")); !now.Running || now.From != "2026-11-01" {
		t.Errorf("running month: %+v", now)
	}

	// An account has no scope of its own; the answer names it and the scope stays alles.
	shared := receiptOf(t, p.bert("GET", receiptPath+"?periode=maand&van=2026-11-01&account=4", ""))
	if shared.Account != 4 || shared.Scope != "alles" || shared.ScopeLabel != "Gedeelde rekening" {
		t.Errorf("account 4: %+v", shared)
	}

	// Before the history: 200 with nothing in it, not an error.
	old := p.bert("GET", receiptPath+"?periode=week&van=2000-01-05", "")
	m := receiptOf(t, old)
	if !m.Empty || m.From != "2000-01-03" || m.Income.Total != 0 || m.Expenses.Total != 0 || m.Saved.Total != 0 || len(m.Notes) != 0 ||
		m.Income.Trend != nil || m.Expenses.Trend != nil {
		t.Errorf("before the history: %+v", m)
	}
	// Arrays, never null, so the page and the mail can range over them.
	for _, s := range []string{`"rows":[]`, `"groups":[]`, `"notes":[]`} {
		if !strings.Contains(old.body, s) {
			t.Errorf("before the history lacks %s: %s", s, old.body)
		}
	}
	// The history starts inside this month for nobody on the demo; a month of nothing is empty too.
	if m := receiptOf(t, p.bert("GET", receiptPath+"?periode=maand&van=2019-06-30", "")); !m.Empty || m.To != "2019-06-30" {
		t.Errorf("2019: %+v", m)
	}
}

// The month of the route is the month of GET /api/reports/months: no drift.
func TestReportReceiptIsTheMonthReport(t *testing.T) {
	p := newPair(t)
	for _, who := range []string{"bert", "partner"} {
		call := p.bert
		if who == "partner" {
			call = p.partner
		}
		for _, scope := range []string{"", "alles", "persoonlijk", "gedeeld"} {
			q := ""
			if scope != "" {
				q = "&scope=" + scope
			}
			for _, month := range []string{"2026-09", "2026-10", "2026-11"} {
				rep := decode[struct {
					Months []struct {
						Month    string
						Income   int64
						Saved    int64
						Expenses map[string]int64
					}
				}](t, call("GET", reportsPath+"?from="+month+"&to="+month+q, "").body)
				if len(rep.Months) != 1 {
					t.Fatalf("%s %s %s: %d months", who, scope, month, len(rep.Months))
				}
				var spent int64
				for _, v := range rep.Months[0].Expenses {
					spent += v
				}
				m := receiptOf(t, call("GET", receiptPath+"?periode=maand&van="+month+"-20"+q, ""))
				if m.Income.Total != rep.Months[0].Income || m.Saved.Total != rep.Months[0].Saved || m.Expenses.Total != spent {
					t.Errorf("%s %q %s: receipt %d/%d/%d, report %d/%d/%d", who, scope, month, m.Income.Total, m.Expenses.Total, m.Saved.Total,
						rep.Months[0].Income, spent, rep.Months[0].Saved)
				}
			}
		}
	}
}

func TestReportReceiptErrors(t *testing.T) {
	p := newPair(t)
	for _, c := range []struct {
		query   string
		status  int
		code    string
		message string
	}{
		{"", 400, "invalid", "Kies week, maand, kwartaal, jaar of eigen."},
		{"?van=2026-11-01", 400, "invalid", "Kies week, maand, kwartaal, jaar of eigen."},
		{"?periode=dag&van=2026-11-01", 400, "invalid", "Kies week, maand, kwartaal, jaar of eigen."},
		{"?periode=Week&van=2026-11-16", 400, "invalid", "Kies week, maand, kwartaal, jaar of eigen."},
		{"?periode=Kwartaal&van=2026-11-16", 400, "invalid", "Kies week, maand, kwartaal, jaar of eigen."},
		{"?periode=jaren&van=2026-11-16", 400, "invalid", "Kies week, maand, kwartaal, jaar of eigen."},
		{"?periode=kwartaal&van=2026-13-01", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=jaar&van=2026", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		// eigen: tot is required, a date, and not before van.
		{"?periode=eigen&van=2026-05-01", 400, "invalid", "Kies een einddatum."},
		{"?periode=eigen&van=2026-05-01&tot=", 400, "invalid", "Kies een einddatum."},
		{"?periode=eigen&tot=2026-10-31", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=eigen&van=2026-05-01&tot=2026-10", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=eigen&van=2026-05-01&tot=2026-02-30", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=eigen&van=2026-10-01&tot=2026-05-31", 400, "invalid", "De einddatum ligt voor de begindatum."},
		{"?periode=eigen&van=2026-10-20&tot=2026-10-05", 400, "invalid", "De einddatum ligt voor de begindatum."},
		// Over 50 years (601 months): the cap of GET /api/reports/months.
		{"?periode=eigen&van=1900-01-01&tot=1950-01-01", 400, "invalid", "Kies een periode van hooguit 50 jaar."},
		{"?periode=eigen&van=1976-01-31&tot=2026-01-01", 400, "invalid", "Kies een periode van hooguit 50 jaar."},
		{"?periode=maand", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=maand&van=", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=maand&van=2026-1-5", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=maand&van=2026-02-30", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=maand&van=2026-11", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=week&van=vandaag", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		{"?periode=week&van=2026-11-16T00:00:00Z", 400, "invalid", "Kies een datum als JJJJ-MM-DD."},
		// Not begun: the next Monday and the next month, however far (the first day of the period decides).
		{"?periode=week&van=2026-11-23", 400, "invalid", "De periode ligt in de toekomst."},
		{"?periode=week&van=2026-11-29", 400, "invalid", "De periode ligt in de toekomst."},
		{"?periode=maand&van=2026-12-01", 400, "invalid", "De periode ligt in de toekomst."},
		{"?periode=maand&van=2030-01-15", 400, "invalid", "De periode ligt in de toekomst."},
		{"?periode=kwartaal&van=2027-01-01", 400, "invalid", "De periode ligt in de toekomst."},
		{"?periode=jaar&van=2027-06-30", 400, "invalid", "De periode ligt in de toekomst."},
		{"?periode=eigen&van=2026-12-01&tot=2027-01-31", 400, "invalid", "De periode ligt in de toekomst."},
		// Selection: as the other reports.
		{"?periode=maand&van=2026-11-01&scope=iedereen", 400, "invalid", "Kies alles, persoonlijk of gedeeld."},
		{"?periode=maand&van=2026-11-01&account=2", 400, "invalid", "Kies een betaalrekening."},  // Bert's own savings account
		{"?periode=maand&van=2026-11-01&account=5", 404, "not_found", "Rekening niet gevonden."}, // Partner's
		{"?periode=maand&van=2026-11-01&account=999999", 404, "not_found", "Rekening niet gevonden."},
		{"?periode=maand&van=2026-11-01&account=abc", 404, "not_found", "Rekening niet gevonden."},
		{"?periode=maand&van=2026-11-01&account=-4", 404, "not_found", "Rekening niet gevonden."},
	} {
		r := p.bert("GET", receiptPath+c.query, "")
		if r.status != c.status {
			t.Errorf("%q: %d %s, want %d", c.query, r.status, r.body, c.status)
			continue
		}
		equalJSON(t, r.body, `{"error":{"code":"`+c.code+`","message":"`+c.message+`"}}`)
	}

	// The running period is not an error, and a period that has begun is not "in the future".
	for _, q := range []string{"?periode=week&van=2026-11-16", "?periode=week&van=2026-11-22", "?periode=maand&van=2026-11-30",
		"?periode=kwartaal&van=2026-12-31", "?periode=jaar&van=2026-12-31", "?periode=eigen&van=2026-09-01&tot=2026-12-31",
		"?periode=eigen&van=2026-11-18&tot=2030-01-01"} {
		if r := p.bert("GET", receiptPath+q, ""); r.status != http.StatusOK {
			t.Errorf("%q: %d %s", q, r.status, r.body)
		}
	}
	// A hidden account answers as an unknown one, whatever else is asked.
	hidden, unknown := p.bert("GET", receiptPath+"?periode=week&van=2026-11-16&account=5", ""), p.bert("GET", receiptPath+"?periode=week&van=2026-11-16&account=999999", "")
	if hidden.status != 404 || hidden.body != unknown.body {
		t.Errorf("hidden %d %s, unknown %d %s", hidden.status, hidden.body, unknown.status, unknown.body)
	}
	// Only GET.
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		if r := p.bert(method, receiptPath+"?periode=maand&van=2026-10-01", "{}"); r.status != http.StatusMethodNotAllowed {
			t.Errorf("%s: %d %s", method, r.status, r.body)
		}
	}
}

// The receipt sums the viewer's own accounts only (rule 1 of docs/security-baseline.md): rows
// added to Partner's accounts change none of Bert's receipts, byte for byte, but do change hers,
// and her budget never reaches his month.
func TestReceiptIsPerViewer(t *testing.T) {
	w := newWorld(t)
	queries := func(as string) []string {
		own := map[string]int64{"bert": w.bertAcc, "partner": w.partnerAcc}[as]
		var out []string
		// The longer kinds come after the first four: partner[3] below is addressed by index.
		for _, q := range []string{"periode=maand&van=2026-11-01", "periode=week&van=2026-11-09", "periode=week&van=2026-11-16", "periode=maand&van=2026-10-01",
			"periode=kwartaal&van=2026-11-01", "periode=jaar&van=2026-01-01", "periode=eigen&van=2020-01-01&tot=2026-11-30"} {
			out = append(out, "?"+q, "?"+q+"&scope=persoonlijk", "?"+q+"&scope=gedeeld", "?"+q+"&account="+id(own), "?"+q+"&account="+id(w.shared))
		}
		return out
	}
	receipts := func(as string) []string {
		var out []string
		for _, q := range queries(as) {
			r, _ := w.send(probe{method: "GET", path: receiptPath + q}, as)
			if r.status != http.StatusOK {
				t.Fatalf("%s %s: %d %s", as, q, r.status, r.body)
			}
			out = append(out, r.body)
		}
		return out
	}
	bert, partner := receipts("bert"), receipts("partner")
	for i, body := range bert {
		for _, s := range []string{"246000", "246002", "Eigen rekening", "Werkgever BV", "143215"} { // Partner's salary, budget, account, balance
			if strings.Contains(body, s) {
				t.Errorf("Bert's receipt %s shows Partner's %q: %s", queries("bert")[i], s, body)
			}
		}
	}
	// The sentinels are not dead: Partner's own month holds her budget reference.
	if m := partner[3]; !strings.Contains(m, `"amount":246002`) { // ?periode=maand&van=2026-11-01&account=<hers>
		t.Errorf("Partner's own month lacks her budget: %s", m)
	}

	w.addRow(w.partnerAcc, 9999900, "2026-11-10", "PR groot loon", "booked", "EUR", "")
	w.addRow(w.partnerAcc, -45000, "2026-11-13", "PR bijdrage", "booked", "EUR", "")
	w.addRow(w.partnerAcc, -1234, "2020-01-05", "PR heel oud", "booked", "EUR", "")
	w.addRow(w.partnerAcc, -8100, "2026-11-12", "PR naar potje", "booked", "EUR", "")
	w.addRow(w.partnerManual, 8100, "2026-11-12", "PR van rekening", "booked", "EUR", "")

	if after := receipts("bert"); !slices.Equal(after, bert) {
		for i := range after {
			if after[i] != bert[i] {
				t.Errorf("Bert's receipt %q changed with Partner's rows:\nbefore %s\nafter  %s", queries("bert")[i], bert[i], after[i])
			}
		}
	}
	if after := receipts("partner"); slices.Equal(after, partner) {
		t.Error("Partner's own receipts did not change with her own rows: the test proves nothing")
	}

	// Another user's account, current or savings, hidden or unknown: the same answer.
	for _, c := range []struct {
		as      string
		account int64
	}{{"bert", w.partnerAcc}, {"bert", w.partnerManual}, {"partner", w.bertAcc}, {"partner", w.bertManual}, {"bert", w.derdeAcc}} {
		got, _ := w.send(probe{method: "GET", path: receiptPath + "?periode=maand&van=2026-11-01&account=" + id(c.account)}, c.as)
		missing, _ := w.send(probe{method: "GET", path: receiptPath + "?periode=maand&van=2026-11-01&account=" + none}, c.as)
		if got.status != http.StatusNotFound || got.body != missing.body {
			t.Errorf("%s asks for account %d: %d %s, missing %d %s", c.as, c.account, got.status, got.body, missing.status, missing.body)
		}
	}
	if r, _ := w.send(probe{method: "GET", path: receiptPath + "?periode=maand&van=2026-11-01"}, "anon"); r.status != http.StatusUnauthorized {
		t.Errorf("anonymous: %d %s", r.status, r.body)
	}
}

// Quarter, year and custom range through the route, as Bert and as Partner: normalised to whole
// periods, labelled, with totals equal to the sum of the months of GET /api/reports/months.
func TestReportReceiptLongerPeriods(t *testing.T) {
	p := newPair(t)
	q3 := p.bert("GET", receiptPath+"?periode=kwartaal&van=2026-08-15", "")
	m := receiptOf(t, q3)
	if m.Period != "kwartaal" || m.From != "2026-07-01" || m.To != "2026-09-30" || m.Label != "3e kwartaal 2026 · jul–sep" || m.Running ||
		m.PartialFrom != nil || m.Income.Prev == nil || len(m.Notes) != 0 {
		t.Errorf("Q3: %+v", m)
	}
	// van is any date in the quarter; tot is ignored outside eigen, whatever it holds.
	for _, q := range []string{"?periode=kwartaal&van=2026-07-01", "?periode=kwartaal&van=2026-09-30", "?periode=kwartaal&van=2026-08-15&tot=onzin",
		"?periode=kwartaal&van=2026-08-15&tot=2020-01-01"} {
		if again := p.bert("GET", receiptPath+q, ""); again.body != q3.body {
			t.Errorf("%s differs from van=2026-08-15", q)
		}
	}
	oct := p.bert("GET", receiptPath+"?periode=maand&van=2026-10-15", "")
	if again := p.bert("GET", receiptPath+"?periode=maand&van=2026-10-15&tot=onzin", ""); again.body != oct.body {
		t.Error("tot changes a month")
	}

	y := receiptOf(t, p.bert("GET", receiptPath+"?periode=jaar&van=2026-03-03", ""))
	if y.Period != "jaar" || y.From != "2026-01-01" || y.To != "2026-12-31" || y.Label != "Jaar 2026" || !y.Running || y.Income.Prev != nil ||
		len(y.Notes) != 1 || !strings.HasPrefix(y.Notes[0], "Loopt nog, tot wo 18 nov") {
		t.Errorf("2026: %+v", y)
	}
	y25 := receiptOf(t, p.bert("GET", receiptPath+"?periode=jaar&van=2025-06-01", ""))
	if y25.Label != "Jaar 2025 · vanaf 1 nov" || y25.PartialFrom == nil || *y25.PartialFrom != "2025-11-01" || y25.Income.Prev != nil || y25.Empty {
		t.Errorf("2025: %+v", y25)
	}

	e := p.bert("GET", receiptPath+"?periode=eigen&van=2026-05-20&tot=2026-10-03", "")
	if m := receiptOf(t, e); m.Period != "eigen" || m.From != "2026-05-01" || m.To != "2026-10-31" || m.Label != "Mei – oktober 2026" || m.Income.Prev == nil {
		t.Errorf("May-October: %+v", m)
	}
	if again := p.bert("GET", receiptPath+"?periode=eigen&van=2026-05-01&tot=2026-10-31", ""); again.body != e.body {
		t.Error("eigen is not normalised to whole months")
	}
	if m := receiptOf(t, p.bert("GET", receiptPath+"?periode=eigen&van=2025-11-30&tot=2026-10-01", "")); m.Label != "Nov 2025 – okt 2026" || m.From != "2025-11-01" {
		t.Errorf("across years: %+v", m)
	}
	one := receiptOf(t, p.bert("GET", receiptPath+"?periode=eigen&van=2026-10-05&tot=2026-10-05", ""))
	if month := receiptOf(t, oct); one.Label != "Oktober 2026" || one.Period != "eigen" || one.Income.Total != month.Income.Total || one.Expenses.Total != month.Expenses.Total {
		t.Errorf("one month: %+v", one)
	}
	// 600 months before the history: allowed, empty.
	if m := receiptOf(t, p.bert("GET", receiptPath+"?periode=eigen&van=1900-01-01&tot=1949-12-31", "")); !m.Empty || m.Income.Prev != nil {
		t.Errorf("600 months: %+v", m)
	}

	for _, who := range []string{"bert", "partner"} {
		call := p.bert
		if who == "partner" {
			call = p.partner
		}
		for _, c := range []struct{ query, from, to string }{
			{"?periode=kwartaal&van=2026-08-15", "2026-07", "2026-09"},
			{"?periode=kwartaal&van=2026-11-18", "2026-10", "2026-11"},
			{"?periode=jaar&van=2025-06-01", "2025-01", "2025-12"},
			{"?periode=jaar&van=2026-06-01", "2026-01", "2026-11"},
			{"?periode=eigen&van=2025-08-01&tot=2026-11-30", "2025-08", "2026-11"},
		} {
			for _, scope := range []string{"", "&scope=persoonlijk", "&scope=gedeeld"} {
				rep := decode[struct {
					Months []struct {
						Income   int64
						Saved    int64
						Expenses map[string]int64
					}
				}](t, call("GET", reportsPath+"?from="+c.from+"&to="+c.to+scope, "").body)
				var inc, sav, spent int64
				for _, mo := range rep.Months {
					inc, sav = inc+mo.Income, sav+mo.Saved
					for _, v := range mo.Expenses {
						spent += v
					}
				}
				m := receiptOf(t, call("GET", receiptPath+c.query+scope, ""))
				if m.Income.Total != inc || m.Saved.Total != sav || m.Expenses.Total != spent {
					t.Errorf("%s %s%s: receipt %d/%d/%d, months %d/%d/%d", who, c.query, scope, m.Income.Total, m.Expenses.Total, m.Saved.Total, inc, spent, sav)
				}
				for _, g := range m.Expenses.Groups {
					if g.Budget != nil {
						t.Errorf("%s %s: a budget outside a month", who, c.query)
					}
				}
			}
		}
	}
}
