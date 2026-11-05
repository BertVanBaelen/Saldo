package banklink

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/secrets"
)

// scriptBank is a bank whose answers a test sets, per provider account id.
type scriptBank struct {
	mu       sync.Mutex
	txs      map[string][]bank.Transaction
	fail     map[string]error
	fetches  int
	inFlight int
	most     int    // the most fetches at once
	hook     func() // runs at the start of every fetch, outside the lock
}

func (b *scriptBank) CheckApplication(context.Context) error { return nil }
func (b *scriptBank) StartAuth(context.Context, string, string, string, string, time.Time) (string, error) {
	return "", nil
}
func (b *scriptBank) CreateSession(context.Context, string) (bank.SessionInfo, error) {
	return bank.SessionInfo{}, nil
}
func (b *scriptBank) ListAccounts(context.Context, bank.Session) ([]bank.Account, error) {
	return nil, nil
}

func (b *scriptBank) FetchTransactions(_ context.Context, _ bank.Session, id, _, _ string) ([]bank.Transaction, error) {
	b.mu.Lock()
	b.fetches++
	b.inFlight++
	b.most = max(b.most, b.inFlight)
	hook := b.hook
	b.mu.Unlock()
	if hook != nil {
		hook()
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.inFlight--
	if err := b.fail[id]; err != nil {
		return nil, err
	}
	return append([]bank.Transaction(nil), b.txs[id]...), nil
}

func (b *scriptBank) FetchBalances(_ context.Context, _ bank.Session, id string) ([]bank.Balance, error) {
	return []bank.Balance{{Amount: 1000, Date: "2026-11-17", Type: "CLBD"}}, nil
}

func (b *scriptBank) set(f func(b *scriptBank)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	f(b)
}

func (b *scriptBank) count() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.fetches
}

type syncEnv struct {
	t    *testing.T
	db   *sql.DB
	box  *secrets.Box
	bank *scriptBank
	svc  *Service
}

// newSyncEnv is one active connection (1) feeding accounts 1 and 2, provider
// ids "a1" and "a2". The IBANs are documentation examples.
func newSyncEnv(t *testing.T) *syncEnv {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	box, err := secrets.Load(filepath.Join(t.TempDir(), "secret.key"))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.com', 'A')`,
		`INSERT INTO accounts (id, type, source, iban, name) VALUES (1, 'current', 'bank', 'BE68539007547034', 'Zicht')`,
		`INSERT INTO accounts (id, type, source, iban, name) VALUES (2, 'current', 'bank', 'BE71096123456769', 'Gezin')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := d.Exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, application_id, session_id_enc, status)
		VALUES (1, 1, 'enablebanking', 'Argenta', 'app', ?, 'active')`, box.Seal([]byte("sess"))); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO account_sources (account_id, connection_id, priority, external_account_id) VALUES (1, 1, 'primary', 'a1')`,
		`INSERT INTO account_sources (account_id, connection_id, priority, external_account_id) VALUES (2, 1, 'primary', 'a2')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	e := &syncEnv{t: t, db: d, box: box, bank: &scriptBank{txs: map[string][]bank.Transaction{}, fail: map[string]error{}}}
	e.restart()
	return e
}

// restart is a new Service on the same database, as after a restart.
func (e *syncEnv) restart() {
	e.svc = New(e.db, e.box, func(int64, string, []byte) (Client, error) { return e.bank, nil }, nil, nil)
}

func at(day, hour, minute int) time.Time {
	return time.Date(2026, 11, day, hour, minute, 0, 0, clock.Brussels)
}

// nightly runs the job at t and returns how many fetches it made.
func (e *syncEnv) nightly(t time.Time) int {
	e.t.Helper()
	before := e.bank.count()
	if err := e.svc.Nightly(context.Background(), t); err != nil {
		e.t.Fatal(err)
	}
	return e.bank.count() - before
}

func (e *syncEnv) query(q string) string {
	e.t.Helper()
	rows, err := e.db.Query(q)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var out []string
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			e.t.Fatal(err)
		}
		out = append(out, strings.TrimSuffix(fmt.Sprintln(vals...), "\n"))
	}
	return strings.Join(out, "\n")
}

func TestNightlyOncePerDayAfterFour(t *testing.T) {
	e := newSyncEnv(t)
	steps := []struct {
		at      time.Time
		fetches int
	}{
		{at(18, 3, 59), 0},
		{at(18, 4, 0), 2}, // two accounts
		{at(18, 4, 10), 0},
		{at(18, 23, 50), 0},
		{at(19, 0, 30), 0},
		{at(19, 4, 5), 2},
		{at(19, 4, 15), 0},
	}
	for _, s := range steps {
		if n := e.nightly(s.at); n != s.fetches {
			t.Errorf("%v: %d fetches, want %d", s.at, n, s.fetches)
		}
	}
	if got := e.query(`SELECT background_day, background_attempts, sync_status FROM provider_connections`); got != "2026-11-19 1 ok" {
		t.Errorf("connection %q", got)
	}
}

func TestNightlyCatchesUpAfterARestart(t *testing.T) {
	e := newSyncEnv(t)
	e.nightly(at(17, 4, 0))
	// Saldo was off from 03:00 until noon (a backup, an update).
	e.restart()
	if n := e.nightly(at(18, 12, 0)); n != 2 {
		t.Errorf("catch-up at noon: %d fetches", n)
	}
	if n := e.nightly(at(18, 12, 10)); n != 0 {
		t.Errorf("after the catch-up: %d fetches", n)
	}
}

// A manual sync after 04:00 is the day's sync; the nightly job skips it.
func TestNightlyCountsAManualSync(t *testing.T) {
	e := newSyncEnv(t)
	if err := e.svc.Sync(context.Background(), 1, at(18, 7, 0)); err != nil {
		t.Fatal(err)
	}
	if n := e.nightly(at(18, 9, 0)); n != 0 {
		t.Errorf("after a manual sync: %d fetches", n)
	}
}

func TestNightlyRetriesWithBackoffUpToTheCap(t *testing.T) {
	e := newSyncEnv(t)
	e.bank.set(func(b *scriptBank) { b.fail["a1"] = errors.New("bank down " + "BE68539007547034") })
	steps := []struct {
		at      time.Time
		fetches int
	}{
		{at(18, 4, 0), 2}, // attempt 1: a1 fails, a2 still syncs
		{at(18, 4, 29), 0},
		{at(18, 4, 30), 2}, // attempt 2, 30 minutes later
		{at(18, 5, 29), 0},
		{at(18, 5, 30), 2}, // attempt 3, 1 hour later
		{at(18, 7, 30), 0}, // the daily cap
		{at(18, 23, 0), 0},
	}
	for _, s := range steps {
		if n := e.nightly(s.at); n != s.fetches {
			t.Errorf("%v: %d fetches, want %d", s.at, n, s.fetches)
		}
	}
	// Per account: a1 failed, a2 synced; the connection failed.
	if got := e.query(`SELECT account_id, status, COALESCE(last_error, '-') FROM account_sources ORDER BY account_id`); got != "1 failed provider_error\n2 ok -" {
		t.Errorf("sources %q", got)
	}
	if got := e.query(`SELECT sync_status, last_error, background_attempts FROM provider_connections`); got != "failed provider_error 3" {
		t.Errorf("connection %q", got)
	}
	// The cap survives a restart; "Sync now" is not capped.
	e.restart()
	if n := e.nightly(at(18, 23, 30)); n != 0 {
		t.Errorf("after a restart: %d fetches", n)
	}
	if err := e.svc.Sync(context.Background(), 1, at(18, 23, 40)); err != nil || e.bank.count() != 8 {
		t.Errorf("Sync now after the cap: %v, %d fetches", err, e.bank.count())
	}
	e.bank.set(func(b *scriptBank) { delete(b.fail, "a1") })
	if n := e.nightly(at(19, 4, 0)); n != 2 {
		t.Errorf("the next day: %d fetches", n)
	}
	if got := e.query(`SELECT sync_status, COALESCE(last_error, '-') FROM provider_connections`); got != "ok -" {
		t.Errorf("connection %q", got)
	}
}

func TestNightlyLeavesAnExpiredSessionAlone(t *testing.T) {
	e := newSyncEnv(t)
	e.bank.set(func(b *scriptBank) { b.fail["a1"] = fmt.Errorf("EXPIRED_SESSION: %w", bank.ErrSessionExpired) })
	if n := e.nightly(at(18, 4, 0)); n != 1 {
		t.Errorf("first attempt: %d fetches", n)
	}
	for _, t2 := range []time.Time{at(18, 4, 30), at(18, 6, 0), at(19, 4, 0)} {
		if n := e.nightly(t2); n != 0 {
			t.Errorf("%v: an expired connection was retried", t2)
		}
	}
	if got := e.query(`SELECT status, last_error FROM provider_connections`); got != "expired session_expired" {
		t.Errorf("connection %q", got)
	}
}

func TestSyncNeverOverlaps(t *testing.T) {
	e := newSyncEnv(t)
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	e.bank.set(func(b *scriptBank) {
		b.hook = func() {
			once.Do(func() {
				close(entered)
				<-release
			})
		}
	})
	ctx := context.Background()
	manual := make(chan error, 1)
	go func() { manual <- e.svc.Sync(ctx, 1, at(18, 4, 0)) }()
	<-entered

	// The nightly job skips a connection that is syncing.
	if n := e.nightly(at(18, 4, 0)); n != 0 {
		t.Errorf("nightly during a manual sync: %d fetches", n)
	}
	// A second "Sync now" and a link callback wait for it instead of
	// fetching (here until their deadline).
	for name, f := range map[string]func(context.Context) error{
		"Sync now": func(ctx context.Context) error { return e.svc.Sync(ctx, 1, at(18, 4, 0)) },
		"callback": func(ctx context.Context) error { return e.svc.SyncConnection(ctx, 1, at(18, 4, 0)) },
	} {
		short, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		err := f(short)
		cancel()
		if !errors.Is(err, context.DeadlineExceeded) || e.bank.count() != 1 {
			t.Errorf("%s during a sync: %v, %d fetches", name, err, e.bank.count())
		}
	}
	close(release)
	if err := <-manual; err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SyncConnection(ctx, 1, at(18, 4, 0)); err != nil {
		t.Fatal(err)
	}
	e.bank.mu.Lock()
	fetches, most := e.bank.fetches, e.bank.most
	e.bank.mu.Unlock()
	if most != 1 || fetches != 4 {
		t.Errorf("%d fetches, %d at once", fetches, most)
	}
	if n := e.nightly(at(18, 4, 10)); n != 0 {
		t.Errorf("nightly after the manual sync: %d fetches", n)
	}
}

func TestSyncTwiceGivesTheSameData(t *testing.T) {
	e := newSyncEnv(t)
	e.bank.set(func(b *scriptBank) {
		b.txs["a1"] = []bank.Transaction{
			{ValueDate: "2026-11-17", Amount: -450, CounterpartyName: "Koffiebar", Status: bank.StatusPending},
			{EntryReference: "r2", BookingDate: "2026-11-12", Amount: -350, CounterpartyName: "Koffiebar", Status: bank.StatusBooked},
			{BookingDate: "2026-11-12", Amount: -350, CounterpartyName: "Koffiebar", Status: bank.StatusBooked},
			{BookingDate: "2026-11-12", Amount: -350, CounterpartyName: "Koffiebar", Status: bank.StatusBooked},
		}
	})
	dump := func() string {
		return e.query(`SELECT id, account_id, status, booking_date, amount, dedupe_key, occurrence FROM transactions ORDER BY id`) +
			"\n" + e.query(`SELECT id, account_id, balance, date, origin FROM balance_snapshots ORDER BY id`)
	}
	ctx := context.Background()
	if err := e.svc.Sync(ctx, 1, at(18, 10, 0)); err != nil {
		t.Fatal(err)
	}
	first := dump()
	if err := e.svc.Sync(ctx, 1, at(18, 11, 0)); err != nil {
		t.Fatal(err)
	}
	if again := dump(); again != first {
		t.Errorf("second sync changed the data:\n%s\n---\n%s", first, again)
	}
	if n := e.query(`SELECT COUNT(*) FROM transactions`); n != "4" {
		t.Errorf("%s rows", n)
	}
	if n := e.query(`SELECT COUNT(*) FROM balance_snapshots`); n != "2" {
		t.Errorf("%s snapshots, want one per account and day", n)
	}
}

// A fetch that fails changes nothing for that account, also not the pending
// rows the bank would no longer report.
func TestFailedFetchDeletesNothing(t *testing.T) {
	e := newSyncEnv(t)
	pending := bank.Transaction{ValueDate: "2026-11-17", Amount: -450, CounterpartyName: "Koffiebar", Status: bank.StatusPending}
	e.bank.set(func(b *scriptBank) { b.txs["a1"] = []bank.Transaction{pending} })
	ctx := context.Background()
	if err := e.svc.Sync(ctx, 1, at(18, 10, 0)); err != nil {
		t.Fatal(err)
	}
	before := e.query(`SELECT id, status, amount FROM transactions`)
	e.bank.set(func(b *scriptBank) {
		b.txs["a1"] = nil
		b.fail["a1"] = errors.New("halfway: page 2 timed out")
	})
	if err := e.svc.Sync(ctx, 1, at(18, 11, 0)); err != nil {
		t.Fatal(err)
	}
	if after := e.query(`SELECT id, status, amount FROM transactions`); after != before || before == "" {
		t.Errorf("rows %q → %q", before, after)
	}
	if got := e.query(`SELECT status, last_error FROM account_sources WHERE account_id = 1`); got != "failed provider_error" {
		t.Errorf("source %q", got)
	}
}
