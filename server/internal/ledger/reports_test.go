package ledger_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"maps"
	"math/rand/v2"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// reportNow is the clock of the reportWorld tests.
var reportNow = time.Date(2026, 11, 17, 12, 0, 0, 0, clock.Brussels)

// Accounts of reportWorld (plan 0.7-1, Tests).
const (
	rwZicht    int64 = 1 // A1 Bert, current, X1
	rwTweede   int64 = 2 // A2 Bert, current, X2
	rwGedeeld  int64 = 3 // A3 Bert + Partner, current, XS
	rwSpaar    int64 = 4 // A4 Bert, savings, bank, XV
	rwBeleggen int64 = 5 // A5 Bert, investment, manual, XI
	rwPartner  int64 = 6 // A6 Partner only, XP
	rwOud      int64 = 7 // A7 Partner only now (Bert left), XO
	rwNieuw    int64 = 8 // A8 Bert, current, X8, first row r23
	rwPot      int64 = 9 // A9 Bert, current, manual, X9, shared = 1 with one member (0.8-0b)
)

// Categories of reportWorld after the defaults (plan 0.8-0a).
const (
	rwSparen     int64 = 26 // top expense, saving
	rwPensioen   int64 = 27 // subcategory of Sparen
	rwRestaurant int64 = 28 // subcategory of Vrije tijd (3), plan 0.8.1-1
	rwBonus      int64 = 29 // subcategory of Salaris (7), plan 0.8.1-1
)

// reportRow is one row of the reportWorld oracle table.
type reportRow struct {
	name        string
	account     int64
	date        string
	amount      int64
	iban        string // counterparty IBAN, "" = none
	category    int64  // 0 = none
	splits      [][2]int64
	transfer    bool // the viewer's override "is een overschrijving"
	pending     bool // status pending: not in the report
	alles       string
	persoonlijk string
	gedeeld     string
	alone       string // with the row's own account as the selection
}

// reportRows is the oracle of plan 0.7-1 (- = not in the selection). r0 gives
// A3 its first booked row on 2025-11-01, as the plan describes it.
var reportRows = []reportRow{
	{name: "r0", account: rwGedeeld, date: "2025-11-01", amount: 700, alles: "income 700", persoonlijk: "-", gedeeld: "income 700", alone: "income 700"},
	{name: "r1", account: rwZicht, date: "2020-03-01", amount: -45000, iban: "XS", alles: "toShared 45000", persoonlijk: "toShared 45000", gedeeld: "-", alone: "toShared 45000"},
	{name: "r2", account: rwZicht, date: "2026-01-01", amount: -45000, iban: "XS", alles: "out", persoonlijk: "toShared 45000", gedeeld: "-", alone: "toShared 45000"},
	{name: "r3", account: rwGedeeld, date: "2026-01-01", amount: 45000, iban: "X1", alles: "out", persoonlijk: "-", gedeeld: "income 45000", alone: "income 45000"},
	{name: "r4", account: rwGedeeld, date: "2026-01-01", amount: 45000, alles: "out", persoonlijk: "-", gedeeld: "income 45000", alone: "income 45000"},
	{name: "r5", account: rwZicht, date: "2026-01-05", amount: -20000, iban: "XV", alles: "saved 20000", persoonlijk: "saved 20000", gedeeld: "-", alone: "saved 20000"},
	{name: "r6", account: rwSpaar, date: "2026-01-05", amount: 20000, iban: "X1", alles: "-", persoonlijk: "-", gedeeld: "-", alone: "-"},
	{name: "r7", account: rwSpaar, date: "2026-01-31", amount: 350, alles: "-", persoonlijk: "-", gedeeld: "-", alone: "-"},
	{name: "r8", account: rwZicht, date: "2026-01-10", amount: 10000, iban: "XV", alles: "saved -10000", persoonlijk: "saved -10000", gedeeld: "-", alone: "saved -10000"},
	{name: "r9", account: rwZicht, date: "2026-01-12", amount: -30000, iban: "X2", alles: "out", persoonlijk: "out", gedeeld: "-", alone: "toOwn 30000"},
	{name: "r10", account: rwTweede, date: "2026-01-12", amount: 30000, iban: "X1", alles: "out", persoonlijk: "out", gedeeld: "-", alone: "income 30000"},
	{name: "r11", account: rwGedeeld, date: "2026-01-15", amount: -5000, iban: "X1", alles: "out", persoonlijk: "-", gedeeld: "toOwn 5000", alone: "toOwn 5000"},
	{name: "r12", account: rwZicht, date: "2026-01-15", amount: 5000, iban: "XS", alles: "out", persoonlijk: "income 5000", gedeeld: "-", alone: "income 5000"},
	{name: "r13", account: rwZicht, date: "2026-01-20", amount: -10000, iban: "XI", alles: "saved 10000", persoonlijk: "saved 10000", gedeeld: "-", alone: "saved 10000"},
	{name: "r14", account: rwZicht, date: "2026-01-22", amount: -12000, iban: "XS", splits: [][2]int64{{1, -8000}, {6, -4000}},
		alles: "out", persoonlijk: "toShared 12000", gedeeld: "-", alone: "toShared 12000"},
	{name: "r15", account: rwZicht, date: "2026-01-25", amount: 2500, category: 3, alles: "3 -2500", persoonlijk: "3 -2500", gedeeld: "-", alone: "3 -2500"},
	{name: "r16", account: rwZicht, date: "2026-01-26", amount: -6000, transfer: true, alles: "out", persoonlijk: "out", gedeeld: "-", alone: "out"},
	{name: "r17", account: rwZicht, date: "2026-01-27", amount: -4000, alles: "none 4000", persoonlijk: "none 4000", gedeeld: "-", alone: "none 4000"},
	{name: "r18", account: rwZicht, date: "2025-06-01", amount: -45000, iban: "XO", alles: "none 45000", persoonlijk: "none 45000", gedeeld: "-", alone: "none 45000"},
	{name: "r19", account: rwTweede, date: "2026-01-28", amount: -3000, category: 2, alles: "2 3000", persoonlijk: "2 3000", gedeeld: "-", alone: "2 3000"},
	{name: "r20", account: rwZicht, date: "2026-01-02", amount: 250000, category: 7, alles: "income 250000", persoonlijk: "income 250000", gedeeld: "-", alone: "income 250000"},
	{name: "r21", account: rwZicht, date: "2026-01-03", amount: -1000, category: 7, alles: "income -1000", persoonlijk: "income -1000", gedeeld: "-", alone: "income -1000"},
	{name: "r22", account: rwZicht, date: "2026-03-10", amount: -1000, iban: "X8", alles: "out", persoonlijk: "out", gedeeld: "-", alone: "toOwn 1000"},
	{name: "r23", account: rwNieuw, date: "2026-03-11", amount: 1000, iban: "X1", alles: "out", persoonlijk: "out", gedeeld: "-", alone: "income 1000"},
	{name: "r24", account: rwZicht, date: "2026-03-07", amount: -2000, iban: "X8", alles: "toOwn 2000", persoonlijk: "toOwn 2000", gedeeld: "-", alone: "toOwn 2000"},
	{name: "p1", account: rwPartner, date: "2026-01-01", amount: -45000, iban: "XS", alles: "-", persoonlijk: "-", gedeeld: "-", alone: "-"},
	// The 3-day window of other_first: A3's first booked row is r0 on 2025-11-01, so a transfer to A3 on 2025-10-29
	// (3 days before, 2025-10-29 + 3 days = 2025-11-01) is internal in Alles, one on 2025-10-28 (4 days before) is a flow.
	{name: "r25", account: rwZicht, date: "2025-10-29", amount: -4600, iban: "XS", alles: "out", persoonlijk: "toShared 4600", gedeeld: "-", alone: "toShared 4600"},
	{name: "r26", account: rwZicht, date: "2025-10-28", amount: -4700, iban: "XS", alles: "toShared 4700", persoonlijk: "toShared 4700", gedeeld: "-", alone: "toShared 4700"},
	// A pending row on a current account is in no report and under no key (2025-09 has nothing else).
	{name: "r27", account: rwZicht, date: "2025-09-15", amount: -3300, category: 2, pending: true, alles: "-", persoonlijk: "-", gedeeld: "-", alone: "-"},
	// A booked row of 0 before the history (2019-12): it is income 0 and starts no history (firstDate, firstMonth stay 2020-03).
	{name: "r28", account: rwZicht, date: "2019-12-15", amount: 0, alles: "income 0", persoonlijk: "income 0", gedeeld: "-", alone: "income 0"},
	// Saving categories (plan 0.8-0a), all in April 2026.
	{name: "s1", account: rwZicht, date: "2026-04-02", amount: -5000, category: rwSparen, alles: "saved 5000", persoonlijk: "saved 5000", gedeeld: "-", alone: "saved 5000"},
	{name: "s2", account: rwZicht, date: "2026-04-03", amount: -3000, category: rwPensioen, alles: "saved 3000", persoonlijk: "saved 3000", gedeeld: "-", alone: "saved 3000"},
	{name: "s3", account: rwZicht, date: "2026-04-04", amount: 1000, category: rwSparen, alles: "saved -1000", persoonlijk: "saved -1000", gedeeld: "-", alone: "saved -1000"},
	{name: "s4", account: rwZicht, date: "2026-04-05", amount: -7000, iban: "XS", category: rwSparen, alles: "out", persoonlijk: "saved 7000", gedeeld: "-", alone: "saved 7000"},
	{name: "s4b", account: rwGedeeld, date: "2026-04-05", amount: 7000, iban: "X1", alles: "out", persoonlijk: "-", gedeeld: "income 7000", alone: "income 7000"},
	{name: "s5", account: rwZicht, date: "2026-04-06", amount: -4000, iban: "XV", category: rwSparen, alles: "saved 4000", persoonlijk: "saved 4000", gedeeld: "-", alone: "saved 4000"},
	{name: "s5b", account: rwSpaar, date: "2026-04-06", amount: 4000, iban: "X1", alles: "-", persoonlijk: "-", gedeeld: "-", alone: "-"},
	{name: "s6", account: rwZicht, date: "2026-04-07", amount: -6500, category: rwSparen, transfer: true, alles: "saved 6500", persoonlijk: "saved 6500", gedeeld: "-", alone: "saved 6500"},
	{name: "s7", account: rwZicht, date: "2026-04-08", amount: -9000, splits: [][2]int64{{rwSparen, -6000}, {6, -3000}},
		alles: "6 3000, saved 6000", persoonlijk: "6 3000, saved 6000", gedeeld: "-", alone: "6 3000, saved 6000"},
	{name: "s8", account: rwZicht, date: "2026-04-09", amount: -2500, iban: "X2", category: rwSparen, alles: "out", persoonlijk: "out", gedeeld: "-", alone: "saved 2500"},
	{name: "s8b", account: rwTweede, date: "2026-04-09", amount: 2500, iban: "X1", alles: "out", persoonlijk: "out", gedeeld: "-", alone: "income 2500"},
	{name: "s9", account: rwGedeeld, date: "2026-04-10", amount: -1500, category: rwSparen, alles: "saved 1500", persoonlijk: "-", gedeeld: "saved 1500", alone: "saved 1500"},
	// The shared flag (plan 0.8-0b), May 2026: A9 is shared by its flag, so t1 is toShared in Persoonlijk.
	{name: "t1", account: rwZicht, date: "2026-05-02", amount: -1000, iban: "X9", alles: "out", persoonlijk: "toShared 1000", gedeeld: "-", alone: "toShared 1000"},
	{name: "t2", account: rwPot, date: "2026-05-02", amount: 1000, iban: "X1", alles: "out", persoonlijk: "-", gedeeld: "income 1000", alone: "income 1000"},
	// Subcategories (plan 0.8.1-1), June 2026, no IBAN so nothing pairs.
	{name: "u1", account: rwZicht, date: "2026-06-02", amount: -2000, category: rwRestaurant, alles: "3 2000", persoonlijk: "3 2000", gedeeld: "-", alone: "3 2000"},
	{name: "u2", account: rwZicht, date: "2026-06-03", amount: -1000, category: 3, alles: "3 1000", persoonlijk: "3 1000", gedeeld: "-", alone: "3 1000"},
	{name: "u3", account: rwZicht, date: "2026-06-04", amount: 5000, category: rwBonus, alles: "income 5000", persoonlijk: "income 5000", gedeeld: "-", alone: "income 5000"},
}

// reportWorld is the fixture of plan 0.7-1 (also for 0.7-2): viewer Bert,
// Partner as the other user, the accounts above and the rows of reportRows.
// It returns the row ids by name.
func reportWorld(t *testing.T) (*sql.DB, *ledger.Store, map[string]int64) {
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
	if err := categorise.SeedDefaults(ctx, d); err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := d.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO categories (id, name, parent_id, type, colour, tint, saving, sort_order) VALUES
		(?, 'Sparen', NULL, 'expense', 'c6', 'c9', 1, 11), (?, 'Pensioensparen', ?, 'expense', 'c6', 'c9', 0, 1),
		(?, 'Restaurant', 3, 'expense', 'c3', NULL, 0, 9), (?, 'Bonus', 7, 'income', 'soft', NULL, 0, 1)`,
		rwSparen, rwPensioen, rwSparen, rwRestaurant, rwBonus)
	exec(`INSERT INTO users (id, email, display_name) VALUES (?, 'bert@example.com', 'Bert'), (?, 'partner@example.com', 'Partner')`, bert, partner)
	for _, a := range []struct {
		id                      int64
		typ, source, iban, name string
		holders                 []int64
	}{
		{rwZicht, "current", "bank", "X1", "Zicht", []int64{bert}},
		{rwTweede, "current", "manual", "X2", "Tweede", []int64{bert}},
		{rwGedeeld, "current", "bank", "XS", "Gedeeld", []int64{bert, partner}},
		{rwSpaar, "savings", "bank", "XV", "Spaar", []int64{bert}},
		{rwBeleggen, "investment", "manual", "XI", "Beleggen", []int64{bert}},
		{rwPartner, "current", "bank", "XP", "Zicht van Partner", []int64{partner}},
		{rwOud, "current", "bank", "XO", "Oud gedeeld", []int64{partner}},
		{rwNieuw, "current", "manual", "X8", "Nieuw", []int64{bert}},
		{rwPot, "current", "manual", "X9", "Pot", []int64{bert}},
	} {
		exec(`INSERT INTO accounts (id, type, source, iban, name) VALUES (?, ?, ?, ?, ?)`, a.id, a.typ, a.source, a.iban, a.name)
		for _, u := range a.holders {
			exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, ?, 'manager', 'edit')`, a.id, u)
		}
	}
	exec(`UPDATE accounts SET shared = 1 WHERE id = ?`, rwPot)
	ids := map[string]int64{}
	for _, r := range reportRows {
		var iban, category any
		if r.iban != "" {
			iban = r.iban
		}
		if r.category != 0 {
			category = r.category
		}
		status := "booked"
		if r.pending {
			status = "pending"
		}
		res, err := d.Exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, counterparty_iban,
			status, dedupe_key, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			r.account, r.amount, r.date, r.name, iban, status, r.name, category)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		ids[r.name] = id
		for _, sp := range r.splits {
			exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)`, id, sp[0], sp[1])
		}
		if r.transfer {
			exec(`INSERT INTO transfer_overrides (user_id, transaction_id, is_transfer) VALUES (?, ?, 1)`, bert, id)
		}
	}
	return d, ledger.New(d), ids
}

// TestReportBucket checks every row of the oracle in every selection, then
// the month totals of plan 0.7-1.
func TestReportBucket(t *testing.T) {
	ctx := context.Background()
	_, s, ids := reportWorld(t)
	read := func(scope string, account int64) map[int64]string {
		t.Helper()
		got, err := s.ReportRows(ctx, bert, scope, account)
		if err != nil {
			t.Fatalf("%s/%d: %v", scope, account, err)
		}
		return got
	}
	label := func(m map[int64]string, id int64) string {
		if v, ok := m[id]; ok {
			return v
		}
		return "-"
	}
	views := map[string]map[int64]string{
		"alles": read("alles", 0), "persoonlijk": read("persoonlijk", 0), "gedeeld": read("gedeeld", 0),
	}
	alone := map[int64]map[int64]string{}
	for _, a := range []int64{rwZicht, rwTweede, rwGedeeld, rwNieuw, rwPot} {
		alone[a] = read("", a)
	}
	for _, r := range reportRows {
		id := ids[r.name]
		for _, c := range []struct{ view, want string }{
			{"alles", r.alles}, {"persoonlijk", r.persoonlijk}, {"gedeeld", r.gedeeld},
		} {
			if got := label(views[c.view], id); got != c.want {
				t.Errorf("%s in %s: %q, want %q", r.name, c.view, got, c.want)
			}
		}
		got := "-"
		if m, ok := alone[r.account]; ok {
			got = label(m, id)
		}
		if got != r.alone {
			t.Errorf("%s with its account alone: %q, want %q", r.name, got, r.alone)
		}
	}

	month := func(scope string, account int64, m string) ledger.ReportMonth {
		t.Helper()
		rep, err := s.ReportMonths(ctx, bert, ledger.ReportQuery{Scope: scope, AccountID: account, From: m, To: m, Now: reportNow})
		if err != nil {
			t.Fatal(err)
		}
		if len(rep.Months) != 1 {
			t.Fatalf("%s/%d %s: %+v", scope, account, m, rep.Months)
		}
		return rep.Months[0]
	}
	for _, c := range []struct {
		scope         string
		account       int64
		month         string
		income, saved int64
		expenses      map[string]int64
	}{
		{"alles", 0, "2026-01", 249000, 20000, map[string]int64{"3": -2500, "none": 4000, "2": 3000}},
		{"persoonlijk", 0, "2026-01", 254000, 20000, map[string]int64{"toShared": 57000, "3": -2500, "none": 4000, "2": 3000}},
		{"gedeeld", 0, "2026-01", 90000, 0, map[string]int64{"toOwn": 5000}},
		{"", rwZicht, "2026-01", 254000, 20000, map[string]int64{"toShared": 57000, "toOwn": 30000, "3": -2500, "none": 4000}},
		{"alles", 0, "2020-03", 0, 0, map[string]int64{"toShared": 45000}},
		{"alles", 0, "2025-06", 0, 0, map[string]int64{"none": 45000}},
		{"alles", 0, "2026-03", 0, 0, map[string]int64{"toOwn": 2000}},
		{"persoonlijk", 0, "2026-03", 0, 0, map[string]int64{"toOwn": 2000}},
		{"", rwZicht, "2026-03", 0, 0, map[string]int64{"toOwn": 3000}},
		{"", rwNieuw, "2026-03", 1000, 0, map[string]int64{}},
		// The 3-day window (r25 internal, r26 a flow) and a pending row (r27) that is in no month.
		{"alles", 0, "2025-10", 0, 0, map[string]int64{"toShared": 4700}},
		{"persoonlijk", 0, "2025-10", 0, 0, map[string]int64{"toShared": 9300}},
		{"gedeeld", 0, "2025-10", 0, 0, map[string]int64{}},
		{"", rwZicht, "2025-10", 0, 0, map[string]int64{"toShared": 9300}},
		{"alles", 0, "2025-09", 0, 0, map[string]int64{}},
		{"", rwZicht, "2025-09", 0, 0, map[string]int64{}},
		// Saving categories (0.8-0a).
		{"alles", 0, "2026-04", 0, 25000, map[string]int64{"6": 3000}},
		{"persoonlijk", 0, "2026-04", 0, 30500, map[string]int64{"6": 3000}},
		{"gedeeld", 0, "2026-04", 7000, 1500, map[string]int64{}},
		{"", rwZicht, "2026-04", 0, 33000, map[string]int64{"6": 3000}},
		{"", rwTweede, "2026-04", 2500, 0, map[string]int64{}},
		{"", rwGedeeld, "2026-04", 7000, 1500, map[string]int64{}},
		// The shared flag (0.8-0b).
		{"alles", 0, "2026-05", 0, 0, map[string]int64{}},
		{"persoonlijk", 0, "2026-05", 0, 0, map[string]int64{"toShared": 1000}},
		{"gedeeld", 0, "2026-05", 1000, 0, map[string]int64{}},
		{"", rwZicht, "2026-05", 0, 0, map[string]int64{"toShared": 1000}},
		// Subcategories (0.8.1-1): rolled up into their top.
		{"alles", 0, "2026-06", 5000, 0, map[string]int64{"3": 3000}},
	} {
		got := month(c.scope, c.account, c.month)
		if got.Income != c.income || got.Saved != c.saved || !maps.Equal(got.Expenses, c.expenses) {
			t.Errorf("%s/%d %s: income %d saved %d expenses %v; want %d %d %v",
				c.scope, c.account, c.month, got.Income, got.Saved, got.Expenses, c.income, c.saved, c.expenses)
		}
	}

	// Partner: s4b is no transfer (A1 is not Partner's), so uncategorised income; s9 is saved.
	if rep, err := s.ReportMonths(ctx, partner, ledger.ReportQuery{Scope: "gedeeld", From: "2026-04", To: "2026-04", Now: reportNow}); err != nil ||
		rep.Months[0].Income != 7000 || rep.Months[0].Saved != 1500 || len(rep.Months[0].Expenses) != 0 {
		t.Errorf("Partner gedeeld 2026-04: %+v, %v", rep.Months, err)
	}

	// Selections and errors.
	rep, err := s.ReportMonths(ctx, bert, ledger.ReportQuery{Now: reportNow})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(rep.Accounts, []int64{rwZicht, rwTweede, rwGedeeld, rwNieuw, rwPot}) || *rep.FirstMonth != "2020-03" ||
		*rep.FirstDate != "2020-03-01" || rep.Months[0].Month != "2020-03" || rep.Months[len(rep.Months)-1].Month != "2026-11" ||
		len(rep.Months) != 6*12+9 {
		t.Errorf("alles: accounts %v, first %v %v, %d months", rep.Accounts, *rep.FirstMonth, *rep.FirstDate, len(rep.Months))
	}
	if p, _ := s.ReportMonths(ctx, bert, ledger.ReportQuery{Scope: "gedeeld", Now: reportNow}); !slices.Equal(p.Accounts, []int64{rwGedeeld, rwPot}) ||
		*p.FirstDate != "2025-11-01" || len(p.Months[0].Accounts) != 2 {
		t.Errorf("gedeeld: %v %v %+v", p.Accounts, *p.FirstDate, p.Months[0])
	}
	for _, c := range []struct {
		q    ledger.ReportQuery
		want error
	}{
		{ledger.ReportQuery{AccountID: rwSpaar}, apperr.Invalid("Kies een betaalrekening.")},
		{ledger.ReportQuery{AccountID: rwBeleggen}, apperr.Invalid("Kies een betaalrekening.")},
		{ledger.ReportQuery{AccountID: rwPartner}, apperr.ErrNotFound},
		{ledger.ReportQuery{AccountID: rwOud}, apperr.ErrNotFound},
		{ledger.ReportQuery{AccountID: 99}, apperr.ErrNotFound},
		{ledger.ReportQuery{From: "2026-1"}, apperr.Invalid("Kies een maand als JJJJ-MM.")},
		{ledger.ReportQuery{To: "2026-13"}, apperr.Invalid("Kies een maand als JJJJ-MM.")},
		{ledger.ReportQuery{To: "2026-12"}, apperr.Invalid("De eindmaand ligt na deze maand.")},
		{ledger.ReportQuery{From: "2026-05", To: "2026-04"}, apperr.Invalid("De beginmaand ligt na de eindmaand.")},
		{ledger.ReportQuery{Scope: "iets"}, apperr.Invalid("Kies alles, persoonlijk of gedeeld.")},
	} {
		c.q.Now = reportNow
		_, err := s.ReportMonths(ctx, bert, c.q)
		if err == nil || err.Error() != c.want.Error() {
			t.Errorf("%+v: %v, want %v", c.q, err, c.want)
		}
	}
}

// Two documented limits (plan 0.7 README, Known limits). If one changes,
// update the README.
func TestReportKnownLimits(t *testing.T) {
	ctx := context.Background()
	_, s, ids := reportWorld(t)
	alles, err := s.ReportRows(ctx, bert, "alles", 0)
	if err != nil {
		t.Fatal(err)
	}
	// r4: Partner's € 450 imported without IBAN pairs with Bert's own r2 and
	// is left out in Alles, so Alles income is € 450 too low.
	if alles[ids["r4"]] != "out" {
		t.Errorf("r4 in alles: %q", alles[ids["r4"]])
	}
	// r18: a contribution to a shared account Bert has left is uncategorised.
	if alles[ids["r18"]] != "none 45000" {
		t.Errorf("r18 in alles: %q", alles[ids["r18"]])
	}
}

// reportExpect is one golden row of a demo report.
type reportExpect struct {
	viewer        int64
	scope         string
	account       int64
	month         string
	income, saved int64
	expenses      map[string]int64 // nil = not checked
}

func checkMonth(t *testing.T, s *ledger.Store, c reportExpect) ledger.ReportMonth {
	t.Helper()
	rep, err := s.ReportMonths(context.Background(), c.viewer, ledger.ReportQuery{Scope: c.scope, AccountID: c.account, From: c.month, To: c.month, Now: demoNow})
	if err != nil {
		t.Fatal(err)
	}
	got := rep.Months[0]
	if got.Income != c.income || got.Saved != c.saved || (c.expenses != nil && !maps.Equal(got.Expenses, c.expenses)) {
		t.Errorf("viewer %d %s/%d %s: income %d saved %d expenses %v; want %d %d %v",
			c.viewer, c.scope, c.account, c.month, got.Income, got.Saved, got.Expenses, c.income, c.saved, c.expenses)
	}
	return got
}

func TestReportMonthsDemo(t *testing.T) {
	ctx := context.Background()
	_, s := seeded(t)
	for _, c := range []reportExpect{
		{bert, "alles", 0, "2026-10", 335000, 20000, map[string]int64{"1": 115000, "2": 25236, "3": 2795, "4": 14060, "5": 6896, "6": 6562}},
		{bert, "persoonlijk", 0, "2026-10", 290000, 20000, map[string]int64{"1": 100500, "3": 2795, "4": 14060, "5": 2598, "toShared": 45000}},
		{bert, "gedeeld", 0, "2026-10", 90000, 0, map[string]int64{"1": 14500, "2": 25236, "5": 4298, "6": 6562}},
		{bert, "alles", 0, "2026-09", 330000, 20000, map[string]int64{"1": 115000, "2": 27106, "3": 6690, "4": 11560, "5": 6896, "6": 8881}},
		{bert, "alles", 0, "2026-07", 330000, 0, nil},
		{bert, "alles", 0, "2026-08", 330000, 40000, nil},
		{bert, "alles", 0, "2026-11", 331850, 20000, map[string]int64{"1": 115000, "2": 29521, "3": 6690, "4": 13410, "5": 6896, "none": 4125}},
		{bert, "persoonlijk", 0, "2026-11", 286850, 20000, map[string]int64{"1": 100500, "3": 6690, "4": 13410, "5": 2598, "none": 4125, "toShared": 45000}},
		{bert, "gedeeld", 0, "2026-11", 90000, 0, map[string]int64{"1": 14500, "2": 29521, "5": 4298}},
		// Partner as viewer: Bert's contribution comes from an account
		// Partner cannot see (income); Partner's own is internal in Alles.
		{partner, "persoonlijk", 0, "2026-10", 246000, 0, map[string]int64{"2": 5200, "4": 2200, "5": 2999, "toShared": 45000}},
		{partner, "gedeeld", 0, "2026-10", 90000, 0, map[string]int64{"1": 14500, "2": 25236, "5": 4298, "6": 6562}},
		{partner, "alles", 0, "2026-10", 291000, 0, map[string]int64{"1": 14500, "2": 30436, "4": 2200, "5": 7297, "6": 6562}},
	} {
		checkMonth(t, s, c)
	}
	july := checkMonth(t, s, reportExpect{bert, "alles", 0, "2026-07", 330000, 0, nil})
	if july.Expenses["6"] != 5721 {
		t.Errorf("July Overig: %d", july.Expenses["6"])
	}

	rep, err := s.ReportMonths(ctx, bert, ledger.ReportQuery{From: "2026-10", To: "2026-11", Now: demoNow})
	if err != nil {
		t.Fatal(err)
	}
	oct, nov := rep.Months[0], rep.Months[1]
	if len(oct.Accounts) != 2 || oct.Accounts[0].ID != 1 || oct.Accounts[1].ID != 4 ||
		oct.Accounts[0].Income != 290000 || oct.Accounts[1].Income != 90000 ||
		oct.Accounts[0].Income+oct.Accounts[1].Income-oct.Income != 45000 {
		t.Errorf("October per account: %+v", oct.Accounts)
	}
	sum := func(m map[string]int64) (n int64) {
		for _, v := range m {
			n += v
		}
		return n
	}
	if sum(nov.Accounts[0].Expenses) != 172323 || nov.Accounts[0].Expenses["toShared"] != 45000 || sum(nov.Accounts[1].Expenses) != 48319 {
		t.Errorf("November per account: %+v", nov.Accounts)
	}
	for _, scope := range []string{"alles", "persoonlijk", "gedeeld"} {
		rep, err := s.ReportMonths(ctx, bert, ledger.ReportQuery{Scope: scope, Now: demoNow})
		if err != nil {
			t.Fatal(err)
		}
		var months []string
		for _, m := range rep.Months {
			months = append(months, m.Month)
		}
		if *rep.FirstMonth != "2025-11" || *rep.FirstDate != "2025-11-01" || len(months) != 13 ||
			months[0] != "2025-11" || months[12] != "2026-11" {
			t.Errorf("%s: first %s %s, months %v", scope, *rep.FirstMonth, *rep.FirstDate, months)
		}
	}
	if _, err := s.ReportMonths(ctx, bert, ledger.ReportQuery{AccountID: 2, Now: demoNow}); err == nil || err.Error() != apperr.Invalid("Kies een betaalrekening.").Error() {
		t.Errorf("account=2: %v", err)
	}

	// The wire shape: per-account list only with more than one account.
	b, _ := json.Marshal(rep.Months[0])
	var shape map[string]any
	_ = json.Unmarshal(b, &shape)
	for _, k := range []string{"month", "income", "saved", "expenses", "accounts"} {
		if _, ok := shape[k]; !ok {
			t.Errorf("month JSON lacks %q: %s", k, b)
		}
	}
	one, _ := s.ReportMonths(ctx, bert, ledger.ReportQuery{AccountID: 1, From: "2026-10", To: "2026-10", Now: demoNow})
	if b, _ := json.Marshal(one.Months[0]); slices.Contains(slices.Collect(maps.Keys(unmarshal(b))), "accounts") {
		t.Errorf("one account carries a per-account list: %s", b)
	}
}

// A selection without accounts, and one without booked rows.
func TestReportMonthsEmpty(t *testing.T) {
	ctx := context.Background()
	d, s, _ := reportWorld(t)
	// Partner holds no shared current account other than A3; drop Partner's
	// access to A3 so Gedeeld is empty for Partner.
	if _, err := d.Exec(`DELETE FROM account_access WHERE account_id = ? AND user_id = ?`, rwGedeeld, partner); err != nil {
		t.Fatal(err)
	}
	rep, err := s.ReportMonths(ctx, partner, ledger.ReportQuery{Scope: "gedeeld", From: "2026-01", Now: reportNow})
	if err != nil || len(rep.Accounts) != 0 || len(rep.Months) != 0 || rep.FirstMonth != nil || rep.FirstDate != nil {
		t.Errorf("empty S: %+v, %v", rep, err)
	}
	if b, _ := json.Marshal(rep); string(b) != `{"accounts":[],"firstMonth":null,"firstDate":null,"months":[]}` {
		t.Errorf("empty S JSON: %s", b)
	}
	// A7 has no rows for Partner: no first month; without from no months,
	// with from every month, zeros included.
	rep, _ = s.ReportMonths(ctx, partner, ledger.ReportQuery{AccountID: rwOud, Now: reportNow})
	if rep.FirstMonth != nil || len(rep.Months) != 0 {
		t.Errorf("no rows: %+v", rep)
	}
	rep, _ = s.ReportMonths(ctx, partner, ledger.ReportQuery{AccountID: rwOud, From: "2026-10", Now: reportNow})
	if len(rep.Months) != 2 || rep.Months[1].Month != "2026-11" || rep.Months[0].Income != 0 || len(rep.Months[0].Expenses) != 0 {
		t.Errorf("no rows with from: %+v", rep)
	}
}

// TestReportMonthsRangeCap: every month in range is answered, so the range is bounded.
func TestReportMonthsRangeCap(t *testing.T) {
	_, s, _ := reportWorld(t)
	_, err := s.ReportMonths(context.Background(), bert, ledger.ReportQuery{From: "0001-01", Now: reportNow})
	if err == nil || !strings.Contains(err.Error(), "50 jaar") {
		t.Errorf("from 0001-01: want the 50 years error, got %v", err)
	}
	if rep, err := s.ReportMonths(context.Background(), bert, ledger.ReportQuery{From: "1976-12", Now: reportNow}); err != nil || len(rep.Months) != 600 {
		t.Errorf("exactly 600 months: %d, %v", len(rep.Months), err)
	}
}

func unmarshal(b []byte) map[string]any {
	m := map[string]any{}
	_ = json.Unmarshal(b, &m)
	return m
}

// demoRow finds one of Bert's demo rows on Zichtrekening by counterparty and date.
func demoRow(t *testing.T, d *sql.DB, name, date string) (id, amount int64) {
	t.Helper()
	if err := d.QueryRow(`SELECT id, amount FROM transactions WHERE account_id = 1 AND counterparty_name = ? AND booking_date = ?`, name, date).
		Scan(&id, &amount); err != nil {
		t.Fatalf("%s %s: %v", name, date, err)
	}
	return id, amount
}

// A split row counts by its parts; its own category does not count.
func TestReportMonthsSplit(t *testing.T) {
	d, s := seeded(t)
	var id, amount, cat int64
	if err := d.QueryRow(`SELECT t.id, t.amount, COALESCE(c.parent_id, c.id) FROM transactions t JOIN categories c ON c.id = t.category_id
		WHERE t.account_id = 1 AND t.status = 'booked' AND t.booking_date LIKE '2026-10-%' AND t.amount < -1000
		AND COALESCE(c.parent_id, c.id) IN (3, 4) ORDER BY t.id LIMIT 1`).Scan(&id, &amount, &cat); err != nil {
		t.Fatal(err)
	}
	before := checkMonth(t, s, reportExpect{bert, "alles", 0, "2026-10", 335000, 20000, nil})
	wonen := amount / 2
	if _, err := d.Exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, 1, ?), (?, 6, ?)`,
		id, wonen, id, amount-wonen); err != nil {
		t.Fatal(err)
	}
	want := maps.Clone(before.Expenses)
	want[fmt.Sprint(cat)] += amount
	want["1"] -= wonen
	want["6"] -= amount - wonen
	if want[fmt.Sprint(cat)] == 0 {
		delete(want, fmt.Sprint(cat))
	}
	checkMonth(t, s, reportExpect{bert, "alles", 0, "2026-10", 335000, 20000, want})
}

// The viewer's overrides: "is geen overschrijving" on Bert's contribution
// makes it an uncategorised expense in Alles; "is een overschrijving" on a
// groceries row without a partner leaves it out everywhere.
func TestReportMonthsOverride(t *testing.T) {
	d, s := seeded(t)
	contribution, _ := demoRow(t, d, "Naar gedeelde rekening", "2026-10-01")
	var groceries, amount int64
	if err := d.QueryRow(`SELECT id, amount FROM transactions WHERE account_id = 4 AND category_id IN (2, 11, 12)
		AND booking_date LIKE '2026-10-%' ORDER BY id LIMIT 1`).Scan(&groceries, &amount); err != nil {
		t.Fatal(err)
	}
	for _, o := range []struct {
		id int64
		is bool
	}{{contribution, false}, {groceries, true}} {
		if _, err := d.Exec(`INSERT INTO transfer_overrides (user_id, transaction_id, is_transfer) VALUES (?, ?, ?)`, bert, o.id, o.is); err != nil {
			t.Fatal(err)
		}
	}
	checkMonth(t, s, reportExpect{bert, "alles", 0, "2026-10", 335000, 20000,
		map[string]int64{"1": 115000, "2": 25236 + amount, "3": 2795, "4": 14060, "5": 6896, "6": 6562, "none": 45000}})
	checkMonth(t, s, reportExpect{bert, "persoonlijk", 0, "2026-10", 290000, 20000,
		map[string]int64{"1": 100500, "3": 2795, "4": 14060, "5": 2598, "none": 45000}})
	checkMonth(t, s, reportExpect{bert, "gedeeld", 0, "2026-10", 90000, 0,
		map[string]int64{"1": 14500, "2": 25236 + amount, "5": 4298, "6": 6562}})
}

// The report over the whole history of a viewer with 20 000 rows and some
// split rows, as TestTransferDetectionSpeed. The bound is loose; the timings
// are logged.
func TestReportMonthsSpeed(t *testing.T) {
	if testing.Short() {
		t.Skip("seeds 20 000 rows")
	}
	if raceEnabled {
		t.Skip("the timing bound only means something without the race detector (CI runs this test in its plain run)")
	}
	ctx := context.Background()
	d, s := seeded(t)
	accounts := []int64{1, 2, 3, 4}
	tx, err := d.Begin()
	if err != nil {
		t.Fatal(err)
	}
	ins, err := tx.Prepare(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key)
		VALUES (?, ?, ?, 'Perf', 'booked', ?)`)
	if err != nil {
		t.Fatal(err)
	}
	split, err := tx.Prepare(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, 1, ?), (?, 6, ?)`)
	if err != nil {
		t.Fatal(err)
	}
	r := rand.New(rand.NewPCG(1, 2))
	start := time.Date(2024, 11, 18, 0, 0, 0, 0, time.UTC)
	for i := range 20000 {
		date := start.AddDate(0, 0, r.IntN(730)).Format(time.DateOnly)
		amount := int64(r.IntN(20000)) - 10000
		res, err := ins.Exec(accounts[i%len(accounts)], amount, date, fmt.Sprintf("perf-%d", i))
		if err != nil {
			t.Fatal(err)
		}
		if i%50 == 0 {
			id, _ := res.LastInsertId()
			if _, err := split.Exec(id, amount/2, id, amount-amount/2); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	timed := func(name string, run func() error) {
		t.Helper()
		began := time.Now()
		if err := run(); err != nil {
			t.Fatal(err)
		}
		took := time.Since(began)
		t.Logf("%s: %v", name, took)
		if took > 4*time.Second { // loose on purpose: a slow or busy runner doubles these timings, the bound only catches seconds turning into minutes
			t.Errorf("%s took %v", name, took)
		}
	}
	report := func(q ledger.ReportQuery) func() error {
		return func() error { _, err := s.ReportMonths(ctx, bert, q); return err }
	}
	timed("alles, whole history", report(ledger.ReportQuery{Now: demoNow}))
	timed("account=1, whole history", report(ledger.ReportQuery{AccountID: 1, Now: demoNow}))
	timed("alles with detail, whole history", report(ledger.ReportQuery{Now: demoNow, Detail: true}))
	// The drill-down (0.7-2) runs parts twice per page, COUNT and items.
	for _, key := range []string{"1", "toShared", "2-zelf", "income-7", "saved-account-2"} {
		timed("drill-down "+key+", first page", func() error {
			_, err := s.Transactions(ctx, bert, ledger.TxQuery{Category: key, Limit: ledger.DefaultLimit})
			return err
		})
	}
}

// The drill-down fragment (0.7-2) lists exactly the rows behind a key.
func TestReportDrillDown(t *testing.T) {
	ctx := context.Background()
	_, s, ids := reportWorld(t)
	for _, c := range []struct {
		scope    string
		account  int64
		key      string
		from, to string
		want     []string
	}{
		{"alles", 0, "toShared", "2000-01-01", "2026-12-31", []string{"r1", "r26"}}, // r25 is internal, r26 four days before A3's history
		{"persoonlijk", 0, "toShared", "2026-01-01", "2026-01-31", []string{"r2", "r14"}},
		{"alles", 0, "none", "2000-01-01", "2026-12-31", []string{"r17", "r18"}},
		{"", rwZicht, "toOwn", "2000-01-01", "2026-12-31", []string{"r9", "r22", "r24"}},
		{"alles", 0, "toOwn", "2026-03-01", "2026-03-31", []string{"r24"}},
		{"alles", 0, "3", "2026-01-01", "2026-01-31", []string{"r15"}},
		{"persoonlijk", 0, "1", "2000-01-01", "2026-12-31", []string{}},
		// A saving top lists the rows saved in it; saved lists every row behind Gespaard (0.8-0a).
		// s5 is saved by rule 2 (the account, 0.8.1-1), so not under its category.
		{"alles", 0, fmt.Sprint(rwSparen), "2026-04-01", "2026-04-30", []string{"s1", "s2", "s3", "s6", "s7", "s9"}},
		{"persoonlijk", 0, fmt.Sprint(rwSparen), "2026-04-01", "2026-04-30", []string{"s1", "s2", "s3", "s4", "s6", "s7"}},
		// The detail keys (0.8.1-1).
		{"alles", 0, fmt.Sprint(rwSparen) + "-zelf", "2026-04-01", "2026-04-30", []string{"s1", "s3", "s6", "s7", "s9"}},
		{"alles", 0, fmt.Sprint(rwPensioen), "2026-04-01", "2026-04-30", []string{"s2"}},
		{"alles", 0, "saved-account-4", "2026-04-01", "2026-04-30", []string{"s5"}},
		{"alles", 0, "saved-account-4", "2026-01-01", "2026-01-31", []string{"r5", "r8"}},
		{"alles", 0, "saved-account-5", "2026-01-01", "2026-01-31", []string{"r13"}},
		{"alles", 0, "3", "2026-06-01", "2026-06-30", []string{"u1", "u2"}},
		{"alles", 0, "3-zelf", "2026-06-01", "2026-06-30", []string{"u2"}},
		{"alles", 0, fmt.Sprint(rwRestaurant), "2026-06-01", "2026-06-30", []string{"u1"}},
		{"alles", 0, "income-7", "2026-01-01", "2026-06-30", []string{"r20", "r21", "u3"}},
		{"alles", 0, "income-7-zelf", "2026-01-01", "2026-06-30", []string{"r20", "r21"}},
		{"alles", 0, fmt.Sprint("income-", rwBonus), "2026-01-01", "2026-06-30", []string{"u3"}},
		{"gedeeld", 0, "income-transfer", "2026-01-01", "2026-01-31", []string{"r3", "r4"}},
		{"alles", 0, "income-none", "2025-11-01", "2025-11-30", []string{"r0"}},
		{"alles", 0, "income-transfer", "2026-01-01", "2026-01-31", []string{}},
		{"alles", 0, "6", "2026-04-01", "2026-04-30", []string{"s7"}},
		{"alles", 0, "saved", "2026-04-01", "2026-04-30", []string{"s1", "s2", "s3", "s5", "s6", "s7", "s9"}},
		{"alles", 0, "saved", "2026-01-01", "2026-01-31", []string{"r5", "r8", "r13"}},
		{"", rwZicht, "saved", "2026-04-01", "2026-04-30", []string{"s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"}},
	} {
		got, err := s.DrillDown(ctx, bert, c.scope, c.account, c.from, c.to, c.key)
		if err != nil {
			t.Fatal(err)
		}
		want := []int64{}
		for _, n := range c.want {
			want = append(want, ids[n])
		}
		if !slices.Equal(got, want) {
			t.Errorf("%s/%d %s: %v, want %v", c.scope, c.account, c.key, got, want)
		}
	}
}

func sumOf(m map[string]int64) (n int64) {
	for _, v := range m {
		n += v
	}
	return n
}

// checkDetail checks the identities of plan 0.8.1-1 on one month or account:
// Σ income, Σ saved and Σ expenses[k] of the detail equal the totals, and only
// top category keys carry an expense detail.
func checkDetail(t *testing.T, label string, r ledger.ReportTotals) {
	t.Helper()
	if r.Detail == nil {
		t.Errorf("%s: no detail", label)
		return
	}
	if sumOf(r.Detail.Income) != r.Income || sumOf(r.Detail.Saved) != r.Saved {
		t.Errorf("%s: detail income %v saved %v; totals %d %d", label, r.Detail.Income, r.Detail.Saved, r.Income, r.Saved)
	}
	for k, v := range r.Expenses {
		if _, err := strconv.ParseInt(k, 10, 64); err == nil && sumOf(r.Detail.Expenses[k]) != v {
			t.Errorf("%s: detail expenses[%s] %v, total %d", label, k, r.Detail.Expenses[k], v)
		}
	}
	for k, m := range r.Detail.Expenses {
		if _, err := strconv.ParseInt(k, 10, 64); err != nil || sumOf(m) != r.Expenses[k] {
			t.Errorf("%s: detail expenses[%s] %v, total %d", label, k, m, r.Expenses[k])
		}
	}
}

// TestReportDetailIdentities (0.8.1-1): on reportWorld and the demo, for every
// selection of Bert and Partner, every month and every account of it, the
// detail adds up to the totals, and detail=0 is the answer without detail.
func TestReportDetailIdentities(t *testing.T) {
	ctx := context.Background()
	_, world, _ := reportWorld(t)
	_, demo := seeded(t)
	for _, w := range []struct {
		name string
		s    *ledger.Store
		now  time.Time
	}{{"reportWorld", world, reportNow}, {"demo", demo, demoNow}} {
		for _, viewer := range []int64{bert, partner} {
			queries := []ledger.ReportQuery{{Scope: "alles"}, {Scope: "persoonlijk"}, {Scope: "gedeeld"}}
			accounts, err := w.s.Accounts(ctx, viewer, w.now)
			if err != nil {
				t.Fatal(err)
			}
			for _, a := range accounts {
				if a.Type == "current" {
					queries = append(queries, ledger.ReportQuery{AccountID: a.ID})
				}
			}
			for _, q := range queries {
				q.Now = w.now
				plain, err := w.s.ReportMonths(ctx, viewer, q)
				if err != nil {
					t.Fatal(err)
				}
				q.Detail = true
				rep, err := w.s.ReportMonths(ctx, viewer, q)
				if err != nil {
					t.Fatal(err)
				}
				for i, m := range rep.Months {
					label := fmt.Sprintf("%s viewer %d %s/%d %s", w.name, viewer, q.Scope, q.AccountID, m.Month)
					checkDetail(t, label, m.ReportTotals)
					for _, a := range m.Accounts {
						checkDetail(t, fmt.Sprintf("%s account %d", label, a.ID), a.ReportTotals)
					}
					// Without the detail the answer is the same.
					m.Detail = nil
					for j := range m.Accounts {
						m.Accounts[j].Detail = nil
					}
					a, _ := json.Marshal(m)
					b, _ := json.Marshal(plain.Months[i])
					if string(a) != string(b) {
						t.Errorf("%s: with detail %s, without %s", label, a, b)
					}
				}
				if b, _ := json.Marshal(plain); strings.Contains(string(b), "detail") {
					t.Errorf("%s viewer %d %+v: detail without detail=1", w.name, viewer, q)
				}
			}
		}
	}
}

// The detail goldens of plan 0.8.1-1 on reportWorld and the demo.
func TestReportDetail(t *testing.T) {
	ctx := context.Background()
	d, s, _ := reportWorld(t)
	// The rolled-up saving top lists 21000 in 2026-04 alles: 18000 own + 3000 Pensioensparen (s5 is rule 2).
	var rolled int64
	for _, r := range allTransactions(t, s, bert, ledger.TxQuery{Scope: "alles", Category: fmt.Sprint(rwSparen), From: "2026-04-01", To: "2026-04-30", Limit: ledger.MaxLimit}) {
		rolled += detailBehind(r, fmt.Sprint(rwSparen), topCategories(t, d), savingTops(t, d))
	}
	if rolled != 21000 {
		t.Errorf("category=%d in 2026-04 alles: %d, want 21000", rwSparen, rolled)
	}
	detail := func(s *ledger.Store, viewer int64, scope, month string, now time.Time) *ledger.ReportDetail {
		t.Helper()
		rep, err := s.ReportMonths(ctx, viewer, ledger.ReportQuery{Scope: scope, From: month, To: month, Now: now, Detail: true})
		if err != nil {
			t.Fatal(err)
		}
		return rep.Months[0].Detail
	}
	sparen, pensioen := fmt.Sprint(rwSparen), fmt.Sprint(rwPensioen)
	for _, c := range []struct {
		scope string
		saved map[string]int64
	}{
		{"alles", map[string]int64{sparen: 18000, pensioen: 3000, "account-4": 4000}},
		{"persoonlijk", map[string]int64{sparen: 23500, pensioen: 3000, "account-4": 4000}},
		{"gedeeld", map[string]int64{sparen: 1500}},
	} {
		if got := detail(s, bert, c.scope, "2026-04", reportNow).Saved; !maps.Equal(got, c.saved) {
			t.Errorf("%s 2026-04 saved detail %v, want %v", c.scope, got, c.saved)
		}
	}
	june := detail(s, bert, "alles", "2026-06", reportNow)
	if want := map[string]int64{"3": 1000, fmt.Sprint(rwRestaurant): 2000}; len(june.Expenses) != 1 || !maps.Equal(june.Expenses["3"], want) {
		t.Errorf("2026-06 expenses detail %v, want 3: %v", june.Expenses, want)
	}
	if want := map[string]int64{fmt.Sprint(rwBonus): 5000}; !maps.Equal(june.Income, want) {
		t.Errorf("2026-06 income detail %v, want %v", june.Income, want)
	}
	// January: salary on the top (its own part), the savings transfers by account.
	jan := detail(s, bert, "alles", "2026-01", reportNow)
	if !maps.Equal(jan.Income, map[string]int64{"7": 249000}) || !maps.Equal(jan.Saved, map[string]int64{"account-4": 10000, "account-5": 10000}) {
		t.Errorf("2026-01 income %v saved %v", jan.Income, jan.Saved)
	}

	// The demo, November 2026, Bert, Alles.
	_, demo := seeded(t)
	nov := detail(demo, bert, "alles", "2026-11", demoNow)
	if sumOf(nov.Income) != 331850 || !maps.Equal(nov.Saved, map[string]int64{"account-2": 20000}) {
		t.Errorf("demo November income %v (Σ %d) saved %v", nov.Income, sumOf(nov.Income), nov.Saved)
	}
	if _, ok := nov.Expenses["none"]; ok {
		t.Errorf("demo November: none carries a detail: %v", nov.Expenses)
	}
	t.Logf("demo November detail: income %v, expenses %v", nov.Income, nov.Expenses)
}
