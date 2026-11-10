package ledger

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// Categorising a transaction by hand (phase 0.4-3, docs/api.md "Categorise a
// transaction"): a manual category, a note, "apply to similar" and splits.
// Every change needs edit permission on the transaction's account; a hidden
// transaction is apperr.ErrNotFound, a read-only one apperr.ErrForbidden.

const (
	maxNote    = 200
	maxParts   = 10
	msgSplit   = "Deze transactie is gesplitst. Pas de splitsing aan of maak ze ongedaan."
	msgNoCat   = "Die categorie bestaat niet."
	msgSumDiff = "De delen tellen samen niet op tot het bedrag."
)

// TxPatch is the body of PATCH /api/transactions/{id}.
type TxPatch struct {
	CategoryID Opt[int64]  `json:"categoryId"`
	Note       Opt[string] `json:"note"`
}

// SplitPart is one part of the body of PUT /api/transactions/{id}/split.
type SplitPart struct {
	CategoryID int64 `json:"categoryId"`
	Amount     int64 `json:"amount"`
}

// Similar is the preview of "apply to similar and create a rule".
type Similar struct {
	Counterparty string             `json:"counterparty"`
	Scope        string             `json:"scope"`
	Count        int                `json:"count"`
	Skipped      categorise.Skipped `json:"skipped"`
}

// SimilarResult is the answer of "apply to similar and create a rule".
type SimilarResult struct {
	Transaction Transaction        `json:"transaction"`
	Rule        RuleView           `json:"rule"`
	RuleCreated bool               `json:"ruleCreated"`
	Updated     int                `json:"updated"`
	Skipped     categorise.Skipped `json:"skipped"`
}

// txRow is what the write paths read of a transaction.
type txRow struct {
	account, amount, members int64
	status, counterparty     string
	category                 sql.NullInt64
	split                    bool
}

// editable reads a transaction the viewer may change.
func editable(ctx context.Context, q categorise.DB, viewer, id int64) (txRow, error) {
	var t txRow
	var perm string
	err := q.QueryRowContext(ctx, `SELECT t.account_id, t.amount, t.status, t.counterparty_name, t.category_id,
		    EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id),
		    (SELECT COUNT(*) FROM account_access m WHERE m.account_id = t.account_id), me.permission
		FROM transactions t JOIN account_access me ON me.account_id = t.account_id AND me.user_id = ?
		WHERE t.id = ?`, viewer, id).Scan(&t.account, &t.amount, &t.status, &t.counterparty, &t.category, &t.split, &t.members, &perm)
	if errors.Is(err, sql.ErrNoRows) {
		return t, apperr.ErrNotFound
	}
	if err == nil && perm != "edit" {
		err = apperr.ErrForbidden
	}
	return t, err
}

func categoryExists(ctx context.Context, q categorise.DB, id int64) error {
	var ok bool
	if err := q.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM categories WHERE id = ?)`, id).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return apperr.Invalid(msgNoCat)
	}
	return nil
}

// cleanNote trims a note and collapses its white space; "" clears it.
func cleanNote(raw string) (string, error) {
	note := strings.Join(strings.Fields(raw), " ")
	if strings.ContainsFunc(note, unicode.IsControl) {
		return "", apperr.Invalid("Een notitie mag geen stuurtekens bevatten.")
	}
	if utf8.RuneCountInString(note) > maxNote {
		return "", apperr.Invalid("De notitie heeft hoogstens 200 tekens.")
	}
	return note, nil
}

// UpdateTransaction sets a transaction's category by hand
// (categorise.SetManual) and/or its note, in one database transaction.
func (s *Store) UpdateTransaction(ctx context.Context, viewer, id int64, in TxPatch) (Transaction, error) {
	if !in.CategoryID.Set && !in.Note.Set {
		return Transaction{}, apperr.Invalid("Kies een categorie of schrijf een notitie.")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Transaction{}, err
	}
	defer tx.Rollback()
	if _, err := editable(ctx, tx, viewer, id); err != nil {
		return Transaction{}, err
	}
	if in.CategoryID.Set {
		if in.CategoryID.Null {
			return Transaction{}, apperr.Invalid("Kies een categorie.")
		}
		if err := categoryExists(ctx, tx, in.CategoryID.V); err != nil {
			return Transaction{}, err
		}
		if _, err := categorise.SetManual(ctx, tx, id, in.CategoryID.V); errors.Is(err, categorise.ErrSplit) {
			return Transaction{}, apperr.Invalid(msgSplit)
		} else if err != nil {
			return Transaction{}, err
		}
	}
	if in.Note.Set {
		note, err := cleanNote(in.Note.V) // null arrives as ""
		if err != nil {
			return Transaction{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE transactions SET note = ? WHERE id = ?`, nullIfEmpty(note), id); err != nil {
			return Transaction{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Transaction{}, err
	}
	return s.transaction(ctx, viewer, id)
}

// similarRule is the rule "apply to similar" makes for a transaction: the
// row's counterparty (contains) and category, owned by the viewer when the
// row's account has one member, else by that account. An owner's rule whose
// only condition is that counterparty (normalised, contains) is reused with
// the row's category (existing). Counterparty "" means there is no basis.
func similarRule(ctx context.Context, q categorise.DB, viewer, id int64) (txRow, categorise.Rule, bool, error) {
	t, err := editable(ctx, q, viewer, id)
	if err != nil {
		return t, categorise.Rule{}, false, err
	}
	if t.split {
		return t, categorise.Rule{}, false, apperr.Invalid(msgSplit)
	}
	if !t.category.Valid {
		return t, categorise.Rule{}, false, apperr.Invalid("Kies eerst een categorie.")
	}
	r := categorise.Rule{ID: categorise.PreviewID, UserID: viewer, Counterparty: ruleCounterparty(t.counterparty), CategoryID: t.category.Int64}
	if t.members != 1 {
		r.UserID, r.AccountID = 0, t.account
	}
	if r.Counterparty == "" {
		return t, r, false, nil
	}
	rows, err := q.QueryContext(ctx, `SELECT `+categorise.RuleColumns+` FROM rules
		WHERE account_id IS ? AND user_id IS ? AND counterparty_exact = 0 AND counterparty_match IS NOT NULL
		  AND counterparty_iban IS NULL AND communication_contains IS NULL AND communication_regex IS NULL
		  AND amount_min IS NULL AND amount_max IS NULL
		ORDER BY priority DESC, id DESC`, nullIfZero(r.AccountID), nullIfZero(r.UserID))
	if err != nil {
		return t, r, false, err
	}
	defer rows.Close()
	want := categorise.Normalise(r.Counterparty)
	for rows.Next() {
		found, err := categorise.ScanRule(rows)
		if err != nil {
			return t, r, false, err
		}
		if categorise.Normalise(found.Counterparty) == want {
			found.CategoryID = r.CategoryID
			return t, found, true, nil
		}
	}
	return t, r, false, rows.Err()
}

// ruleCounterparty cleans a counterparty name like rule input: no control
// characters, white space collapsed, at most MaxCounterparty characters.
func ruleCounterparty(name string) string {
	s := strings.Join(strings.Fields(name), " ")
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	if n := []rune(s); len(n) > categorise.MaxCounterparty {
		s = string(n[:categorise.MaxCounterparty])
	}
	return strings.Join(strings.Fields(s), " ")
}

func scopeOf(r categorise.Rule) string {
	if r.AccountID != 0 {
		return "account"
	}
	return "user"
}

// SimilarPreview answers what "apply to similar and create a rule" would do
// for a transaction; it writes nothing.
func (s *Store) SimilarPreview(ctx context.Context, viewer, id int64) (Similar, error) {
	_, r, _, err := similarRule(ctx, s.db, viewer, id)
	if err != nil {
		return Similar{}, err
	}
	out := Similar{Counterparty: r.Counterparty, Scope: scopeOf(r)}
	if r.Counterparty == "" {
		return out, nil
	}
	res, err := categorise.Plan(ctx, s.db, r, id)
	if err != nil {
		return Similar{}, err
	}
	out.Count, out.Skipped = len(res.Changes), res.Skipped
	return out, nil
}

// ApplySimilar fixes a transaction's current category by hand, creates or
// reuses the rule of similarRule and applies it to the rows it covers, all
// in one database transaction.
func (s *Store) ApplySimilar(ctx context.Context, viewer, id int64) (SimilarResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SimilarResult{}, err
	}
	defer tx.Rollback()
	t, r, existing, err := similarRule(ctx, tx, viewer, id)
	if err != nil {
		return SimilarResult{}, err
	}
	if r.Counterparty == "" {
		return SimilarResult{}, apperr.Invalid("Deze transactie heeft geen tegenpartij om op te vergelijken.")
	}
	if _, err := categorise.SetManual(ctx, tx, id, t.category.Int64); err != nil {
		return SimilarResult{}, err
	}
	out := SimilarResult{RuleCreated: !existing}
	if existing {
		if _, err := tx.ExecContext(ctx, `UPDATE rules SET category_id = ? WHERE id = ?`, r.CategoryID, r.ID); err != nil {
			return SimilarResult{}, err
		}
	} else {
		in := RuleInput{Counterparty: Opt[string]{Set: true, V: r.Counterparty}, CategoryID: Opt[int64]{Set: true, V: r.CategoryID}}
		if r.AccountID != 0 {
			in.AccountID = Opt[int64]{Set: true, V: r.AccountID}
		}
		if r, err = createRule(ctx, tx, viewer, in); err != nil {
			return SimilarResult{}, err
		}
	}
	res, err := categorise.Plan(ctx, tx, r, id)
	if err != nil {
		return SimilarResult{}, err
	}
	if out.Updated, err = categorise.Apply(ctx, tx, res); err != nil {
		return SimilarResult{}, err
	}
	out.Skipped = res.Skipped
	if err := tx.Commit(); err != nil {
		return SimilarResult{}, err
	}
	if out.Transaction, err = s.transaction(ctx, viewer, id); err != nil {
		return SimilarResult{}, err
	}
	out.Rule, err = s.ruleView(ctx, viewer, r.ID)
	return out, err
}

// SetSplit replaces a booked transaction's split parts. The row's own
// category fields stay, to come back when the split is undone.
func (s *Store) SetSplit(ctx context.Context, viewer, id int64, parts []SplitPart) (Transaction, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Transaction{}, err
	}
	defer tx.Rollback()
	t, err := editable(ctx, tx, viewer, id)
	if err != nil {
		return Transaction{}, err
	}
	if t.status != "booked" {
		return Transaction{}, apperr.Invalid("Splitsen kan pas als de bank de transactie boekt.")
	}
	if len(parts) < 2 || len(parts) > maxParts {
		return Transaction{}, apperr.Invalid("Splits in 2 tot 10 delen.")
	}
	var sum int64
	for _, p := range parts {
		if p.Amount == 0 || (p.Amount < 0) != (t.amount < 0) {
			return Transaction{}, apperr.Invalid("Elk deel heeft het teken van het bedrag en is niet 0.")
		}
		if abs(p.Amount) > abs(t.amount) { // also keeps the sum from overflowing
			return Transaction{}, apperr.Invalid(msgSumDiff)
		}
		sum += p.Amount
	}
	if sum != t.amount {
		return Transaction{}, apperr.Invalid(msgSumDiff)
	}
	for _, p := range parts {
		if err := categoryExists(ctx, tx, p.CategoryID); err != nil {
			return Transaction{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM transaction_splits WHERE transaction_id = ?`, id); err != nil {
		return Transaction{}, err
	}
	for _, p := range parts {
		if _, err := tx.ExecContext(ctx, `INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)`,
			id, p.CategoryID, p.Amount); err != nil {
			return Transaction{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Transaction{}, err
	}
	return s.transaction(ctx, viewer, id)
}

// RemoveSplit removes a transaction's split parts: its earlier category (or
// none) shows again. A row without parts is left as it is.
func (s *Store) RemoveSplit(ctx context.Context, viewer, id int64) (Transaction, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Transaction{}, err
	}
	defer tx.Rollback()
	if _, err := editable(ctx, tx, viewer, id); err != nil {
		return Transaction{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM transaction_splits WHERE transaction_id = ?`, id); err != nil {
		return Transaction{}, err
	}
	if err := tx.Commit(); err != nil {
		return Transaction{}, err
	}
	return s.transaction(ctx, viewer, id)
}

func abs(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}
