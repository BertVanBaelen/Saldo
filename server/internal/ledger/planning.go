package ledger

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// Planning data (plan 0.8-1): the recurring items, budgets and planned items
// the forecast is built on. They belong to an account: every member reads
// them, members with Bewerken write them, and only current accounts carry
// them. Every write checks access first (404 hidden, 403 read-only, 400 not a
// current account) and only then the fields.

// planningMonths is how far ahead a budget or a planned item may lie: the
// longest forecast horizon, counted in months after the running one.
const planningMonths = 24

// Item is a recurring item as the API shows it. The counterparty IBAN it
// matches by is stored but never shown (it can be a member's personal IBAN).
type Item struct {
	ID           int64   `json:"id"`
	AccountID    int64   `json:"accountId"`
	Description  string  `json:"description"`
	Counterparty string  `json:"counterparty"`
	Amount       int64   `json:"amount"`
	AmountRule   string  `json:"amountRule"` // fixed | average
	Frequency    string  `json:"frequency"`  // monthly | quarterly | yearly
	Day          int     `json:"day"`
	Month        *int    `json:"month"` // nil for monthly
	EndDate      *string `json:"endDate"`
	Kind         string  `json:"kind"`  // income | expense | saving | transfer | contribution
	State        string  `json:"state"` // confirmed | ignored
	// CategoryID is the item's category (0.9.1-3): an expense category for an expense item (a top one or a
	// subcategory), a saving category for a saving item; nil is "Zonder categorie".
	CategoryID *int64 `json:"categoryId"`
}

// ItemFields are the fields of a recurring item in a request: a PATCH names
// the ones that change, a POST all it needs (amountRule and state default to
// fixed and confirmed).
type ItemFields struct {
	Description  Opt[string] `json:"description"`
	Counterparty Opt[string] `json:"counterparty"`
	Amount       Opt[int64]  `json:"amount"`
	AmountRule   Opt[string] `json:"amountRule"`
	Frequency    Opt[string] `json:"frequency"`
	Day          Opt[int]    `json:"day"`
	Month        Opt[int]    `json:"month"`
	EndDate      Opt[string] `json:"endDate"`
	Kind         Opt[string] `json:"kind"`
	State        Opt[string] `json:"state"`
	CategoryID   Opt[int64]  `json:"categoryId"`
}

// ItemInput is the body of POST /api/planning/items. FromSuggestion makes the
// server copy the counterparty IBAN of the account's newest booked row with
// the same key and sign (the IBAN is never part of a request).
type ItemInput struct {
	AccountID      int64 `json:"accountId"`
	FromSuggestion bool  `json:"fromSuggestion"`
	ItemFields
}

// apply puts the named fields on it; a null clears month and end date and
// reads as the zero value elsewhere (which validation refuses).
func (it *Item) apply(f ItemFields) {
	if f.Description.Set {
		it.Description = f.Description.V
	}
	if f.Counterparty.Set {
		it.Counterparty = f.Counterparty.V
	}
	if f.Amount.Set {
		it.Amount = f.Amount.V
	}
	if f.AmountRule.Set {
		it.AmountRule = f.AmountRule.V
	}
	if f.Frequency.Set {
		it.Frequency = f.Frequency.V
	}
	if f.Day.Set {
		it.Day = f.Day.V
	}
	if f.Month.Set {
		it.Month = nil
		if !f.Month.Null {
			it.Month = ptr(f.Month.V)
		}
	}
	if f.EndDate.Set {
		it.EndDate = nil
		if !f.EndDate.Null {
			it.EndDate = ptr(f.EndDate.V)
		}
	}
	if f.Kind.Set {
		it.Kind = f.Kind.V
	}
	if f.State.Set {
		it.State = f.State.V
	}
	if f.CategoryID.Set {
		it.CategoryID = nil
		if !f.CategoryID.Null {
			it.CategoryID = ptr(f.CategoryID.V)
		}
	}
}

// validate checks a whole item and normalises it: trimmed texts, an ignored
// item's description is its counterparty, no month for a monthly item. shared
// is whether its account is shared; endChanged whether the end date was set
// or changed (only then it must not lie in the past).
func (it *Item) validate(shared, endChanged bool, today string) error {
	it.Description, it.Counterparty = strings.TrimSpace(it.Description), strings.TrimSpace(it.Counterparty)
	switch {
	case !oneOf(it.Kind, "income", "expense", "saving", "transfer", "contribution"):
		return apperr.Invalid("Kies inkomst, uitgave, sparen, overschrijving of bijdrage.")
	case !oneOf(it.Frequency, "monthly", "quarterly", "yearly"):
		return apperr.Invalid("Kies maandelijks, per kwartaal of jaarlijks.")
	case !oneOf(it.AmountRule, "fixed", "average"):
		return apperr.Invalid("Kies een vast bedrag of het gemiddelde.")
	case !oneOf(it.State, "confirmed", "ignored"):
		return apperr.Invalid("Kies bevestigd of genegeerd.")
	case utf8.RuneCountInString(it.Counterparty) > 140:
		return apperr.Invalid("De tegenpartij heeft hoogstens 140 tekens.")
	}
	if it.State == "ignored" {
		it.Description = it.Counterparty
	}
	switch {
	case it.Description == "":
		return apperr.Invalid("Geef de post een naam.")
	case it.State == "confirmed" && utf8.RuneCountInString(it.Description) > 80:
		return apperr.Invalid("De naam heeft hoogstens 80 tekens.")
	case it.Amount == 0:
		return apperr.Invalid("Vul een bedrag in.")
	case it.Amount > MaxBuffer || it.Amount < -MaxBuffer:
		return apperr.Invalid("Dit bedrag is te groot.")
	case it.Kind == "contribution" && !shared:
		return apperr.Invalid("Een bijdrage hoort bij een gedeelde rekening.")
	case it.Kind == "transfer" && shared:
		return apperr.Invalid("Kies inkomst of bijdrage voor een gedeelde rekening.")
	case (it.Kind == "income" || it.Kind == "contribution") && it.Amount < 0, (it.Kind == "expense" || it.Kind == "saving") && it.Amount > 0:
		return apperr.Invalid("Een inkomst is positief, een uitgave negatief.")
	case it.Day < 1 || it.Day > 31:
		return apperr.Invalid("Kies een dag van 1 tot 31.")
	}
	if it.Frequency == "monthly" {
		it.Month = nil
	} else if it.Month == nil || *it.Month < 1 || *it.Month > 12 {
		return apperr.Invalid("Kies de maand.")
	}
	if it.EndDate != nil && endChanged {
		if _, err := time.Parse(time.DateOnly, *it.EndDate); err != nil {
			return apperr.Invalid("Kies een datum als 2026-11-18.")
		}
		if *it.EndDate < today {
			return apperr.Invalid("Kies een einddatum vanaf vandaag.")
		}
	}
	return nil
}

// checkCategory checks the item's category against its kind, in the transaction of the write (0.9.1-3): an expense
// item takes a category whose top is an expense category that does not count as saved, a saving item one whose top
// does, every other kind none. A category the request names (named) that does not fit is refused; one that was
// stored and no longer fits (the kind changed) is cleared. An ignored item never keeps one.
func (it *Item) checkCategory(ctx context.Context, tx *sql.Tx, named bool) error {
	if it.State == "ignored" {
		it.CategoryID = nil
	}
	if it.CategoryID == nil {
		return nil
	}
	var typ string
	var saving bool
	err := tx.QueryRowContext(ctx, `SELECT t.type, t.saving = 1 FROM categories c JOIN categories t ON t.id = COALESCE(c.parent_id, c.id)
		WHERE c.id = ?`, *it.CategoryID).Scan(&typ, &saving)
	msg := ""
	switch {
	case errors.Is(err, sql.ErrNoRows):
		msg = "Die categorie bestaat niet."
	case err != nil:
		return err
	case it.Kind != "expense" && it.Kind != "saving":
		msg = "Alleen een uitgave of sparen krijgt een categorie."
	case it.Kind == "expense" && (typ != "expense" || saving):
		msg = "Kies een uitgavencategorie die niet als gespaard telt."
	case it.Kind == "saving" && !saving:
		msg = "Kies een spaarcategorie."
	}
	switch {
	case msg == "":
	case named:
		return apperr.Invalid(msg)
	default:
		it.CategoryID = nil
	}
	return nil
}

func oneOf(s string, options ...string) bool {
	for _, o := range options {
		if s == o {
			return true
		}
	}
	return false
}

// today is the Brussels date of now.
func today(now time.Time) string { return now.In(clock.Brussels).Format(time.DateOnly) }

// editableCurrent is the check before a write to an account's planning data:
// the account is the viewer's (else apperr.ErrNotFound), the viewer may edit
// it (else apperr.ErrForbidden) and it is a current account.
func editableCurrent(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, viewer, account int64) (access, error) {
	a, err := accessOf(ctx, q, viewer, account)
	if err != nil {
		return a, err
	}
	if err := a.edit(); err != nil {
		return a, err
	}
	if a.typ != "current" {
		return a, apperr.Invalid("Kies een betaalrekening.")
	}
	return a, nil
}

const itemColumns = `id, account_id, description, counterparty, amount, amount_rule, frequency, expected_day, expected_month, end_date, kind, state, category_id`

type scanner interface{ Scan(...any) error }

func scanItem(r scanner) (Item, error) {
	var it Item
	var month, category sql.NullInt64
	var end sql.NullString
	if err := r.Scan(&it.ID, &it.AccountID, &it.Description, &it.Counterparty, &it.Amount, &it.AmountRule, &it.Frequency,
		&it.Day, &month, &end, &it.Kind, &it.State, &category); err != nil {
		return it, err
	}
	if month.Valid {
		it.Month = ptr(int(month.Int64))
	}
	if category.Valid {
		it.CategoryID = &category.Int64
	}
	if end.Valid {
		it.EndDate = &end.String
	}
	return it, nil
}

// PlanningItems lists the recurring items of the current accounts of the
// scope the viewer holds, confirmed and ignored: by account (the order of
// Accounts), state, day and id.
func (s *Store) PlanningItems(ctx context.Context, viewer int64, scope string) ([]Item, error) {
	sel, err := s.reportSelection(ctx, viewer, scope, 0)
	if err != nil {
		return nil, err
	}
	out := []Item{}
	if len(sel) == 0 {
		return out, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+itemColumns+` FROM recurring_items WHERE account_id IN `+idList(sel)+`
		ORDER BY account_id, state, expected_day, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// CreateItem stores a recurring item on an account the viewer may edit. key
// is planning.Key (ledger cannot import planning): with FromSuggestion the
// item gets the counterparty IBAN of the newest booked row of the account
// whose name has the same key and whose sign is the item's.
func (s *Store) CreateItem(ctx context.Context, viewer int64, in ItemInput, now time.Time, key func(string) string) (Item, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	a, err := editableCurrent(ctx, tx, viewer, in.AccountID)
	if err != nil {
		return Item{}, err
	}
	it := Item{AccountID: in.AccountID, AmountRule: "fixed", State: "confirmed"}
	it.apply(in.ItemFields)
	if err := it.validate(a.shared(), true, today(now)); err != nil {
		return Item{}, err
	}
	if err := it.checkCategory(ctx, tx, true); err != nil {
		return Item{}, err
	}
	var iban any
	if in.FromSuggestion && key != nil {
		if iban, err = suggestionIBAN(ctx, tx, it.AccountID, it.Counterparty, it.Amount, key); err != nil {
			return Item{}, err
		}
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO recurring_items (account_id, counterparty, counterparty_iban, description, amount, amount_rule,
		frequency, expected_day, expected_month, end_date, kind, state, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		it.AccountID, it.Counterparty, iban, it.Description, it.Amount, it.AmountRule, it.Frequency, it.Day, it.Month, it.EndDate,
		it.Kind, it.State, it.CategoryID).Scan(&it.ID)
	if err != nil {
		return Item{}, err
	}
	return it, tx.Commit()
}

// suggestionIBAN is the normalised counterparty IBAN of the newest booked row
// of the account with the counterparty's key, the sign of amount and an amount
// within 10 % of it (so a holder's € 450 contribution and € 200 savings order,
// one name, keep their own IBANs); rows without an IBAN are skipped (detection
// folds them into the IBAN run); nil when no qualifying row carries an IBAN or
// they carry different IBANs.
func suggestionIBAN(ctx context.Context, tx *sql.Tx, account int64, counterparty string, amount int64, key func(string) string) (any, error) {
	want := key(counterparty)
	if want == "" {
		return nil, nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT COALESCE(counterparty_name, ''), COALESCE(counterparty_iban, '') FROM transactions
		WHERE account_id = ?1 AND status = 'booked' AND amount * ?2 > 0 AND ABS(amount - ?2) * 10 <= ABS(?2) AND counterparty_name <> ''
		ORDER BY booking_date DESC, id DESC`, account, amount)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	found, newest := false, ""
	for rows.Next() {
		var name, iban string
		if err := rows.Scan(&name, &iban); err != nil {
			return nil, err
		}
		if key(name) != want {
			continue
		}
		if iban = NormalizeIBAN(iban); iban == "" {
			continue // a row without an IBAN (a Bilance import) says nothing
		} else if !found {
			found, newest = true, iban
		} else if iban != newest {
			return nil, nil // the amounts do not tell two IBANs apart
		}
	}
	return nullIfEmpty(newest), rows.Err()
}

// UpdateItem changes the named fields of a recurring item on an account the
// viewer may edit, checking the whole item again. A changed counterparty
// clears the IBAN the item matched by. A category the request does not name
// is cleared when the new kind or state no longer fits it (checkCategory). The
// account never changes.
func (s *Store) UpdateItem(ctx context.Context, viewer, id int64, f ItemFields, now time.Time) (Item, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	it, a, err := loadItem(ctx, tx, viewer, id)
	if err != nil {
		return Item{}, err
	}
	if err := a.edit(); err != nil {
		return Item{}, err
	}
	was := it
	it.apply(f)
	if err := it.validate(a.shared(), f.EndDate.Set && !equalPtr(was.EndDate, it.EndDate), today(now)); err != nil {
		return Item{}, err
	}
	if err := it.checkCategory(ctx, tx, f.CategoryID.Set); err != nil {
		return Item{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE recurring_items SET counterparty = ?1, description = ?2, amount = ?3, amount_rule = ?4, frequency = ?5,
		expected_day = ?6, expected_month = ?7, end_date = ?8, kind = ?9, state = ?10, category_id = ?12,
		counterparty_iban = CASE WHEN counterparty = ?1 THEN counterparty_iban END WHERE id = ?11`,
		it.Counterparty, it.Description, it.Amount, it.AmountRule, it.Frequency, it.Day, it.Month, it.EndDate, it.Kind, it.State, id, it.CategoryID); err != nil {
		return Item{}, err
	}
	return it, tx.Commit()
}

// DeleteItem removes a recurring item (an ignored one brings its suggestion
// back) from an account the viewer may edit.
func (s *Store) DeleteItem(ctx context.Context, viewer, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, a, err := loadItem(ctx, tx, viewer, id)
	if err != nil {
		return err
	}
	if err := a.edit(); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM recurring_items WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// loadItem reads an item and the viewer's access to its account; an unknown
// item and one on a hidden account are both apperr.ErrNotFound.
func loadItem(ctx context.Context, tx *sql.Tx, viewer, id int64) (Item, access, error) {
	it, err := scanItem(tx.QueryRowContext(ctx, `SELECT `+itemColumns+` FROM recurring_items WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return it, access{}, apperr.ErrNotFound
	}
	if err != nil {
		return it, access{}, err
	}
	a, err := accessOf(ctx, tx, viewer, it.AccountID)
	return it, a, err
}

func equalPtr[T comparable](a, b *T) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

// Budget is one row of "from this month on, this category of this account has
// this budget"; a nil Amount means no budget (the forecast uses the average).
type Budget struct {
	ID         int64  `json:"id"`
	AccountID  int64  `json:"accountId"`
	CategoryID int64  `json:"categoryId"`
	FromMonth  string `json:"fromMonth"`
	Amount     *int64 `json:"amount"`
}

// BudgetInput is the body of PUT /api/planning/budgets; amount is required
// (a number or null).
type BudgetInput struct {
	AccountID  int64      `json:"accountId"`
	CategoryID int64      `json:"categoryId"`
	FromMonth  string     `json:"fromMonth"`
	Amount     Opt[int64] `json:"amount"`
}

func budgetsOf(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, where string, args ...any) ([]Budget, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, account_id, category_id, from_month, monthly_amount FROM budgets WHERE `+where+`
		ORDER BY account_id, category_id, from_month`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Budget{}
	for rows.Next() {
		var b Budget
		var amount sql.NullInt64
		if err := rows.Scan(&b.ID, &b.AccountID, &b.CategoryID, &b.FromMonth, &amount); err != nil {
			return nil, err
		}
		if amount.Valid {
			b.Amount = &amount.Int64
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Budgets lists the budget rows of the current accounts of the scope the
// viewer holds, by account, category and month.
func (s *Store) Budgets(ctx context.Context, viewer int64, scope string) ([]Budget, error) {
	sel, err := s.reportSelection(ctx, viewer, scope, 0)
	if err != nil || len(sel) == 0 {
		return []Budget{}, err
	}
	return budgetsOf(ctx, s.db, `account_id IN `+idList(sel))
}

// SetBudget sets the budget of a top expense category (not a saving one) from
// a month on, in one transaction: it upserts the row of fromMonth (the current
// month to the current month + 24) and deletes the later rows of that account
// and category. A nil amount right after no row or a nil row is no row at
// all. It answers the rows of that account and category.
func (s *Store) SetBudget(ctx context.Context, viewer int64, in BudgetInput, now time.Time) ([]Budget, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := editableCurrent(ctx, tx, viewer, in.AccountID); err != nil {
		return nil, err
	}
	var top, saving bool
	var typ string
	err = tx.QueryRowContext(ctx, `SELECT parent_id IS NULL, type, saving = 1 FROM categories WHERE id = ?`, in.CategoryID).Scan(&top, &typ, &saving)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil, apperr.Invalid("Die categorie bestaat niet.")
	case err != nil:
		return nil, err
	case typ != "expense":
		return nil, apperr.Invalid("Kies een uitgavencategorie.")
	case !top:
		return nil, apperr.Invalid("Een budget hoort bij een hoofdcategorie.")
	case saving:
		return nil, apperr.Invalid("Voor een spaarcategorie stel je geen budget in.")
	}
	if _, err := parseMonth(in.FromMonth); err != nil {
		return nil, err
	}
	first := now.In(clock.Brussels)
	first = time.Date(first.Year(), first.Month(), 1, 0, 0, 0, 0, clock.Brussels)
	if in.FromMonth < first.Format("2006-01") || in.FromMonth > first.AddDate(0, planningMonths, 0).Format("2006-01") {
		return nil, apperr.Invalid("Kies een maand vanaf deze maand, tot 24 maanden vooruit.")
	}
	switch {
	case !in.Amount.Set:
		return nil, apperr.Invalid("De gegevens kloppen niet.")
	case !in.Amount.Null && in.Amount.V < 0:
		return nil, apperr.Invalid("Een budget is niet negatief.")
	case in.Amount.V > MaxBuffer:
		return nil, apperr.Invalid("Dit bedrag is te groot.")
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM budgets WHERE account_id = ? AND category_id = ? AND from_month > ?`,
		in.AccountID, in.CategoryID, in.FromMonth); err != nil {
		return nil, err
	}
	if in.Amount.Null {
		var prev sql.NullInt64
		err := tx.QueryRowContext(ctx, `SELECT monthly_amount FROM budgets WHERE account_id = ? AND category_id = ? AND from_month < ?
			ORDER BY from_month DESC LIMIT 1`, in.AccountID, in.CategoryID, in.FromMonth).Scan(&prev)
		if errors.Is(err, sql.ErrNoRows) || err == nil && !prev.Valid {
			if _, err := tx.ExecContext(ctx, `DELETE FROM budgets WHERE account_id = ? AND category_id = ? AND from_month = ?`,
				in.AccountID, in.CategoryID, in.FromMonth); err != nil {
				return nil, err
			}
			return commitBudgets(ctx, tx, in)
		}
		if err != nil {
			return nil, err
		}
	}
	var amount any
	if !in.Amount.Null {
		amount = in.Amount.V
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO budgets (account_id, category_id, monthly_amount, from_month) VALUES (?, ?, ?, ?)
		ON CONFLICT (account_id, category_id, from_month) DO UPDATE SET monthly_amount = excluded.monthly_amount`,
		in.AccountID, in.CategoryID, amount, in.FromMonth); err != nil {
		return nil, err
	}
	return commitBudgets(ctx, tx, in)
}

func commitBudgets(ctx context.Context, tx *sql.Tx, in BudgetInput) ([]Budget, error) {
	out, err := budgetsOf(ctx, tx, `account_id = ? AND category_id = ?`, in.AccountID, in.CategoryID)
	if err != nil {
		return nil, err
	}
	return out, tx.Commit()
}

// Planned is a one-off expense or income on a day, or somewhere in a month
// (0.8.1-9, WholeMonth: Date is nil and the engine spreads it over the month),
// as the API shows it. Month is always set. It is stored as the day, or as the
// month's 1st with whole_month = 1.
type Planned struct {
	ID          int64   `json:"id"`
	AccountID   int64   `json:"accountId"`
	Date        *string `json:"date"`  // YYYY-MM-DD; nil for a dayless item
	Month       string  `json:"month"` // YYYY-MM
	WholeMonth  bool    `json:"wholeMonth"`
	Amount      int64   `json:"amount"`
	Description string  `json:"description"`
}

// PlannedFields are the fields of a planned item in a request: a date or a
// month (YYYY-MM, a dayless item), never both. A null counts as not named, so
// a PATCH may send {"date": null, "month": "2027-07"}.
type PlannedFields struct {
	Date        Opt[string] `json:"date"`
	Month       Opt[string] `json:"month"`
	Amount      Opt[int64]  `json:"amount"`
	Description Opt[string] `json:"description"`
}

// PlannedInput is the body of POST /api/planning/planned.
type PlannedInput struct {
	AccountID int64 `json:"accountId"`
	PlannedFields
}

// stored is the value of the date column: the day, or the month's 1st for a
// dayless item.
func (p Planned) stored() string {
	if p.Date != nil {
		return *p.Date
	}
	return p.Month + "-01"
}

// apply puts the named fields on it; a date makes the item dated, a month
// makes it dayless. Naming both is refused before anything else is checked.
func (p *Planned) apply(f PlannedFields) error {
	date, month := f.Date.Set && !f.Date.Null, f.Month.Set && !f.Month.Null
	switch {
	case date && month:
		return apperr.Invalid("Kies een dag of alleen een maand.")
	case date:
		p.Date, p.Month, p.WholeMonth = ptr(f.Date.V), "", false
		if len(f.Date.V) >= 7 {
			p.Month = f.Date.V[:7]
		}
	case month:
		p.Date, p.Month, p.WholeMonth = nil, f.Month.V, true
	}
	if f.Amount.Set {
		p.Amount = f.Amount.V
	}
	if f.Description.Set {
		p.Description = f.Description.V
	}
	return nil
}

// validate checks a whole planned item; a date must lie from today to the
// last day of the month planningMonths after this one, a month from this month
// to that one, but only when it was set or changed (a passed item stays
// editable until it is removed).
func (p *Planned) validate(dateChanged bool, now time.Time) error {
	p.Description = strings.TrimSpace(p.Description)
	switch {
	case p.Description == "" || p.Amount == 0:
		return apperr.Invalid("Vul een omschrijving en een bedrag in.")
	case utf8.RuneCountInString(p.Description) > 80:
		return apperr.Invalid("De omschrijving heeft hoogstens 80 tekens.")
	case p.Amount > MaxBuffer || p.Amount < -MaxBuffer:
		return apperr.Invalid("Dit bedrag is te groot.")
	case !dateChanged:
		return nil
	}
	n := now.In(clock.Brussels)
	if p.WholeMonth {
		if _, err := parseMonth(p.Month); err != nil {
			return err
		}
		first := time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, clock.Brussels)
		switch {
		case p.Month < first.Format("2006-01"):
			return apperr.Invalid("Kies een maand vanaf deze maand.")
		case p.Month > first.AddDate(0, planningMonths, 0).Format("2006-01"):
			return apperr.Invalid("Kies een maand binnen 24 maanden.")
		}
		return nil
	}
	date := ""
	if p.Date != nil {
		date = *p.Date
	}
	if _, err := time.Parse(time.DateOnly, date); err != nil {
		if date == "" {
			return apperr.Invalid("Kies een datum vanaf vandaag.")
		}
		return apperr.Invalid("Kies een datum als 2026-11-18.")
	}
	last := time.Date(n.Year(), n.Month()+planningMonths+1, 0, 0, 0, 0, 0, clock.Brussels).Format(time.DateOnly)
	switch {
	case date < today(now):
		return apperr.Invalid("Kies een datum vanaf vandaag.")
	case date > last:
		return apperr.Invalid("Kies een datum binnen 24 maanden.")
	}
	return nil
}

// PlannedItems lists the planned items of the current accounts of the scope
// the viewer holds that are dated from the first day of the current month,
// by date and id.
func (s *Store) PlannedItems(ctx context.Context, viewer int64, scope string, now time.Time) ([]Planned, error) {
	sel, err := s.reportSelection(ctx, viewer, scope, 0)
	out := []Planned{}
	if err != nil || len(sel) == 0 {
		return out, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+plannedColumns+` FROM planned_items
		WHERE account_id IN `+idList(sel)+` AND date >= ? ORDER BY date, id`, today(now)[:7]+"-01")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanPlanned(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

const plannedColumns = `id, account_id, date, whole_month, amount, description`

// scanPlanned reads a row of plannedColumns: a dayless item has no Date, its
// stored date is only the month's 1st.
func scanPlanned(r scanner) (Planned, error) {
	var p Planned
	var date string
	if err := r.Scan(&p.ID, &p.AccountID, &date, &p.WholeMonth, &p.Amount, &p.Description); err != nil {
		return p, err
	}
	p.Month = date[:7]
	if !p.WholeMonth {
		p.Date = &date
	}
	return p, nil
}

// CreatePlanned stores a planned item, created by the viewer, on an account
// the viewer may edit.
func (s *Store) CreatePlanned(ctx context.Context, viewer int64, in PlannedInput, now time.Time) (Planned, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Planned{}, err
	}
	defer tx.Rollback()
	if _, err := editableCurrent(ctx, tx, viewer, in.AccountID); err != nil {
		return Planned{}, err
	}
	p := Planned{AccountID: in.AccountID}
	if err := p.apply(in.PlannedFields); err != nil {
		return Planned{}, err
	}
	if err := p.validate(true, now); err != nil {
		return Planned{}, err
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO planned_items (account_id, created_by, date, whole_month, amount, description) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
		p.AccountID, viewer, p.stored(), p.WholeMonth, p.Amount, p.Description).Scan(&p.ID)
	if err != nil {
		return Planned{}, err
	}
	return p, tx.Commit()
}

// UpdatePlanned changes the named fields of a planned item on an account the
// viewer may edit, checking the whole item again.
func (s *Store) UpdatePlanned(ctx context.Context, viewer, id int64, f PlannedFields, now time.Time) (Planned, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Planned{}, err
	}
	defer tx.Rollback()
	p, a, err := loadPlanned(ctx, tx, viewer, id)
	if err != nil {
		return Planned{}, err
	}
	if err := a.edit(); err != nil {
		return Planned{}, err
	}
	was := p
	if err := p.apply(f); err != nil {
		return Planned{}, err
	}
	// Switching between a day and a month changes the item even when the stored 1st stays the same.
	if err := p.validate(p.WholeMonth != was.WholeMonth || p.stored() != was.stored(), now); err != nil {
		return Planned{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE planned_items SET date = ?, whole_month = ?, amount = ?, description = ? WHERE id = ?`,
		p.stored(), p.WholeMonth, p.Amount, p.Description, id); err != nil {
		return Planned{}, err
	}
	return p, tx.Commit()
}

// DeletePlanned removes a planned item from an account the viewer may edit.
func (s *Store) DeletePlanned(ctx context.Context, viewer, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, a, err := loadPlanned(ctx, tx, viewer, id)
	if err != nil {
		return err
	}
	if err := a.edit(); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM planned_items WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func loadPlanned(ctx context.Context, tx *sql.Tx, viewer, id int64) (Planned, access, error) {
	p, err := scanPlanned(tx.QueryRowContext(ctx, `SELECT `+plannedColumns+` FROM planned_items WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return p, access{}, apperr.ErrNotFound
	}
	if err != nil {
		return p, access{}, err
	}
	a, err := accessOf(ctx, tx, viewer, p.AccountID)
	return p, a, err
}
