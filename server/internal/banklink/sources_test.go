package banklink

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/secrets"
)

// Primary and fallback sources (plan 0.6-1d). logBank answers per session
// and provider account ("s1/p") and logs every call, so a test asserts which
// source was asked for what.
type logBank struct {
	mu   sync.Mutex
	txs  map[string][]bank.Transaction // by "session/account"
	fail map[string]error              // by session, or by "session/account"
	log  []string
	hook func(session string) // runs at the start of every transaction fetch, outside the lock
}

func (b *logBank) CheckApplication(context.Context) error { return nil }
func (b *logBank) StartAuth(context.Context, string, string, string, string, time.Time) (string, error) {
	return "", nil
}
func (b *logBank) CreateSession(context.Context, string) (bank.SessionInfo, error) {
	return bank.SessionInfo{}, nil
}
func (b *logBank) ListAccounts(context.Context, bank.Session) ([]bank.Account, error) {
	return nil, nil
}

func (b *logBank) FetchTransactions(_ context.Context, s bank.Session, id, from, to string) ([]bank.Transaction, error) {
	b.mu.Lock()
	b.log = append(b.log, fmt.Sprintf("tx %s/%s %s..%s", s.ID, id, from, to))
	hook := b.hook
	b.mu.Unlock()
	if hook != nil {
		hook(s.ID)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := cmp.Or(b.fail[s.ID], b.fail[s.ID+"/"+id]); err != nil {
		return nil, err
	}
	return append([]bank.Transaction(nil), b.txs[s.ID+"/"+id]...), nil
}

func (b *logBank) FetchBalances(_ context.Context, s bank.Session, id string) ([]bank.Balance, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.log = append(b.log, "bal "+s.ID+"/"+id)
	return []bank.Balance{{Amount: 1000, Date: "2026-11-15", Type: "CLBD"}}, nil
}

func (b *logBank) set(f func(b *logBank)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	f(b)
}

// take returns the calls since the last take.
func (b *logBank) take() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := strings.Join(b.log, "\n")
	b.log = nil
	return out
}

// both gives the primary ("s<primary>/p") and the fallback
// ("s<fallback>/f") the same rows: both consents report the same bookings.
func (e *srcEnv) both(rows ...bank.Transaction) {
	e.bank.set(func(b *logBank) {
		b.txs[e.sess(e.primary)+"/p"] = rows
		b.txs[e.sess(e.fallback)+"/f"] = rows
	})
}

type srcEnv struct {
	*syncEnv
	bank              *logBank
	primary, fallback int64 // connection ids
	store             *ledger.Store
}

func (e *srcEnv) sess(conn int64) string { return fmt.Sprintf("s%d", conn) }

// newSrcEnv: Bert (user 1) manages the shared account 1 (IBAN BE71...6769),
// fed by his connection primary (provider id "p"); Partner (user 2) joined
// it later through her connection fallback (provider id "f").
func newSrcEnv(t *testing.T, primary, fallback int64) *srcEnv {
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
	e := &srcEnv{syncEnv: &syncEnv{t: t, db: d, box: box}, primary: primary, fallback: fallback, store: ledger.New(d),
		bank: &logBank{txs: map[string][]bank.Transaction{}, fail: map[string]error{}}}
	for _, q := range []string{
		`INSERT INTO users (id, email, display_name) VALUES (1, 'bert@example.com', 'Bert'), (2, 'partner@example.com', 'Partner')`,
		`INSERT INTO accounts (id, type, source, iban, name) VALUES (1, 'current', 'bank', 'BE71096123456769', 'Gezin')`,
		`INSERT INTO account_access (account_id, user_id, role, permission, joined_at) VALUES
			(1, 1, 'manager', 'edit', '2026-06-01T10:00:00Z'), (1, 2, 'member', 'edit', '2026-06-05T10:00:00Z')`,
		`INSERT INTO categories (id, name, type) VALUES (50, 'Boodschappen', 'expense')`,
	} {
		e.exec(q)
	}
	for _, c := range []struct {
		id, user int64
	}{{primary, 1}, {fallback, 2}} {
		e.exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, application_id, session_id_enc, status, valid_until)
			VALUES (?, ?, 'enablebanking', 'Argenta', 'app', ?, 'active', '2027-05-01T10:00:00Z')`, c.id, c.user, box.Seal([]byte(e.sess(c.id))))
	}
	e.exec(`INSERT INTO account_sources (account_id, connection_id, priority, external_account_id) VALUES (1, ?, 'primary', 'p'), (1, ?, 'fallback', 'f')`,
		primary, fallback)
	e.svc = New(d, box, func(int64, string, []byte) (Client, error) { return e.bank, nil }, nil, nil)
	return e
}

func (e *srcEnv) exec(q string, args ...any) {
	e.t.Helper()
	if _, err := e.db.Exec(q, args...); err != nil {
		e.t.Fatalf("%s: %v", q, err)
	}
}

// night runs the nightly job and returns the bank calls it made, in order.
func (e *srcEnv) night(t time.Time) string {
	e.t.Helper()
	e.bank.take()
	if err := e.svc.Nightly(context.Background(), t); err != nil {
		e.t.Fatal(err)
	}
	return e.bank.take()
}

// fetchedBy are the sessions whose transactions a log fetched, sorted.
func fetchedBy(log string) string {
	var out []string
	for _, l := range strings.Split(log, "\n") {
		if s, ok := strings.CutPrefix(l, "tx "); ok {
			out = append(out, s[:strings.Index(s, "/")])
		}
	}
	slices.Sort(out)
	return strings.Join(out, " ")
}

func (e *srcEnv) account(viewer int64, now time.Time) ledger.Account {
	e.t.Helper()
	a, err := e.store.Account(context.Background(), viewer, 1, now)
	if err != nil {
		e.t.Fatal(err)
	}
	return a
}

// carried is the account as viewer sees who carries it: "Partner me=false via=true".
func (e *srcEnv) carried(viewer int64, now time.Time) string {
	a := e.account(viewer, now)
	if a.CarriedBy == nil {
		return fmt.Sprintf("nobody via=%v", a.ViaReserve)
	}
	return fmt.Sprintf("%s me=%v via=%v", a.CarriedBy.Name, a.CarriedBy.Me, a.ViaReserve)
}

// noDuplicates fails when one booking is stored twice.
func (e *srcEnv) noDuplicates() {
	e.t.Helper()
	if got := e.query(`SELECT booking_date || ' ' || amount || ' ' || counterparty_name || ' x' || COUNT(*) FROM transactions
		WHERE account_id = 1 GROUP BY booking_date, amount, counterparty_name, communication, status HAVING COUNT(*) > 1`); got != "" {
		e.t.Errorf("duplicates: %s", got)
	}
}

func book(ref, date string, amount int64, name string) bank.Transaction {
	return bank.Transaction{EntryReference: ref, BookingDate: date, ValueDate: date, Amount: amount, CounterpartyName: name, Status: bank.StatusBooked}
}

func pend(valueDate string, amount int64, name string) bank.Transaction {
	return bank.Transaction{ValueDate: valueDate, Amount: amount, CounterpartyName: name, Status: bank.StatusPending}
}

// A one-link account syncs exactly as before 0.6-1d: per account its
// transactions from 14 days before its newest row, then its balance; nothing
// else is asked.
func TestOneLinkAccountCallLog(t *testing.T) {
	e := newSyncEnv(t)
	lb := &logBank{txs: map[string][]bank.Transaction{
		"sess/a1": {book("r1", "2026-11-10", -100, "Bakker")},
		"sess/a2": {book("r2", "2026-11-12", -200, "Slager")},
	}, fail: map[string]error{}}
	e.svc = New(e.db, e.box, func(int64, string, []byte) (Client, error) { return lb, nil }, nil, nil)
	if err := e.svc.Nightly(context.Background(), at(18, 4, 0)); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Nightly(context.Background(), at(19, 4, 0)); err != nil {
		t.Fatal(err)
	}
	want := strings.Join([]string{
		"tx sess/a1 ..2026-11-18", "bal sess/a1", "tx sess/a2 ..2026-11-18", "bal sess/a2",
		"tx sess/a1 2026-10-27..2026-11-19", "bal sess/a1", "tx sess/a2 2026-10-29..2026-11-19", "bal sess/a2",
	}, "\n")
	if got := lb.take(); got != want {
		t.Errorf("calls:\n%s\nwant:\n%s", got, want)
	}
	if got := e.query(`SELECT account_id, status, COALESCE(last_error, '-'), last_sync_at FROM account_sources ORDER BY account_id`); got != "1 ok - 2026-11-19T03:00:00Z\n2 ok - 2026-11-19T03:00:00Z" {
		t.Errorf("sources %q", got)
	}
	if got := e.query(`SELECT sync_status, last_sync_at FROM provider_connections`); got != "ok 2026-11-19T03:00:00Z" {
		t.Errorf("connection %q", got)
	}
	if n := e.query(`SELECT COUNT(*) FROM transactions`); n != "2" {
		t.Errorf("%s rows", n)
	}
}

// While the primary works the fallback is never called, and the idle
// fallback is no problem: the account is not stale, nobody gets an alert,
// and the fallback's connection ends ok.
func TestIdleFallbackIsNotAProblem(t *testing.T) {
	e := newSrcEnv(t, 1, 2)
	e.both(book("r1", "2026-11-14", -1200, "Bakker"))
	for day := 16; day <= 20; day++ {
		if got := e.night(at(day, 4, 0)); fetchedBy(got) != "s1" {
			t.Errorf("night %d: %q", day, got)
		}
	}
	now := at(20, 12, 0)
	if got := e.query(`SELECT COALESCE(last_sync_at, '-'), COALESCE(last_attempt_at, '-') FROM account_sources WHERE connection_id = 2`); got != "- -" {
		t.Errorf("the fallback was touched: %q", got)
	}
	for _, viewer := range []int64{1, 2} {
		a := e.account(viewer, now)
		if *a.SyncStatus != "ok" || a.SyncError != nil || *a.LastSync != "2026-11-20T04:00:00+01:00" {
			t.Errorf("user %d: %s %v %s", viewer, *a.SyncStatus, a.SyncError, *a.LastSync)
		}
		alerts, err := e.store.Alerts(context.Background(), viewer, now)
		if err != nil {
			t.Fatal(err)
		}
		for _, al := range alerts {
			if al.Type == "sync" || al.Type == "consent" {
				t.Errorf("user %d: alert %+v", viewer, al)
			}
		}
		conns, err := e.store.Connections(context.Background(), viewer, now)
		if err != nil {
			t.Fatal(err)
		}
		// What the "Synchronisatie gestopt" mail and the alerts read.
		if len(conns) != 1 || conns[0].Status != ledger.ConnOK || conns[0].Stopped(now) {
			t.Errorf("user %d: connection %+v", viewer, conns)
		}
	}
	if got := e.carried(1, now) + " / " + e.carried(2, now); got != "Bert me=true via=false / Bert me=false via=false" {
		t.Errorf("carried: %s", got)
	}
	if r := e.account(2, now).SourceRole; r == nil || *r != "reserve" {
		t.Errorf("Partner's role: %v", r)
	}
}

// The ways a primary stops, each decided on the state stored before the run.
var stops = []struct {
	name        string
	takesNight  int // the first night the fallback fetches
	stop, heal  func(e *srcEnv)
	primaryRuns bool // the primary's connection still syncs (and skips the account)
}{
	{"consent lapsed", 17,
		func(e *srcEnv) {
			e.exec(`UPDATE provider_connections SET valid_until = '2026-11-16T20:00:00Z' WHERE id = ?`, e.primary)
		},
		func(e *srcEnv) {
			e.exec(`UPDATE provider_connections SET valid_until = '2027-05-18T10:00:00Z' WHERE id = ?`, e.primary)
		}, true},
	{"expired", 17,
		func(e *srcEnv) {
			// As broken() leaves it after a lapsed session.
			e.exec(`UPDATE provider_connections SET status = 'expired', last_error = 'session_expired' WHERE id = ?`, e.primary)
			e.exec(`UPDATE account_sources SET status = 'failed', last_error = 'session_expired', last_attempt_at = '2026-11-16T19:00:00Z' WHERE connection_id = ?`, e.primary)
		},
		func(e *srcEnv) { // re-authorised: storeConsent
			e.exec(`UPDATE provider_connections SET status = 'active', consent_since = '2026-11-18' WHERE id = ?`, e.primary)
		}, false},
	{"not shared", 17,
		func(e *srcEnv) { // a new consent without the account
			e.exec(`UPDATE account_sources SET external_account_id = NULL WHERE connection_id = ?`, e.primary)
		},
		func(e *srcEnv) { // a new consent with it
			e.exec(`UPDATE account_sources SET external_account_id = 'p' WHERE connection_id = ?`, e.primary)
		}, true},
	{"failing", 18,
		func(e *srcEnv) {
			e.bank.set(func(b *logBank) { b.fail[e.sess(e.primary)] = errors.New("bank down") })
		},
		func(e *srcEnv) { e.bank.set(func(b *logBank) { delete(b.fail, e.sess(e.primary)) }) }, true},
}

// When the primary stops, the fallback fetches from the account's newest
// booking minus the overlap, fills the gap without duplicates and takes the
// pending rows over (their category and note go to the booked row); when the
// primary is back it carries again and the pending rows follow it. The same
// whether the fallback's connection id is lower or higher than the primary's.
func TestFallbackTakesOverAndHandsBack(t *testing.T) {
	for _, s := range stops {
		for _, ids := range [][2]int64{{1, 2}, {2, 1}} {
			t.Run(fmt.Sprintf("%s/primary %d", s.name, ids[0]), func(t *testing.T) {
				e := newSrcEnv(t, ids[0], ids[1])
				ps, fs := e.sess(e.primary), e.sess(e.fallback)
				r1 := book("r1", "2026-11-14", -1200, "Bakker")
				e.both(r1, pend("2026-11-16", -450, "Koffiebar"))
				if got := e.night(at(16, 4, 0)); fetchedBy(got) != ps {
					t.Fatalf("night 16: %q", got)
				}
				// The user notes and categorises the pending row.
				e.exec(`UPDATE transactions SET note = 'voor Jan', category_id = 50, category_origin = 'manual' WHERE status = 'pending'`)

				s.stop(e)
				// The pending coffee is booked, a new pending row and a new booking.
				gap := []bank.Transaction{r1, book("r2", "2026-11-17", -450, "Koffiebar"),
					book("r3", "2026-11-17", -3000, "Garage"), pend("2026-11-18", -999, "Slager")}
				e.both(gap...)
				for day := 17; day <= 18; day++ {
					want := fs
					if day < s.takesNight {
						want = ps // still the carrier: tried, failed
					}
					got := e.night(at(day, 4, 0))
					if fetchedBy(got) != want {
						t.Errorf("night %d: %q, want only %s", day, got, want)
					}
					if day == s.takesNight && !strings.Contains(got, "tx "+fs+"/f 2026-11-02..") {
						t.Errorf("takeover from the newest booking (16 Nov) minus 14 days: %q", got)
					}
				}
				e.noDuplicates()
				if got := e.query(`SELECT status, booking_date, amount, COALESCE(note, '-'), COALESCE(category_id, 0), COALESCE(source_connection_id, 0) FROM transactions ORDER BY booking_date, amount`); got !=
					"booked 2026-11-14 -1200 - 0 "+fmt.Sprint(e.primary)+"\n"+
						"booked 2026-11-17 -3000 - 0 "+fmt.Sprint(e.fallback)+"\n"+
						"booked 2026-11-17 -450 voor Jan 50 "+fmt.Sprint(e.fallback)+"\n"+
						"pending 2026-11-18 -999 - 0 "+fmt.Sprint(e.fallback) {
					t.Errorf("rows after the takeover:\n%s", got)
				}
				now := at(18, 12, 0)
				if got := e.carried(1, now) + " / " + e.carried(2, now); got != "Partner me=false via=true / Partner me=true via=true" {
					t.Errorf("carried: %s", got)
				}
				for _, viewer := range []int64{1, 2} {
					if a := e.account(viewer, now); *a.SyncStatus != "ok" || a.SyncError != nil {
						t.Errorf("user %d: %s %v", viewer, *a.SyncStatus, a.SyncError)
					}
				}
				if s.primaryRuns {
					// Bert's own link is broken and says so, to him only.
					if got := e.query(fmt.Sprintf(`SELECT sync_status FROM provider_connections WHERE id = %d`, e.primary)); got != "failed" && s.name != "not shared" {
						t.Errorf("primary connection: %s", got)
					}
				}
				if got := e.query(fmt.Sprintf(`SELECT sync_status FROM provider_connections WHERE id = %d`, e.fallback)); got != "ok" {
					t.Errorf("fallback connection: %s", got)
				}

				// The user notes the new pending row; the primary is back.
				e.exec(`UPDATE transactions SET note = 'gehakt' WHERE status = 'pending'`)
				s.heal(e)
				e.both(r1, book("r2", "2026-11-17", -450, "Koffiebar"), book("r3", "2026-11-17", -3000, "Garage"),
					book("r4", "2026-11-19", -999, "Slager"))
				if got := e.night(at(19, 4, 0)); fetchedBy(got) != ps {
					t.Errorf("night 19: %q, want only %s", got, ps)
				}
				e.noDuplicates()
				if got := e.query(`SELECT status, booking_date, amount, COALESCE(note, '-') FROM transactions WHERE booking_date >= '2026-11-18'`); got != "booked 2026-11-19 -999 gehakt" {
					t.Errorf("the pending row followed the primary: %q", got)
				}
				if n := e.query(`SELECT COUNT(*) FROM transactions`); n != "4" {
					t.Errorf("%s rows, want 4", n)
				}
				if got := e.carried(1, at(19, 12, 0)); got != "Bert me=true via=false" {
					t.Errorf("carried after the return: %s", got)
				}
				if got := e.query(`SELECT COUNT(*) FROM account_sources WHERE last_error = 'store_failed'`); got != "0" {
					t.Errorf("store_failed: %s", got)
				}
			})
		}
	}
}

// A fallback that was promoted to primary (connection 2) never synced; the
// ex-primary linked again and is a fallback now (connection 1, the lower
// id): only one source fetches.
func TestPromotedPrimaryThatNeverSynced(t *testing.T) {
	e := newSrcEnv(t, 2, 1)
	e.exec(`UPDATE account_sources SET last_sync_at = NULL, last_attempt_at = NULL WHERE account_id = 1`)
	e.both(book("r1", "2026-11-14", -1200, "Bakker"))
	if got := e.night(at(16, 4, 0)); fetchedBy(got) != "s2" {
		t.Errorf("night 16: %q", got)
	}
	// The promoted primary had been marked not_shared once while it was a
	// fallback: its consent lists the account now, so that does not stop it.
	e.exec(`UPDATE account_sources SET status = 'failed', last_error = 'not_shared', last_sync_at = NULL WHERE connection_id = 2`)
	if got := e.night(at(18, 4, 0)); fetchedBy(got) != "s2" {
		t.Errorf("night 18: %q", got)
	}
}

// A primary that has been failing for more than StaleAfter is skipped while
// a fallback carries, and tried again once its last attempt is older than
// StaleAfter. Two syncs at once that straddle that moment both decide to
// carry (one picks the fallback, the other the primary): they store one after
// the other, without duplicates or store_failed. A plain parallel run of both
// connections fetches the account once.
func TestTwoSourcesAtOnce(t *testing.T) {
	rows := []bank.Transaction{book("r1", "2026-11-14", -1200, "Bakker"), book("r2", "2026-11-15", -300, "Bakker"),
		pend("2026-11-17", -450, "Koffiebar")}
	setup := func(t *testing.T) *srcEnv {
		e := newSrcEnv(t, 1, 2)
		e.both(rows...)
		e.night(at(16, 4, 0))
		return e
	}

	t.Run("same moment", func(t *testing.T) {
		e := setup(t)
		e.bank.take()
		var wg sync.WaitGroup
		errs := make(chan error, 2)
		for _, c := range []int64{1, 2} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				errs <- e.svc.SyncConnection(context.Background(), c, at(16, 12, 0))
			}()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatal(err)
			}
		}
		if got := e.bank.take(); fetchedBy(got) != "s1" {
			t.Errorf("calls: %q", got)
		}
	})

	t.Run("straddling the retry", func(t *testing.T) {
		e := setup(t)
		// Failing since the 16th: last good sync 16 04:00, last attempt 17 04:00.
		e.exec(`UPDATE account_sources SET status = 'failed', last_error = 'ASPSP_ERROR', last_attempt_at = '2026-11-17T03:00:00Z' WHERE connection_id = 1`)
		e.bank.take()
		both := make(chan struct{})
		var arrived sync.WaitGroup
		arrived.Add(2)
		go func() { arrived.Wait(); close(both) }()
		e.bank.set(func(b *logBank) {
			b.hook = func(string) {
				arrived.Done()
				select {
				case <-both:
				case <-time.After(5 * time.Second):
				}
			}
		})
		var wg sync.WaitGroup
		errs := make(chan error, 2)
		for _, run := range []struct {
			conn int64
			at   time.Time
		}{
			{2, at(18, 15, 0)}, // attempt 35 hours ago: the primary is stopped, the fallback carries
			{1, at(18, 17, 0)}, // 37 hours ago: the primary is tried again
		} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				errs <- e.svc.SyncConnection(context.Background(), run.conn, run.at)
			}()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatal(err)
			}
		}
		select {
		case <-both:
		default:
			t.Fatal("the two syncs did not fetch at the same time")
		}
		if got := e.bank.take(); fetchedBy(got) != "s1 s2" {
			t.Errorf("calls: %q", got)
		}
		e.noDuplicates()
		if n := e.query(`SELECT COUNT(*) FROM transactions`); n != "3" {
			t.Errorf("%s rows, want 3", n)
		}
		if got := e.query(`SELECT connection_id, status, COALESCE(last_error, '-') FROM account_sources ORDER BY connection_id`); got != "1 ok -\n2 ok -" {
			t.Errorf("sources:\n%s", got)
		}
		if got := e.query(`SELECT COUNT(DISTINCT source_connection_id) FROM transactions WHERE status = 'pending'`); got != "1" {
			t.Errorf("pending rows' sources: %s", got)
		}
	})
}

// Two consents, one booking: what dedupe does with their entry references
// (plan 0.6-1d point 8, to verify with real data).
func TestTakeoverReferences(t *testing.T) {
	stopPrimary := func(e *srcEnv) {
		e.exec(`UPDATE provider_connections SET valid_until = '2026-11-16T20:00:00Z' WHERE id = 1`)
	}
	healPrimary := func(e *srcEnv) {
		e.exec(`UPDATE provider_connections SET valid_until = '2027-05-18T10:00:00Z' WHERE id = 1`)
	}
	t.Run("references differ", func(t *testing.T) {
		e := newSrcEnv(t, 1, 2)
		e.bank.set(func(b *logBank) { b.txs["s1/p"] = []bank.Transaction{book("p-1", "2026-11-14", -1200, "Bakker")} })
		e.night(at(16, 4, 0))
		stopPrimary(e)
		// The same booking under the fallback's own reference, and a new one.
		e.bank.set(func(b *logBank) {
			b.txs["s2/f"] = []bank.Transaction{book("f-1", "2026-11-14", -1200, "Bakker"), book("f-2", "2026-11-17", -300, "Garage")}
		})
		if got := e.night(at(17, 4, 0)); fetchedBy(got) != "s2" {
			t.Fatalf("night 17: %q", got)
		}
		// The primary is back and lists both under its references.
		healPrimary(e)
		e.bank.set(func(b *logBank) {
			b.txs["s1/p"] = []bank.Transaction{book("p-1", "2026-11-14", -1200, "Bakker"), book("p-2", "2026-11-17", -300, "Garage")}
		})
		if got := e.night(at(18, 4, 0)); fetchedBy(got) != "s1" {
			t.Fatalf("night 18: %q", got)
		}
		// checkReference takes a new reference on a stored booking with the
		// same content whose own reference this fetch does not list as the
		// same booking re-referenced: no duplicates either way.
		if got := e.query(`SELECT external_id, booking_date, amount FROM transactions ORDER BY id`); got != "p-1 2026-11-14 -1200\nf-2 2026-11-17 -300" {
			t.Errorf("rows:\n%s", got)
		}
	})
	t.Run("two identical bookings on one day", func(t *testing.T) {
		e := newSrcEnv(t, 1, 2)
		// Two coffees on the 17th; the primary had only the first one.
		e.bank.set(func(b *logBank) { b.txs["s1/p"] = []bank.Transaction{book("p-1", "2026-11-17", -300, "Koffiebar")} })
		e.night(at(17, 4, 0))
		stopPrimary(e)
		e.bank.set(func(b *logBank) {
			b.txs["s2/f"] = []bank.Transaction{book("f-1", "2026-11-17", -300, "Koffiebar"), book("f-2", "2026-11-17", -300, "Koffiebar")}
		})
		e.night(at(18, 4, 0))
		// Both fallback rows match the stored coffee by content, whose
		// reference the fallback does not list: the second coffee collapses
		// into the first and is missing while the fallback carries.
		if n := e.query(`SELECT COUNT(*) FROM transactions`); n != "1" {
			t.Errorf("while the fallback carries: %s coffees, documented as 1", n)
		}
		// The primary is back and lists both: the second one arrives.
		healPrimary(e)
		e.bank.set(func(b *logBank) {
			b.txs["s1/p"] = []bank.Transaction{book("p-1", "2026-11-17", -300, "Koffiebar"), book("p-2", "2026-11-17", -300, "Koffiebar")}
		})
		e.night(at(19, 4, 0))
		if got := e.query(`SELECT external_id FROM transactions ORDER BY id`); got != "p-1\np-2" {
			t.Errorf("after the primary is back: %q", got)
		}
	})
	t.Run("identical bookings without references", func(t *testing.T) {
		e := newSrcEnv(t, 1, 2)
		coffee := book("", "2026-11-17", -300, "Koffiebar")
		e.bank.set(func(b *logBank) { b.txs["s1/p"] = []bank.Transaction{coffee} })
		e.night(at(17, 4, 0))
		stopPrimary(e)
		e.bank.set(func(b *logBank) { b.txs["s2/f"] = []bank.Transaction{coffee, coffee} })
		e.night(at(18, 4, 0))
		// The content key and its occurrence number count them: 2.
		if n := e.query(`SELECT COUNT(*) FROM transactions`); n != "2" {
			t.Errorf("%s coffees, want 2", n)
		}
	})
}

// Tonight's outcome never decides the carrier: a primary that fails (or
// whose session lapses) in this run, after a downtime that left its last
// good sync older than StaleAfter, was tonight's carrier for a fallback
// connection that syncs after it as well as before it.
func TestTonightsOutcomeDoesNotCount(t *testing.T) {
	for _, fail := range []error{errors.New("bank down"), fmt.Errorf("EXPIRED: %w", bank.ErrSessionExpired)} {
		for _, ids := range [][2]int64{{1, 2}, {2, 1}} {
			t.Run(fmt.Sprintf("%v/primary %d", fail, ids[0]), func(t *testing.T) {
				e := newSrcEnv(t, ids[0], ids[1])
				e.both(book("r1", "2026-11-14", -1200, "Bakker"))
				e.night(at(16, 4, 0))
				// Saldo was off on the 17th; on the 18th the primary fails.
				e.bank.set(func(b *logBank) { b.fail[e.sess(e.primary)] = fail })
				if got := e.night(at(18, 4, 0)); fetchedBy(got) != e.sess(e.primary) {
					t.Errorf("night 18: %q, want only the primary", got)
				}
			})
		}
	}
}

// The same for a fallback that carries and whose session lapses in this run:
// a stopped primary that syncs after it does not step in that night.
func TestTonightsFallbackOutcomeDoesNotCount(t *testing.T) {
	for _, ids := range [][2]int64{{1, 2}, {2, 1}} {
		t.Run(fmt.Sprintf("primary %d", ids[0]), func(t *testing.T) {
			e := newSrcEnv(t, ids[0], ids[1])
			e.both(book("r1", "2026-11-14", -1200, "Bakker"))
			e.night(at(16, 4, 0))
			// The primary has been failing since: stopped.
			e.exec(`UPDATE account_sources SET status = 'failed', last_error = 'ASPSP_ERROR', last_attempt_at = '2026-11-17T03:00:00Z' WHERE connection_id = ?`, e.primary)
			e.bank.set(func(b *logBank) { b.fail[e.sess(e.fallback)] = fmt.Errorf("EXPIRED: %w", bank.ErrSessionExpired) })
			if got := e.night(at(18, 4, 0)); fetchedBy(got) != e.sess(e.fallback) {
				t.Errorf("night 18: %q, want only the fallback", got)
			}
		})
	}
}

// A connection-wide failure (a lapsed session on another account of the
// primary's link, or credentials that cannot be unsealed) does not stamp the
// stopped primary it skipped: the fallback takes over the same night in both
// id orders. Bert's link also feeds his own account 2 (provider id "p2").
func TestBrokenPrimaryConnectionLeavesTheSkippedRow(t *testing.T) {
	cases := []struct {
		name  string
		night int // the night the fallback fetches
		stop  func(e *srcEnv)
	}{
		{"consent lapsed, session expired on the other account", 17, func(e *srcEnv) {
			e.exec(`UPDATE provider_connections SET valid_until = '2026-11-16T20:00:00Z' WHERE id = ?`, e.primary)
			e.bank.set(func(b *logBank) { b.fail[e.sess(e.primary)+"/p2"] = fmt.Errorf("EXPIRED: %w", bank.ErrSessionExpired) })
		}},
		{"credentials unreadable", 18, func(e *srcEnv) {
			e.exec(`UPDATE provider_connections SET session_id_enc = X'00' WHERE id = ?`, e.primary)
		}},
	}
	for _, c := range cases {
		for _, ids := range [][2]int64{{1, 2}, {2, 1}} {
			t.Run(fmt.Sprintf("%s/primary %d", c.name, ids[0]), func(t *testing.T) {
				e := newSrcEnv(t, ids[0], ids[1])
				e.exec(`INSERT INTO accounts (id, type, source, iban, name) VALUES (2, 'current', 'bank', 'BE68539007547034', 'Zicht')`)
				e.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (2, 1, 'manager', 'edit')`)
				e.exec(`INSERT INTO account_sources (account_id, connection_id, priority, external_account_id) VALUES (2, ?, 'primary', 'p2')`, e.primary)
				e.both(book("r1", "2026-11-14", -1200, "Bakker"))
				if got := e.night(at(16, 4, 0)); fetchedBy(got) != e.sess(e.primary)+" "+e.sess(e.primary) {
					t.Fatalf("night 16: %q", got)
				}
				c.stop(e)
				for day := 17; day <= c.night; day++ {
					got := fetchedBy(e.night(at(day, 4, 0)))
					if day == c.night && !strings.Contains(got, e.sess(e.fallback)) {
						t.Errorf("night %d: %q, want the fallback", day, got)
					}
				}
				if got := e.carried(1, at(c.night, 12, 0)); got != "Partner me=false via=true" {
					t.Errorf("carried: %s", got)
				}
			})
		}
	}
}
