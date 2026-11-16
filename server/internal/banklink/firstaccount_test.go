package banklink

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// The live report: one connection, two accounts, and only one of them ever
// syncs. These tests put the first account in the states that can do that and
// check that the other account still syncs and that the first one says why.

// windowBank is a scriptBank that records the window each account is fetched
// with and can fail the balances of one account.
type windowBank struct {
	*scriptBank
	wmu      sync.Mutex
	from     map[string][]string
	balsFail map[string]error
}

func (b *windowBank) FetchTransactions(ctx context.Context, s bank.Session, id, from, to string) ([]bank.Transaction, error) {
	b.wmu.Lock()
	b.from[id] = append(b.from[id], from)
	b.wmu.Unlock()
	return b.scriptBank.FetchTransactions(ctx, s, id, from, to)
}

func (b *windowBank) FetchBalances(ctx context.Context, s bank.Session, id string) ([]bank.Balance, error) {
	if err := b.balsFail[id]; err != nil {
		return nil, err
	}
	return b.scriptBank.FetchBalances(ctx, s, id)
}

func (b *windowBank) lastFrom(id string) string {
	b.wmu.Lock()
	defer b.wmu.Unlock()
	if l := b.from[id]; len(l) > 0 {
		return l[len(l)-1]
	}
	return "<none>"
}

func newWindowEnv(t *testing.T) (*syncEnv, *windowBank) {
	e := newSyncEnv(t)
	wb := &windowBank{scriptBank: e.bank, from: map[string][]string{}, balsFail: map[string]error{}}
	e.svc = New(e.db, e.box, func(int64, string, []byte) (Client, error) { return wb, nil }, nil, nil)
	return e, wb
}

func (e *syncEnv) exec(q string, args ...any) {
	e.t.Helper()
	if _, err := e.db.Exec(q, args...); err != nil {
		e.t.Fatal(err)
	}
}

var booked = bank.Transaction{EntryReference: "b1", BookingDate: "2026-11-16", Amount: -1200, CounterpartyName: "Bakker", Status: bank.StatusBooked}

// A stored booking date that is not a plain date (a bank that sends a time
// with it) must not stop the sync of the connection's other accounts, nor
// leave the first account looking fine.
func TestBadStoredDateDoesNotStopTheOtherAccount(t *testing.T) {
	e, _ := newWindowEnv(t)
	e.exec(`INSERT INTO transactions (account_id, amount, booking_date, status, dedupe_key)
		VALUES (1, -500, '2026-11-10T00:00:00', 'booked', 'x')`)
	e.bank.set(func(b *scriptBank) { b.txs["a2"] = []bank.Transaction{booked} })
	if err := e.svc.Sync(context.Background(), 1, at(18, 10, 0)); err != nil {
		t.Fatal(err)
	}
	if got := e.query(`SELECT COUNT(*) FROM transactions WHERE account_id = 2`); got != "1" {
		t.Errorf("account 2 has %s rows: the first account's stored date stopped its sync", got)
	}
	if got := e.query(`SELECT status FROM account_sources WHERE account_id = 1`); got != "ok" {
		t.Errorf("account 1 source %q, want ok: a date with a time is still a date", got)
	}
}

// A store failure of one account (here a trigger stands in for any database
// refusal of that account's rows) is recorded on that account, and the
// connection's other accounts still sync.
func TestStoreFailureOfOneAccountIsRecordedAndOthersSync(t *testing.T) {
	e, _ := newWindowEnv(t)
	e.exec(`CREATE TRIGGER refuse BEFORE INSERT ON transactions WHEN NEW.account_id = 1
		BEGIN SELECT RAISE(ABORT, 'refused'); END`)
	e.bank.set(func(b *scriptBank) {
		b.txs["a1"] = []bank.Transaction{booked}
		b.txs["a2"] = []bank.Transaction{booked}
	})
	err := e.svc.Sync(context.Background(), 1, at(18, 10, 0))
	if err == nil {
		t.Error("a database failure is not reported")
	}
	if got := e.query(`SELECT COUNT(*) FROM transactions WHERE account_id = 2`); got != "1" {
		t.Errorf("account 2 has %s rows: account 1's failure stopped it", got)
	}
	if got := e.query(`SELECT status, last_error, last_attempt_at IS NOT NULL FROM account_sources WHERE account_id = 1`); got != "failed store_failed 1" {
		t.Errorf("account 1 source %q, want it failed with its code", got)
	}
	if got := e.query(`SELECT sync_status, last_error FROM provider_connections WHERE id = 1`); got != "failed store_failed" {
		t.Errorf("connection %q", got)
	}
}

// The window starts before the newest row up to today. A pending row the bank
// dates far ahead (a scheduled payment listed on its value date) must not
// move it to today, which would fetch only today's bookings from then on.
func TestFuturePendingRowDoesNotShrinkTheWindow(t *testing.T) {
	e, wb := newWindowEnv(t)
	e.bank.set(func(b *scriptBank) {
		b.txs["a1"] = []bank.Transaction{
			{ValueDate: "2027-01-05", Amount: -9900, CounterpartyName: "Verzekering", Status: bank.StatusPending},
			booked,
		}
	})
	ctx := context.Background()
	if err := e.svc.Sync(ctx, 1, at(18, 10, 0)); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Sync(ctx, 1, at(25, 10, 0)); err != nil {
		t.Fatal(err)
	}
	if got := wb.lastFrom("a1"); got != "2026-11-02" {
		t.Errorf("second sync of account 1 fetched from %q, want 14 days before its newest row up to today (2026-11-02)", got)
	}
}

// A new consent that leaves the first account out (unticked at the bank)
// stops its sync; the account must then say so instead of looking fine.
func TestAccountLeftOutOfTheConsentIsMarked(t *testing.T) {
	e, wb := newWindowEnv(t)
	ctx := context.Background()
	if err := e.svc.Sync(ctx, 1, at(18, 10, 0)); err != nil {
		t.Fatal(err)
	}
	// What storeConsent does for an account the new session does not list.
	e.exec(`UPDATE account_sources SET external_account_id = NULL WHERE account_id = 1`)
	before := wb.count()
	if err := e.svc.Sync(ctx, 1, at(19, 10, 0)); err != nil {
		t.Fatal(err)
	}
	if n := wb.count() - before; n != 1 {
		t.Errorf("%d fetches, want only account 2", n)
	}
	if got := e.query(`SELECT status, last_error FROM account_sources WHERE account_id = 1`); got != "failed not_shared" {
		t.Errorf("account 1 source %q, want failed not_shared", got)
	}
	if got := e.query(`SELECT status, COALESCE(last_error, '-') FROM account_sources WHERE account_id = 2`); got != "ok -" {
		t.Errorf("account 2 source %q", got)
	}

	// The accounts list says which account failed, and why.
	e.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 1, 'manager', 'edit'), (2, 1, 'manager', 'edit')`)
	accs, err := ledger.New(e.db).Accounts(ctx, 1, at(19, 10, 5))
	if err != nil || len(accs) != 2 {
		t.Fatalf("accounts %v, %v", accs, err)
	}
	str := func(p *string) string {
		if p == nil {
			return "<nil>"
		}
		return *p
	}
	want := at(19, 10, 0).Format(time.RFC3339)
	if a := accs[0]; str(a.SyncStatus) != "failed" || str(a.SyncError) != "not_shared" || str(a.LastAttempt) != want {
		t.Errorf("account 1: status %s, error %s, attempt %s", str(a.SyncStatus), str(a.SyncError), str(a.LastAttempt))
	}
	if a := accs[1]; str(a.SyncStatus) != "ok" || a.SyncError != nil || str(a.LastAttempt) != want {
		t.Errorf("account 2: status %s, error %s, attempt %s", str(a.SyncStatus), str(a.SyncError), str(a.LastAttempt))
	}
}

// Balances that fail for one account mark that account failed and leave the
// other account's sync alone.
func TestBalanceFailureOfOneAccount(t *testing.T) {
	e, wb := newWindowEnv(t)
	wb.balsFail["a1"] = errors.New("balances unavailable")
	e.bank.set(func(b *scriptBank) {
		b.txs["a1"] = []bank.Transaction{booked}
		b.txs["a2"] = []bank.Transaction{booked}
	})
	if err := e.svc.Sync(context.Background(), 1, at(18, 10, 0)); err != nil {
		t.Fatal(err)
	}
	if got := e.query(`SELECT status, last_error FROM account_sources WHERE account_id = 1`); got != "failed provider_error" {
		t.Errorf("account 1 source %q", got)
	}
	if got := e.query(`SELECT COUNT(*), (SELECT status FROM account_sources WHERE account_id = 2) FROM transactions WHERE account_id = 2`); got != "1 ok" {
		t.Errorf("account 2: %q", got)
	}
}
