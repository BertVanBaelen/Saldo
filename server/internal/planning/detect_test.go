package planning_test

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

const detectToday = "2026-11-18"

// detectMonths are the dates of day d in n months from YYYY-MM on.
func detectMonths(from string, n, d int) []string {
	t, _ := time.Parse("2006-01", from)
	out := make([]string, n)
	for i := range out {
		out[i] = t.AddDate(0, i, d-1).Format(time.DateOnly)
	}
	return out
}

// detectRows are rows of one counterparty: one amount for every date, or one
// amount per date when amounts has more than one.
func detectRows(name, iban string, dates []string, amounts ...int64) []planning.DetectRow {
	out := make([]planning.DetectRow, len(dates))
	for i, d := range dates {
		out[i] = planning.DetectRow{Date: d, Name: name, IBAN: iban, Amount: amounts[min(i, len(amounts)-1)]}
	}
	return out
}

// detectSummary renders the groups: a suggestion as "frequency dDay [mMonth]
// amount rule kind xSeen", any other group as its verdict.
func detectSummary(gs []planning.DetectGroup) string {
	parts := []string{}
	for _, g := range gs {
		s := g.Suggestion
		if s == nil {
			parts = append(parts, g.Verdict)
			continue
		}
		m := ""
		if s.Month != nil {
			m = fmt.Sprintf(" m%d", *s.Month)
		}
		parts = append(parts, fmt.Sprintf("%s d%d%s %d %s %s x%d", s.Frequency, s.Day, m, s.Amount, s.AmountRule, s.Kind, s.Seen))
	}
	return strings.Join(parts, " | ")
}

func TestDetect(t *testing.T) {
	jan11 := detectMonths("2026-01", 11, 5)
	netflix := detectRows("Netflix", "", jan11, -1000)
	item := func(amount int64, state string) []planning.DetectItem {
		return []planning.DetectItem{{Counterparty: "Netflix", Amount: amount, State: state}}
	}
	bvb := append(detectRows("BERT VAN BAELEN", "XS", detectMonths("2026-05", 7, 1), -45000), detectRows("BERT VAN BAELEN", "XV", detectMonths("2026-05", 7, 16), -20000)...)
	saving := detectRows("Sparen", "", jan11, -5000)
	for i := range saving {
		saving[i].Saving = true
	}
	tests := []struct {
		name  string
		rows  []planning.DetectRow
		items []planning.DetectItem
		acc   planning.DetectAccount
		want  string
	}{
		{"monthly fixed", netflix, nil, planning.DetectAccount{}, "monthly d5 -1000 fixed expense x11"},
		{"monthly skip and extra", detectRows("Sparen", "", slices.Concat(detectMonths("2025-11", 8, 16), detectMonths("2026-08", 4, 16), []string{"2026-08-28"}), -20000),
			nil, planning.DetectAccount{}, "monthly d16 -20000 fixed expense x4"},
		{"end of month drift", detectRows("Werkgever", "", []string{"2026-05-30", "2026-06-30", "2026-07-31", "2026-08-29", "2026-09-30", "2026-10-30"}, 250000),
			nil, planning.DetectAccount{}, "monthly d30 250000 fixed income x6"},
		{"rent paid early", detectRows("Immo", "", []string{"2026-07-01", "2026-07-31", "2026-09-01", "2026-10-01", "2026-10-30"}, -80000),
			nil, planning.DetectAccount{}, "monthly d1 -80000 fixed expense x5"},
		{"twice a month", detectRows("Colruyt", "", slices.Concat(detectMonths("2026-05", 6, 8), detectMonths("2026-05", 6, 22), []string{"2026-11-08"}), -5000),
			nil, planning.DetectAccount{}, "extras"},
		{"every other month", detectRows("Zara", "", []string{"2026-05-20", "2026-07-20", "2026-09-20", "2026-11-15"}, -2400),
			nil, planning.DetectAccount{}, "too few"},
		{"amounts vary 15 %", detectRows("Delhaize", "", jan11, -5437, -4517, -6357, -5137, -6317, -4537, -5837, -4587, -6347, -5337, -4547),
			nil, planning.DetectAccount{}, "amount"},
		{"amounts vary 6 %", detectRows("Action", "", jan11, -6202, -5842, -6562, -6082, -6402, -5902, -6292, -5952, -6512, -6162, -6022),
			nil, planning.DetectAccount{}, "monthly d5 -6162 average expense x11"},
		{"stale", detectRows("Gym", "", detectMonths("2026-01", 8, 1), -999), nil, planning.DetectAccount{}, "stale"},
		{"quarterly with extra", detectRows("Decathlon", "", []string{"2025-12-27", "2026-03-27", "2026-06-27", "2026-09-27", "2026-11-14"}, -4290),
			nil, planning.DetectAccount{}, "quarterly d27 m9 -4290 fixed expense x4"},
		{"yearly", detectRows("Verzekering", "", []string{"2025-01-15", "2026-01-15"}, -68400), nil, planning.DetectAccount{}, "yearly d15 m1 -68400 fixed expense x2"},
		{"yearly, two years back", detectRows("Club", "", []string{"2024-02-29", "2025-02-28"}, -5000), nil, planning.DetectAccount{}, "stale"},
		{"yearly, recent", detectRows("Club", "", []string{"2025-02-28", "2026-02-28"}, -5000), nil, planning.DetectAccount{}, "yearly d28 m2 -5000 fixed expense x2"},
		{"covered", netflix, item(-1000, "confirmed"), planning.DetectAccount{}, "covered"},
		{"ignored", netflix, item(-1000, "ignored"), planning.DetectAccount{}, "ignored"},
		{"other sign", detectRows("Netflix", "", jan11, 1000), item(-1000, "confirmed"), planning.DetectAccount{}, "monthly d5 1000 fixed income x11"},
		{"one extra", append(detectRows("Luminus", "", detectMonths("2026-01", 11, 3), -14500), detectRows("Luminus", "", []string{"2026-06-10"}, -30000)...),
			nil, planning.DetectAccount{}, "monthly d3 -14500 fixed expense x11"},
		{"shared name, two IBANs", bvb, nil, planning.DetectAccount{OwnCurrent: map[string]bool{"XS": true}, OwnSavings: map[string]bool{"XV": true}},
			"monthly d1 -45000 fixed transfer x7 | monthly d16 -20000 fixed saving x7"},
		// The € 200 item with its IBAN and an ignored € 200 without one leave the € 450 group alone; an ignored € 440 hides it.
		{"shared name, hidden by IBAN or amount", bvb, []planning.DetectItem{{Counterparty: "Bert van Baelen", IBAN: "XV", Amount: -20000, State: "confirmed"},
			{Counterparty: "Bert van Baelen", Amount: -20000, State: "ignored"}, {Counterparty: "Bert van Baelen", Amount: -44000, State: "ignored"}}, planning.DetectAccount{},
			"ignored | covered"},
		{"key with digits", detectRows("PAYPAL *NETFLIX 1234", "", detectMonths("2026-06", 6, 5), -1399), nil, planning.DetectAccount{}, "monthly d5 -1399 fixed expense x6"},
		{"saving category", saving, nil, planning.DetectAccount{}, "monthly d5 -5000 fixed saving x11"},
		{"contribution sender on a shared account", detectRows("Bert", "XB", jan11, 45000),
			nil, planning.DetectAccount{Shared: true, Senders: map[string]bool{"XB": true}, OwnCurrent: map[string]bool{"XB": true}}, "monthly d5 45000 fixed contribution x11"},
		{"empty name", detectRows("", "", jan11, -1000), nil, planning.DetectAccount{}, ""},
		// Bilance rows (no IBAN) join the one IBAN group of their key; next to two IBAN groups they stay their own group.
		{"IBAN-less history folded", slices.Concat(detectRows("Basic-Fit", "", detectMonths("2026-05", 6, 1), -10000), detectRows("Basic-Fit", "XG", []string{"2026-11-01"}, -10000),
			bvb, detectRows("BERT VAN BAELEN", "", detectMonths("2026-02", 3, 1), -45000)), nil, planning.DetectAccount{},
			"monthly d1 -10000 fixed expense x7 | stale | monthly d1 -45000 fixed expense x7 | monthly d16 -20000 fixed expense x7"},
	}
	// The digits case: the other spelling on every other row.
	for i := range tests[19].rows {
		if i%2 == 1 {
			tests[19].rows[i].Name = "PAYPAL *NETFLIX 5678"
		}
	}
	for _, tc := range tests {
		if got := detectSummary(planning.Detect(detectToday, tc.acc, tc.rows, tc.items)); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

// detectDB is the demo database of 18 November 2026 with the 0.8-1 seed.
func detectDB(t *testing.T) (*sql.DB, *ledger.Store) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	ctx := context.Background()
	if _, err := db.Migrate(ctx, d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := demo.Seed(ctx, d, fake.Provider{}, nil); err != nil {
		t.Fatal(err)
	}
	return d, ledger.New(d)
}

func TestDetectDemo(t *testing.T) {
	d, st := detectDB(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 18, 20, 0, 0, 0, clock.Brussels)
	suggestions := func(viewer int64) string {
		list, err := planning.DetectSuggestions(ctx, d, st, viewer, "alles", now)
		if err != nil {
			t.Fatal(err)
		}
		parts := []string{}
		for _, s := range list {
			m := ""
			if s.Month != nil {
				m = fmt.Sprintf(" m%d", *s.Month)
			}
			parts = append(parts, fmt.Sprintf("%d %s %s d%d%s %d %s %s x%d", s.AccountID, s.Counterparty, s.Frequency, s.Day, m, s.Amount, s.AmountRule, s.Kind, s.Seen))
		}
		return strings.Join(parts, "\n")
	}
	report := func(viewer, account int64) map[string]planning.DetectGroup {
		rep, err := planning.DetectionReport(ctx, d, st, viewer, account, now)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]planning.DetectGroup{}
		for _, g := range rep.Groups {
			out[fmt.Sprintf("%s %+d", g.Key, g.Sign)] = g
		}
		return out
	}
	verdicts := func(viewer, account int64, want map[string]string) {
		groups := report(viewer, account)
		for key, v := range want {
			if groups[key].Verdict != v {
				t.Errorf("account %d, %s: verdict %q, want %q", account, key, groups[key].Verdict, v)
			}
		}
	}
	const action = "4 Action monthly d23 -6247 average expense x12"
	if got, want := suggestions(demo.Bert), "1 Decathlon quarterly d27 m9 -4290 fixed expense x4\n"+action; got != want {
		t.Errorf("Bert:\n%s\nwant\n%s", got, want)
	}
	if got, want := suggestions(demo.Partner), action+"\n5 De Lijn monthly d14 -2200 fixed expense x13\n5 Naar gedeelde rekening monthly d1 -45000 fixed transfer x13\n"+
		"5 Werkgever BV monthly d2 246000 fixed income x13\n5 Basic-Fit monthly d21 -2999 fixed expense x12"; got != want {
		t.Errorf("Partner:\n%s\nwant\n%s", got, want)
	}
	verdicts(demo.Partner, 5, map[string]string{"lidl -1": "amount", "zara -1": "extras"})
	if lidl := report(demo.Partner, 5)["lidl -1"].Runs[0].Within; lidl != 54 {
		t.Errorf("Lidl within 10 %%: %d, want 54", lidl)
	}

	// Without the seed's items, and with Bert's sender claimed on the shared
	// account: its suggestions are the same for both members.
	if _, err := d.Exec(`DELETE FROM recurring_items`); err != nil {
		t.Fatal(err)
	}
	if got, want := suggestions(demo.Bert), "1 Immo Verhaeghe monthly d1 -100500 fixed expense x13\n1 Naar gedeelde rekening monthly d1 -45000 fixed transfer x13\n"+
		"1 Netflix monthly d12 -1399 fixed expense x13\n1 Spotify monthly d17 -1199 fixed expense x13\n1 Werkgever NV monthly d2 285000 fixed income x13\n"+
		"1 Decathlon quarterly d27 m9 -4290 fixed expense x4\n1 Naar spaarrekening monthly d16 -20000 fixed saving x4\n"+
		"4 Bert monthly d1 45000 fixed income x13\n4 Luminus monthly d3 -14500 fixed expense x13\n4 Partner monthly d1 45000 fixed income x13\n"+
		"4 Proximus monthly d9 -4298 fixed expense x13\n"+action; got != want {
		t.Errorf("Bert without items:\n%s\nwant\n%s", got, want)
	}
	verdicts(demo.Bert, 4, map[string]string{"albert heijn -1": "amount", "carrefour express -1": "amount", "delhaize -1": "amount", "colruyt laagste prijzen -1": "extras"})
	verdicts(demo.Bert, 1, map[string]string{"totalenergies -1": "extras"})
	if _, err := d.Exec(`INSERT INTO contribution_senders (account_id, user_id, iban) VALUES (4, ?, ?)`, demo.Bert, fake.IBANBertCurrent); err != nil {
		t.Fatal(err)
	}
	shared := func(viewer int64) string {
		list, err := planning.DetectSuggestions(ctx, d, st, viewer, "gedeeld", now)
		if err != nil {
			t.Fatal(err)
		}
		return fmt.Sprint(list)
	}
	if b, p := shared(demo.Bert), shared(demo.Partner); b != p || !strings.Contains(b, "Bert Bert 45000 fixed monthly 1 <nil> contribution") || !strings.Contains(b, "Partner Partner 45000 fixed monthly 1 <nil> income") {
		t.Errorf("shared account: Bert %s, Partner %s", b, p)
	}
}
