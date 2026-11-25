package planning

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// ErrNoBalance means the account has no balance snapshot, so it has no
// forecast (the API lists it under missing).
var ErrNoBalance = errors.New("planning: the account has no balance")

// The loader's SQL reads only account-level facts: never a per-user table
// (transfer_overrides, account access, anything keyed by a user), so the
// forecast is the same for every member (plan 0.8 decision 2). Pinned by
// TestForecastLoaderReadsNoUserData on forecastQueries.
const (
	fcQueryAccount = `SELECT a.source, a.buffer, s.balance, s.date,
		(SELECT MAX(last_sync_at) FROM account_sources WHERE account_id = a.id AND status = 'ok'),
		(SELECT MIN(booking_date) FROM transactions WHERE account_id = a.id AND status = 'booked'),
		(SELECT MAX(booking_date) FROM transactions WHERE account_id = a.id AND status = 'booked' AND booking_date <= ?2)
		FROM accounts a LEFT JOIN balance_snapshots s ON s.id = (SELECT id FROM balance_snapshots WHERE account_id = a.id ORDER BY date DESC, id DESC LIMIT 1)
		WHERE a.id = ?1`
	fcQueryRows = `SELECT t.id, t.booking_date, t.amount, t.status = 'pending', t.counterparty_name, COALESCE(t.counterparty_iban, ''),
		COALESCE(sp.amount, t.amount), COALESCE(tc.id, 0), COALESCE(tc.type = 'expense' AND tc.saving = 0, 0), COALESCE(tc.saving, 0),
			COALESCE(sp.category_id, t.category_id, 0)
		FROM transactions t
		LEFT JOIN transaction_splits sp ON sp.transaction_id = t.id
		LEFT JOIN categories c ON c.id = COALESCE(sp.category_id, t.category_id)
		LEFT JOIN categories tc ON tc.id = COALESCE(c.parent_id, c.id)
		WHERE t.account_id = ? AND t.booking_date >= ?
		ORDER BY t.booking_date, t.id, sp.id`
	// The last column is the item's top category when it is an expense item whose top is an expense category that is
	// not saving (0.9.1-3's rule again, so a stale row never counts), else 0.
	fcQueryItems = `SELECT i.id, i.description, i.counterparty, COALESCE(i.counterparty_iban, ''), i.amount, i.amount_rule = 'average', i.frequency,
		i.expected_day, COALESCE(i.expected_month, 0), COALESCE(i.end_date, ''), i.kind, COALESCE(t.id, 0)
		FROM recurring_items i
		LEFT JOIN categories c ON c.id = i.category_id
		LEFT JOIN categories t ON t.id = COALESCE(c.parent_id, c.id) AND i.kind = 'expense' AND t.type = 'expense' AND t.saving = 0
		WHERE i.account_id = ? AND i.state = 'confirmed' ORDER BY i.id`
	fcQueryBudgets = `SELECT b.category_id, b.from_month, b.monthly_amount FROM budgets b JOIN categories c ON c.id = b.category_id
		WHERE b.account_id = ? AND c.parent_id IS NULL AND c.type = 'expense' AND c.saving = 0 ORDER BY b.category_id, b.from_month`
	fcQueryPlanned = `SELECT id, date, amount, description, whole_month FROM planned_items WHERE account_id = ? AND date >= ? ORDER BY date, id`
)

// forecastQueries are every statement the loader runs.
var forecastQueries = []string{fcQueryAccount, fcQueryRows, fcQueryItems, fcQueryBudgets, fcQueryPlanned, fcQueryFirstBooked, fcQueryBookedMonths}

// Forecast is the forecast of one current account on today (the Brussels
// date) for the running month and horizon months after it. It takes no
// viewer: the caller checks access and refuses savings and investment
// accounts. ErrNoBalance without a balance snapshot.
func Forecast(ctx context.Context, db *sql.DB, account int64, today string, horizon int) (AccountForecast, error) {
	f, err := LoadFacts(ctx, db, account, today)
	if err != nil {
		return AccountForecast{}, err
	}
	return Project(f, today, horizon), nil
}

// LoadFacts reads the facts the forecast of an account on today needs: rows
// from the 6th month before the running month (and from the snapshot's date
// when that is older, for the balance), confirmed items (with the top expense
// category each is assigned to), budgets of valid
// categories, planned items from the running month on.
func LoadFacts(ctx context.Context, db *sql.DB, account int64, today string) (Facts, error) {
	f := Facts{AccountID: account}
	var source string
	var balance sql.NullInt64
	var balanceDate, lastSync, first, newest sql.NullString
	if err := db.QueryRowContext(ctx, fcQueryAccount, account, today).Scan(&source, &f.Buffer, &balance, &balanceDate,
		&lastSync, &first, &newest); err != nil {
		return f, err
	}
	if !balance.Valid {
		return f, ErrNoBalance
	}
	f.Balance, f.BalanceDate, f.FirstBooked = balance.Int64, balanceDate.String, first.String
	f.DataDate = max(f.BalanceDate, newest.String)
	if source == "bank" && lastSync.Valid {
		if t, err := time.Parse(time.RFC3339, lastSync.String); err == nil {
			f.DataDate = t.In(clock.Brussels).Format(time.DateOnly)
		}
	}

	from := min(fcAddDays(fcAddMonths(today[:7], -fcHistory)+"-01", -fcMatchDays), f.BalanceDate)
	var err error
	if f.Rows, err = loadRows(ctx, db, account, from); err != nil {
		return f, err
	}

	items, err := db.QueryContext(ctx, fcQueryItems, account)
	if err != nil {
		return f, err
	}
	defer items.Close()
	for items.Next() {
		var it FactItem
		if err := items.Scan(&it.ID, &it.Description, &it.Counterparty, &it.IBAN, &it.Amount, &it.Average, &it.Frequency,
			&it.Day, &it.Month, &it.EndDate, &it.Kind, &it.Category); err != nil {
			return f, err
		}
		it.IBAN = ledger.NormalizeIBAN(it.IBAN)
		f.Items = append(f.Items, it)
	}
	if err := items.Err(); err != nil {
		return f, err
	}

	if f.Budgets, err = LoadBudgets(ctx, db, account); err != nil {
		return f, err
	}

	planned, err := db.QueryContext(ctx, fcQueryPlanned, account, today[:7]+"-01")
	if err != nil {
		return f, err
	}
	defer planned.Close()
	for planned.Next() {
		var p FactPlanned
		if err := planned.Scan(&p.ID, &p.Date, &p.Amount, &p.Description, &p.WholeMonth); err != nil {
			return f, err
		}
		f.Planned = append(f.Planned, p)
	}
	return f, planned.Err()
}

// loadRows reads the account's rows from from on, a split row once with its parts.
func loadRows(ctx context.Context, db *sql.DB, account int64, from string) ([]FactRow, error) {
	rows, err := db.QueryContext(ctx, fcQueryRows, account, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FactRow
	for rows.Next() {
		var r FactRow
		var p FactPart
		if err := rows.Scan(&r.ID, &r.Date, &r.Amount, &r.Pending, &r.Name, &r.IBAN, &p.Amount, &p.Category, &p.Variable, &p.Saving, &p.Own); err != nil {
			return nil, err
		}
		if n := len(out); n > 0 && out[n-1].ID == r.ID {
			out[n-1].Parts = append(out[n-1].Parts, p)
			continue
		}
		r.IBAN, r.Parts = ledger.NormalizeIBAN(r.IBAN), []FactPart{p}
		out = append(out, r)
	}
	return out, rows.Err()
}
