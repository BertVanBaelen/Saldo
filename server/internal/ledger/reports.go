package ledger

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// maxReportMonths bounds the months of one answer (50 years): every month in
// range is present, zeros included, so an open-ended from would be a huge reply.
const maxReportMonths = 600

// ReportQuery chooses the selection and the months of a report (plan 0.7-1).
type ReportQuery struct {
	Scope     string    // "", "alles", "persoonlijk" or "gedeeld"
	AccountID int64     // 0 = every current account of the scope
	From, To  string    // months YYYY-MM, inclusive; "" = firstMonth / the current month
	Now       time.Time // the clock; its Brussels month is the current month
	Detail    bool      // detail=1: the amounts per category and subcategory too (0.8.1-1)
}

// Report is the answer of GET /api/reports/months (money in cents).
type Report struct {
	Accounts   []int64       `json:"accounts"`
	FirstMonth *string       `json:"firstMonth"`
	FirstDate  *string       `json:"firstDate"`
	Months     []ReportMonth `json:"months"`
}

// ReportTotals is income, saved and the expenses by key (a top category id,
// none, toShared or toOwn) of one month; a key is present only when not 0.
type ReportTotals struct {
	Income   int64            `json:"income"`
	Saved    int64            `json:"saved"`
	Expenses map[string]int64 `json:"expenses"`
	Detail   *ReportDetail    `json:"detail,omitempty"`
}

// ReportDetail splits the totals by the row's own category (0.8.1-1), only
// with ReportQuery.Detail. Income and Saved are keyed by reportDetail (a
// category id, transfer, none, account-<id>); Expenses by top category key,
// then own category id (Expenses[k][k] is the top's own part). Entries of 0
// are left out. Σ Income = income, Σ Saved = saved, Σ Expenses[k] = expenses[k].
type ReportDetail struct {
	Income   map[string]int64            `json:"income"`
	Saved    map[string]int64            `json:"saved"`
	Expenses map[string]map[string]int64 `json:"expenses"`
}

// ReportMonth is one month of a report. Accounts is the per-account view,
// present only when the selection holds more than one account.
type ReportMonth struct {
	Month string `json:"month"`
	ReportTotals
	Accounts []ReportAccount `json:"accounts,omitempty"`
}

// ReportAccount is one account of the selection on its own (selection = that
// account, so every transfer of it is a flow).
type ReportAccount struct {
	ID int64 `json:"id"`
	ReportTotals
}

// reportParts extends visibleTx (it starts with a comma, after the tx CTE)
// with the report layer: first_booked is the first booked date per visible
// account, parts one row per booked transaction or per split part, with the
// part's amount, own category (cat_id) and top category, its top category's saving flag (0.8-0a), the
// other side's type, shared (IsShared) and first booked date. It takes no parameters.
const reportParts = `, first_booked AS (
    SELECT account_id, MIN(booking_date) AS first FROM booked GROUP BY account_id
), parts AS (
    SELECT tx.id, tx.account_id, tx.booking_date, COALESCE(sp.amount, tx.amount) AS amount, tx.shared,
           tx.is_transfer, tx.other_id, ov.type AS other_type, ov.shared AS other_shared, fb.first AS other_first,
           COALESCE(c.parent_id, c.id) AS top_id, c.id AS cat_id, c.type AS cat_type, COALESCE(tc.saving, 0) AS saving
    FROM tx
    LEFT JOIN transaction_splits sp ON sp.transaction_id = tx.id
    LEFT JOIN categories c ON c.id = COALESCE(sp.category_id, tx.category_id)
    LEFT JOIN categories tc ON tc.id = COALESCE(c.parent_id, c.id)
    LEFT JOIN vis ov ON ov.account_id = tx.other_id
    LEFT JOIN first_booked fb ON fb.account_id = tx.other_id
    WHERE tx.status = 'booked'
)`

// reportBase is the prefix of every report query: visibleTx with tx
// materialised (other_id, a correlated subquery, is otherwise evaluated once
// per use) followed by reportParts. The report reads every row anyway, so
// materialising costs nothing there; Transacties' plain pages keep the lazy
// visibleTx so LIMIT can stop early.
var reportBase = strings.Replace(visibleTx, "), tx AS (", "), tx AS MATERIALIZED (", 1) + reportParts

// reportBucket is the SQL that puts a parts row in out, saved, income or
// expense (plan 0.7-1, the rule in its order, with the saving categories of
// 0.8-0a). inSel is a condition on other_id saying the other side is in the
// selection; the other side only counts as in it once its history has
// started (its first booked row on or before this date plus the 3 days of
// the pairing window). In order: an internal transfer inside the selection is
// left out; a transfer to a savings or investment account is saved; a row or
// split part whose top category is a saving category is saved (net, so a
// withdrawal subtracts), which beats toShared, toOwn, none and an override
// without partner; an override without partner is left out; then 0.7-1.
func reportBucket(inSel string) string {
	return `(CASE
    WHEN is_transfer = 1 AND (` + inSel + `) AND other_first <= date(booking_date, '+3 days') THEN 'out'
    WHEN ` + reportToSavings + ` THEN 'saved'
    WHEN saving = 1 THEN 'saved'
    WHEN is_transfer = 1 AND other_id IS NULL THEN 'out'
    WHEN is_transfer = 1 AND amount < 0 THEN 'expense'
    WHEN is_transfer = 1 THEN 'income'
    WHEN cat_type = 'income' THEN 'income'
    WHEN cat_type = 'expense' THEN 'expense'
    WHEN amount < 0 THEN 'expense'
    ELSE 'income' END)`
}

// reportKey is the expense key of a parts row; it means something only when
// reportBucket says expense: toShared (a personal account to a shared one),
// toOwn (any other transfer out), the top category id, or none.
const reportKey = `(CASE
    WHEN is_transfer = 1 THEN CASE WHEN shared = 0 AND other_shared = 1 THEN 'toShared' ELSE 'toOwn' END
    WHEN cat_type = 'expense' THEN CAST(top_id AS TEXT)
    ELSE 'none' END)`

// reportToSavings is rule 2 of reportBucket: a transfer to a savings or
// investment account the viewer sees (other_type is only known then).
const reportToSavings = `is_transfer = 1 AND other_type IN ('savings', 'investment')`

// The detail of a parts row per bucket (0.8.1-1), each meaningful only when
// reportBucket says that bucket. Income: transfer, the own category id of an
// income category, else none (an expense category is never income). Saved:
// account-<other id> under rule 2, else the own category id (rule 3, a saving
// category or its sub). Expense: the own category id when reportKey is a top
// category id, else the empty text (toShared, toOwn and none carry no detail).
const (
	reportIncomeDetail  = `(CASE WHEN is_transfer = 1 THEN 'transfer' WHEN cat_type = 'income' THEN CAST(cat_id AS TEXT) ELSE 'none' END)`
	reportSavedDetail   = `(CASE WHEN ` + reportToSavings + ` THEN 'account-' || other_id ELSE CAST(cat_id AS TEXT) END)`
	reportExpenseDetail = `(CASE WHEN is_transfer = 1 THEN '' WHEN cat_type = 'expense' THEN CAST(cat_id AS TEXT) ELSE '' END)`
)

// reportDetail is the detail of a parts row for the bucket expression it is
// paired with (the selection's or the per-account one).
func reportDetail(bucket string) string {
	return `(CASE ` + bucket + ` WHEN 'income' THEN ` + reportIncomeDetail + ` WHEN 'saved' THEN ` + reportSavedDetail +
		` WHEN 'expense' THEN ` + reportExpenseDetail + ` ELSE '' END)`
}

// idList is "(1, 4)" for SQL; the ids come from the database, never from input.
func idList(ids []int64) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.FormatInt(id, 10)
	}
	return "(" + strings.Join(parts, ", ") + ")"
}

// inSelection is the condition "column is an account of sel".
func inSelection(column string, sel []int64) string {
	if len(sel) == 0 {
		return "0 = 1"
	}
	return column + " IN " + idList(sel)
}

// reportDrillDown is the drill-down filter of 0.7-2: the condition on the tx
// CTE, with its arguments, that keeps exactly the rows behind one key of the
// report for the selection sel (from reportSelection, with the same scope and
// account as the report). The query must be visibleTx + reportParts. key is
// "saved" (every row behind the Gespaard number, 0.8-0a), an expense key
// ("none", "toShared" or "toOwn"), or one of the detail keys of 0.8.1-1, as
// categoryKey normalises them:
//   - "<id>": a top category rolled up (its own part and its subs, as reportKey;
//     a saving top lists the rows saved in it by rule 3), a subcategory on its
//     own, in the expense or the saved bucket;
//   - "<id>-zelf": the own part of that category only (detail = id);
//   - "income-<id>": income rolled up for a top, own for a sub;
//     "income-<id>-zelf", "income-transfer", "income-none": income detail = the value;
//   - "saved-account-<id>": saved by rule 2 to that account.
//
// A split row matches when one of its parts does.
func reportDrillDown(sel []int64, key string) (string, []any) {
	bucket := reportBucket(inSelection("other_id", sel))
	var cond string
	var args []any
	income, isIncome := strings.CutPrefix(key, "income-")
	own, isOwn := strings.CutSuffix(key, "-zelf")
	switch {
	case key == "saved":
		cond = bucket + ` = 'saved'`
	case strings.HasPrefix(key, "saved-account-"):
		cond, args = bucket+` = 'saved' AND `+reportSavedDetail+` = ?`, []any{strings.TrimPrefix(key, "saved-")}
	case isIncome:
		if v, ok := strings.CutSuffix(income, "-zelf"); ok || income == "transfer" || income == "none" {
			if ok {
				income = v
			}
			cond, args = bucket+` = 'income' AND `+reportIncomeDetail+` = ?`, []any{income}
		} else {
			// The rows whose income detail is a category of that top, or that sub.
			cond = bucket + ` = 'income' AND is_transfer = 0 AND cat_type = 'income' AND ? IN (CAST(top_id AS TEXT), CAST(cat_id AS TEXT))`
			args = []any{income}
		}
	case isOwn:
		cond = `CASE ` + bucket + ` WHEN 'expense' THEN ` + reportExpenseDetail + ` = ? WHEN 'saved' THEN ` + reportSavedDetail + ` = ? ELSE 0 END`
		args = []any{own, own}
	default:
		// A top rolled up or a sub on its own; in saved, not the rule-2 rows (their detail is the account).
		cond = `CASE ` + bucket + ` WHEN 'expense' THEN ` + reportKey + ` = ? OR ` + reportExpenseDetail + ` = ?
            WHEN 'saved' THEN CASE WHEN ` + reportToSavings + ` THEN 0 ELSE ? IN (CAST(top_id AS TEXT), CAST(cat_id AS TEXT)) END
            ELSE 0 END`
		args = []any{key, key, key}
	}
	return `tx.id IN (SELECT id FROM parts WHERE ` + inSelection("account_id", sel) + ` AND ` + cond + `)`, args
}

// reportSelection is the selection S of a report: with account, that
// account, which must be a current account the viewer holds (savings or
// investment: invalid; hidden or unknown: apperr.ErrNotFound); else every
// current account of the scope the viewer holds. Ids in account order.
func (s *Store) reportSelection(ctx context.Context, viewer int64, scope string, account int64) ([]int64, error) {
	inScope, err := scopeCond(scope)
	if err != nil {
		return nil, err
	}
	if account != 0 {
		var kind string
		err := s.db.QueryRowContext(ctx, `SELECT a.type FROM account_access x JOIN accounts a ON a.id = x.account_id
			WHERE x.user_id = ? AND a.id = ?`, viewer, account).Scan(&kind)
		if err == sql.ErrNoRows {
			return nil, apperr.ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		if kind != "current" {
			return nil, apperr.Invalid("Kies een betaalrekening.")
		}
		return []int64{account}, nil
	}
	// tx is the alias scopeCond expects.
	rows, err := s.db.QueryContext(ctx, `SELECT tx.id FROM (
		SELECT a.id, (a.shared = 1 OR (SELECT COUNT(*) FROM account_access m WHERE m.account_id = a.id) > 1) AS shared
		FROM account_access x JOIN accounts a ON a.id = x.account_id
		WHERE x.user_id = ? AND a.type = 'current') tx
		WHERE `+inScope+` ORDER BY tx.id`, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sel := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		sel = append(sel, id)
	}
	return sel, rows.Err()
}

// ReportSelection is the selection of a report for the routes built on it
// (0.8.1-2 budgets, 0.8.1-5 balances): the rules and errors of reportSelection.
func (s *Store) ReportSelection(ctx context.Context, viewer int64, scope string, account int64) ([]int64, error) {
	return s.reportSelection(ctx, viewer, scope, account)
}

// parseMonth checks a YYYY-MM month.
func parseMonth(m string) (time.Time, error) {
	t, err := time.Parse("2006-01", m)
	if err != nil || t.Format("2006-01") != m {
		return time.Time{}, apperr.Invalid("Kies een maand als JJJJ-MM.")
	}
	return t, nil
}

// ReportMonths answers income, saved and expenses per month for the viewer's
// selection (plan 0.7-1): one statement for the months, one for firstDate.
func (s *Store) ReportMonths(ctx context.Context, viewer int64, q ReportQuery) (Report, error) {
	current := q.Now.In(clock.Brussels).Format("2006-01")
	to := q.To
	if to == "" {
		to = current
	}
	toTime, err := parseMonth(to)
	if err != nil {
		return Report{}, err
	}
	if q.From != "" {
		if _, err := parseMonth(q.From); err != nil {
			return Report{}, err
		}
	}
	if to > current {
		return Report{}, apperr.Invalid("De eindmaand ligt na deze maand.")
	}
	if q.From != "" && q.From > to {
		return Report{}, apperr.Invalid("De beginmaand ligt na de eindmaand.")
	}
	sel, err := s.reportSelection(ctx, viewer, q.Scope, q.AccountID)
	if err != nil {
		return Report{}, err
	}
	out := Report{Accounts: sel, Months: []ReportMonth{}}
	if len(sel) == 0 {
		return out, nil
	}

	var first sql.NullString
	// Booked rows with an amount, as in the booked relation of visibleTx: a row of 0 starts no history.
	if err := s.db.QueryRowContext(ctx, `SELECT MIN(booking_date) FROM transactions
		WHERE status = 'booked' AND amount <> 0 AND `+inSelection("account_id", sel)).Scan(&first); err != nil {
		return Report{}, err
	}
	from := q.From
	if first.Valid {
		date, month := first.String, first.String[:7]
		out.FirstDate, out.FirstMonth = &date, &month
		if from == "" {
			from = month
		}
	}
	if from == "" || from > to {
		return out, nil
	}

	// from is valid here (checked above, or the first booked month).
	fromTime, _ := parseMonth(from)
	if span := (toTime.Year()-fromTime.Year())*12 + int(toTime.Month()-fromTime.Month()) + 1; span > maxReportMonths {
		return Report{}, apperr.Invalid("Kies een periode van hooguit 50 jaar.")
	}
	index := map[string]*ReportMonth{}
	for m := fromTime; !m.After(toTime); m = m.AddDate(0, 1, 0) {
		rm := ReportMonth{Month: m.Format("2006-01"), ReportTotals: newTotals(q.Detail)}
		if len(sel) > 1 {
			for _, id := range sel {
				rm.Accounts = append(rm.Accounts, ReportAccount{ID: id, ReportTotals: newTotals(q.Detail)})
			}
		}
		out.Months = append(out.Months, rm)
	}
	for i := range out.Months {
		index[out.Months[i].Month] = &out.Months[i]
	}

	end := toTime.AddDate(0, 1, 0).Format("2006-01") + "-01"
	// With detail, one more column per bucket (the selection's, the per-account one), from the same rows.
	bucket, own := reportBucket(inSelection("other_id", sel)), reportBucket("0 = 1")
	detailCols, group := "", "1, 2, 3, 4, 5"
	if q.Detail {
		detailCols, group = `, `+reportDetail(bucket)+`, `+reportDetail(own), "1, 2, 3, 4, 5, 6, 7"
	}
	rows, err := s.db.QueryContext(ctx, reportBase+`
		SELECT substr(booking_date, 1, 7), account_id, `+bucket+`, `+reportKey+`,
		       `+own+detailCols+`, SUM(amount)
		FROM parts
		WHERE `+inSelection("account_id", sel)+` AND booking_date >= ? AND booking_date < ?
		GROUP BY `+group, viewer, viewer, from+"-01", end)
	if err != nil {
		return Report{}, err
	}
	defer rows.Close()
	at := map[int64]int{}
	for i, id := range sel {
		at[id] = i
	}
	for rows.Next() {
		var month, bucket, key, own, detail, ownDetail string
		var account, amount int64
		dest := []any{&month, &account, &bucket, &key, &own, &amount}
		if q.Detail {
			dest = []any{&month, &account, &bucket, &key, &own, &detail, &ownDetail, &amount}
		}
		if err := rows.Scan(dest...); err != nil {
			return Report{}, err
		}
		rm := index[month]
		rm.add(bucket, key, detail, amount)
		if rm.Accounts != nil {
			rm.Accounts[at[account]].add(own, key, ownDetail, amount)
		}
	}
	if err := rows.Err(); err != nil {
		return Report{}, err
	}
	for i := range out.Months {
		out.Months[i].prune()
		for j := range out.Months[i].Accounts {
			out.Months[i].Accounts[j].prune()
		}
	}
	return out, nil
}

// newTotals is an empty month or account, with an empty detail when asked.
func newTotals(detail bool) ReportTotals {
	r := ReportTotals{Expenses: map[string]int64{}}
	if detail {
		r.Detail = &ReportDetail{Income: map[string]int64{}, Saved: map[string]int64{}, Expenses: map[string]map[string]int64{}}
	}
	return r
}

// add sums amount (signed as stored) into its bucket, and into its detail
// when the totals carry one (an expense key without detail, "", has none).
func (r *ReportTotals) add(bucket, key, detail string, amount int64) {
	switch bucket {
	case "income":
		r.Income += amount
	case "saved":
		r.Saved -= amount
	case "expense":
		r.Expenses[key] -= amount
	}
	if r.Detail == nil {
		return
	}
	switch bucket {
	case "income":
		r.Detail.Income[detail] += amount
	case "saved":
		r.Detail.Saved[detail] -= amount
	case "expense":
		if detail == "" {
			return
		}
		if r.Detail.Expenses[key] == nil {
			r.Detail.Expenses[key] = map[string]int64{}
		}
		r.Detail.Expenses[key][detail] -= amount
	}
}

// prune drops the expense keys and detail entries that sum to 0.
func (r *ReportTotals) prune() {
	dropZero(r.Expenses)
	if r.Detail == nil {
		return
	}
	dropZero(r.Detail.Income)
	dropZero(r.Detail.Saved)
	for k, m := range r.Detail.Expenses {
		if dropZero(m); len(m) == 0 {
			delete(r.Detail.Expenses, k)
		}
	}
}

func dropZero(m map[string]int64) {
	for k, v := range m {
		if v == 0 {
			delete(m, k)
		}
	}
}
