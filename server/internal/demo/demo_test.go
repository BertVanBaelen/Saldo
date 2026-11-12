package demo

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	return d
}

func count(t *testing.T, d *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := d.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

func TestSeed(t *testing.T) {
	ctx := context.Background()
	d := openDB(t)
	seeded, err := Seed(ctx, d, fake.Provider{}, nil)
	if err != nil || !seeded {
		t.Fatalf("Seed: %v, %v", seeded, err)
	}

	checks := []struct {
		name string
		q    string
		want int
	}{
		{"users", `SELECT COUNT(*) FROM users`, 2},
		{"admin", `SELECT COUNT(*) FROM users WHERE id = 1 AND role = 'admin' AND email = 'bert@jouw-domein.be'`, 1},
		{"accounts", `SELECT COUNT(*) FROM accounts`, 5},
		{"Bert's accounts", `SELECT COUNT(*) FROM account_access WHERE user_id = 1`, 4},
		{"Partner's accounts", `SELECT COUNT(*) FROM account_access WHERE user_id = 2 AND account_id IN (4, 5)`, 2},
		{"only Partner holds account 5", `SELECT COUNT(*) FROM account_access WHERE account_id = 5`, 1},
		{"shared account manager", `SELECT COUNT(*) FROM account_access WHERE account_id = 4 AND user_id = 1 AND role = 'manager'`, 1},
		{"connections", `SELECT COUNT(*) FROM provider_connections`, 2},
		{"sources", `SELECT COUNT(*) FROM account_sources`, 4},
		{"fallback", `SELECT COUNT(*) FROM account_sources WHERE account_id = 4 AND connection_id = 2 AND priority = 'fallback'`, 1},
		{"categories (the default tree)", `SELECT COUNT(*) FROM categories`, 25},
		{"categories marked seeded", `SELECT COUNT(*) FROM app_settings WHERE key = 'categories_seeded'`, 1},
		{"history stays on the top categories", `SELECT COUNT(*) FROM transactions t JOIN categories c ON c.id = t.category_id WHERE c.parent_id IS NOT NULL`, 0},
		{"the nine story categories keep their ids", `SELECT COUNT(*) FROM categories WHERE (id, name) IN (VALUES (1, 'Wonen'), (2, 'Boodschappen'), (6, 'Overig'), (7, 'Salaris'), (9, 'Bijdrage'))`, 5},
		{"rows of 12–18 Nov on Bert's accounts", `SELECT COUNT(*) FROM transactions WHERE account_id IN (1, 4) AND booking_date >= '2026-11-12'`, 16},
		{"pending", `SELECT COUNT(*) FROM transactions WHERE status = 'pending' AND counterparty_name = 'Bol.com'`, 1},
		{"history from November 2025", `SELECT COUNT(*) FROM transactions WHERE booking_date < '2025-12-01' AND booking_date >= '2025-11-01'`, 26},
		{"no duplicates on the shared account", `SELECT COUNT(*) FROM (SELECT external_id FROM transactions WHERE account_id = 4 GROUP BY external_id HAVING COUNT(*) > 1)`, 0},
		{"Partner's account has transactions", `SELECT MIN(1, COUNT(*)) FROM transactions WHERE account_id = 5`, 1},
		{"salary on the 2nd", `SELECT COUNT(*) FROM transactions WHERE account_id = 1 AND amount = 285000 AND substr(booking_date, 9) = '02'`, 13},
		{"bank balance", `SELECT balance FROM balance_snapshots WHERE account_id = 1`, 196882},
		{"manual balance", `SELECT balance FROM balance_snapshots WHERE account_id = 2 AND date = '2026-10-02' AND origin = 'manual'`, 1250000},
	}
	for _, c := range checks {
		if got := count(t, d, c.q); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}

	// Exactly the four rows of the design stay uncategorised, apart from transfers.
	rows, err := d.Query(`SELECT counterparty_name FROM transactions
		WHERE category_id IS NULL AND counterparty_name NOT IN ('Naar spaarrekening', 'Naar gedeelde rekening')
		ORDER BY booking_date DESC, id DESC`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var open []string
	for rows.Next() {
		var n string
		rows.Scan(&n)
		open = append(open, n)
	}
	want := []string{"Bol.com", "Bakkerij De Graankorrel", "Frituur 't Pleintje", "Apotheek Van Damme"}
	if len(open) != len(want) {
		t.Fatalf("uncategorised: %v, want %v", open, want)
	}
	for i := range want {
		if open[i] != want[i] {
			t.Errorf("uncategorised: %v, want %v", open, want)
		}
	}
}

func TestSeedOnce(t *testing.T) {
	ctx := context.Background()
	d := openDB(t)
	if _, err := Seed(ctx, d, fake.Provider{}, nil); err != nil {
		t.Fatal(err)
	}
	before := count(t, d, `SELECT COUNT(*) FROM transactions`)
	seeded, err := Seed(ctx, d, fake.Provider{}, nil)
	if err != nil || seeded {
		t.Fatalf("second Seed: %v, %v", seeded, err)
	}
	if after := count(t, d, `SELECT COUNT(*) FROM transactions`); after != before {
		t.Errorf("transactions %d → %d", before, after)
	}
}

func TestSeedIsDeterministic(t *testing.T) {
	ctx := context.Background()
	a, b := openDB(t), openDB(t)
	Seed(ctx, a, fake.Provider{}, nil)
	Seed(ctx, b, fake.Provider{}, nil)
	sum := `SELECT COUNT(*) || ':' || SUM(amount) || ':' || SUM(id * amount) || ':' || group_concat(counterparty_name, '') FROM transactions`
	var x, y string
	a.QueryRow(sum).Scan(&x)
	b.QueryRow(sum).Scan(&y)
	if x != y {
		t.Error("two seeds differ")
	}
}

func TestSeedRefusesRealData(t *testing.T) {
	ctx := context.Background()
	d := openDB(t)
	if _, err := d.Exec(`INSERT INTO users (email, display_name, role) VALUES ('someone@example.org', 'Someone', 'admin')`); err != nil {
		t.Fatal(err)
	}
	if _, err := Seed(ctx, d, fake.Provider{}, nil); !errors.Is(err, ErrNotDemoDatabase) {
		t.Fatalf("want ErrNotDemoDatabase, got %v", err)
	}
}
