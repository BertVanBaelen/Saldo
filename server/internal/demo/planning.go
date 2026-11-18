package demo

import (
	"context"
	"database/sql"

	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
)

// The planning seed (plan 0.8-1): what Bert and Partner confirmed, budgeted
// and planned by 18 November 2026. Viewer-free facts of the story; the
// counterparty IBANs are the ones of the fake bank's own-account transfers
// (the contribution and the savings order carry the holder's name, so only
// the IBAN tells them apart). The seed writes no transactions, so no number of
// 0.7 or of the saving categories changes.

type item struct {
	account                         int64
	description, counterparty, iban string
	amount                          int64
	frequency                       string
	day                             int
	month                           any // nil for monthly
	kind                            string
}

var items = []item{
	{1, "Salaris", "Werkgever NV", "", 285000, "monthly", 2, nil, "income"},
	{1, "Huur", "Immo Verhaeghe", "", -100500, "monthly", 1, nil, "expense"},
	{1, "Naar gedeelde rekening", "Naar gedeelde rekening", fake.IBANShared, -45000, "monthly", 1, nil, "transfer"},
	{1, "Netflix", "Netflix", "", -1399, "monthly", 12, nil, "expense"},
	{1, "Naar spaarrekening", "Naar spaarrekening", fake.IBANSavings, -20000, "monthly", 16, nil, "saving"},
	{1, "Spotify", "Spotify", "", -1199, "monthly", 17, nil, "expense"},
	{1, "Familiale verzekering", "", "", -68400, "yearly", 15, 1, "expense"}, // added by hand: no counterparty
	{4, "Bijdrage Bert", "Bert", fake.IBANBertCurrent, 45000, "monthly", 1, nil, "contribution"},
	{4, "Bijdrage Partner", "Partner", fake.IBANPartnerCurrent, 45000, "monthly", 1, nil, "contribution"},
	{4, "Energie", "Luminus", "", -14500, "monthly", 3, nil, "expense"},
	{4, "Internet en tv", "Proximus", "", -4298, "monthly", 9, nil, "expense"},
}

// budgets are from 2026-11 on: account, top category, monthly amount. The
// shared account's Boodschappen is € 550 (not the mockup's € 650, with which
// its month would net exactly 0), and its Overig has none, so the demo
// exercises the average.
var budgets = []struct {
	account  int64
	category string
	amount   int64
}{
	{1, "Vrije tijd", 35000}, {1, "Vervoer", 30000}, {1, "Overig", 28798}, {4, "Boodschappen", 55000},
}

// planned are Bert's one-off items on the Zichtrekening.
var planned = []struct {
	date        string
	amount      int64
	description string
}{
	{"2026-12-20", -35000, "Kerstcadeaus"}, {"2027-02-10", -200000, "Autoherstelling"},
	{"2027-07-15", -150000, "Zomervakantie"}, {"2027-08-20", 68000, "Belastingteruggave"},
}

func seedPlanning(ctx context.Context, tx *sql.Tx) error {
	for _, it := range items {
		if _, err := tx.ExecContext(ctx, `INSERT INTO recurring_items (account_id, counterparty, counterparty_iban, description, amount, amount_rule,
			frequency, expected_day, expected_month, kind, state) VALUES (?, ?, ?, ?, ?, 'fixed', ?, ?, ?, ?, 'confirmed')`,
			it.account, it.counterparty, nullIfEmpty(it.iban), it.description, it.amount, it.frequency, it.day, it.month, it.kind); err != nil {
			return err
		}
	}
	for _, b := range budgets {
		if _, err := tx.ExecContext(ctx, `INSERT INTO budgets (account_id, category_id, monthly_amount, from_month)
			VALUES (?, (SELECT id FROM categories WHERE name = ? AND parent_id IS NULL), ?, '2026-11')`, b.account, b.category, b.amount); err != nil {
			return err
		}
	}
	for _, p := range planned {
		if _, err := tx.ExecContext(ctx, `INSERT INTO planned_items (account_id, created_by, date, amount, description) VALUES (1, ?, ?, ?, ?)`,
			Bert, p.date, p.amount, p.description); err != nil {
			return err
		}
	}
	return nil
}
