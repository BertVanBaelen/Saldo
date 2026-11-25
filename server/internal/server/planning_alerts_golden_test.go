package server

import (
	"flag"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// updateAlertsGolden rewrites testdata/alerts_golden.txt from the current code.
var updateAlertsGolden = flag.Bool("update-alerts-golden", false, "rewrite the GET /api/alerts golden")

// TestAlertsGolden pins the full bytes of GET /api/alerts on the demo in
// several situations. The golden was written by the code before the month-end
// rule moved from this package into planning.Warnings (0.9-3 step 1), so the
// move is shown to change no byte of Start's alerts.
func TestAlertsGolden(t *testing.T) {
	p := newPair(t)
	var out []byte
	ask := func(situation string) {
		t.Helper()
		for _, who := range []string{"bert", "partner"} {
			call := p.bert
			if who == "partner" {
				call = p.partner
			}
			for _, q := range []string{"", "?scope=persoonlijk", "?scope=gedeeld"} {
				r := call("GET", "/api/alerts"+q, "")
				if r.status != http.StatusOK {
					t.Fatalf("%s %s %s: %d %s", situation, who, q, r.status, r.body)
				}
				out = append(out, []byte(situation+" "+who+" /api/alerts"+q+"\n"+r.body+"\n")...)
			}
		}
	}
	ask("demo")                                                  // Bert: red in February, buffer in January
	p.exec(`UPDATE users SET lookahead_months = 1 WHERE id = 1`) // none within one month
	ask("look1")
	p.exec(`UPDATE users SET lookahead_months = 6 WHERE id = 1`)
	ask("look6")
	p.exec(`UPDATE users SET lookahead_months = 3 WHERE id = 1`)
	p.exec(`UPDATE accounts SET buffer = 150000 WHERE id = 1`) // the buffer from the running month
	ask("buffer150000")
	p.exec(`UPDATE balance_snapshots SET balance = -50000000 WHERE account_id = 5`) // Partner red from the running month
	ask("partnerred")

	path := filepath.Join("testdata", "alerts_golden.txt")
	if *updateAlertsGolden {
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
		t.Errorf("GET /api/alerts differs from %s:\n%s", path, out)
	}
}
