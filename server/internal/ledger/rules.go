package ledger

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// Rules (phase 0.4-2, docs/api.md "Rules"). A rule belongs to an account
// (seen by its members, changed by those with edit) or to a user (seen and
// changed by that user only, applied to their personal accounts). The
// matching itself is categorise's.

// RuleView is a rule as the API shows it; the IBAN is masked.
type RuleView struct {
	ID                 int64   `json:"id"`
	AccountID          *int64  `json:"accountId"`
	Priority           int     `json:"priority"`
	Counterparty       *string `json:"counterparty"`
	CounterpartyExact  bool    `json:"counterpartyExact"`
	CounterpartyIBAN   *string `json:"counterpartyIban"`
	Communication      *string `json:"communication"`
	CommunicationRegex bool    `json:"communicationRegex"`
	AmountMin          *int64  `json:"amountMin"`
	AmountMax          *int64  `json:"amountMax"`
	CategoryID         int64   `json:"categoryId"`
	Permission         string  `json:"permission"`
}

// RuleInput is the body of POST and PATCH /api/rules: in a PATCH a field
// left out stays, null (or "") clears a condition.
type RuleInput struct {
	AccountID          Opt[int64]  `json:"accountId"`
	Priority           Opt[int]    `json:"priority"`
	Counterparty       Opt[string] `json:"counterparty"`
	CounterpartyExact  Opt[bool]   `json:"counterpartyExact"`
	CounterpartyIBAN   Opt[string] `json:"counterpartyIban"`
	Communication      Opt[string] `json:"communication"`
	CommunicationRegex Opt[bool]   `json:"communicationRegex"`
	AmountMin          Opt[int64]  `json:"amountMin"`
	AmountMax          Opt[int64]  `json:"amountMax"`
	CategoryID         Opt[int64]  `json:"categoryId"`
}

// visibleRules are the viewer's own user rules and the rules of the accounts
// the viewer holds, with the viewer's permission on them.
const visibleRules = `SELECT ` + categorise.RuleColumns + `, COALESCE(me.permission, 'edit') FROM rules
	LEFT JOIN account_access me ON me.account_id = rules.account_id AND me.user_id = ?1
	WHERE (rules.user_id = ?1 OR me.user_id IS NOT NULL)`

func scanView(row interface{ Scan(...any) error }) (RuleView, error) {
	var perm string
	r, err := categorise.ScanRule(scanTail{row, &perm})
	if err != nil {
		return RuleView{}, err
	}
	v := RuleView{ID: r.ID, Priority: r.Priority, CounterpartyExact: r.CounterpartyExact, CommunicationRegex: r.CommunicationRegex,
		AmountMin: r.AmountMin, AmountMax: r.AmountMax, CategoryID: r.CategoryID, Permission: perm}
	if r.AccountID != 0 {
		v.AccountID = &r.AccountID
	}
	if r.Counterparty != "" {
		v.Counterparty = &r.Counterparty
	}
	if r.CounterpartyIBAN != "" {
		m := MaskIBAN(r.CounterpartyIBAN)
		if m == "" { // shorter than an IBAN: show nothing of it
			m = "••••"
		}
		v.CounterpartyIBAN = &m
	}
	if r.Communication != "" {
		v.Communication = &r.Communication
	}
	return v, nil
}

// scanTail appends extra destinations to a Scan.
type scanTail struct {
	row  interface{ Scan(...any) error }
	tail any
}

func (s scanTail) Scan(dest ...any) error { return s.row.Scan(append(dest, s.tail)...) }

// Rules lists the rules the viewer can see, in evaluation order (priority
// DESC, then the newest first).
func (s *Store) Rules(ctx context.Context, viewer int64) ([]RuleView, error) {
	return rulesOf(ctx, s.db, viewer)
}

func rulesOf(ctx context.Context, q categorise.DB, viewer int64) ([]RuleView, error) {
	rows, err := q.QueryContext(ctx, visibleRules+` ORDER BY rules.priority DESC, rules.id DESC`, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []RuleView{}
	for rows.Next() {
		v, err := scanView(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, v)
	}
	return list, rows.Err()
}

// rule loads one visible rule: hidden is apperr.ErrNotFound.
func rule(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, viewer, id int64) (categorise.Rule, string, error) {
	var perm string
	r, err := categorise.ScanRule(scanTail{q.QueryRowContext(ctx, visibleRules+` AND rules.id = ?2`, viewer, id), &perm})
	if errors.Is(err, sql.ErrNoRows) {
		return r, "", apperr.ErrNotFound
	}
	return r, perm, err
}

func (s *Store) ruleView(ctx context.Context, viewer, id int64) (RuleView, error) {
	return scanView(s.db.QueryRowContext(ctx, visibleRules+` AND rules.id = ?2`, viewer, id))
}

// CreateRule adds a rule for an account the viewer may edit, or (accountId
// null or left out) for the viewer. It does not run it: POST
// /api/rules/apply does.
func (s *Store) CreateRule(ctx context.Context, viewer int64, in RuleInput) (RuleView, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RuleView{}, err
	}
	defer tx.Rollback()
	r, err := createRule(ctx, tx, viewer, in)
	if err != nil {
		return RuleView{}, err
	}
	if err := tx.Commit(); err != nil {
		return RuleView{}, err
	}
	return s.ruleView(ctx, viewer, r.ID)
}

// createRule checks and stores a new rule inside the caller's transaction
// (CreateRule, "apply to similar").
func createRule(ctx context.Context, tx *sql.Tx, viewer int64, in RuleInput) (categorise.Rule, error) {
	r, err := ruleOwner(ctx, tx, viewer, in)
	if err != nil {
		return r, err
	}
	if err := applyInput(ctx, tx, &r, in); err != nil {
		return r, err
	}
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM rules WHERE account_id IS ? AND user_id IS ?`,
		nullIfZero(r.AccountID), nullIfZero(r.UserID)).Scan(&n); err != nil {
		return r, err
	}
	if n >= categorise.MaxRulesPerOwner {
		return r, apperr.Invalid("Er zijn al 200 regels voor deze eigenaar. Verwijder er eerst een.")
	}
	cpText, comm, regex := ruleTexts(r)
	err = tx.QueryRowContext(ctx, `INSERT INTO rules (account_id, user_id, priority, counterparty_match, counterparty_exact,
		    counterparty_iban, communication_contains, communication_regex, amount_min, amount_max, category_id, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		nullIfZero(r.AccountID), nullIfZero(r.UserID), r.Priority, cpText, r.CounterpartyExact, nullIfEmpty(r.CounterpartyIBAN),
		comm, regex, r.AmountMin, r.AmountMax, r.CategoryID, viewer).Scan(&r.ID)
	return r, err
}

// ruleOwner is the owner of a new rule: an account the viewer may edit
// (hidden: apperr.ErrNotFound, read-only: apperr.ErrForbidden) or, without
// accountId, the viewer.
func ruleOwner(ctx context.Context, q categorise.DB, viewer int64, in RuleInput) (categorise.Rule, error) {
	if !in.AccountID.Set || in.AccountID.Null {
		return categorise.Rule{UserID: viewer}, nil
	}
	a, err := accessOf(ctx, q, viewer, in.AccountID.V)
	if err != nil {
		return categorise.Rule{}, err
	}
	if a.permission != "edit" {
		return categorise.Rule{}, apperr.ErrForbidden
	}
	return categorise.Rule{AccountID: in.AccountID.V}, nil
}

// UpdateRule changes a visible rule the viewer may edit; its owner stays.
func (s *Store) UpdateRule(ctx context.Context, viewer, id int64, in RuleInput) (RuleView, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return RuleView{}, err
	}
	defer tx.Rollback()
	r, perm, err := rule(ctx, tx, viewer, id)
	if err != nil {
		return RuleView{}, err
	}
	if perm != "edit" {
		return RuleView{}, apperr.ErrForbidden
	}
	if in.AccountID.Set {
		return RuleView{}, apperr.Invalid("De eigenaar van een regel verandert niet. Maak een nieuwe regel.")
	}
	if err := applyInput(ctx, tx, &r, in); err != nil {
		return RuleView{}, err
	}
	cpText, comm, regex := ruleTexts(r)
	if _, err := tx.ExecContext(ctx, `UPDATE rules SET priority = ?, counterparty_match = ?, counterparty_exact = ?,
		    counterparty_iban = ?, communication_contains = ?, communication_regex = ?, amount_min = ?, amount_max = ?, category_id = ?
		WHERE id = ?`, r.Priority, cpText, r.CounterpartyExact, nullIfEmpty(r.CounterpartyIBAN), comm, regex,
		r.AmountMin, r.AmountMax, r.CategoryID, id); err != nil {
		return RuleView{}, err
	}
	if err := tx.Commit(); err != nil {
		return RuleView{}, err
	}
	return s.ruleView(ctx, viewer, id)
}

// DeleteRule deletes a visible rule the viewer may edit. The categories it
// set stay (origin "rule", rule_id NULL through the foreign key).
func (s *Store) DeleteRule(ctx context.Context, viewer, id int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, perm, err := rule(ctx, tx, viewer, id)
	if err != nil {
		return err
	}
	if perm != "edit" {
		return apperr.ErrForbidden
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM rules WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// ApplyRules runs the rules over the eligible rows of every account the
// viewer may edit (categorise.ApplyAccount) and returns how many changed.
func (s *Store) ApplyRules(ctx context.Context, viewer int64) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	accounts, err := editableAccounts(ctx, tx, viewer)
	if err != nil {
		return 0, err
	}
	total := 0
	for _, a := range accounts {
		n, err := categorise.ApplyAccount(ctx, tx, a)
		if err != nil {
			return 0, err
		}
		total += n
	}
	return total, tx.Commit()
}

// editableAccounts are the accounts the viewer holds with edit permission.
func editableAccounts(ctx context.Context, q categorise.DB, viewer int64) ([]int64, error) {
	rows, err := q.QueryContext(ctx, `SELECT account_id FROM account_access WHERE user_id = ? AND permission = 'edit' ORDER BY account_id`, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var accounts []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		accounts = append(accounts, id)
	}
	return accounts, rows.Err()
}

// ruleTexts are the stored counterparty and communication columns.
func ruleTexts(r categorise.Rule) (cp, contains, regex any) {
	cp = nullIfEmpty(r.Counterparty)
	if r.CommunicationRegex {
		return cp, nil, nullIfEmpty(r.Communication)
	}
	return cp, nullIfEmpty(r.Communication), nil
}

// applyInput merges a body into a rule and checks the result.
func applyInput(ctx context.Context, q categorise.DB, r *categorise.Rule, in RuleInput) error {
	if err := applyConditions(r, in); err != nil {
		return err
	}
	if in.CategoryID.Set {
		if in.CategoryID.Null {
			return apperr.Invalid("Kies een categorie.")
		}
		r.CategoryID = in.CategoryID.V
	}
	if r.CategoryID == 0 {
		return apperr.Invalid("Kies een categorie.")
	}
	return categoryExists(ctx, q, r.CategoryID)
}

// applyConditions merges a body's conditions and priority into a rule and
// checks them.
func applyConditions(r *categorise.Rule, in RuleInput) error {
	text := func(o Opt[string], max int, what string, dst *string) error {
		if !o.Set {
			return nil
		}
		if strings.ContainsFunc(o.V, unicode.IsControl) {
			return apperr.Invalid(what + " mag geen stuurtekens bevatten.")
		}
		v := strings.Join(strings.Fields(o.V), " ")
		if utf8.RuneCountInString(v) > max {
			return apperr.Invalid(what + " is te lang.")
		}
		*dst = v
		return nil
	}
	if err := text(in.Counterparty, categorise.MaxCounterparty, "De tegenpartij", &r.Counterparty); err != nil {
		return err
	}
	if in.CounterpartyExact.Set {
		r.CounterpartyExact = in.CounterpartyExact.V
	}
	if in.CommunicationRegex.Set {
		r.CommunicationRegex = in.CommunicationRegex.V
	}
	if in.Communication.Set && r.CommunicationRegex {
		// a pattern keeps its spaces; only the ends are trimmed
		if utf8.RuneCountInString(in.Communication.V) > categorise.MaxCommunication {
			return apperr.Invalid("De mededeling is te lang.")
		}
		r.Communication = strings.TrimSpace(in.Communication.V)
	} else if err := text(in.Communication, categorise.MaxCommunication, "De mededeling", &r.Communication); err != nil {
		return err
	}
	if r.CommunicationRegex && r.Communication != "" {
		if _, err := categorise.Compile(r.Communication); err != nil {
			return apperr.Invalid("Deze reguliere expressie klopt niet.")
		}
	}
	if in.CounterpartyIBAN.Set {
		iban := NormalizeIBAN(in.CounterpartyIBAN.V)
		if iban != "" && (len(iban) < 8 || len(iban) > 34 || iban[0] < 'A' || iban[1] < 'A') {
			return apperr.Invalid("Dit lijkt geen IBAN.")
		}
		r.CounterpartyIBAN = iban
	}
	amount := func(o Opt[int64], dst **int64) error {
		if !o.Set {
			return nil
		}
		if o.Null {
			*dst = nil
			return nil
		}
		if o.V < 0 || o.V > MaxBalance {
			return apperr.Invalid("Vul een bedrag zonder teken in.")
		}
		*dst = &o.V
		return nil
	}
	if err := amount(in.AmountMin, &r.AmountMin); err != nil {
		return err
	}
	if err := amount(in.AmountMax, &r.AmountMax); err != nil {
		return err
	}
	if r.AmountMin != nil && r.AmountMax != nil && *r.AmountMin > *r.AmountMax {
		return apperr.Invalid("Het eerste bedrag moet kleiner zijn dan het tweede.")
	}
	if r.Counterparty == "" && r.CounterpartyIBAN == "" && r.Communication == "" && r.AmountMin == nil && r.AmountMax == nil {
		return apperr.Invalid("Vul minstens één voorwaarde in.")
	}
	if in.Priority.Set {
		if in.Priority.Null || in.Priority.V < 0 || in.Priority.V > 1000 {
			return apperr.Invalid("De prioriteit is een getal van 0 tot 1000.")
		}
		r.Priority = in.Priority.V
	}
	return nil
}

// RulePreviewInput is the body of POST /api/rules/preview: a draft as in
// POST /api/rules (the category may be left out) and the rule it edits.
type RulePreviewInput struct {
	RuleInput
	RuleID Opt[int64] `json:"ruleId"`
}

// RulePreview is what a draft rule would do (phase 0.4-4).
type RulePreview struct {
	Matches int                `json:"matches"`
	Changes int                `json:"changes"`
	Skipped categorise.Skipped `json:"skipped"`
}

// PreviewRule answers what a draft would do to the stored rows of its
// scope (categorise.Plan), writing nothing. The draft is checked like a new
// rule, except that it may lack a category; ruleId names the stored rule it
// edits (it must be the viewer's to edit and have the draft's owner), which
// then leaves the competition.
func (s *Store) PreviewRule(ctx context.Context, viewer int64, in RulePreviewInput) (RulePreview, error) {
	r, err := ruleOwner(ctx, s.db, viewer, in.RuleInput)
	if err != nil {
		return RulePreview{}, err
	}
	r.ID = categorise.PreviewID
	if in.RuleID.Set && !in.RuleID.Null {
		stored, perm, err := rule(ctx, s.db, viewer, in.RuleID.V)
		if err != nil {
			return RulePreview{}, err
		}
		if perm != "edit" {
			return RulePreview{}, apperr.ErrForbidden
		}
		if stored.AccountID != r.AccountID || stored.UserID != r.UserID {
			return RulePreview{}, apperr.Invalid("De eigenaar van een regel verandert niet. Maak een nieuwe regel.")
		}
		r.ID = stored.ID
	}
	if err := applyConditions(&r, in.RuleInput); err != nil {
		return RulePreview{}, err
	}
	if in.CategoryID.Set && !in.CategoryID.Null {
		if err := categoryExists(ctx, s.db, in.CategoryID.V); err != nil {
			return RulePreview{}, err
		}
		r.CategoryID = in.CategoryID.V
	}
	res, err := categorise.Plan(ctx, s.db, r, 0)
	if err != nil {
		return RulePreview{}, err
	}
	return RulePreview{Matches: res.Matches, Changes: len(res.Changes), Skipped: res.Skipped}, nil
}

// ApplyRule runs one rule the viewer may edit over its scope (Plan, then
// Apply) in one database transaction and returns how many rows changed.
func (s *Store) ApplyRule(ctx context.Context, viewer, id int64) (int, categorise.Skipped, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, categorise.Skipped{}, err
	}
	defer tx.Rollback()
	r, perm, err := rule(ctx, tx, viewer, id)
	if err != nil {
		return 0, categorise.Skipped{}, err
	}
	if perm != "edit" {
		return 0, categorise.Skipped{}, apperr.ErrForbidden
	}
	res, err := categorise.Plan(ctx, tx, r, 0)
	if err != nil {
		return 0, categorise.Skipped{}, err
	}
	n, err := categorise.Apply(ctx, tx, res)
	if err != nil {
		return 0, categorise.Skipped{}, err
	}
	return n, res.Skipped, tx.Commit()
}

// ReorderRules gives the rules the viewer may edit new priorities in the
// order of ids (top first), which must be exactly those rules. The current
// priorities sorted descending, v0 >= v1 >= ..., become strictly decreasing
// values p_i = max(n-1-i, min(v_i, p_(i-1) - 1)): distinct values keep
// their place, ties are broken, and none drops below 0 or rises above 1000.
// Rules the viewer cannot edit keep their priority. It answers the list of
// GET /api/rules.
func (s *Store) ReorderRules(ctx context.Context, viewer int64, ids []int64) ([]RuleView, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	list, err := rulesOf(ctx, tx, viewer)
	if err != nil {
		return nil, err
	}
	current := map[int64]int{}
	var values []int // priority DESC: the list's order
	for _, v := range list {
		if v.Permission == "edit" {
			current[v.ID] = v.Priority
			values = append(values, v.Priority)
		}
	}
	stale := apperr.Invalid("De lijst met regels is veranderd. Laad ze opnieuw.")
	if len(ids) != len(values) {
		return nil, stale
	}
	seen := map[int64]bool{}
	for _, id := range ids {
		if _, ok := current[id]; !ok || seen[id] {
			return nil, stale
		}
		seen[id] = true
	}
	n := len(ids)
	if n > 1001 {
		return nil, apperr.Invalid("Er zijn te veel regels om te ordenen.")
	}
	p := math.MaxInt
	for i, id := range ids {
		p = max(n-1-i, min(values[i], p-1))
		if p == current[id] {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE rules SET priority = ? WHERE id = ?`, p, id); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.Rules(ctx, viewer)
}
