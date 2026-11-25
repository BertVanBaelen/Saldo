package ledger

import (
	"fmt"
	"strconv"
	"strings"
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

// MonthDutch is the lower-case Dutch name of a month ("februari").
func MonthDutch(m time.Month) string { return monthNames[m-1] }

// MonthLabel is a "YYYY-MM" month in lower-case Dutch, with its year when it is
// more than 11 months after the running month ("januari", "januari 2028").
func MonthLabel(month, running string) string {
	t, _ := time.Parse("2006-01", month)
	r, _ := time.Parse("2006-01", running)
	name := MonthDutch(t.Month())
	if (t.Year()-r.Year())*12+int(t.Month()-r.Month()) > 11 {
		name += " " + strconv.Itoa(t.Year())
	}
	return name
}

// Eur0 is an amount in cents in whole euros as the web app writes it:
// "€ 1.134", negative "−€ 1.134" (U+2212), half a euro rounded up.
func Eur0(cents int64) string {
	sign := ""
	if cents < 0 {
		sign, cents = "−", -cents
	}
	digits := strconv.FormatInt((cents+50)/100, 10)
	var b strings.Builder
	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return sign + "€ " + b.String()
}
