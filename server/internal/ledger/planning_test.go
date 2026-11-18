package ledger_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// Planning data (plan 0.8-1) on reportWorld, today 2026-11-17: Bert holds the
// current accounts 1, 2, 8 and 9 (9 is shared by its flag), the shared 3 with
// Partner (who reads only, set here), the savings account 4 and the
// investment account 5; Partner's own current account is 6.

// planningFixture is reportWorld with Partner on Lezen on the shared account.
func planningFixture(t *testing.T) (*sql.DB, *ledger.Store) {
	t.Helper()
	d, s, _ := reportWorld(t)
	if _, err := d.Exec(`UPDATE account_access SET permission = 'read' WHERE account_id = ? AND user_id = ?`, rwGedeeld, partner); err != nil {
		t.Fatal(err)
	}
	return d, s
}

// wantInvalid checks an error against the Dutch message ("" = no error).
func wantInvalid(t *testing.T, what string, err error, message string) {
	t.Helper()
	switch {
	case message == "" && err != nil:
		t.Errorf("%s: %v", what, err)
	case message != "" && (err == nil || err.Error() != apperr.Invalid(message).Error()):
		t.Errorf("%s: %v, want %q", what, err, message)
	}
}

func wantErr(t *testing.T, what string, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Errorf("%s: %v, want %v", what, err, want)
	}
}

func TestRecurringItemCRUD(t *testing.T) {
	ctx := context.Background()
	d, s := planningFixture(t)
	create := func(viewer int64, body string) (ledger.Item, error) {
		t.Helper()
		var in ledger.ItemInput
		if err := json.Unmarshal([]byte(body), &in); err != nil {
			t.Fatal(err)
		}
		return s.CreateItem(ctx, viewer, in, reportNow, planning.Key)
	}
	patch := func(viewer, id int64, body string) (ledger.Item, error) {
		t.Helper()
		var f ledger.ItemFields
		if err := json.Unmarshal([]byte(body), &f); err != nil {
			t.Fatal(err)
		}
		return s.UpdateItem(ctx, viewer, id, f, reportNow)
	}
	item := func(account int64, rest string) string {
		return fmt.Sprintf(`{"accountId":%d,"description":"Huur","counterparty":"Immo Verhaeghe","amount":-100500,"frequency":"monthly","day":1,"kind":"expense"%s}`, account, rest)
	}
	must := func(it ledger.Item, err error) ledger.Item {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return it
	}
	long := func(n int) string { return strings.Repeat("a", n) }

	// Validation: every message, one field at a time (the base body is valid).
	for _, c := range []struct {
		account int64
		rest    string
		message string
	}{
		{rwZicht, `,"description":"  "`, "Geef de post een naam."},
		{rwZicht, `,"description":"` + long(81) + `"`, "De naam heeft hoogstens 80 tekens."},
		{rwZicht, `,"counterparty":"` + long(141) + `"`, "De tegenpartij heeft hoogstens 140 tekens."},
		{rwZicht, `,"amount":0`, "Vul een bedrag in."},
		{rwZicht, `,"amount":100000001`, "Dit bedrag is te groot."},
		{rwZicht, `,"kind":"income"`, "Een inkomst is positief, een uitgave negatief."},
		{rwZicht, `,"kind":"saving","amount":500`, "Een inkomst is positief, een uitgave negatief."},
		{rwZicht, `,"kind":"contribution","amount":500`, "Een bijdrage hoort bij een gedeelde rekening."},
		{rwPot, `,"kind":"transfer"`, "Kies inkomst of bijdrage voor een gedeelde rekening."},
		{rwPot, `,"kind":"contribution"`, "Een inkomst is positief, een uitgave negatief."},
		{rwZicht, `,"day":0`, "Kies een dag van 1 tot 31."},
		{rwZicht, `,"day":32`, "Kies een dag van 1 tot 31."},
		{rwZicht, `,"frequency":"quarterly"`, "Kies de maand."},
		{rwZicht, `,"frequency":"yearly","month":13`, "Kies de maand."},
		{rwZicht, `,"endDate":"2026-11-16"`, "Kies een einddatum vanaf vandaag."},
		{rwZicht, `,"endDate":"morgen"`, "Kies een datum als 2026-11-18."},
		{rwZicht, `,"kind":"other"`, "Kies inkomst, uitgave, sparen, overschrijving of bijdrage."},
		{rwZicht, `,"frequency":"weekly"`, "Kies maandelijks, per kwartaal of jaarlijks."},
		{rwZicht, `,"amountRule":"vaag"`, "Kies een vast bedrag of het gemiddelde."},
		{rwZicht, `,"state":"suggested"`, "Kies bevestigd of genegeerd."},
		{rwSpaar, ``, "Kies een betaalrekening."},
		{rwBeleggen, ``, "Kies een betaalrekening."},
	} {
		_, err := create(bert, item(c.account, c.rest))
		wantInvalid(t, fmt.Sprintf("%d %s", c.account, c.rest), err, c.message)
	}
	if n := countRows(t, d, `SELECT COUNT(*) FROM recurring_items`); n != 0 {
		t.Fatalf("%d items after only refused ones", n)
	}

	// Valid: a contribution on a flag-shared account (today as the end date, a month on a monthly item is
	// dropped), an income on a shared account, the same item twice with days that order them.
	must(create(bert, item(rwPot, `,"kind":"contribution","amount":45000,"month":5,"endDate":"2026-11-17"`)))
	shared := must(create(bert, `{"accountId":3,"description":"Salaris","amount":45000,"frequency":"monthly","day":1,"kind":"income"}`))
	expense := must(create(bert, item(rwZicht, `,"day":16`)))
	transfer := must(create(bert, item(rwZicht, `,"kind":"transfer","amount":45000`)))
	ignored := must(create(bert, `{"accountId":1,"counterparty":"Decathlon","amount":-4290,"frequency":"quarterly","month":2,"day":27,"kind":"expense","state":"ignored","description":"x"}`))
	if ignored.Description != "Decathlon" || ignored.State != "ignored" || expense.AmountRule != "fixed" || expense.State != "confirmed" || expense.Month != nil {
		t.Errorf("defaults: %+v %+v", expense, ignored)
	}

	// Access: Partner reads the shared account only; Lezen is 403 on every write, Bert's personal account is 404.
	_, err := create(partner, item(rwGedeeld, ""))
	wantErr(t, "create with Lezen", err, apperr.ErrForbidden)
	_, err = create(partner, item(rwZicht, ""))
	wantErr(t, "create on Bert's account", err, apperr.ErrNotFound)
	_, err = patch(partner, shared.ID, `{"amount":1}`)
	wantErr(t, "patch with Lezen", err, apperr.ErrForbidden)
	wantErr(t, "delete with Lezen", s.DeleteItem(ctx, partner, shared.ID), apperr.ErrForbidden)
	_, err = patch(partner, expense.ID, `{"amount":-1}`)
	wantErr(t, "patch Bert's item", err, apperr.ErrNotFound)
	wantErr(t, "delete Bert's item", s.DeleteItem(ctx, partner, expense.ID), apperr.ErrNotFound)
	wantErr(t, "delete a missing item", s.DeleteItem(ctx, bert, 9999), apperr.ErrNotFound)

	// Lists per scope: by account, then state, then day, then id; Partner sees the shared item.
	list := func(viewer int64, scope string) (out []int64) {
		t.Helper()
		items, err := s.PlanningItems(ctx, viewer, scope)
		if err != nil {
			t.Fatal(err)
		}
		for _, it := range items {
			out = append(out, it.ID)
		}
		return out
	}
	for _, c := range []struct {
		viewer int64
		scope  string
		want   []int64
	}{
		{bert, "alles", []int64{transfer.ID, expense.ID, ignored.ID, shared.ID, 1}},
		{bert, "persoonlijk", []int64{transfer.ID, expense.ID, ignored.ID}},
		{bert, "gedeeld", []int64{shared.ID, 1}},
		{partner, "alles", []int64{shared.ID}},
		{partner, "persoonlijk", nil},
	} {
		if got := list(c.viewer, c.scope); !slices.Equal(got, c.want) {
			t.Errorf("%d %s: %v, want %v", c.viewer, c.scope, got, c.want)
		}
	}
	if _, err := s.PlanningItems(ctx, bert, "iedereen"); err == nil {
		t.Error("an unknown scope was accepted")
	}

	// Update: fields merge and the whole item is checked again; a monthly item loses its month.
	y := must(patch(bert, ignored.ID, `{"frequency":"yearly","month":5,"state":"confirmed","description":"Decathlon jaar"}`))
	if y.Frequency != "yearly" || *y.Month != 5 || y.State != "confirmed" || y.Description != "Decathlon jaar" {
		t.Errorf("patch: %+v", y)
	}
	if m := must(patch(bert, ignored.ID, `{"frequency":"monthly"}`)); m.Month != nil {
		t.Errorf("to monthly: %+v", m)
	}
	_, err = patch(bert, ignored.ID, `{"kind":"contribution"}`)
	wantInvalid(t, "patch to a contribution", err, "Een bijdrage hoort bij een gedeelde rekening.")
	if countRows(t, d, `SELECT COUNT(*) FROM recurring_items WHERE id = ? AND kind = 'expense'`, ignored.ID) != 1 {
		t.Error("a refused patch changed the item")
	}

	// An end date in the past is refused when set or changed; an item whose end date passed stays editable.
	_, err = patch(bert, ignored.ID, `{"endDate":"2026-10-01"}`)
	wantInvalid(t, "past end date", err, "Kies een einddatum vanaf vandaag.")
	must(patch(bert, ignored.ID, `{"endDate":"2026-12-31"}`))
	if _, err := d.Exec(`UPDATE recurring_items SET end_date = '2026-01-01' WHERE id = ?`, ignored.ID); err != nil {
		t.Fatal(err)
	}
	must(patch(bert, ignored.ID, `{"description":"Nog bewerkbaar"}`))
	_, err = patch(bert, ignored.ID, `{"endDate":"2026-02-02"}`)
	wantInvalid(t, "another past end date", err, "Kies een einddatum vanaf vandaag.")
	if e := must(patch(bert, ignored.ID, `{"endDate":null}`)); e.EndDate != nil {
		t.Errorf("clear end date: %+v", e)
	}

	// The IBAN: copied from the newest booked row with the same key, sign and amount (±10 %) on a confirm from a
	// suggestion (not from a later pending row or the other sign; an older row without an IBAN is skipped), never by hand, dropped when the
	// counterparty changes, and never in the answer.
	for _, q := range []string{
		`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, counterparty_iban, status, dedupe_key) VALUES
		    (1, -45000, '2026-10-20', 'Naar Spaarpot 1', 'BE00AAAA', 'booked', 'i1'), (1, -20000, '2026-10-01', 'NAAR SPAARPOT 22', 'BE00BBBB', 'booked', 'i2'),
		    (1, 20000, '2026-10-05', 'Naar Spaarpot', 'BE00CCCC', 'booked', 'i3'), (1, -20000, '2026-10-09', 'Naar Spaarpot 3', 'BE00DDDD', 'pending', 'i4'),
		    (1, -45000, '2026-08-20', 'Naar Spaarpot', 'BE00EEEE', 'booked', 'i5'), (1, -20000, '2026-09-01', 'Naar Spaarpot', NULL, 'booked', 'i6')`,
	} {
		if _, err := d.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	iban := func(id int64) (v sql.NullString) {
		t.Helper()
		if err := d.QueryRow(`SELECT counterparty_iban FROM recurring_items WHERE id = ?`, id).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	saving := `{"accountId":1,"description":"Naar spaarrekening","counterparty":"Naar Spaarpot","amount":-20000,"frequency":"monthly","day":16,"kind":"saving"`
	byHand, fromRows := must(create(bert, saving+`}`)), must(create(bert, saving+`,"fromSuggestion":true}`))
	if v := iban(byHand.ID); v.Valid {
		t.Errorf("an item by hand has the IBAN %q", v.String)
	}
	if v := iban(fromRows.ID); v.String != "BE00BBBB" {
		t.Errorf("IBAN from the suggestion: %+v", v)
	}
	// One name, two IBANs (the holder's contribution and savings order): the amount picks the IBAN, the newer
	// -45000 row is not the -20000 item's; two IBANs that the amount does not separate give none.
	if v := iban(must(create(bert, strings.Replace(saving, "-20000", "-45000", 1)+`,"fromSuggestion":true}`)).ID); v.Valid {
		t.Errorf("two IBANs at -45000 stored %q", v.String)
	}
	must(patch(bert, fromRows.ID, `{"description":"Sparen"}`))
	if iban(fromRows.ID).String != "BE00BBBB" {
		t.Error("a new description cleared the IBAN")
	}
	must(patch(bert, fromRows.ID, `{"counterparty":"Naar Spaarpot 2"}`))
	if iban(fromRows.ID).Valid {
		t.Error("a new counterparty kept the IBAN")
	}
	if b, _ := json.Marshal(fromRows); strings.Contains(strings.ToLower(string(b)), "iban") {
		t.Errorf("the answer shows the IBAN: %s", b)
	}

	if err := s.DeleteItem(ctx, bert, ignored.ID); err != nil || countRows(t, d, `SELECT COUNT(*) FROM recurring_items WHERE id = ?`, ignored.ID) != 0 {
		t.Errorf("delete: %v", err)
	}
}

func TestBudgets(t *testing.T) {
	ctx := context.Background()
	d, s := planningFixture(t)
	put := func(viewer int64, account, category int64, month, amount string) ([]ledger.Budget, error) {
		t.Helper()
		var in ledger.BudgetInput
		body := fmt.Sprintf(`{"accountId":%d,"categoryId":%d,"fromMonth":%q,"amount":%s}`, account, category, month, amount)
		if err := json.Unmarshal([]byte(body), &in); err != nil {
			t.Fatal(err)
		}
		return s.SetBudget(ctx, viewer, in, reportNow)
	}
	rows := func(b []ledger.Budget) string {
		var out []string
		for _, r := range b {
			a := "null"
			if r.Amount != nil {
				a = fmt.Sprint(*r.Amount)
			}
			out = append(out, r.FromMonth+": "+a)
		}
		return strings.Join(out, ", ")
	}

	// "From this month on": a later row is replaced; a null row after no row or a null row is no row.
	for _, c := range []struct {
		month, amount, want string
	}{
		{"2026-11", "300", "2026-11: 300"},
		{"2027-01", "null", "2026-11: 300, 2027-01: null"},
		{"2026-12", "400", "2026-11: 300, 2026-12: 400"},
		{"2026-12", "null", "2026-11: 300, 2026-12: null"},
		{"2027-03", "null", "2026-11: 300, 2026-12: null"},
		{"2026-11", "0", "2026-11: 0"},                 // a later row goes
		{"2028-11", "100", "2026-11: 0, 2028-11: 100"}, // current month + 24 is the last one
	} {
		got, err := put(bert, rwZicht, 2, c.month, c.amount)
		if err != nil || rows(got) != c.want {
			t.Errorf("%s %s: %q, %v, want %q", c.month, c.amount, rows(got), err, c.want)
		}
	}
	if got, err := put(bert, rwZicht, 4, "2026-11", "null"); err != nil || len(got) != 0 {
		t.Errorf("null without a row: %v, %v", got, err)
	}

	// The category and the amount, the month window, the account.
	for _, c := range []struct {
		account, category int64
		month, amount     string
		message           string
	}{
		{rwZicht, 17, "2026-11", "100", "Een budget hoort bij een hoofdcategorie."},
		{rwZicht, rwSparen, "2026-11", "100", "Voor een spaarcategorie stel je geen budget in."},
		{rwZicht, 7, "2026-11", "100", "Kies een uitgavencategorie."},
		{rwZicht, 999, "2026-11", "100", "Die categorie bestaat niet."},
		{rwZicht, 2, "2026-10", "100", "Kies een maand vanaf deze maand, tot 24 maanden vooruit."},
		{rwZicht, 2, "2028-12", "100", "Kies een maand vanaf deze maand, tot 24 maanden vooruit."},
		{rwZicht, 2, "november", "100", "Kies een maand als JJJJ-MM."},
		{rwZicht, 2, "2026-11", "-1", "Een budget is niet negatief."},
		{rwZicht, 2, "2026-11", "100000001", "Dit bedrag is te groot."},
		{rwSpaar, 2, "2026-11", "100", "Kies een betaalrekening."},
	} {
		_, err := put(bert, c.account, c.category, c.month, c.amount)
		wantInvalid(t, fmt.Sprintf("%d/%d %s %s", c.account, c.category, c.month, c.amount), err, c.message)
	}
	var in ledger.BudgetInput
	if err := json.Unmarshal([]byte(`{"accountId":1,"categoryId":2,"fromMonth":"2026-11"}`), &in); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetBudget(ctx, bert, in, reportNow); err == nil {
		t.Error("a budget without an amount was accepted")
	}
	_, err := put(partner, rwGedeeld, 2, "2026-11", "100")
	wantErr(t, "budget with Lezen", err, apperr.ErrForbidden)
	_, err = put(partner, rwZicht, 2, "2026-11", "100")
	wantErr(t, "budget on Bert's account", err, apperr.ErrNotFound)

	// Lists per scope; the merge and the saving rules of 0.8-0a keep working on the rebuilt table.
	if _, err := put(bert, rwGedeeld, 2, "2026-11", "55000"); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		viewer int64
		scope  string
		want   int
	}{{bert, "alles", 3}, {bert, "persoonlijk", 2}, {bert, "gedeeld", 1}, {partner, "alles", 1}, {partner, "persoonlijk", 0}} {
		if got, err := s.Budgets(ctx, c.viewer, c.scope); err != nil || len(got) != c.want {
			t.Errorf("%d %s: %d budgets, %v, want %d", c.viewer, c.scope, len(got), err, c.want)
		}
	}
	if _, err := put(bert, rwZicht, 6, "2026-11", "100"); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveCategory(ctx, 6, 5); err != nil || countRows(t, d, `SELECT COUNT(*) FROM budgets WHERE category_id = 5`) != 1 || countRows(t, d, `SELECT COUNT(*) FROM budgets WHERE category_id = 6`) != 0 {
		t.Errorf("merge of Overig into Abonnementen: %v", err)
	}
}

func TestPlannedItems(t *testing.T) {
	ctx := context.Background()
	d, s := planningFixture(t)
	create := func(viewer, account int64, body string) (ledger.Planned, error) {
		t.Helper()
		in := ledger.PlannedInput{AccountID: account}
		if err := json.Unmarshal([]byte(body), &in.PlannedFields); err != nil {
			t.Fatal(err)
		}
		return s.CreatePlanned(ctx, viewer, in, reportNow)
	}
	patch := func(viewer, id int64, body string) (ledger.Planned, error) {
		t.Helper()
		var f ledger.PlannedFields
		if err := json.Unmarshal([]byte(body), &f); err != nil {
			t.Fatal(err)
		}
		return s.UpdatePlanned(ctx, viewer, id, f, reportNow)
	}
	const base = `{"date":"2026-12-20","amount":-35000,"description":"Kerstcadeaus"}`
	const dates = "Kies een datum vanaf vandaag."
	for _, c := range []struct {
		account int64
		body    string
		message string
	}{
		{rwZicht, `{"date":"2026-12-20","amount":-35000,"description":" "}`, "Vul een omschrijving en een bedrag in."},
		{rwZicht, `{"date":"2026-12-20","amount":0,"description":"x"}`, "Vul een omschrijving en een bedrag in."},
		{rwZicht, `{"date":"2026-12-20","amount":-35000,"description":"` + strings.Repeat("a", 81) + `"}`, "De omschrijving heeft hoogstens 80 tekens."},
		{rwZicht, `{"date":"2026-12-20","amount":100000001,"description":"x"}`, "Dit bedrag is te groot."},
		{rwZicht, `{"date":"2026-11-16","amount":-1,"description":"x"}`, dates},
		{rwZicht, `{"amount":-1,"description":"x"}`, dates},
		{rwZicht, `{"date":"2028-12-01","amount":-1,"description":"x"}`, "Kies een datum binnen 24 maanden."},
		{rwZicht, `{"date":"20 december","amount":-1,"description":"x"}`, "Kies een datum als 2026-11-18."},
		{rwSpaar, base, "Kies een betaalrekening."},
		{rwZicht, `{"date":"2026-11-17","amount":68000,"description":"vandaag"}`, ""},
		{rwZicht, `{"date":"2028-11-30","amount":-1,"description":"de laatste dag"}`, ""},
	} {
		_, err := create(bert, c.account, c.body)
		wantInvalid(t, c.body, err, c.message)
	}
	kerst, err := create(bert, rwGedeeld, base)
	if err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, d, `SELECT COUNT(*) FROM planned_items WHERE id = ? AND created_by = ?`, kerst.ID, bert); n != 1 {
		t.Error("created_by is not the viewer")
	}

	// Lezen and hidden accounts.
	_, err = create(partner, rwGedeeld, base)
	wantErr(t, "create with Lezen", err, apperr.ErrForbidden)
	_, err = create(partner, rwZicht, base)
	wantErr(t, "create on Bert's account", err, apperr.ErrNotFound)
	_, err = patch(partner, kerst.ID, `{"amount":-1}`)
	wantErr(t, "patch with Lezen", err, apperr.ErrForbidden)
	wantErr(t, "delete with Lezen", s.DeletePlanned(ctx, partner, kerst.ID), apperr.ErrForbidden)

	// The list starts at the first of the current month and runs by date.
	if _, err := d.Exec(`INSERT INTO planned_items (account_id, created_by, date, amount, description) VALUES
	    (1, 1, '2026-10-31', -1, 'vorige maand'), (1, 1, '2026-11-01', -2, 'begin deze maand'), (6, 2, '2026-12-01', 246003, 'Partner')`); err != nil {
		t.Fatal(err)
	}
	past := int64(countRows(t, d, `SELECT id FROM planned_items WHERE description = 'begin deze maand'`))
	list := func(viewer int64, scope string) (out []string) {
		t.Helper()
		items, err := s.PlannedItems(ctx, viewer, scope, reportNow)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range items {
			out = append(out, p.Description)
		}
		return out
	}
	for _, c := range []struct {
		viewer int64
		scope  string
		want   []string
	}{
		{bert, "alles", []string{"begin deze maand", "vandaag", "Kerstcadeaus", "de laatste dag"}},
		{bert, "persoonlijk", []string{"begin deze maand", "vandaag", "de laatste dag"}},
		{bert, "gedeeld", []string{"Kerstcadeaus"}},
		{partner, "alles", []string{"Partner", "Kerstcadeaus"}},
	} {
		if got := list(c.viewer, c.scope); !slices.Equal(got, c.want) {
			t.Errorf("%d %s: %v, want %v", c.viewer, c.scope, got, c.want)
		}
	}

	// Update: the date is checked only when it changes, so a passed item stays editable until removed.
	if p, err := patch(bert, past, `{"description":"nog bewerkbaar","amount":-3}`); err != nil || p.Description != "nog bewerkbaar" || p.Amount != -3 || p.Date != "2026-11-01" {
		t.Errorf("edit a passed item: %+v, %v", p, err)
	}
	_, err = patch(bert, past, `{"date":"2026-11-02"}`)
	wantInvalid(t, "move to a passed date", err, dates)
	_, err = patch(bert, past, `{"amount":0}`)
	wantInvalid(t, "zero amount", err, "Vul een omschrijving en een bedrag in.")
	if p, err := patch(bert, kerst.ID, `{"date":"2027-01-05","description":"Nieuwjaar"}`); err != nil || p.Date != "2027-01-05" || p.Amount != -35000 {
		t.Errorf("patch: %+v, %v", p, err)
	}
	_, err = patch(partner, past, `{"amount":-1}`)
	wantErr(t, "patch Bert's item", err, apperr.ErrNotFound)
	wantErr(t, "delete a missing item", s.DeletePlanned(ctx, bert, 9999), apperr.ErrNotFound)
	if err := s.DeletePlanned(ctx, bert, past); err != nil || countRows(t, d, `SELECT COUNT(*) FROM planned_items WHERE id = ?`, past) != 0 {
		t.Errorf("delete: %v", err)
	}
	if _, err := s.PlannedItems(ctx, bert, "iedereen", reportNow); err == nil {
		t.Error("an unknown scope was accepted")
	}
}

func countRows(t *testing.T, d *sql.DB, q string, args ...any) (n int) {
	t.Helper()
	if err := d.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
