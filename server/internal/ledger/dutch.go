package ledger

import (
	"fmt"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

var weekdays = [...]string{"zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"}

var monthNames = [...]string{"januari", "februari", "maart", "april", "mei", "juni", "juli",
	"augustus", "september", "oktober", "november", "december"}

// whenDutch describes a moment relative to now, as the design does:
// "vandaag 04:02", "gisteren 04:02", "zondag 04:02" within the last week,
// otherwise "15 november 04:02" (with the year when it differs).
func whenDutch(t, now time.Time) string {
	t, now = t.In(clock.Brussels), now.In(clock.Brussels)
	hm := t.Format("15:04")
	days, _ := clock.DaysBetween(t.Format(time.DateOnly), now.Format(time.DateOnly))
	switch {
	case days == 0:
		return "vandaag " + hm
	case days == 1:
		return "gisteren " + hm
	case days > 1 && days < 7:
		return weekdays[t.Weekday()] + " " + hm
	case t.Year() != now.Year():
		return fmt.Sprintf("%d %s %d %s", t.Day(), monthNames[t.Month()-1], t.Year(), hm)
	}
	return fmt.Sprintf("%d %s %s", t.Day(), monthNames[t.Month()-1], hm)
}

// plural picks the Dutch singular or plural form.
func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
