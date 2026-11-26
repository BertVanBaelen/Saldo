package ledger_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// rowIDs are the ids of listed rows, in order.
func rowIDs(rows []ledger.Transaction) []int64 {
	out := make([]int64, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.ID)
	}
	return out
}

// invalidCategory checks that q is refused with message (400 on the wire).
func invalidCategory(t *testing.T, s *ledger.Store, q ledger.TxQuery, message string) {
	t.Helper()
	var invalid *apperr.InvalidError
	_, err := s.Transactions(context.Background(), bert, q)
	if !errors.As(err, &invalid) || invalid.Message != message {
		t.Errorf("%+v: %v, want %q", q, err, message)
	}
}

// The category filter of GET /api/transactions (plan 0.7-2) on the demo story.
func TestTransactionsCategoryFilter(t *testing.T) {
	ctx := context.Background()
	d, s := seeded(t)
	list := func(q ledger.TxQuery) []ledger.Transaction {
		t.Helper()
		q.Limit = ledger.MaxLimit
		return allTransactions(t, s, bert, q)
	}
	october := func(scope string, account int64, key string) ledger.TxQuery {
		return ledger.TxQuery{Scope: scope, AccountID: account, Category: key, From: "2026-10-01", To: "2026-10-31"}
	}
	top := topCategories(t, d)

	// Groceries of October: the shared account only, adding up to the report's row.
	groceries := list(october("", 0, "2"))
	var spent int64
	for _, r := range groceries {
		if r.AccountID != 4 {
			t.Errorf("groceries row %d on account %d", r.ID, r.AccountID)
		}
		spent += behind(r, "2", top, nil)
	}
	if len(groceries) == 0 || spent != 25236 {
		t.Errorf("groceries of October: %d rows, € %d cents; want the report's 25236", len(groceries), spent)
	}

	// A split row appears under each part's category, with its full amount, and no longer under its own.
	splitID, splitAmount, splitTop := splitDemoRow(t, d)
	for _, c := range []struct {
		key  string
		want bool
	}{{"1", true}, {"6", true}, {fmt.Sprint(splitTop), false}} {
		found := slices.Contains(rowIDs(list(october("", 0, c.key))), splitID)
		if found != c.want {
			t.Errorf("split row under category %s: %v, want %v", c.key, found, c.want)
		}
	}
	for _, r := range list(october("", 0, "1")) {
		if r.ID == splitID && (r.Amount != splitAmount || len(r.Splits) != 2) {
			t.Errorf("split row listed with amount %d and %d parts, want %d and 2", r.Amount, len(r.Splits), splitAmount)
		}
	}

	// A transfer that carries a category is a transfer: Naar gedeelde rekening, not Boodschappen.
	contribution, _ := demoRow(t, d, "Naar gedeelde rekening", "2026-10-01")
	if _, err := d.Exec(`UPDATE transactions SET category_id = 2 WHERE id = ?`, contribution); err != nil {
		t.Fatal(err)
	}
	if slices.Contains(rowIDs(list(october("", 0, "2"))), contribution) {
		t.Error("a transfer with a category is listed under it")
	}
	for _, c := range []struct {
		scope   string
		account int64
		want    []int64
	}{
		{"persoonlijk", 0, []int64{contribution}}, // Bert's € 450 of 1 October
		{"alles", 0, []int64{}},                   // both histories start on 2025-11-01: an internal transfer
		{"", 1, []int64{contribution}},
		{"", 4, []int64{}},
	} {
		if got := rowIDs(list(october(c.scope, c.account, "toShared"))); !slices.Equal(got, c.want) {
			t.Errorf("toShared %s/%d: %v, want %v", c.scope, c.account, got, c.want)
		}
	}

	// With an account the scope does not filter (as in the report): the shared account under Persoonlijk, Zichtrekening under Gedeeld.
	for _, c := range []struct {
		scope   string
		account int64
		key     string
		want    []int64
	}{
		{"gedeeld", 1, "toShared", []int64{contribution}},
		{"persoonlijk", 4, "2", rowIDs(groceries)},
		{"alles", 4, "2", rowIDs(groceries)},
	} {
		if got := rowIDs(list(october(c.scope, c.account, c.key))); !slices.Equal(got, c.want) {
			t.Errorf("%s/%d %s: %v, want %v", c.scope, c.account, c.key, got, c.want)
		}
	}
	// Without a category the scope still filters an account (a personal account is no Gedeeld row).
	if rows := list(ledger.TxQuery{Scope: "gedeeld", AccountID: 1}); len(rows) != 0 {
		t.Errorf("account 1 under Gedeeld without a category: %d rows", len(rows))
	}
	invalidCategory(t, s, ledger.TxQuery{Category: "1", AccountID: 1, Scope: "iedereen"}, "Kies alles, persoonlijk of gedeeld.")

	// Pending rows are not in the report, so they never appear, categorised or not.
	res, err := d.Exec(`UPDATE transactions SET category_id = 3 WHERE status = 'pending'`)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		t.Fatal("the demo has no pending row")
	}
	november := ledger.TxQuery{From: "2026-11-01", To: "2026-11-30"}
	pending := 0
	for _, r := range list(november) {
		if r.Status == "pending" && r.Category != nil && r.Category.ID == 3 {
			pending++
		}
	}
	if pending == 0 {
		t.Error("the categorised pending row is not in the plain list")
	}
	november.Category = "3"
	for _, r := range list(november) {
		if r.Status != "booked" {
			t.Errorf("pending row %d under category 3", r.ID)
		}
	}

	// Anything else than an id, none, toShared or toOwn is refused; an unknown id is an empty list.
	for _, bad := range []string{"abc", "-1", "+2", "0", "1,5", " 2", "toshared", "none ",
		"income-", "income-x", "income-0", "-zelf", "1-zelf-zelf", "saved-account-", "saved-account-2-zelf", "account-2", "income-saved", "saved-7"} {
		invalidCategory(t, s, ledger.TxQuery{Category: bad}, "Kies een categorie.")
	}
	// A savings account has no report row behind it: an empty list (200), whatever the category, unlike the report's 400.
	for _, account := range []int64{2, 3} { // Spaarrekening, Reserve
		for _, key := range []string{"1", "none", "toShared", "toOwn"} {
			if page, err := s.Transactions(ctx, bert, ledger.TxQuery{Category: key, AccountID: account}); err != nil || len(page.Items) != 0 || page.Total != 0 || page.Next != nil {
				t.Errorf("category %s on account %d: %+v, %v; want an empty page", key, account, page, err)
			}
		}
	}
	invalidCategory(t, s, ledger.TxQuery{Category: "abc", AccountID: 2}, "Kies een categorie.")
	invalidCategory(t, s, ledger.TxQuery{Category: "1", Scope: "iedereen"}, "Kies alles, persoonlijk of gedeeld.")
	if _, err := s.Transactions(ctx, bert, ledger.TxQuery{Category: "1", AccountID: 5}); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("Partner's account 5: %v, want not found", err)
	}
	if page, err := s.Transactions(ctx, bert, ledger.TxQuery{Category: "99999"}); err != nil || len(page.Items) != 0 || page.Total != 0 {
		t.Errorf("unknown id: %+v, %v", page, err)
	}
	// A leading zero is the same id.
	if a, b := list(october("", 0, "2")), list(october("", 0, "002")); !slices.Equal(rowIDs(a), rowIDs(b)) {
		t.Errorf("002: %v, want %v", rowIDs(b), rowIDs(a))
	}
	for _, c := range [][2]string{{"income-7", "income-007"}, {"2-zelf", "02-zelf"}, {"income-7-zelf", "income-07-zelf"}, {"saved-account-2", "saved-account-02"}} {
		if a, b := list(october("", 0, c[0])), list(october("", 0, c[1])); len(a) == 0 || !slices.Equal(rowIDs(a), rowIDs(b)) {
			t.Errorf("%s: %v, want %v (not empty)", c[1], rowIDs(b), rowIDs(a))
		}
	}

	// The cursor, the order and Total hold with the filter: Bert's thirteen contributions in pages of 4.
	whole := list(ledger.TxQuery{Scope: "persoonlijk", Category: "toShared"})
	var paged []int64
	q := ledger.TxQuery{Scope: "persoonlijk", Category: "toShared", Limit: 4}
	for range 10 {
		page, err := s.Transactions(ctx, bert, q)
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != len(whole) {
			t.Errorf("Total %d on a page, want %d", page.Total, len(whole))
		}
		paged = append(paged, rowIDs(page.Items)...)
		if page.Next == nil {
			break
		}
		q.Before = *page.Next
	}
	if len(whole) < 12 || !slices.Equal(paged, rowIDs(whole)) {
		t.Errorf("%d rows in pages of 4: %v, want %v", len(whole), paged, rowIDs(whole))
	}
}

// The same on reportWorld (plan 0.7-1), through the oracle table.
func TestTransactionsCategoryFilterWorld(t *testing.T) {
	_, s, ids := reportWorld(t)
	name := map[int64]string{}
	for n, id := range ids {
		name[id] = n
	}
	list := func(scope string, account int64, key string) []string {
		t.Helper()
		out := []string{}
		for _, r := range allTransactions(t, s, bert, ledger.TxQuery{Scope: scope, AccountID: account, Category: key, Limit: ledger.MaxLimit}) {
			out = append(out, name[r.ID])
		}
		slices.Sort(out)
		return out
	}
	for _, c := range []struct {
		scope   string
		account int64
		key     string
		want    []string
	}{
		// The pre-history contribution of 2020 (r2 pairs, so it is out) and r26, four days before A3's history (r25, three days, is out).
		{"alles", 0, "toShared", []string{"r1", "r26"}},
		{"alles", 0, "none", []string{"r17", "r18"}},
		{"", rwZicht, "toOwn", []string{"r22", "r24", "r9"}}, // saved (r5, r13) is not toOwn
		// t1: A9 is shared by its flag (0.8-0b).
		{"persoonlijk", 0, "toShared", []string{"r1", "r14", "r2", "r25", "r26", "t1"}},
		{"gedeeld", rwZicht, "none", []string{"r17", "r18"}}, // the account wins over the scope, as in the report
		{"gedeeld", 0, "toOwn", []string{"r11"}},
		{"alles", 0, "3", []string{"r15", "u1", "u2"}}, // u1 on its sub Restaurant (0.8.1-1)
		// r14 is a split row and a transfer: its parts (Wonen, Overig) are toShared, in no category, and out in Alles.
		{"persoonlijk", 0, "1", []string{}},
		{"persoonlijk", 0, "6", []string{"s7"}}, // s7's Overig part (0.8-0a)
		{"alles", 0, "1", []string{}},
		{"gedeeld", 0, "saved", []string{"s9"}},
	} {
		if got := list(c.scope, c.account, c.key); !slices.Equal(got, c.want) {
			t.Errorf("%s/%d %s: %v, want %v", c.scope, c.account, c.key, got, c.want)
		}
	}
	// The savings account (r6, r7) and the investment account answer an empty list, not an error.
	if rows := list("", rwSpaar, ""); len(rows) != 3 {
		t.Errorf("the savings account without a category: %v, want r6, r7 and s5b", rows)
	}
	for _, account := range []int64{rwSpaar, rwBeleggen} {
		for _, key := range []string{"1", "none", "toShared", "toOwn", "saved"} {
			if got := list("", account, key); len(got) != 0 {
				t.Errorf("account %d, category %s: %v, want none", account, key, got)
			}
		}
	}
	// r5 and r13 are saved, r6 and r7 belong to the savings account, r27 is pending and r28 is 0: never under a key.
	keys := []string{"none", "toShared", "toOwn"}
	for id := 1; id <= 30; id++ {
		keys = append(keys, fmt.Sprint(id))
	}
	for _, sel := range []struct {
		scope   string
		account int64
	}{{"alles", 0}, {"persoonlijk", 0}, {"gedeeld", 0}, {"", rwZicht}, {"", rwTweede}, {"", rwGedeeld}, {"", rwNieuw}} {
		for _, key := range keys {
			for _, n := range list(sel.scope, sel.account, key) {
				if slices.Contains([]string{"r5", "r6", "r7", "r13", "r8", "r27", "r28"}, n) {
					t.Errorf("%s/%d %s lists %s", sel.scope, sel.account, key, n)
				}
			}
		}
	}
}

// splitDemoRow splits a bigger October row of Zichtrekening (Vrije tijd or
// Vervoer) in two halves, Wonen and Overig, and returns its id, amount and
// former top category.
func splitDemoRow(t *testing.T, d *sql.DB) (id, amount, top int64) {
	t.Helper()
	if err := d.QueryRow(`SELECT t.id, t.amount, COALESCE(c.parent_id, c.id) FROM transactions t JOIN categories c ON c.id = t.category_id
		WHERE t.account_id = 1 AND t.status = 'booked' AND t.booking_date LIKE '2026-10-%' AND t.amount < -1000
		AND COALESCE(c.parent_id, c.id) IN (3, 4) ORDER BY t.id LIMIT 1`).Scan(&id, &amount, &top); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, 1, ?), (?, 6, ?)`,
		id, amount/2, id, amount-amount/2); err != nil {
		t.Fatal(err)
	}
	return id, amount, top
}

// topCategories maps every category id to its top category.
func topCategories(t *testing.T, d *sql.DB) map[int64]int64 {
	t.Helper()
	rows, err := d.Query(`SELECT id, COALESCE(parent_id, id) FROM categories`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	top := map[int64]int64{}
	for rows.Next() {
		var id, parent int64
		if err := rows.Scan(&id, &parent); err != nil {
			t.Fatal(err)
		}
		top[id] = parent
	}
	return top
}

// savingTops are the top categories that count as saved (0.8-0a).
func savingTops(t *testing.T, d *sql.DB) map[int64]bool {
	t.Helper()
	rows, err := d.Query(`SELECT id FROM categories WHERE saving = 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		out[id] = true
	}
	return out
}

// behind is what a listed row adds to the report's expense row key, as spending
// (positive). A split row is listed with its full amount, so only its parts
// that carry the key count: for a transfer key (toShared, toOwn: the row is
// one transfer) every part not in a saving category (those are saved,
// 0.8-0a), else the parts whose top category it is.
func behind(r ledger.Transaction, key string, top map[int64]int64, saving map[int64]bool) int64 {
	if r.Splits == nil {
		return -r.Amount
	}
	var sum int64
	for _, p := range r.Splits {
		if (key == "toShared" || key == "toOwn") && !saving[top[p.Category.ID]] || fmt.Sprint(top[p.Category.ID]) == key {
			sum -= p.Amount
		}
	}
	return sum
}

// checkDrillDown: for every selection of every viewer, every month with data and
// every expense key of the report, the rows that GET /api/transactions lists
// for that category and month add up to the report's row, and are the rows of
// the drill-down fragment itself. Every other key (every top category, none,
// toShared, toOwn) adds up to 0 in a month where the report has no such row.
// An account is run alone and under its matching scope: the account wins.
func checkDrillDown(t *testing.T, d *sql.DB, s *ledger.Store, now time.Time, viewers ...int64) {
	t.Helper()
	ctx := context.Background()
	top, saving := topCategories(t, d), savingTops(t, d)
	keys := []string{"none", "toShared", "toOwn"} // the expense keys; a saving top is never one
	var savingKeys []string
	for id, parent := range top {
		switch {
		case id == parent && saving[id]:
			savingKeys = append(savingKeys, fmt.Sprint(id))
		case id == parent:
			keys = append(keys, fmt.Sprint(id))
		}
	}
	checked := 0
	for _, viewer := range viewers {
		type selection struct {
			scope   string
			account int64
		}
		selections := []selection{{"alles", 0}, {"persoonlijk", 0}, {"gedeeld", 0}}
		accounts, err := s.Accounts(ctx, viewer, now)
		if err != nil {
			t.Fatal(err)
		}
		for _, a := range accounts {
			if a.Type == "current" {
				matching := map[string]string{"personal": "persoonlijk", "shared": "gedeeld"}[a.Kind]
				selections = append(selections, selection{"", a.ID}, selection{matching, a.ID})
			}
		}
		for _, sel := range selections {
			rep, err := s.ReportMonths(ctx, viewer, ledger.ReportQuery{Scope: sel.scope, AccountID: sel.account, Now: now})
			if err != nil {
				t.Fatal(err)
			}
			reportKeys := map[string]bool{}
			for _, m := range rep.Months {
				start, err := time.Parse("2006-01", m.Month)
				if err != nil {
					t.Fatal(err)
				}
				from, to := m.Month+"-01", start.AddDate(0, 1, -1).Format(time.DateOnly)
				for key, want := range m.Expenses {
					reportKeys[key] = true
					label := fmt.Sprintf("viewer %d %s/%d %s key %s", viewer, sel.scope, sel.account, m.Month, key)
					rows := allTransactions(t, s, viewer, ledger.TxQuery{Scope: sel.scope, AccountID: sel.account, Category: key, From: from, To: to, Limit: ledger.MaxLimit})
					var got int64
					for _, r := range rows {
						got += behind(r, key, top, saving)
					}
					if got != want {
						t.Errorf("%s: the rows add up to %d, the report says %d", label, got, want)
					}
					fragment, err := s.DrillDown(ctx, viewer, sel.scope, sel.account, from, to, key)
					if err != nil {
						t.Fatal(err)
					}
					if listed := rowIDs(rows); !slices.Equal(slices.Sorted(slices.Values(listed)), fragment) {
						t.Errorf("%s: rows %v, the fragment lists %v", label, listed, fragment)
					}
					checked++
				}
			}
			// Every key over the whole history, by month: a month without the key in the report adds up to 0.
			// (A key that nets to 0 is pruned from the report: its rows are then of both signs.)
			for key := range reportKeys {
				if !slices.Contains(keys, key) {
					t.Errorf("viewer %d %s/%d: the report has the key %s, no top category, none, toShared or toOwn", viewer, sel.scope, sel.account, key)
				}
			}
			for _, key := range keys {
				sums, signs := map[string]int64{}, map[string][2]bool{}
				for _, r := range allTransactions(t, s, viewer, ledger.TxQuery{Scope: sel.scope, AccountID: sel.account, Category: key, Limit: ledger.MaxLimit}) {
					month, amount := r.BookingDate[:7], behind(r, key, top, saving)
					sums[month] += amount
					sg := signs[month]
					sg[0], sg[1] = sg[0] || amount > 0, sg[1] || amount < 0
					signs[month] = sg
				}
				inReport := map[string]bool{}
				for _, m := range rep.Months {
					inReport[m.Month] = true
					_, has := m.Expenses[key]
					label := fmt.Sprintf("viewer %d %s/%d %s key %s (whole history)", viewer, sel.scope, sel.account, m.Month, key)
					if sums[m.Month] != m.Expenses[key] {
						t.Errorf("%s: the rows add up to %d, the report says %d", label, sums[m.Month], m.Expenses[key])
					}
					if sg, listed := signs[m.Month]; !has && listed && !(sg[0] && sg[1]) {
						t.Errorf("%s: rows are listed, the report has no such row", label)
					}
				}
				for month := range sums {
					if !inReport[month] {
						t.Errorf("viewer %d %s/%d key %s: rows in %s, a month the report does not have", viewer, sel.scope, sel.account, key, month)
					}
				}
				checked++
			}
			// The Gespaard drill-down (0.8-0a), every month: category=saved lists exactly the rows with a
			// saved part, and their saved parts add up to the report's saved.
			for _, m := range rep.Months {
				start, _ := time.Parse("2006-01", m.Month)
				from, to := m.Month+"-01", start.AddDate(0, 1, -1).Format(time.DateOnly)
				label := fmt.Sprintf("viewer %d %s/%d %s saved", viewer, sel.scope, sel.account, m.Month)
				parts, err := s.SavedParts(ctx, viewer, sel.scope, sel.account, from, to)
				if err != nil {
					t.Fatal(err)
				}
				var sum int64
				for _, v := range parts {
					sum += v
				}
				listed := rowIDs(allTransactions(t, s, viewer, ledger.TxQuery{Scope: sel.scope, AccountID: sel.account, Category: "saved", From: from, To: to, Limit: ledger.MaxLimit}))
				fragment, err := s.DrillDown(ctx, viewer, sel.scope, sel.account, from, to, "saved")
				if err != nil {
					t.Fatal(err)
				}
				if want := slices.Sorted(maps.Keys(parts)); sum != m.Saved || !slices.Equal(slices.Sorted(slices.Values(listed)), want) || !slices.Equal(fragment, want) {
					t.Errorf("%s: saved parts %d (report %d), rows %v, fragment %v, want %v", label, sum, m.Saved, listed, fragment, want)
				}
				checked++
			}
			checkDetailDrillDown(t, s, viewer, sel.scope, sel.account, now, top, saving)
			// A saving top category lists only rows that are saved (its expense half is always empty).
			saved := rowIDs(allTransactions(t, s, viewer, ledger.TxQuery{Scope: sel.scope, AccountID: sel.account, Category: "saved", Limit: ledger.MaxLimit}))
			for _, key := range savingKeys {
				for _, id := range rowIDs(allTransactions(t, s, viewer, ledger.TxQuery{Scope: sel.scope, AccountID: sel.account, Category: key, Limit: ledger.MaxLimit})) {
					if !slices.Contains(saved, id) {
						t.Errorf("viewer %d %s/%d key %s lists row %d, which is not saved", viewer, sel.scope, sel.account, key, id)
					}
				}
			}
		}
	}
	if checked == 0 {
		t.Error("no expense row was checked")
	}
	t.Logf("%d lists checked against the report", checked)
}

// detailBehind is what a listed row adds to the detail entry behind a detail
// drill-down key (0.8.1-1): income positive, saved and expenses as spending.
// A key on a category counts the parts on that category (rolled up: on it or
// its subs; -zelf: on it only); transfer counts the parts not saved by rule 3,
// none and saved-account-<id> the whole row (no category; rule 2 takes every part).
func detailBehind(r ledger.Transaction, key string, top map[int64]int64, saving map[int64]bool) int64 {
	sign, k := int64(-1), key
	if v, ok := strings.CutPrefix(key, "income-"); ok {
		sign, k = 1, v
	}
	parts := r.Splits
	if parts == nil {
		p := ledger.Split{Amount: r.Amount}
		if r.Category != nil {
			p.Category = *r.Category
		}
		parts = []ledger.Split{p}
	}
	own, zelf := strings.CutSuffix(k, "-zelf")
	id, _ := strconv.ParseInt(own, 10, 64)
	var sum int64
	for _, p := range parts {
		c := p.Category.ID
		switch {
		case strings.HasPrefix(k, "saved-account-") || k == "none",
			k == "transfer" && !saving[top[c]],
			c != 0 && (c == id || !zelf && top[c] == id):
			sum += sign * p.Amount
		}
	}
	return sum
}

// checkDetailDrillDown (0.8.1-1): every entry of the report's detail, and every
// rolled-up income or saving top, has a drill-down key whose rows add up to it
// in every month of the whole history (0 where the report has no such entry),
// and the rows are those of the fragment itself.
func checkDetailDrillDown(t *testing.T, s *ledger.Store, viewer int64, scope string, account int64, now time.Time, top map[int64]int64, saving map[int64]bool) {
	t.Helper()
	ctx := context.Background()
	rep, err := s.ReportMonths(ctx, viewer, ledger.ReportQuery{Scope: scope, AccountID: account, Now: now, Detail: true})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]map[string]int64{} // drill-down key -> month -> amount
	add := func(key, month string, v int64) {
		if want[key] == nil {
			want[key] = map[string]int64{}
		}
		want[key][month] += v
	}
	id := func(k string) int64 { n, _ := strconv.ParseInt(k, 10, 64); return n }
	for _, m := range rep.Months {
		for k, v := range m.Detail.Income {
			switch {
			case k == "transfer" || k == "none":
				add("income-"+k, m.Month, v)
			case top[id(k)] == id(k):
				add("income-"+k+"-zelf", m.Month, v)
				add("income-"+k, m.Month, v)
			default:
				add("income-"+k, m.Month, v)
				add(fmt.Sprint("income-", top[id(k)]), m.Month, v)
			}
		}
		for k, v := range m.Detail.Saved {
			switch {
			case strings.HasPrefix(k, "account-"):
				add("saved-"+k, m.Month, v)
			case top[id(k)] == id(k):
				add(k+"-zelf", m.Month, v)
				add(k, m.Month, v)
			default:
				add(k, m.Month, v)
				add(fmt.Sprint(top[id(k)]), m.Month, v)
			}
		}
		for tk, inner := range m.Detail.Expenses {
			for c, v := range inner {
				if c == tk {
					add(c+"-zelf", m.Month, v)
				} else {
					add(c, m.Month, v)
				}
			}
		}
	}
	for key, months := range want {
		label := fmt.Sprintf("viewer %d %s/%d detail key %s", viewer, scope, account, key)
		rows := allTransactions(t, s, viewer, ledger.TxQuery{Scope: scope, AccountID: account, Category: key, Limit: ledger.MaxLimit})
		got := map[string]int64{}
		for _, r := range rows {
			got[r.BookingDate[:7]] += detailBehind(r, key, top, saving)
		}
		for _, m := range rep.Months {
			if got[m.Month] != months[m.Month] {
				t.Errorf("%s %s: the rows add up to %d, the detail says %d", label, m.Month, got[m.Month], months[m.Month])
			}
			delete(got, m.Month)
		}
		maps.DeleteFunc(got, func(_ string, v int64) bool { return v == 0 }) // a row of 0 before the history (r28)
		if len(got) != 0 {
			t.Errorf("%s: rows in months the report does not have: %v", label, got)
		}
		fragment, err := s.DrillDown(ctx, viewer, scope, account, "0001-01-01", "9999-12-31", key)
		if err != nil {
			t.Fatal(err)
		}
		if listed := rowIDs(rows); !slices.Equal(slices.Sorted(slices.Values(listed)), fragment) {
			t.Errorf("%s: rows %v, the fragment lists %v", label, listed, fragment)
		}
	}
	if len(rep.Months) > 0 && len(want) == 0 && scope == "alles" {
		t.Errorf("viewer %d alles: no detail key checked", viewer)
	}
}

func TestDrillDownMatchesReport(t *testing.T) {
	t.Run("reportWorld", func(t *testing.T) {
		if testing.Short() {
			t.Skip("about 9 s, no goroutines: CI runs it in the plain run, not under -race")
		}
		d, s, _ := reportWorld(t)
		checkDrillDown(t, d, s, reportNow, bert, partner)
	})
	// The demo story with one of Bert's rows split in two, so that the run covers a split row.
	// Bert only: each listed month and key costs two transfer-detection queries.
	t.Run("demo", func(t *testing.T) {
		if testing.Short() {
			t.Skip("about 30 s")
		}
		d, s := seeded(t)
		splitDemoRow(t, d)
		checkDrillDown(t, d, s, demoNow, bert)
	})
}
