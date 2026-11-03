// Package demo seeds an empty database with the demo story (analysis section
// 12, analysis/concepts/demo-data.md) for demo mode: two users, five
// accounts, two bank connections, the shared category tree and about a year
// of transactions fetched through the fake bank provider.
package demo

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Demo user ids. Demo mode acts as Bert.
const (
	Bert    int64 = 1
	Partner int64 = 2
)

// ErrNotDemoDatabase means demo mode was started on a database that holds
// data which the demo did not create. Demo mode acts as user 1 without
// signing in, so it refuses to run on real data.
var ErrNotDemoDatabase = errors.New("demo: the database holds non-demo data; use an empty state directory for demo mode")

type user struct {
	id      int64
	name    string
	email   string
	role    string
	created string
}

var users = []user{
	{Bert, "Bert", "bert@jouw-domein.be", "admin", "2026-06-03T08:00:00Z"},
	{Partner, "Partner", "partner@jouw-domein.be", "user", "2026-06-04T18:30:00Z"},
}

type category struct {
	name   string
	kind   string
	colour string
}

// categories is the shared default tree; ids follow this order.
var categories = []category{
	{"Wonen", "expense", "c1"},
	{"Boodschappen", "expense", "c2"},
	{"Vrije tijd", "expense", "c3"},
	{"Vervoer", "expense", "c4"},
	{"Abonnementen", "expense", "c5"},
	{"Overig", "expense", "c6"},
	{"Salaris", "income", "soft"},
	{"Terugbetaling", "income", "soft"},
	{"Bijdrage", "income", "soft"},
}

type connection struct {
	id         int64
	user       int64
	session    string
	since      string
	validUntil string // 12:00 Brussels on the last day
	lastSync   string
}

var connections = []connection{
	{1, Bert, fake.SessionBert, "2026-06-03", "2026-11-30T11:00:00Z", "2026-11-18T03:02:00Z"},
	{2, Partner, fake.SessionPartner, "2026-06-05", "2026-12-02T11:00:00Z", "2026-11-18T03:05:00Z"},
}

type account struct {
	id      int64
	name    string
	typ     string
	iban    string
	colour  string
	buffer  int64
	owner   int64
	created string
}

// bankAccounts are matched on the IBANs the fake provider reports.
var bankAccounts = map[string]account{
	fake.IBANBertCurrent:    {1, "Zichtrekening", "current", fake.IBANBertCurrent, "green", 90000, Bert, "2026-06-03T08:10:00Z"},
	fake.IBANShared:         {4, "Gedeelde rekening", "current", fake.IBANShared, "violet", 60000, Bert, "2026-06-03T08:10:00Z"},
	fake.IBANPartnerCurrent: {5, "Zichtrekening", "current", fake.IBANPartnerCurrent, "pink", 50000, Partner, "2026-06-05T19:00:00Z"},
}

// joinedAt is when each user joined each bank account.
var joinedAt = map[[2]int64]string{
	{1, Bert}:    "2026-06-03T08:10:00Z",
	{4, Bert}:    "2026-06-03T08:10:00Z",
	{4, Partner}: "2026-06-05T19:00:00Z",
	{5, Partner}: "2026-06-05T19:00:00Z",
}

type manual struct {
	account
	balance int64
	updated string
}

var manualAccounts = []manual{
	{account{2, "Spaarrekening", "savings", fake.IBANSavings, "orange", 0, Bert, "2026-06-03T08:20:00Z"}, 1250000, "2026-10-02"},
	{account{3, "Reserve", "savings", "", "yellow", 0, Bert, "2026-06-03T08:21:00Z"}, 420000, "2026-10-02"},
}

// categorised is how the demo users categorised their history.
var categorised = []struct {
	category       string
	counterparties []string
}{
	{"Wonen", []string{"Immo Verhaeghe", "Luminus"}},
	{"Boodschappen", []string{"Colruyt Laagste Prijzen", "Delhaize", "Albert Heijn", "Carrefour Express", "Lidl", "Bakkerij De Graankorrel"}},
	{"Vrije tijd", []string{"Kinepolis", "Decathlon", "Standaard Boekhandel"}},
	{"Vervoer", []string{"TotalEnergies", "NMBS", "De Lijn"}},
	{"Abonnementen", []string{"Spotify", "Netflix", "Proximus", "Basic-Fit"}},
	{"Overig", []string{"Bol.com", "Action", "Zara", "Frituur 't Pleintje", "Apotheek Van Damme"}},
	{"Salaris", []string{"Werkgever NV", "Werkgever BV"}},
	{"Terugbetaling", []string{"CM Ziekenfonds"}},
	{"Bijdrage", []string{"Bert", "Partner"}},
}

// openSince: these counterparties stay uncategorised from this date on, which
// gives Bert the 4 transactions "te categoriseren" of the design. Transfers to
// own accounts ("Naar spaarrekening", "Naar gedeelde rekening") are never
// categorised; they are recognised per viewer.
const openSince = "2026-11-12"

var leftOpen = map[string]bool{
	"Bol.com": true, "Bakkerij De Graankorrel": true, "Frituur 't Pleintje": true, "Apotheek Van Damme": true,
}

// Seed fills an empty database with the demo story through the provider. It
// does nothing on a database it seeded before and returns ErrNotDemoDatabase
// on a database with other data.
func Seed(ctx context.Context, db *sql.DB, p bank.Provider, log *slog.Logger) (bool, error) {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	var usersCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&usersCount); err != nil {
		return false, err
	}
	var marker string
	err := db.QueryRowContext(ctx, `SELECT value FROM app_settings WHERE key = 'demo'`).Scan(&marker)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	if marker == "1" {
		return false, nil
	}
	if usersCount > 0 {
		return false, ErrNotDemoDatabase
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	n, err := seed(ctx, tx, p)
	if err != nil {
		return false, fmt.Errorf("demo: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO app_settings (key, value) VALUES ('demo', '1'), ('demo_seeded_at', ?)`,
		time.Now().UTC().Format(time.RFC3339)); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	log.Info("demo story seeded", "transactions", n)
	return true, nil
}

func seed(ctx context.Context, tx *sql.Tx, p bank.Provider) (int, error) {
	exec := func(q string, args ...any) error {
		_, err := tx.ExecContext(ctx, q, args...)
		return err
	}
	for _, u := range users {
		if err := exec(`INSERT INTO users (id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)`,
			u.id, u.email, u.name, u.role, u.created); err != nil {
			return 0, err
		}
	}
	for i, c := range categories {
		if err := exec(`INSERT INTO categories (id, name, type, colour, sort_order) VALUES (?, ?, ?, ?, ?)`,
			i+1, c.name, c.kind, c.colour, i+1); err != nil {
			return 0, err
		}
	}
	for _, m := range manualAccounts {
		if err := insertAccount(ctx, tx, m.account, "manual", ""); err != nil {
			return 0, err
		}
		if err := exec(`INSERT INTO account_access (account_id, user_id, role, permission, joined_at) VALUES (?, ?, 'manager', 'edit', ?)`,
			m.id, m.owner, m.created); err != nil {
			return 0, err
		}
		if err := exec(`INSERT INTO balance_snapshots (account_id, balance, date, origin) VALUES (?, ?, ?, 'manual')`,
			m.id, m.balance, m.updated); err != nil {
			return 0, err
		}
	}

	// Bank side: list, fetch and store, exactly as a first sync would.
	var rows []ledger.NewTransaction
	balanced := map[int64]bool{}
	for _, c := range connections {
		if err := exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, aspsp_country, consent_since,
			valid_until, status, sync_status, last_sync_at, last_attempt_at, created_at)
			VALUES (?, ?, 'fake', ?, 'BE', ?, ?, 'active', 'ok', ?, ?, ?)`,
			c.id, c.user, fake.Bank, c.since, c.validUntil, c.lastSync, c.lastSync, c.since+"T08:00:00Z"); err != nil {
			return 0, err
		}
		session := bank.Session{ID: c.session}
		accs, err := p.ListAccounts(ctx, session)
		if err != nil {
			return 0, err
		}
		for _, ba := range accs {
			a, ok := bankAccounts[ledger.NormalizeIBAN(ba.IBAN)]
			if !ok {
				return 0, fmt.Errorf("unexpected demo account %s", ba.IBAN)
			}
			var exists bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM accounts WHERE id = ?)`, a.id).Scan(&exists); err != nil {
				return 0, err
			}
			role, priority := "member", "fallback"
			if !exists {
				if err := insertAccount(ctx, tx, a, "bank", ba.Bank); err != nil {
					return 0, err
				}
				role, priority = "manager", "primary"
			}
			if err := exec(`INSERT INTO account_access (account_id, user_id, role, permission, joined_at, contribution_share)
				VALUES (?, ?, ?, 'edit', ?, ?)`, a.id, c.user, role, joinedAt[[2]int64{a.id, c.user}], share(a.id)); err != nil {
				return 0, err
			}
			if err := exec(`INSERT INTO account_sources (account_id, connection_id, priority, external_account_id, status, last_sync_at, last_attempt_at)
				VALUES (?, ?, ?, ?, 'ok', ?, ?)`, a.id, c.id, priority, ba.ID, c.lastSync, c.lastSync); err != nil {
				return 0, err
			}
			txs, err := p.FetchTransactions(ctx, session, ba.ID, fake.StoryStart, fake.StoryEnd)
			if err != nil {
				return 0, err
			}
			rows = append(rows, ledger.Keyed(a.id, a.iban, c.id, txs)...)
			if !balanced[a.id] {
				bals, err := p.FetchBalances(ctx, session, ba.ID)
				if err != nil {
					return 0, err
				}
				for _, b := range bals {
					if err := exec(`INSERT INTO balance_snapshots (account_id, balance, date, origin) VALUES (?, ?, ?, 'bank')`,
						a.id, b.Amount, b.Date); err != nil {
						return 0, err
					}
				}
				balanced[a.id] = true
			}
		}
	}

	// Insert oldest first and, within a day, in reverse story order (the fake
	// references encode the position in the day; a pending row has none and
	// tops its day), so the newest-first list (booking date, then id) shows
	// the rows in the order of the design. The shared account arrives through
	// both connections; the dedupe key keeps one copy.
	slices.SortStableFunc(rows, func(a, b ledger.NewTransaction) int {
		return cmp.Or(cmp.Compare(a.BookingDate, b.BookingDate), cmp.Compare(b.EntryReference, a.EntryReference))
	})
	n, err := ledger.InsertTransactions(ctx, tx, rows)
	if err != nil {
		return 0, err
	}
	if err := categorise(ctx, tx); err != nil {
		return 0, err
	}
	return n, nil
}

func insertAccount(ctx context.Context, tx *sql.Tx, a account, source, bankName string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO accounts (id, type, source, iban, name, colour, buffer, bank_name, created_by, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.id, a.typ, source, nullIfEmpty(a.iban), a.name, a.colour, a.buffer, nullIfEmpty(bankName), a.owner, a.created)
	return err
}

// share is the agreed contribution split: 50 % each on the shared account.
func share(accountID int64) any {
	if accountID == bankAccounts[fake.IBANShared].id {
		return 50
	}
	return nil
}

func categorise(ctx context.Context, tx *sql.Tx) error {
	for _, c := range categorised {
		for _, name := range c.counterparties {
			q := `UPDATE transactions SET category_id = (SELECT id FROM categories WHERE name = ? AND parent_id IS NULL),
				category_origin = 'import' WHERE counterparty_name = ?`
			args := []any{c.category, name}
			if leftOpen[name] {
				q += ` AND booking_date < ?`
				args = append(args, openSince)
			}
			if _, err := tx.ExecContext(ctx, q, args...); err != nil {
				return err
			}
		}
	}
	return nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
