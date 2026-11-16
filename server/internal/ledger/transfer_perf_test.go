package ledger_test

import (
	"context"
	"fmt"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// The per-row transfer match (plan 0.6-3, rule b) on a viewer with 20 000
// transactions: the list, the uncategorised count and its filter stay fast.
// The viewer's booked rows are materialised once per query and SQLite
// indexes them on the fly. The bound is loose; the timings are logged.
func TestTransferDetectionSpeed(t *testing.T) {
	if testing.Short() {
		t.Skip("seeds 20 000 rows")
	}
	ctx := context.Background()
	d, s := seeded(t)
	var accounts []int64
	rows, err := d.Query(`SELECT account_id FROM account_access WHERE user_id = ?`, bert)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		accounts = append(accounts, id)
	}
	rows.Close()
	tx, err := d.Begin()
	if err != nil {
		t.Fatal(err)
	}
	ins, err := tx.Prepare(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key)
		VALUES (?, ?, ?, 'Perf', 'booked', ?)`)
	if err != nil {
		t.Fatal(err)
	}
	r := rand.New(rand.NewPCG(1, 2))
	start := time.Date(2024, 11, 18, 0, 0, 0, 0, time.UTC)
	for i := range 20000 {
		date := start.AddDate(0, 0, r.IntN(730)).Format(time.DateOnly)
		amount := int64(r.IntN(20000)) - 10000 // about 27 rows a day, some opposite pairs
		if _, err := ins.Exec(accounts[i%len(accounts)], amount, date, fmt.Sprintf("perf-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	timed := func(name string, f func() error) {
		t.Helper()
		began := time.Now()
		if err := f(); err != nil {
			t.Fatal(err)
		}
		took := time.Since(began)
		t.Logf("%s: %v", name, took)
		if took > 2*time.Second {
			t.Errorf("%s took %v", name, took)
		}
	}
	timed("first page of 50", func() error {
		_, err := s.Transactions(ctx, bert, ledger.TxQuery{Limit: 50})
		return err
	})
	timed("uncategorised=1&limit=1", func() error {
		_, err := s.Transactions(ctx, bert, ledger.TxQuery{Uncategorised: true, Limit: 1})
		return err
	})
	timed("one day (as a write route's answer)", func() error {
		_, err := s.Transactions(ctx, bert, ledger.TxQuery{From: "2025-06-01", To: "2025-06-01", Limit: 1})
		return err
	})
	timed("UncategorisedCount", func() error {
		_, err := s.UncategorisedCount(ctx, bert)
		return err
	})
}
