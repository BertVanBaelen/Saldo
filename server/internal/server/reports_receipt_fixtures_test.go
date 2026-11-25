package server

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// updateReceiptFixtures rewrites fixtures/receipt/*.json from the current code:
//
//	go test ./internal/server -run TestReceiptFixtures -update-receipt-fixtures
var updateReceiptFixtures = flag.Bool("update-receipt-fixtures", false, "rewrite fixtures/receipt from the current server")

// receiptFixtureDir is the shared fixture folder (repo root), read by the web
// test of the overview receipt (0.9-3c step 5): lib/reports.ts must read the
// same numbers out of the same answers as the Go model, so a change to either
// side fails both until the fixtures are consciously renewed.
const receiptFixtureDir = "../../../fixtures/receipt"

// TestReceiptFixtures pins, for Bert on the demo (today 18 November 2026), the
// answers Overzicht is built from and the receipt model of the same month:
// October 2026, scope alles. With the flag it writes them; without it, the
// answers of the server today must equal the files byte for byte, so a change
// to the report rule, the category tree, the budget reference or the model
// fails here until the fixtures are renewed (and the web test with them).
func TestReceiptFixtures(t *testing.T) {
	p := newPair(t)
	fixtures := []struct{ file, path string }{
		// September too: the receipt compares October with September, and the web cross-check needs both months for the trend.
		{"months-2026-09-10-detail.json", reportsPath + "?detail=1&scope=alles&from=2026-09&to=2026-10"},
		{"categories.json", "/api/categories"},
		{"budgets-2026-10.json", budgetsPath + "?scope=alles&from=2026-10&to=2026-10"},
		{"model-month-2026-10.json", receiptPath + "?periode=maand&van=2026-10-01&scope=alles"},
	}
	for _, f := range fixtures {
		r := p.bert("GET", f.path, "")
		if r.status != 200 {
			t.Fatalf("GET %s: %d %s", f.path, r.status, r.body)
		}
		// Indented and ending in a newline, so a change is a readable diff.
		var out bytes.Buffer
		if err := json.Indent(&out, bytes.TrimSpace([]byte(r.body)), "", "  "); err != nil {
			t.Fatalf("GET %s: %v", f.path, err)
		}
		out.WriteByte('\n')
		path := filepath.Join(receiptFixtureDir, f.file)
		if *updateReceiptFixtures {
			if err := os.MkdirAll(receiptFixtureDir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%v: write the fixtures with: go test ./internal/server -run TestReceiptFixtures -update-receipt-fixtures", err)
		}
		// A checkout may have turned the line ends into CRLF; the content is what counts.
		if got := strings.ReplaceAll(string(want), "\r\n", "\n"); got != out.String() {
			t.Errorf("GET %s differs from %s: the server's rule changed. If that is intended, renew the fixtures with -update-receipt-fixtures "+
				"and run the web tests that read them.\nnow:\n%s", f.path, path, out.String())
		}
	}
}

// The fixtures agree with each other: the model of October is made of the same
// numbers as the report of October (a guard against writing a stale file).
func TestReceiptFixturesAgree(t *testing.T) {
	read := func(name string, v any) {
		t.Helper()
		b, err := os.ReadFile(filepath.Join(receiptFixtureDir, name))
		if err != nil {
			t.Fatalf("%v (write them with -update-receipt-fixtures)", err)
		}
		if err := json.Unmarshal(b, v); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	var months struct {
		Months []struct {
			Month    string           `json:"month"`
			Income   int64            `json:"income"`
			Saved    int64            `json:"saved"`
			Expenses map[string]int64 `json:"expenses"`
		} `json:"months"`
	}
	var model struct {
		From     string `json:"from"`
		Income   struct{ Total int64 }
		Saved    struct{ Total int64 }
		Expenses struct{ Total int64 }
	}
	read("months-2026-09-10-detail.json", &months)
	read("model-month-2026-10.json", &model)
	if len(months.Months) != 2 || months.Months[1].Month != "2026-10" || model.From != "2026-10-01" {
		t.Fatalf("months %+v, model from %s", months.Months, model.From)
	}
	var spent int64
	for _, v := range months.Months[1].Expenses {
		spent += v
	}
	if model.Income.Total != months.Months[1].Income || model.Saved.Total != months.Months[1].Saved || model.Expenses.Total != spent {
		t.Errorf("model %d/%d/%d, report %d/%d/%d", model.Income.Total, model.Expenses.Total, model.Saved.Total,
			months.Months[1].Income, spent, months.Months[1].Saved)
	}
}
