package planning

import (
	"cmp"
	"context"
	"database/sql"
	"slices"
)

// The past-balance rules of plan 0.8-3 (rules 1 and 2), shared by Project and
// the balance history of Overzicht (plan 0.8.1-5).

// DayAmount is a booked amount on a date.
type DayAmount struct {
	Date   string
	Amount int64
}

// Point is the end-of-day balance of a date.
type Point struct {
	Date    string `json:"date"`
	Balance int64  `json:"balance"`
}

// BalanceOn is rule 1: the snapshot plus the booked rows dated after the
// snapshot's date, up to today.
func BalanceOn(snapshot int64, snapshotDate string, rows []DayAmount, today string) int64 {
	for _, r := range rows {
		if r.Date > snapshotDate && r.Date <= today {
			snapshot += r.Amount
		}
	}
	return snapshot
}

// PastBalances is rule 2: the end of day d is balance (today's) minus the
// booked rows dated after d, up to today. The first point is the day before
// from; then one point per day from from to today with booked rows (the
// balance holds until the next point). Rows after today are ignored.
func PastBalances(balance int64, rows []DayAmount, from, today string) []Point {
	byDate := map[string]int64{}
	var after int64
	for _, r := range rows {
		if r.Date >= from && r.Date <= today {
			byDate[r.Date] += r.Amount
			after += r.Amount
		}
	}
	dates := make([]string, 0, len(byDate))
	for d := range byDate {
		dates = append(dates, d)
	}
	slices.SortFunc(dates, cmp.Compare)
	bal := balance - after
	out := append(make([]Point, 0, len(dates)+1), Point{Date: fcAddDays(from, -1), Balance: bal})
	for _, d := range dates {
		bal += byDate[d]
		out = append(out, Point{Date: d, Balance: bal})
	}
	return out
}

// FromFirstBooked drops the points dated before the account's first booked
// row: no line before it (none at all without a booked row).
func FromFirstBooked(points []Point, firstBooked string) []Point {
	if firstBooked == "" {
		return []Point{}
	}
	out := []Point{}
	for _, p := range points {
		if p.Date >= firstBooked {
			out = append(out, p)
		}
	}
	return out
}

// History is an account's end-of-day balance from the day before from to today.
type History struct {
	AccountID   int64
	Buffer      int64
	FirstBooked string // "" without a booked row
	Points      []Point
}

// LoadHistory reads an account's balance history from from (YYYY-MM-DD) to
// today with the forecast loader's queries (account-level, viewer-free): the
// newest snapshot and the booked rows from the earlier of from and the
// snapshot's date. ErrNoBalance without a snapshot. The caller checks access.
func LoadHistory(ctx context.Context, db *sql.DB, account int64, from, today string) (History, error) {
	h := History{AccountID: account, Points: []Point{}}
	var source string
	var balance sql.NullInt64
	var balanceDate, lastSync, first, newest sql.NullString
	if err := db.QueryRowContext(ctx, fcQueryAccount, account, today).Scan(&source, &h.Buffer, &balance, &balanceDate,
		&lastSync, &first, &newest); err != nil {
		return h, err
	}
	if !balance.Valid {
		return h, ErrNoBalance
	}
	h.FirstBooked = first.String
	rows, err := loadRows(ctx, db, account, min(from, balanceDate.String))
	if err != nil {
		return h, err
	}
	booked := bookedAmounts(rows)
	now := BalanceOn(balance.Int64, balanceDate.String, booked, today)
	h.Points = FromFirstBooked(PastBalances(now, booked, from, today), h.FirstBooked)
	return h, nil
}

// bookedAmounts are the booked rows as day amounts.
func bookedAmounts(rows []FactRow) []DayAmount {
	var out []DayAmount
	for _, r := range rows {
		if !r.Pending {
			out = append(out, DayAmount{Date: r.Date, Amount: r.Amount})
		}
	}
	return out
}
