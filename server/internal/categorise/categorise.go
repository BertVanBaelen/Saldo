// Package categorise is Saldo's categorisation engine (phases 0.4-1 and
// 0.4-2): the default category tree, the rule matcher and the one place that
// writes a category automatically.
//
// A transaction holds one category for every member of its account
// (category_id, category_origin, rule_id). Precedence: a manual choice >
// the highest-priority matching rule > a learned suggestion. Only Assign
// changes the category of a stored transaction automatically, and it repeats
// the eligibility guard (Eligible) in the SQL of its UPDATE, so a stale read
// can never overwrite a row that was changed meanwhile. Rows of origin
// 'manual' or 'import' (categories from a Bilance file), rows of unknown
// origin and split rows are never touched by it. Every automatic writer
// (rules on demand, "apply to similar" of 0.4-3, suggestions of 0.4-4,
// learning and backfill of 0.5-6) must go through Assign; new rows are
// tagged with Match before they are inserted.
//
// This package must not import ledger: ledger imports it.
package categorise

import (
	"context"
	"database/sql"
)

// DB is what the engine needs of a *sql.DB or *sql.Tx.
type DB interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Default is one top category of the default tree with its subcategories.
type Default struct {
	Name, Type, Colour string
	Subs               []string
}

// Defaults is the Dutch default tree of the design (finance-mockup
// categorieen.js, TREE). Expense tops come first: their ids are 1..6, the
// income tops 7..10, then the subcategories in this order.
var Defaults = []Default{
	{"Wonen", "expense", "c1", []string{"Huur", "Energie", "Internet en tv", "Verzekeringen"}},
	{"Boodschappen", "expense", "c2", []string{"Supermarkt", "Bakker"}},
	{"Vrije tijd", "expense", "c3", []string{"Uitgaan", "Sport", "Cultuur", "Vakantie"}},
	{"Vervoer", "expense", "c4", []string{"Brandstof", "Openbaar vervoer", "Onderhoud"}},
	{"Abonnementen", "expense", "c5", []string{"Streaming", "Telefoon"}},
	{"Overig", "expense", "c6", nil},
	{"Salaris", "income", "soft", nil},
	{"Terugbetaling", "income", "soft", nil},
	{"Bijdrage", "income", "soft", nil},
	{"Overig inkomen", "income", "soft", nil},
}

// seededKey marks in app_settings that the defaults were offered once.
const seededKey = "categories_seeded"

// SeedDefaults inserts the default tree when the categories table is empty
// and it never did so before, then marks it. A user who removes every
// category does not get the defaults back; with categories present it only
// writes the marker. The tree goes in as one statement, so a crash leaves
// all or nothing.
func SeedDefaults(ctx context.Context, db DB) error {
	var seeded, has bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM app_settings WHERE key = ?),
		EXISTS (SELECT 1 FROM categories)`, seededKey).Scan(&seeded, &has); err != nil || seeded {
		return err
	}
	if !has {
		q := `INSERT INTO categories (id, name, parent_id, type, colour, sort_order) VALUES `
		var args []any
		add := func(id int, name string, parent any, typ, colour string, order int) {
			if args != nil {
				q += ", "
			}
			q += "(?, ?, ?, ?, ?, ?)"
			args = append(args, id, name, parent, typ, colour, order)
		}
		for i, d := range Defaults {
			add(i+1, d.Name, nil, d.Type, d.Colour, i+1)
		}
		id := len(Defaults)
		for i, d := range Defaults {
			for j, sub := range d.Subs {
				id++
				add(id, sub, i+1, d.Type, d.Colour, j+1)
			}
		}
		if _, err := db.ExecContext(ctx, q, args...); err != nil {
			return err
		}
	}
	_, err := db.ExecContext(ctx, `INSERT INTO app_settings (key, value) VALUES (?, '1') ON CONFLICT (key) DO NOTHING`, seededKey)
	return err
}
