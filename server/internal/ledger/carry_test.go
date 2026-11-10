package ledger_test

import (
	"database/sql"
	"fmt"
	"slices"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// edit is what the user set on a stored row before the next fetch.
type edit struct {
	name, date string
	category   any
	origin     any
	note       any
}

// carryState lists every row as "account status date amount name category origin note", sorted.
func carryState(t *testing.T, d *sql.DB) []string {
	t.Helper()
	rows, err := d.Query(`SELECT account_id, status, booking_date, amount, counterparty_name,
		COALESCE(category_id, '-'), COALESCE(category_origin, '-'), COALESCE(note, '-') FROM transactions`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var account, amount int64
		var status, date, name, cat, origin, note string
		if err := rows.Scan(&account, &status, &date, &amount, &name, &cat, &origin, &note); err != nil {
			t.Fatal(err)
		}
		out = append(out, fmt.Sprintf("%d %s %s %d %s %s %s %s", account, status, date, amount, name, cat, origin, note))
	}
	slices.Sort(out)
	return out
}

func carryDB(t *testing.T) *sql.DB {
	d := emptyAccount(t)
	for _, q := range []string{
		`INSERT INTO categories (id, name, type, colour) VALUES (1, 'Boodschappen', 'expense', 'c2'), (2, 'Overig', 'expense', 'c6')`,
		`INSERT INTO accounts (id, type, source, name) VALUES (2, 'current', 'manual', 'Ander')`,
		// Another account's pending row with the same content: never touched.
		`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id, category_origin, note)
		 VALUES (2, -1000, '2026-11-10', 'Winkel', 'pending', 'other', 2, 'manual', 'van een ander')`,
		// An unrelated manual row and a rule row of the account itself.
		`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id, category_origin)
		 VALUES (1, -1000, '2026-11-09', 'Winkel', 'booked', 'manual-old', 2, 'manual'),
		        (1, -2000, '2026-11-09', 'Garage', 'booked', 'rule-old', 1, 'rule')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	return d
}

// Carry-over (plan 0.4-3, step 7): a choice on a pending row reaches its
// booked row when the bank books it, and nothing else moves.
func TestCarryPendingToBooked(t *testing.T) {
	pending := func(date, name string, amount int64) bank.Transaction {
		return bank.Transaction{BookingDate: date, Amount: amount, CounterpartyName: name, Status: bank.StatusPending}
	}
	booked := func(ref, date, name string, amount int64) bank.Transaction {
		return bank.Transaction{EntryReference: ref, BookingDate: date, Amount: amount, CounterpartyName: name, Status: bank.StatusBooked}
	}
	manual := func(date string, cat int, note string) edit {
		return edit{"Winkel", date, cat, "manual", note}
	}
	fixed := []string{ // the rows of carryDB, unchanged in every case
		"1 booked 2026-11-09 -1000 Winkel 2 manual -",
		"1 booked 2026-11-09 -2000 Garage 1 rule -",
		"2 pending 2026-11-10 -1000 Winkel 2 manual van een ander",
	}
	tests := []struct {
		name   string
		first  []bank.Transaction
		edits  []edit
		second []bank.Transaction
		rule   bool // an account rule "winkel" with category 1
		want   []string
	}{
		{"manual category and note", []bank.Transaction{pending("2026-11-10", "Winkel", -1000)}, []edit{manual("2026-11-10", 2, "cadeau")},
			[]bank.Transaction{booked("R1", "2026-11-12", "Winkel", -1000)}, false,
			[]string{"1 booked 2026-11-12 -1000 Winkel 2 manual cadeau"}},
		{"a manual category beats a rule on the booked row", []bank.Transaction{pending("2026-11-10", "Winkel", -1000)}, []edit{manual("2026-11-10", 2, "")},
			[]bank.Transaction{booked("R1", "2026-11-12", "Winkel", -1000)}, true,
			[]string{"1 booked 2026-11-12 -1000 Winkel 2 manual -"}},
		{"note only", []bank.Transaction{pending("2026-11-10", "Winkel", -1000)}, []edit{{"Winkel", "2026-11-10", nil, nil, "terug te vragen"}},
			[]bank.Transaction{booked("R1", "2026-11-12", "Winkel", -1000)}, false,
			[]string{"1 booked 2026-11-12 -1000 Winkel - - terug te vragen"}},
		{"a rule's category is not carried as manual", []bank.Transaction{pending("2026-11-10", "Winkel", -1000)}, []edit{{"Winkel", "2026-11-10", 2, "rule", nil}},
			[]bank.Transaction{booked("R1", "2026-11-12", "Winkel", -1000)}, true,
			[]string{"1 booked 2026-11-12 -1000 Winkel 1 rule -"}},
		{"another amount", []bank.Transaction{pending("2026-11-10", "Winkel", -1000)}, []edit{manual("2026-11-10", 2, "x")},
			[]bank.Transaction{booked("R1", "2026-11-12", "Winkel", -1001)}, false,
			[]string{"1 booked 2026-11-12 -1001 Winkel - - -"}},
		{"another counterparty", []bank.Transaction{pending("2026-11-10", "Winkel", -1000)}, []edit{manual("2026-11-10", 2, "x")},
			[]bank.Transaction{booked("R1", "2026-11-12", "Winkels", -1000)}, false,
			[]string{"1 booked 2026-11-12 -1000 Winkels - - -"}},
		{"case, accents and spaces do not matter", []bank.Transaction{pending("2026-11-10", "  WÏNKEL ", -1000)}, []edit{{"  WÏNKEL ", "2026-11-10", 2, "manual", "x"}},
			[]bank.Transaction{booked("R1", "2026-11-12", "winkel", -1000)}, false,
			[]string{"1 booked 2026-11-12 -1000 winkel 2 manual x"}},
		{"7 days apart carries", []bank.Transaction{pending("2026-11-03", "Winkel", -1000)}, []edit{manual("2026-11-03", 2, "x")},
			[]bank.Transaction{booked("R1", "2026-11-10", "Winkel", -1000)}, false,
			[]string{"1 booked 2026-11-10 -1000 Winkel 2 manual x"}},
		{"8 days apart does not", []bank.Transaction{pending("2026-11-02", "Winkel", -1000)}, []edit{manual("2026-11-02", 2, "x")},
			[]bank.Transaction{booked("R1", "2026-11-10", "Winkel", -1000)}, false,
			[]string{"1 booked 2026-11-10 -1000 Winkel - - -"}},
		{"two pending rows, one to one, closest dates first",
			[]bank.Transaction{pending("2026-11-01", "Winkel", -1000), pending("2026-11-05", "Winkel", -1000)},
			[]edit{manual("2026-11-01", 1, "een"), manual("2026-11-05", 2, "twee")},
			[]bank.Transaction{booked("R2", "2026-11-06", "Winkel", -1000), booked("R1", "2026-11-02", "Winkel", -1000)}, false,
			[]string{"1 booked 2026-11-02 -1000 Winkel 1 manual een", "1 booked 2026-11-06 -1000 Winkel 2 manual twee"}},
		{"fewer booked rows than pending rows",
			[]bank.Transaction{pending("2026-11-01", "Winkel", -1000), pending("2026-11-03", "Winkel", -1000)},
			[]edit{manual("2026-11-01", 1, "een"), manual("2026-11-03", 2, "twee")},
			[]bank.Transaction{booked("R1", "2026-11-04", "Winkel", -1000)}, false,
			[]string{"1 booked 2026-11-04 -1000 Winkel 2 manual twee"}},
		{"a stored booked row is no target",
			[]bank.Transaction{pending("2026-11-10", "Winkel", -1000), booked("R1", "2026-11-11", "Winkel", -1000)},
			[]edit{manual("2026-11-10", 2, "x")},
			[]bank.Transaction{booked("R1", "2026-11-11", "Winkel", -1000)}, false,
			[]string{"1 booked 2026-11-11 -1000 Winkel - - -"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := carryDB(t)
			if tt.rule {
				if _, err := d.Exec(`INSERT INTO rules (account_id, counterparty_match, category_id) VALUES (1, 'winkel', 1)`); err != nil {
					t.Fatal(err)
				}
			}
			storeFetch(t, d, fetch{txs: tt.first})
			for _, e := range tt.edits {
				if _, err := d.Exec(`UPDATE transactions SET category_id = ?, category_origin = ?, note = ?
					WHERE account_id = 1 AND status = 'pending' AND counterparty_name = ? AND booking_date = ?`,
					e.category, e.origin, e.note, e.name, e.date); err != nil {
					t.Fatal(err)
				}
			}
			storeFetch(t, d, fetch{txs: tt.second})
			want := slices.Sorted(slices.Values(append(slices.Clone(fixed), tt.want...)))
			got := carryState(t, d)
			if !slices.Equal(got, want) {
				t.Errorf("rows\n%q\nwant\n%q", got, want)
			}
			storeFetch(t, d, fetch{txs: tt.second}) // the same fetch again changes nothing
			if again := carryState(t, d); !slices.Equal(again, got) {
				t.Errorf("a repeated fetch changed rows\n%q\nwas\n%q", again, got)
			}
		})
	}
}
