package server

import (
	"flag"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// updateBudgetsGolden rewrites testdata/reports_budgets_golden.txt from the current code.
var updateBudgetsGolden = flag.Bool("update-budgets-golden", false, "rewrite the GET /api/reports/budgets golden")

// TestReportBudgetsGolden pins the full bytes of GET /api/reports/budgets on
// the demo. The golden was written by the code before the budget reference
// moved from this package into planning (0.9-3c), so the move is shown to
// change no byte of the answer.
func TestReportBudgetsGolden(t *testing.T) {
	p := newPair(t)
	var out []byte
	for _, c := range []struct {
		who, query string
	}{
		{"bert", ""}, {"bert", "?scope=persoonlijk"}, {"bert", "?scope=gedeeld"},
		{"bert", "?account=1"}, {"bert", "?account=4"}, {"bert", "?account=1&from=2025-10&to=2025-11"},
		{"partner", ""}, {"partner", "?account=5"},
	} {
		call := p.bert
		if c.who == "partner" {
			call = p.partner
		}
		r := call("GET", budgetsPath+c.query, "")
		if r.status != http.StatusOK {
			t.Fatalf("%s %s: %d %s", c.who, c.query, r.status, r.body)
		}
		out = append(out, []byte(c.who+" "+budgetsPath+c.query+"\n"+r.body+"\n")...)
	}
	path := filepath.Join("testdata", "reports_budgets_golden.txt")
	if *updateBudgetsGolden {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, out, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(want) != string(out) {
		t.Errorf("GET /api/reports/budgets differs from %s:\n%s", path, out)
	}
}
