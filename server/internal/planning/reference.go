package planning

import (
	"context"
	"database/sql"
)

// The loaders of the budget reference of Overzicht (0.8.1-2). Like the
// forecast loader's they read account-level facts only, never a per-user
// table (TestForecastLoaderReadsNoUserData covers them through forecastQueries);
// the caller checks that the viewer holds the account.
const (
	fcQueryFirstBooked  = `SELECT MIN(booking_date) FROM transactions WHERE account_id = ? AND status = 'booked'`
	fcQueryBookedMonths = `SELECT DISTINCT substr(booking_date, 1, 7) FROM transactions WHERE account_id = ? AND status = 'booked' AND booking_date <= ?`
)

// LoadHistoryMonths reads the account's first booked row (YYYY-MM-DD, "" without
// one) and its months with a booked row, and gives that date with its history
// months on today (HistoryMonths).
func LoadHistoryMonths(ctx context.Context, db *sql.DB, account int64, today string) (first string, months []string, err error) {
	var date sql.NullString
	if err := db.QueryRowContext(ctx, fcQueryFirstBooked, account).Scan(&date); err != nil {
		return "", nil, err
	}
	rows, err := db.QueryContext(ctx, fcQueryBookedMonths, account, today)
	if err != nil {
		return "", nil, err
	}
	defer rows.Close()
	booked := map[string]bool{}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return "", nil, err
		}
		booked[m] = true
	}
	if err := rows.Err(); err != nil {
		return "", nil, err
	}
	return date.String, HistoryMonths(date.String, booked, today), nil
}

// LoadBudgets reads the account's budget rows of valid categories (top,
// expense, not saving), by category and month; Amount nil: use the average.
// The forecast loader reads them through it too.
func LoadBudgets(ctx context.Context, db *sql.DB, account int64) ([]FactBudget, error) {
	rows, err := db.QueryContext(ctx, fcQueryBudgets, account)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FactBudget
	for rows.Next() {
		var b FactBudget
		var amount sql.NullInt64
		if err := rows.Scan(&b.Category, &b.From, &amount); err != nil {
			return nil, err
		}
		if amount.Valid {
			b.Amount = &amount.Int64
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// HistoryMonths gives the history months of rule 7: at most the fcHistory
// complete months before today's month, from the month of first (the account's
// first booked row, YYYY-MM-DD) when it is on the 1st, else the month after,
// and only months with booked[m] (a booked row of the account in that month).
// Oldest first; nil without a first booked row.
func HistoryMonths(first string, booked map[string]bool, today string) []string {
	if first == "" {
		return nil
	}
	eligible := first[:7]
	if first[8:] != "01" {
		eligible = fcAddMonths(eligible, 1)
	}
	run := today[:7]
	var hist []string
	for i := range fcHistory {
		m := fcAddMonths(run, i-fcHistory)
		if m >= eligible && booked[m] {
			hist = append(hist, m)
		}
	}
	return hist
}

// AverageOf is the engine's average of sum over n history months: rounded
// half away from zero, never below 0, 0 without months. The reference of
// Overzicht (0.8.1-2) rounds like the engine's average does.
func AverageOf(sum int64, n int) int64 {
	if n <= 0 {
		return 0
	}
	return max(0, fcDivRound(sum, int64(n)))
}

// BudgetFor gives the budget of category in month: the row with the greatest
// From <= month (the first such row on a tie). ok is false without a row or
// when that row has no amount (the average applies then).
func BudgetFor(rows []FactBudget, category int64, month string) (amount int64, ok bool) {
	var best *FactBudget
	for i, b := range rows {
		if b.Category == category && b.From <= month && (best == nil || b.From > best.From) {
			best = &rows[i]
		}
	}
	if best == nil || best.Amount == nil {
		return 0, false
	}
	return *best.Amount, true
}
