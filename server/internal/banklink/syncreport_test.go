package banklink

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// reports is the sync report of each of viewer 1's accounts by account id
// (nil while an account has none).
func reports(t *testing.T, e *syncEnv, now time.Time) map[int64]*ledger.SyncReport {
	t.Helper()
	accs, err := ledger.New(e.db).Accounts(context.Background(), 1, now)
	if err != nil {
		t.Fatal(err)
	}
	out := map[int64]*ledger.SyncReport{}
	for _, a := range accs {
		out[a.ID] = a.SyncReport
	}
	return out
}

func str(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

// A link with two accounts on the fake bank: each account's report is its own
// (its own counts, its own provider id), and a second sync that finds nothing
// new says "fetched N, added 0".
func TestSyncReportIsPerAccountOnTheFakeBank(t *testing.T) {
	ctx := context.Background()
	svc, e := linkEnv(t, func(int64, string, []byte) (Client, error) { return fake.Client{Session: fake.SessionBert}, nil })
	now := at(18, 10, 0)
	linked, err := svc.Complete(ctx, 1, fake.DemoCode, svc.states.add(1, 1), now)
	if err != nil || len(linked.Accounts) != 2 {
		t.Fatalf("linked %+v, %v", linked, err)
	}
	if r := reports(t, e, now); r[linked.Accounts[0]] != nil || r[linked.Accounts[1]] != nil {
		t.Fatalf("reports before the first sync: %+v, want none", r)
	}
	if err := svc.Sync(ctx, 1, now); err != nil {
		t.Fatal(err)
	}

	sess := bank.Session{ID: fake.SessionBert}
	accs, err := fake.Provider{}.ListAccounts(ctx, sess)
	if err != nil || len(accs) != 2 {
		t.Fatalf("fake accounts: %d, %v", len(accs), err)
	}
	got := reports(t, e, now)
	for i, id := range linked.Accounts {
		txs, err := fake.Provider{}.FetchTransactions(ctx, sess, accs[i].ID, "", "2026-11-18")
		if err != nil || len(txs) == 0 {
			t.Fatalf("story of %s: %d rows, %v", accs[i].IBAN, len(txs), err)
		}
		r := got[id]
		if r == nil {
			t.Fatalf("account %d has no report after its sync", id)
		}
		if r.At != now.Format(time.RFC3339) || r.From != nil || r.Fetched != len(txs) || r.Added != len(txs) ||
			str(r.Newest) != txs[0].BookingDate || str(r.BalanceDate) != fake.StoryEnd || r.IDTail != accs[i].ID[len(accs[i].ID)-4:] {
			t.Errorf("account %d: %+v (newest %s, balance %s), want at %s, from nil, %d fetched and added, newest %s, balance %s, tail %s",
				id, *r, str(r.Newest), str(r.BalanceDate), now.Format(time.RFC3339), len(txs), txs[0].BookingDate, fake.StoryEnd, accs[i].ID[len(accs[i].ID)-4:])
		}
	}
	if a, b := got[linked.Accounts[0]], got[linked.Accounts[1]]; a.IDTail == b.IDTail || a.Fetched == b.Fetched {
		t.Errorf("the two reports look alike: %+v and %+v", *a, *b)
	}

	// Nothing is new the next day: the window starts 14 days back and every
	// row it returns is stored already.
	if err := svc.Sync(ctx, 1, at(19, 10, 0)); err != nil {
		t.Fatal(err)
	}
	for _, id := range linked.Accounts {
		r := reports(t, e, at(19, 10, 5))[id]
		if r == nil || r.Added != 0 || r.Fetched == 0 || r.From == nil || r.At != at(19, 10, 0).Format(time.RFC3339) {
			t.Errorf("account %d after a second sync: %+v, want a new report with rows fetched and none added", id, r)
		}
	}
}

// A failed account keeps the report of its last successful sync while the
// other account gets a new one, and every stored account logs one line.
func TestFailedAccountKeepsItsOldReport(t *testing.T) {
	e, wb := newWindowEnv(t)
	var logs bytes.Buffer
	e.svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	e.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 1, 'manager', 'edit'), (2, 1, 'manager', 'edit')`)
	other := bank.Transaction{EntryReference: "b2", BookingDate: "2026-11-12", Amount: -300, CounterpartyName: "Slager", Status: bank.StatusBooked}
	e.bank.set(func(b *scriptBank) {
		b.txs["a1"] = []bank.Transaction{booked}
		b.txs["a2"] = []bank.Transaction{booked, other}
	})
	ctx := context.Background()
	if err := e.svc.Sync(ctx, 1, at(18, 10, 0)); err != nil {
		t.Fatal(err)
	}
	first := reports(t, e, at(18, 10, 5))
	want1 := ledger.SyncReport{At: at(18, 10, 0).Format(time.RFC3339), Fetched: 1, Added: 1, IDTail: "a1"}
	want2 := ledger.SyncReport{At: want1.At, Fetched: 2, Added: 2, IDTail: "a2"}
	for id, want := range map[int64]ledger.SyncReport{1: want1, 2: want2} {
		r := first[id]
		if r == nil || r.At != want.At || r.From != nil || r.Fetched != want.Fetched || r.Added != want.Added ||
			str(r.BalanceDate) != "2026-11-17" || r.IDTail != want.IDTail {
			t.Errorf("account %d: %+v, want %+v with balance date 2026-11-17", id, r, want)
		}
	}
	if n := str(first[1].Newest); n != "2026-11-16" {
		t.Errorf("account 1 newest %s, want 2026-11-16", n)
	}
	if n := str(first[2].Newest); n != "2026-11-16" {
		t.Errorf("account 2 newest %s, want 2026-11-16", n)
	}

	wb.balsFail["a2"] = errors.New("unavailable")
	if err := e.svc.Sync(ctx, 1, at(19, 10, 0)); err != nil {
		t.Fatal(err)
	}
	after := reports(t, e, at(19, 10, 5))
	oldJSON, _ := json.Marshal(first[2])
	newJSON, _ := json.Marshal(after[2])
	if string(newJSON) != string(oldJSON) {
		t.Errorf("failed account 2: report %s, want the old %s", newJSON, oldJSON)
	}
	if want := `{"at":"2026-11-18T10:00:00+01:00","from":null,"fetched":2,"added":2,"newest":"2026-11-16","balanceDate":"2026-11-17","idTail":"a2"}`; string(oldJSON) != want {
		t.Errorf("report JSON %s, want %s", oldJSON, want)
	}
	if r := after[1]; r.At != at(19, 10, 0).Format(time.RFC3339) || r.Fetched != 1 || r.Added != 0 || str(r.From) != "2026-11-02" {
		t.Errorf("account 1 after the second sync: %+v, want a new report: from 2026-11-02, 1 fetched, 0 added", *r)
	}
	if n := strings.Count(logs.String(), `msg="bank sync account"`); n != 3 {
		t.Errorf("%d 'bank sync account' lines, want 3 (two accounts, then the one that did not fail):\n%s", n, logs.String())
	}
	if line := "account=1 from=2026-11-02 fetched=1 added=0 newest=2026-11-16"; !strings.Contains(logs.String(), line) {
		t.Errorf("log lacks %q:\n%s", line, logs.String())
	}
}
