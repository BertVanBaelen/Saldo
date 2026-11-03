// Package clock gives the server's notion of "now" and "today" in
// Europe/Brussels, with an optional fixed date for demo mode and tests.
package clock

import (
	"fmt"
	"time"
	_ "time/tzdata" // the add-on image may not ship a time zone database
)

// Brussels is the time zone for every date in Saldo (analysis 5.1).
var Brussels = mustLoad("Europe/Brussels")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

// Clock returns the current time. The zero value uses the real clock.
type Clock struct {
	date *time.Time // fixed date (midnight, Brussels); nil = real date
	now  func() time.Time
}

// New returns a clock. A non-empty today (YYYY-MM-DD) fixes the date while
// the time of day keeps running, so timestamps still move forward.
func New(today string) (Clock, error) {
	if today == "" {
		return Clock{}, nil
	}
	d, err := time.ParseInLocation(time.DateOnly, today, Brussels)
	if err != nil {
		return Clock{}, fmt.Errorf("clock: %q is not a YYYY-MM-DD date", today)
	}
	return Clock{date: &d}, nil
}

// Fixed returns a clock that always answers t (for tests).
func Fixed(t time.Time) Clock {
	return Clock{now: func() time.Time { return t }}
}

// Now is the current time in Europe/Brussels.
func (c Clock) Now() time.Time {
	now := time.Now
	if c.now != nil {
		now = c.now
	}
	t := now().In(Brussels)
	if c.date == nil {
		return t
	}
	y, m, d := c.date.Date()
	return time.Date(y, m, d, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), Brussels)
}

// Today is the current date in Europe/Brussels as YYYY-MM-DD.
func (c Clock) Today() string { return c.Now().Format(time.DateOnly) }

// DaysBetween counts calendar days from date a to date b (both YYYY-MM-DD).
func DaysBetween(a, b string) (int, error) {
	ta, err := time.Parse(time.DateOnly, a)
	if err != nil {
		return 0, err
	}
	tb, err := time.Parse(time.DateOnly, b)
	if err != nil {
		return 0, err
	}
	return int(tb.Sub(ta).Hours() / 24), nil
}
