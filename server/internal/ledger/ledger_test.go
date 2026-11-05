package ledger_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

const (
	bert    = demo.Bert
	partner = demo.Partner
)

// demoNow is the demo date in the evening, after the 04:02 sync.
var demoNow = time.Date(2026, 11, 18, 20, 0, 0, 0, clock.Brussels)

func seeded(t *testing.T) (*sql.DB, *ledger.Store) {
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

func ids[T any](items []T, id func(T) int64) []int64 {
	out := make([]int64, 0, len(items))
	for _, it := range items {
		out = append(out, id(it))
	}
	return out
}

func accountIDs(list []ledger.Account) []int64 {
	return ids(list, func(a ledger.Account) int64 { return a.ID })
}

// allTransactions walks every page.
func allTransactions(t *testing.T, s *ledger.Store, viewer int64, q ledger.TxQuery) []ledger.Transaction {
	t.Helper()
	var out []ledger.Transaction
	for range 1000 {
		page, err := s.Transactions(context.Background(), viewer, q)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, page.Items...)
		if page.Next == nil {
			return out
		}
		q.Before = *page.Next
	}
	t.Fatal("pagination does not end")
	return nil
}

func TestAccountsForBert(t *testing.T) {
	_, s := seeded(t)
	list, err := s.Accounts(context.Background(), bert, demoNow)
	if err != nil {
		t.Fatal(err)
	}
	if got := accountIDs(list); !slices.Equal(got, []int64{1, 2, 3, 4}) {
		t.Fatalf("Bert sees %v", got)
	}
	zicht, spaar, reserve, shared := list[0], list[1], list[2], list[3]

	if zicht.Name != "Zichtrekening" || zicht.Type != "current" || zicht.Source != "bank" || zicht.Kind != "personal" ||
		*zicht.IBAN != "BE68 •••• •••• 4821" || zicht.Colour != "green" || zicht.Buffer != 90000 || zicht.Balance != 196882 ||
		*zicht.BalanceDate != "2026-11-18" || *zicht.State != "ok" || *zicht.Bank != "Argenta" ||
		*zicht.LastSync != "2026-11-18T04:02:00+01:00" || *zicht.SyncStatus != "ok" ||
		zicht.Permission != "edit" || zicht.Role != "manager" || len(zicht.Members) != 0 {
		t.Errorf("Zichtrekening: %+v", zicht)
	}
	if spaar.Type != "savings" || spaar.Source != "manual" || spaar.Balance != 1250000 || *spaar.BalanceDate != "2026-10-02" ||
		spaar.State != nil || spaar.Bank != nil || spaar.LastSync != nil || spaar.SyncStatus != nil || spaar.Buffer != 0 ||
		spaar.Colour != "orange" || *spaar.IBAN != "BE41 •••• •••• 1196" {
		t.Errorf("Spaarrekening: %+v", spaar)
	}
	if reserve.IBAN != nil || reserve.Balance != 420000 || reserve.Colour != "yellow" {
		t.Errorf("Reserve: %+v", reserve)
	}
	if shared.Kind != "shared" || shared.Balance != 94608 || shared.Buffer != 60000 || *shared.State != "ok" ||
		*shared.IBAN != "BE12 •••• •••• 7730" || shared.Colour != "violet" || shared.Role != "manager" ||
		*shared.LastSync != "2026-11-18T04:02:00+01:00" {
		t.Errorf("Gedeelde rekening: %+v", shared)
	}
	wantMembers := []ledger.Member{
		{Name: "Bert", Initial: "B", Role: "manager", Permission: "edit", Me: true},
		{Name: "Partner", Initial: "P", Role: "member", Permission: "edit", Me: false},
	}
	if !slices.Equal(shared.Members, wantMembers) {
		t.Errorf("members: %+v", shared.Members)
	}
}

// Privacy (analysis 2): a user only sees the accounts they hold, in every query.
func TestPrivacy(t *testing.T) {
	ctx := context.Background()
	_, s := seeded(t)

	partnerAccounts, _ := s.Accounts(ctx, partner, demoNow)
	if got := accountIDs(partnerAccounts); !slices.Equal(got, []int64{4, 5}) {
		t.Fatalf("Partner sees %v, want [4 5]", got)
	}
	shared := partnerAccounts[0]
	if shared.Role != "member" || shared.Members[1].Name != "Partner" || !shared.Members[1].Me || shared.Members[0].Me {
		t.Errorf("Partner's view of the shared account: %+v", shared)
	}

	cases := []struct {
		viewer  int64
		visible []int64
		hidden  []int64
	}{
		{bert, []int64{1, 2, 3, 4}, []int64{5}},
		{partner, []int64{4, 5}, []int64{1, 2, 3}},
	}
	for _, c := range cases {
		for _, scope := range []string{"alles", "persoonlijk", "gedeeld"} {
			for _, tx := range allTransactions(t, s, c.viewer, ledger.TxQuery{Scope: scope, Limit: 200}) {
				if !slices.Contains(c.visible, tx.AccountID) {
					t.Fatalf("viewer %d sees transaction %d of account %d", c.viewer, tx.ID, tx.AccountID)
				}
			}
		}
		for _, id := range c.hidden {
			if _, err := s.Account(ctx, c.viewer, id, demoNow); !errors.Is(err, apperr.ErrNotFound) {
				t.Errorf("viewer %d, account %d: %v", c.viewer, id, err)
			}
			if _, err := s.Transactions(ctx, c.viewer, ledger.TxQuery{AccountID: id}); !errors.Is(err, apperr.ErrNotFound) {
				t.Errorf("viewer %d, ?account=%d: %v", c.viewer, id, err)
			}
			name := "x"
			if _, err := s.UpdateAccount(ctx, c.viewer, id, ledger.AccountPatch{Name: &name}, demoNow); !errors.Is(err, apperr.ErrNotFound) {
				t.Errorf("viewer %d, update %d: %v", c.viewer, id, err)
			}
		}
		conns, _ := s.Connections(ctx, c.viewer, demoNow)
		for _, conn := range conns {
			for _, id := range conn.Accounts {
				if !slices.Contains(c.visible, id) {
					t.Errorf("viewer %d's connection lists hidden account %d", c.viewer, id)
				}
			}
		}
	}

	// Searching for Partner's own counterparties finds nothing for Bert.
	for _, q := range []string{"Lidl", "Zara", "Werkgever BV", "Basic-Fit"} {
		page, _ := s.Transactions(ctx, bert, ledger.TxQuery{Q: q})
		if len(page.Items) != 0 {
			t.Errorf("Bert finds %d rows for %q", len(page.Items), q)
		}
		page, _ = s.Transactions(ctx, partner, ledger.TxQuery{Q: q})
		if len(page.Items) == 0 {
			t.Errorf("Partner finds nothing for %q", q)
		}
	}

	bertConns, _ := s.Connections(ctx, bert, demoNow)
	partnerConns, _ := s.Connections(ctx, partner, demoNow)
	if len(bertConns) != 1 || bertConns[0].ID != 1 || len(partnerConns) != 1 || partnerConns[0].ID != 2 {
		t.Errorf("connections: Bert %+v, Partner %+v", bertConns, partnerConns)
	}
	if !slices.Equal(partnerConns[0].Accounts, []int64{4, 5}) {
		t.Errorf("Partner's connection feeds %v", partnerConns[0].Accounts)
	}
}

// Transfer detection is per viewer (analysis 5.2): only accounts the viewer
// can see count, so Partner's personal account never labels anything for Bert.
func TestTransferFlagPerViewer(t *testing.T) {
	_, s := seeded(t)
	type key struct {
		account int64
		name    string
	}
	flags := func(viewer int64) map[key]bool {
		out := map[key]bool{}
		for _, tx := range allTransactions(t, s, viewer, ledger.TxQuery{Q: "Bijdrage november", Limit: 200}) {
			if tx.BookingDate == "2026-11-01" {
				out[key{tx.AccountID, tx.Counterparty}] = tx.Transfer
			}
		}
		return out
	}
	bertFlags := flags(bert)
	want := map[key]bool{
		{1, "Naar gedeelde rekening"}: true,  // Bert's own transfer out
		{4, "Bert"}:                   true,  // its incoming side on the shared account
		{4, "Partner"}:                false, // income from an IBAN Bert cannot see
	}
	if len(bertFlags) != len(want) {
		t.Fatalf("Bert: %v", bertFlags)
	}
	for k, v := range want {
		if bertFlags[k] != v {
			t.Errorf("Bert, %v: transfer=%v, want %v", k, bertFlags[k], v)
		}
	}
	partnerFlags := flags(partner)
	want = map[key]bool{
		{5, "Naar gedeelde rekening"}: true,
		{4, "Partner"}:                true,
		{4, "Bert"}:                   false,
	}
	if len(partnerFlags) != len(want) {
		t.Fatalf("Partner: %v", partnerFlags)
	}
	for k, v := range want {
		if partnerFlags[k] != v {
			t.Errorf("Partner, %v: transfer=%v, want %v", k, partnerFlags[k], v)
		}
	}

	// The transfer to the manual savings account is a transfer (its IBAN is registered).
	page, _ := s.Transactions(context.Background(), bert, ledger.TxQuery{Q: "Maandelijks sparen", Limit: 1})
	if len(page.Items) != 1 || !page.Items[0].Transfer || page.Items[0].BookingDate != "2026-11-16" || page.Items[0].Amount != -20000 {
		t.Errorf("Naar spaarrekening: %+v", page.Items)
	}
}

func TestTransferOverride(t *testing.T) {
	ctx := context.Background()
	d, s := seeded(t)
	page, _ := s.Transactions(ctx, bert, ledger.TxQuery{Q: "Kinepolis", Limit: 1})
	tx := page.Items[0]
	if tx.Transfer {
		t.Fatal("Kinepolis is no transfer")
	}
	if _, err := d.Exec(`INSERT INTO transfer_overrides (user_id, transaction_id, is_transfer) VALUES (?, ?, 1)`, bert, tx.ID); err != nil {
		t.Fatal(err)
	}
	page, _ = s.Transactions(ctx, bert, ledger.TxQuery{Q: "Kinepolis", Limit: 1})
	if !page.Items[0].Transfer {
		t.Error("the user's override is ignored")
	}
	page, _ = s.Transactions(ctx, partner, ledger.TxQuery{Q: "Kinepolis"})
	if len(page.Items) != 0 {
		t.Error("Partner sees Bert's Kinepolis row")
	}
}

func TestDemoRowsAndUncategorised(t *testing.T) {
	ctx := context.Background()
	_, s := seeded(t)
	page, err := s.Transactions(ctx, bert, ledger.TxQuery{Limit: 16})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Bol.com", "Colruyt Laagste Prijzen", "TotalEnergies", "Spotify", "Bakkerij De Graankorrel",
		"Naar spaarrekening", "CM Ziekenfonds", "Delhaize", "Kinepolis", "Frituur 't Pleintje", "Decathlon", "NMBS",
		"Albert Heijn", "Apotheek Van Damme", "Netflix", "Carrefour Express"}
	got := make([]string, 0, 16)
	for _, tx := range page.Items {
		got = append(got, tx.Counterparty)
	}
	if !slices.Equal(got, want) {
		t.Errorf("first page:\n got %v\nwant %v", got, want)
	}
	first := page.Items[0]
	if first.Status != "pending" || first.Amount != -2499 || first.Category != nil || first.AccountID != 1 ||
		first.Communication != "Bestelling 4471-2210" || first.BookingDate != "2026-11-18" || first.Transfer {
		t.Errorf("Bol.com: %+v", first)
	}
	colruyt := page.Items[1]
	if colruyt.Category == nil || colruyt.Category.Name != "Boodschappen" || colruyt.Category.Colour != "c2" || colruyt.AccountID != 4 {
		t.Errorf("Colruyt: %+v", colruyt)
	}
	cm := page.Items[6]
	if cm.Category == nil || cm.Category.Name != "Terugbetaling" || cm.Category.Colour != "soft" || cm.Amount != 1850 {
		t.Errorf("CM Ziekenfonds: %+v", cm)
	}

	n, err := s.UncategorisedCount(ctx, bert)
	if err != nil || n != 4 {
		t.Errorf("Bert's uncategorised count: %d, %v", n, err)
	}
	open := allTransactions(t, s, bert, ledger.TxQuery{Uncategorised: true})
	if len(open) != 4 {
		t.Errorf("uncategorised filter: %d rows", len(open))
	}
	if n, _ := s.UncategorisedCount(ctx, partner); n != 0 {
		t.Errorf("Partner's uncategorised count: %d", n)
	}
}

func TestFiltersAndPagination(t *testing.T) {
	ctx := context.Background()
	_, s := seeded(t)

	all := allTransactions(t, s, bert, ledger.TxQuery{Limit: 200})
	paged := allTransactions(t, s, bert, ledger.TxQuery{Limit: 7})
	if len(all) < 250 || len(all) != len(paged) {
		t.Fatalf("all=%d paged=%d", len(all), len(paged))
	}
	for i := range all {
		if all[i].ID != paged[i].ID {
			t.Fatalf("pages differ at %d", i)
		}
		if i > 0 && (all[i].BookingDate > all[i-1].BookingDate ||
			(all[i].BookingDate == all[i-1].BookingDate && all[i].ID > all[i-1].ID)) {
			t.Fatalf("not newest first at %d", i)
		}
	}

	page, _ := s.Transactions(ctx, bert, ledger.TxQuery{})
	if len(page.Items) != ledger.DefaultLimit || page.Next == nil {
		t.Errorf("default page: %d items, next %v", len(page.Items), page.Next)
	}
	page, _ = s.Transactions(ctx, bert, ledger.TxQuery{Limit: 5000})
	if len(page.Items) != ledger.MaxLimit {
		t.Errorf("limit is not capped: %d", len(page.Items))
	}

	for _, tx := range allTransactions(t, s, bert, ledger.TxQuery{Scope: "persoonlijk", Limit: 200}) {
		if tx.AccountID != 1 {
			t.Fatalf("persoonlijk holds account %d", tx.AccountID)
		}
	}
	for _, tx := range allTransactions(t, s, bert, ledger.TxQuery{Scope: "gedeeld", Limit: 200}) {
		if tx.AccountID != 4 {
			t.Fatalf("gedeeld holds account %d", tx.AccountID)
		}
	}
	for _, tx := range allTransactions(t, s, bert, ledger.TxQuery{AccountID: 4, Scope: "persoonlijk"}) {
		t.Fatalf("account 4 is not personal, got %+v", tx)
	}

	search := []struct {
		q    string
		want string
	}{
		{"bol.com", "Bol.com"},
		{"4471-2210", "Bol.com"},
		{"24,99", "Bol.com"},
		{"€ 86.42", "Colruyt Laagste Prijzen"},
		{"graankorrel", "Bakkerij De Graankorrel"},
		{"8,40", "Bakkerij De Graankorrel"},
		{"-8,4", "Bakkerij De Graankorrel"},
		{"100%", ""},
		{"_", ""},
	}
	for _, sc := range search {
		page, err := s.Transactions(ctx, bert, ledger.TxQuery{Q: sc.q, Limit: 1})
		if err != nil {
			t.Fatalf("%q: %v", sc.q, err)
		}
		if sc.want == "" {
			if len(page.Items) != 0 {
				t.Errorf("%q matched %+v", sc.q, page.Items[0])
			}
			continue
		}
		if len(page.Items) != 1 || page.Items[0].Counterparty != sc.want {
			t.Errorf("%q: %+v", sc.q, page.Items)
		}
	}

	var invalid *apperr.InvalidError
	if _, err := s.Transactions(ctx, bert, ledger.TxQuery{Scope: "iedereen"}); !errors.As(err, &invalid) {
		t.Errorf("bad scope: %v", err)
	}
	if _, err := s.Transactions(ctx, bert, ledger.TxQuery{Before: "nonsense"}); !errors.As(err, &invalid) {
		t.Errorf("bad cursor: %v", err)
	}
	if _, err := s.Transactions(ctx, bert, ledger.TxQuery{AccountID: 999}); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("unknown account: %v", err)
	}
}

func TestUpdateAccount(t *testing.T) {
	ctx := context.Background()
	d, s := seeded(t)
	str := func(s string) *string { return &s }
	num := func(n int64) *int64 { return &n }

	a, err := s.UpdateAccount(ctx, bert, 1, ledger.AccountPatch{Name: str("  Dagelijks  "), Colour: str("teal"), Buffer: num(100000)}, demoNow)
	if err != nil {
		t.Fatal(err)
	}
	if a.Name != "Dagelijks" || a.Colour != "teal" || a.Buffer != 100000 || *a.State != "ok" {
		t.Errorf("updated: %+v", a)
	}
	a, _ = s.UpdateAccount(ctx, bert, 1, ledger.AccountPatch{Buffer: num(200000)}, demoNow)
	if *a.State != "buffer" || a.Name != "Dagelijks" {
		t.Errorf("state after a higher buffer: %+v", a)
	}

	bad := []struct {
		name string
		id   int64
		p    ledger.AccountPatch
	}{
		{"nothing", 1, ledger.AccountPatch{}},
		{"empty name", 1, ledger.AccountPatch{Name: str("   ")}},
		{"long name", 1, ledger.AccountPatch{Name: str("Een veel te lange naam voor een rekening hier")}},
		{"newline", 1, ledger.AccountPatch{Name: str("Zicht\nrekening")}},
		{"colour", 1, ledger.AccountPatch{Colour: str("red")}},
		{"negative buffer", 1, ledger.AccountPatch{Buffer: num(-100)}},
		{"cents", 1, ledger.AccountPatch{Buffer: num(90050)}},
		{"huge buffer", 1, ledger.AccountPatch{Buffer: num(100_000_100)}},
		{"buffer on savings", 2, ledger.AccountPatch{Buffer: num(10000)}},
	}
	for _, b := range bad {
		var invalid *apperr.InvalidError
		if _, err := s.UpdateAccount(ctx, bert, b.id, b.p, demoNow); !errors.As(err, &invalid) || invalid.Message == "" {
			t.Errorf("%s: %v", b.name, err)
		}
	}
	if a, err := s.UpdateAccount(ctx, bert, 2, ledger.AccountPatch{Name: str("Spaarpot"), Buffer: num(10000)}, demoNow); err == nil {
		t.Errorf("savings accepted a buffer: %+v", a)
	}
	if a, _ := s.Account(ctx, bert, 2, demoNow); a.Name != "Spaarrekening" {
		t.Errorf("a rejected patch changed the account: %+v", a)
	}
	// Buffer 0 is the only buffer of a savings account, so a form may send it.
	if a, err := s.UpdateAccount(ctx, bert, 2, ledger.AccountPatch{Name: str("Spaarpot"), Buffer: num(0)}, demoNow); err != nil || a.Name != "Spaarpot" {
		t.Errorf("savings with buffer 0: %+v, %v", a, err)
	}

	// A read-only member can see the account but not change it.
	d.Exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = ?`, partner)
	if _, err := s.UpdateAccount(ctx, partner, 4, ledger.AccountPatch{Colour: str("blue")}, demoNow); !errors.Is(err, apperr.ErrForbidden) {
		t.Errorf("read-only member: %v", err)
	}
	// The other member sees the change of a member with edit rights.
	if _, err := s.UpdateAccount(ctx, bert, 4, ledger.AccountPatch{Colour: str("blue")}, demoNow); err != nil {
		t.Fatal(err)
	}
	if a, _ := s.Account(ctx, partner, 4, demoNow); a.Colour != "blue" || a.Permission != "read" {
		t.Errorf("Partner's view: %+v", a)
	}
}

func TestConnectionsAndAlerts(t *testing.T) {
	ctx := context.Background()
	d, s := seeded(t)

	conns, err := s.Connections(ctx, bert, demoNow)
	if err != nil {
		t.Fatal(err)
	}
	c := conns[0]
	if c.Bank != "Argenta" || *c.Since != "2026-06-03" || *c.ValidUntil != "2026-11-30" || *c.DaysLeft != 12 ||
		*c.LastSync != "2026-11-18T04:02:00+01:00" || c.Status != "ok" || !slices.Equal(c.Accounts, []int64{1, 4}) {
		t.Errorf("Bert's connection: %+v", c)
	}

	alerts, err := s.Alerts(ctx, bert, demoNow)
	if err != nil {
		t.Fatal(err)
	}
	want := []ledger.Alert{
		{Kind: "warn", Type: "consent", Title: "Toestemming verloopt over 12 dagen", Note: "Argenta · opnieuw autoriseren", Href: "/bankkoppelingen"},
		{Kind: "ok", Type: "categorise", Title: "4 transacties te categoriseren", Note: "", Href: "/transacties?filter=niet-gecategoriseerd"},
	}
	if !slices.Equal(alerts, want) {
		t.Errorf("Bert's alerts:\n got %+v\nwant %+v", alerts, want)
	}
	partnerAlerts, _ := s.Alerts(ctx, partner, demoNow)
	if len(partnerAlerts) != 1 || partnerAlerts[0].Title != "Toestemming verloopt over 14 dagen" {
		t.Errorf("Partner's alerts: %+v", partnerAlerts)
	}

	// Two days later without a sync: stale, and the consent nearly ends.
	later := demoNow.Add(48 * time.Hour)
	alerts, _ = s.Alerts(ctx, bert, later)
	var titles []string
	for _, a := range alerts {
		titles = append(titles, a.Kind+": "+a.Title)
	}
	wantTitles := []string{
		"warn: Toestemming verloopt over 10 dagen",
		"warn: Zichtrekening niet bijgewerkt sinds woensdag 04:02",
		"warn: Gedeelde rekening niet bijgewerkt sinds woensdag 04:02",
		"ok: 4 transacties te categoriseren",
	}
	if !slices.Equal(titles, wantTitles) {
		t.Errorf("stale alerts:\n got %v\nwant %v", titles, wantTitles)
	}
	if conns, _ := s.Connections(ctx, bert, later); conns[0].Status != "stale" || conns[0].Stopped(later) {
		t.Errorf("connection after 2 days: %s", conns[0].Status)
	}

	// More than 72 hours: "Synchronisatie gestopt" replaces the account
	// warnings it explains.
	stopped := demoNow.Add(72 * time.Hour)
	alerts, _ = s.Alerts(ctx, bert, stopped)
	want = []ledger.Alert{
		{Kind: "neg", Type: "sync", Title: "Synchronisatie gestopt · Argenta", Note: "Niet bijgewerkt sinds woensdag 04:02 · bekijk de koppeling", Href: "/bankkoppelingen"},
		{Kind: "warn", Type: "consent", Title: "Toestemming verloopt over 9 dagen", Note: "Argenta · opnieuw autoriseren", Href: "/bankkoppelingen"},
		{Kind: "ok", Type: "categorise", Title: "4 transacties te categoriseren", Note: "", Href: "/transacties?filter=niet-gecategoriseerd"},
	}
	if !slices.Equal(alerts, want) {
		t.Errorf("stopped alerts:\n got %+v\nwant %+v", alerts, want)
	}

	// Bert's sync fails: one error for his connection; the shared account falls
	// back on Partner's link and stays fine.
	d.Exec(`UPDATE provider_connections SET sync_status = 'failed', last_attempt_at = '2026-11-18T03:02:00Z' WHERE id = 1`)
	d.Exec(`UPDATE account_sources SET status = 'failed' WHERE connection_id = 1`)
	alerts, _ = s.Alerts(ctx, bert, demoNow)
	if alerts[0].Kind != "neg" || alerts[0].Title != "Synchronisatie mislukt · Argenta" ||
		alerts[0].Note != "Laatste poging vandaag 04:02 · bekijk de koppeling" {
		t.Errorf("failed sync alert: %+v", alerts)
	}
	for _, a := range alerts[1:] {
		if a.Kind == "neg" {
			t.Errorf("duplicate error alert: %+v", a)
		}
	}
	accs, _ := s.Accounts(ctx, bert, demoNow)
	if *accs[0].SyncStatus != "failed" || *accs[3].SyncStatus != "ok" || *accs[3].LastSync != "2026-11-18T04:05:00+01:00" {
		t.Errorf("sync status: zicht %s, shared %s %s", *accs[0].SyncStatus, *accs[3].SyncStatus, *accs[3].LastSync)
	}

	// After the consent date the connection is expired.
	expired := time.Date(2026, 12, 1, 9, 0, 0, 0, clock.Brussels)
	conns, _ = s.Connections(ctx, bert, expired)
	if conns[0].Status != "expired" || *conns[0].DaysLeft != -1 {
		t.Errorf("expired connection: %+v", conns[0])
	}
	alerts, _ = s.Alerts(ctx, bert, expired)
	if alerts[0].Kind != "neg" || alerts[0].Type != "consent" {
		t.Errorf("expired consent alert: %+v", alerts)
	}
}

func TestMarkSynced(t *testing.T) {
	ctx := context.Background()
	_, s := seeded(t)
	at := time.Date(2026, 11, 18, 21, 15, 0, 0, clock.Brussels)
	n, err := s.MarkSynced(ctx, bert, at)
	if err != nil || n != 1 {
		t.Fatalf("MarkSynced: %d, %v", n, err)
	}
	conns, _ := s.Connections(ctx, bert, at)
	if *conns[0].LastSync != "2026-11-18T21:15:00+01:00" {
		t.Errorf("connection last sync: %s", *conns[0].LastSync)
	}
	accs, _ := s.Accounts(ctx, bert, at)
	if *accs[0].LastSync != "2026-11-18T21:15:00+01:00" {
		t.Errorf("account last sync: %s", *accs[0].LastSync)
	}
	// Partner's connection is untouched.
	conns, _ = s.Connections(ctx, partner, at)
	if *conns[0].LastSync != "2026-11-18T04:05:00+01:00" {
		t.Errorf("Partner's connection changed: %s", *conns[0].LastSync)
	}
}

func TestInsertTransactionsIsIdempotent(t *testing.T) {
	ctx := context.Background()
	d, _ := seeded(t)
	p := fake.Provider{}
	sess := bank.Session{ID: fake.SessionPartner}
	accs, _ := p.ListAccounts(ctx, sess)
	txs, _ := p.FetchTransactions(ctx, sess, accs[1].ID, fake.StoryStart, fake.StoryEnd)
	n, err := ledger.InsertTransactions(ctx, d, ledger.Keyed(4, accs[1].IBAN, 2, txs))
	if err != nil || n != 0 {
		t.Errorf("re-fetching the shared account inserted %d rows (%v)", n, err)
	}
}

// A user who has not linked a bank yet has no accounts: the API must answer
// [], not null, which the web app cannot iterate.
func TestAccountsWithoutAccountsIsAnEmptyList(t *testing.T) {
	_, s := seeded(t)
	list, err := s.Accounts(context.Background(), 999, demoNow)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := json.Marshal(list); string(b) != "[]" {
		t.Fatalf("accounts of a viewer without accounts = %s, want []", b)
	}
}

// The shapes a real link goes through: credentials saved (pending, no dates),
// consent given but the first sync failed (no last sync), then three days of
// failures, then an expired session.
func TestAlertsForARealLink(t *testing.T) {
	ctx := context.Background()
	d, s := seeded(t)
	exec := func(q string) {
		t.Helper()
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users (id, email, display_name) VALUES (50, 'nieuw@example.com', 'Nieuw')`)
	exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, status, created_at)
		VALUES (50, 50, 'enablebanking', 'Argenta', 'pending', '2026-11-01T10:00:00Z')`)
	titles := func(now time.Time) []string {
		t.Helper()
		alerts, err := s.Alerts(ctx, 50, now)
		if err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, a := range alerts {
			out = append(out, a.Kind+" "+a.Type+": "+a.Title+" / "+a.Note)
		}
		return out
	}
	if got := titles(demoNow); len(got) != 0 {
		t.Errorf("pending link: %v", got)
	}
	conns, _ := s.Connections(ctx, 50, demoNow)
	if conns[0].Status != "pending" || conns[0].DaysLeft != nil || conns[0].Stopped(demoNow.AddDate(0, 1, 0)) {
		t.Errorf("pending connection: %+v", conns[0])
	}

	// Linked this morning; the first sync failed.
	exec(`UPDATE provider_connections SET status = 'active', consent_since = '2026-11-18', valid_until = '2027-05-17T10:00:00Z',
		sync_status = 'failed', last_attempt_at = '2026-11-18T09:00:00Z' WHERE id = 50`)
	exec(`INSERT INTO accounts (id, type, source, iban, name, bank_name) VALUES (50, 'current', 'bank', 'BE68539007547034', 'Zichtrekening', 'Argenta')`)
	exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (50, 50, 'manager', 'edit')`)
	exec(`INSERT INTO account_sources (account_id, connection_id, priority, status) VALUES (50, 50, 'primary', 'failed')`)
	want := []string{"neg sync: Synchronisatie mislukt · Argenta / Laatste poging vandaag 10:00 · bekijk de koppeling"}
	if got := titles(demoNow); !slices.Equal(got, want) {
		t.Errorf("first sync failed:\n got %v\nwant %v", got, want)
	}
	// Three days on, still nothing: counted from the day of the consent.
	want = []string{"neg sync: Synchronisatie gestopt · Argenta / Nog nooit gesynchroniseerd · bekijk de koppeling"}
	if got := titles(demoNow.Add(56 * time.Hour)); !slices.Equal(got, want) {
		t.Errorf("never synced for three days:\n got %v\nwant %v", got, want)
	}

	// The bank reports the session as expired.
	exec(`UPDATE provider_connections SET status = 'expired' WHERE id = 50`)
	want = []string{"neg consent: Toestemming voor Argenta is verlopen / Synchronisatie gestopt · opnieuw autoriseren"}
	if got := titles(demoNow); !slices.Equal(got, want) {
		t.Errorf("expired:\n got %v\nwant %v", got, want)
	}
}
