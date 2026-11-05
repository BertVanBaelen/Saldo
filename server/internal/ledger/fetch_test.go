package ledger_test

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"slices"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

const fetchIBAN = "BE68539007547034" // a documentation example

// emptyAccount is a database with one user, connection and bank account (1).
func emptyAccount(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO users (id, email, display_name) VALUES (1, 'a@example.com', 'A')`,
		`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, status) VALUES (1, 1, 'fake', 'Argenta', 'active')`,
		`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, status) VALUES (2, 1, 'fake', 'Argenta', 'active')`,
		`INSERT INTO accounts (id, type, source, iban, name) VALUES (1, 'current', 'bank', '` + fetchIBAN + `', 'Zicht')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return d
}

type fetch struct {
	connection int64
	from       string
	txs        []bank.Transaction
}

func storeFetch(t *testing.T, d *sql.DB, f fetch) {
	t.Helper()
	ctx := context.Background()
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	conn := f.connection
	if conn == 0 {
		conn = 1
	}
	if _, err := ledger.StoreFetch(ctx, tx, 1, conn, f.from, ledger.Keyed(1, fetchIBAN, conn, f.txs)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// stored lists the account's rows as "status date amount name ref", sorted.
func stored(t *testing.T, d *sql.DB) []string {
	t.Helper()
	rows, err := d.Query(`SELECT status, booking_date, amount, counterparty_name, COALESCE(external_id, '') FROM transactions WHERE account_id = 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var status, date, name, ref string
		var amount int64
		if err := rows.Scan(&status, &date, &amount, &name, &ref); err != nil {
			t.Fatal(err)
		}
		out = append(out, fmt.Sprintf("%s %s %d %s %s", status, date, amount, name, ref))
	}
	slices.Sort(out)
	return out
}

func TestStoreFetch(t *testing.T) {
	coffee := bank.Transaction{BookingDate: "2026-11-10", Amount: -350, CounterpartyName: "Koffiebar", Communication: "Bancontact", Status: bank.StatusBooked}
	pending := coffee
	pending.Status = bank.StatusPending
	ref := func(t bank.Transaction, r string) bank.Transaction { t.EntryReference = r; return t }
	bread := bank.Transaction{EntryReference: "R1", BookingDate: "2026-11-12", Amount: -1230, CounterpartyName: "Bakkerij", Status: bank.StatusBooked}
	old := pending
	old.BookingDate = "2026-10-01"

	tests := []struct {
		name    string
		fetches []fetch
		want    []string
	}{
		{"the same fetch twice", []fetch{{txs: []bank.Transaction{coffee, ref(coffee, "R9"), pending}}, {txs: []bank.Transaction{coffee, ref(coffee, "R9"), pending}}},
			[]string{"booked 2026-11-10 -350 Koffiebar ", "booked 2026-11-10 -350 Koffiebar R9", "pending 2026-11-10 -350 Koffiebar "}},
		{"one coffee before, two in the overlapping fetch", []fetch{{txs: []bank.Transaction{coffee}}, {from: "2026-10-27", txs: []bank.Transaction{coffee, coffee}}, {from: "2026-10-27", txs: []bank.Transaction{coffee, coffee}}},
			[]string{"booked 2026-11-10 -350 Koffiebar ", "booked 2026-11-10 -350 Koffiebar "}},
		{"pending then booked with a reference", []fetch{{txs: []bank.Transaction{pending}}, {txs: []bank.Transaction{ref(coffee, "R1")}}},
			[]string{"booked 2026-11-10 -350 Koffiebar R1"}},
		{"pending then booked without a reference", []fetch{{txs: []bank.Transaction{pending}}, {txs: []bank.Transaction{coffee}}},
			[]string{"booked 2026-11-10 -350 Koffiebar "}},
		{"a pending row the bank drops", []fetch{{txs: []bank.Transaction{pending}}, {txs: nil}},
			[]string{}},
		{"one of two identical pending rows booked", []fetch{{txs: []bank.Transaction{pending, pending}}, {txs: []bank.Transaction{pending, coffee}}},
			[]string{"booked 2026-11-10 -350 Koffiebar ", "pending 2026-11-10 -350 Koffiebar "}},
		{"a pending row before the window stays", []fetch{{txs: []bank.Transaction{old}}, {from: "2026-11-01", txs: nil}},
			[]string{"pending 2026-10-01 -350 Koffiebar "}},
		{"another connection's pending row stays", []fetch{{connection: 2, txs: []bank.Transaction{pending}}, {txs: nil}},
			[]string{"pending 2026-11-10 -350 Koffiebar "}},
		{"a booked row is never deleted", []fetch{{txs: []bank.Transaction{ref(coffee, "R1"), coffee}}, {txs: nil}},
			[]string{"booked 2026-11-10 -350 Koffiebar ", "booked 2026-11-10 -350 Koffiebar R1"}},
		{"a reused reference is another transaction", []fetch{{txs: []bank.Transaction{ref(coffee, "R1")}}, {txs: []bank.Transaction{bread}}, {txs: []bank.Transaction{bread}}},
			[]string{"booked 2026-11-10 -350 Koffiebar R1", "booked 2026-11-12 -1230 Bakkerij R1"}},
		{"a changed reference is the same transaction", []fetch{{txs: []bank.Transaction{ref(coffee, "R1")}}, {txs: []bank.Transaction{ref(coffee, "R2")}}, {txs: []bank.Transaction{ref(coffee, "R2")}}},
			[]string{"booked 2026-11-10 -350 Koffiebar R1"}},
		{"a second identical coffee with its own reference", []fetch{{txs: []bank.Transaction{ref(coffee, "R1")}}, {txs: []bank.Transaction{ref(coffee, "R1"), ref(coffee, "R2")}}},
			[]string{"booked 2026-11-10 -350 Koffiebar R1", "booked 2026-11-10 -350 Koffiebar R2"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := emptyAccount(t)
			for _, f := range tt.fetches {
				storeFetch(t, d, f)
			}
			if got := stored(t, d); !slices.Equal(got, tt.want) {
				t.Errorf("stored\n%q\nwant\n%q", got, tt.want)
			}
		})
	}
}

// A pending row the bank still reports keeps its id.
func TestStoreFetchKeepsReportedPendingRows(t *testing.T) {
	d := emptyAccount(t)
	p := bank.Transaction{BookingDate: "2026-11-10", Amount: -350, CounterpartyName: "Koffiebar", Status: bank.StatusPending}
	storeFetch(t, d, fetch{txs: []bank.Transaction{p}})
	var before, after int64
	d.QueryRow(`SELECT id FROM transactions`).Scan(&before)
	storeFetch(t, d, fetch{txs: []bank.Transaction{p}})
	d.QueryRow(`SELECT id FROM transactions`).Scan(&after)
	if before == 0 || before != after {
		t.Errorf("id %d → %d", before, after)
	}
}
