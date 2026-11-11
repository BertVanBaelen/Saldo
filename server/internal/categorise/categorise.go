// Package categorise is Saldo's categorisation engine (phases 0.4-1 to
// 0.4-3): the default category tree, the rule matcher, the one place that
// writes a category automatically and the one place that writes it by hand.
//
// A transaction holds one category for every member of its account
// (category_id, category_origin, rule_id). Precedence: a manual choice >
// the highest-priority matching rule > a learned suggestion. Only Assign
// changes the category of a stored transaction automatically, and it repeats
// the eligibility guard (Eligible) in the SQL of its UPDATE, so a stale read
// can never overwrite a row that was changed meanwhile. Rows of origin
// 'manual' or 'import' (categories from a Bilance file; Assign itself writes
// "import" only onto a row with no category, 0.5-4), rows of unknown
// origin and split rows are never touched by it. Every automatic writer
// (rules on demand, "apply to similar" through Plan and Apply, suggestions
// of 0.4-4, learning and backfill of 0.5-6) must go through Assign; new rows
// are tagged with Match before they are inserted. A choice by hand goes
// through SetManual, which refuses a split row. Plan is the one engine that
// says what a single rule does to stored rows (it writes nothing); Apply
// writes its changes through Assign.
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
	Name, Type, Colour, Icon string
	Subs                     []Sub
}

// Sub is a default subcategory; it takes its parent's type and colour.
type Sub struct{ Name, Icon string }

// Defaults is the Dutch default tree of the design (finance-mockup
// categorieen.js, TREE). Expense tops come first: their ids are 1..6, the
// income tops 7..10, then the subcategories in this order.
var Defaults = []Default{
	{"Wonen", "expense", "c1", "home", []Sub{{"Huur", "home"}, {"Energie", "bolt"}, {"Internet en tv", "wifi"}, {"Verzekeringen", "shield"}}},
	{"Boodschappen", "expense", "c2", "cart", []Sub{{"Supermarkt", "cart"}, {"Bakker", "food"}}},
	{"Vrije tijd", "expense", "c3", "ticket", []Sub{{"Uitgaan", "beer"}, {"Sport", "sport"}, {"Cultuur", "film"}, {"Vakantie", "plane"}}},
	{"Vervoer", "expense", "c4", "car", []Sub{{"Brandstof", "fuel"}, {"Openbaar vervoer", "bus"}, {"Onderhoud", "wrench"}}},
	{"Abonnementen", "expense", "c5", "repeat", []Sub{{"Streaming", "tv"}, {"Telefoon", "phone"}}},
	{"Overig", "expense", "c6", "dots", nil},
	{"Salaris", "income", "soft", "salary", nil},
	{"Terugbetaling", "income", "soft", "refund", nil},
	{"Bijdrage", "income", "soft", "piggy", nil},
	{"Overig inkomen", "income", "soft", "wallet", nil},
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
		q := `INSERT INTO categories (id, name, parent_id, type, colour, sort_order, icon) VALUES `
		var args []any
		add := func(id int, name string, parent any, typ, colour string, order int, icon string) {
			if args != nil {
				q += ", "
			}
			q += "(?, ?, ?, ?, ?, ?, ?)"
			args = append(args, id, name, parent, typ, colour, order, icon)
		}
		for i, d := range Defaults {
			add(i+1, d.Name, nil, d.Type, d.Colour, i+1, d.Icon)
		}
		id := len(Defaults)
		for i, d := range Defaults {
			for j, sub := range d.Subs {
				id++
				add(id, sub.Name, i+1, d.Type, d.Colour, j+1, sub.Icon)
			}
		}
		if _, err := db.ExecContext(ctx, q, args...); err != nil {
			return err
		}
	}
	_, err := db.ExecContext(ctx, `INSERT INTO app_settings (key, value) VALUES (?, '1') ON CONFLICT (key) DO NOTHING`, seededKey)
	return err
}
