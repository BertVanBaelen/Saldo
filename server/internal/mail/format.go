package mail

import (
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	nbsp  = " " // no-break space: keeps "€ 1.033,47" and "−7 %" on one line
	minus = "−" // the typographic minus of the app's money format
	zwsp  = "​" // zero-width space: a line-break opportunity inside a long name
)

// Money is passed to the mail package as integer cents and formatted here
// the Dutch way, so a mail never does arithmetic on floats.

// amount is "1.033,47": cents with a decimal comma and dots between thousands,
// a U+2212 minus for negatives, no currency symbol (the receipt's row format).
func amount(cents int64) string {
	s := groupedEuros(cents)
	if cents < 0 {
		return minus + s
	}
	return s
}

// euro is "€ 1.033,47" and "−€ 1.033,47": the symbol, a no-break space, the
// amount; the minus sits before the symbol.
func euro(cents int64) string {
	s := "€" + nbsp + groupedEuros(cents)
	if cents < 0 {
		return minus + s
	}
	return s
}

// euroAuto is euro without ",00" when the amount is whole: "€ 436" for the
// short sentences of the contribution mail, "€ 436,50" otherwise.
func euroAuto(cents int64) string {
	if cents%100 == 0 {
		s := "€" + nbsp + groupedWhole(cents)
		if cents < 0 {
			return minus + s
		}
		return s
	}
	return euro(cents)
}

func absCents(cents int64) uint64 {
	if cents < 0 {
		return uint64(-(cents + 1)) + 1 // safe for the most negative value
	}
	return uint64(cents)
}

func groupedWhole(cents int64) string {
	whole := strconv.FormatUint(absCents(cents)/100, 10)
	var b strings.Builder
	for i, r := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return b.String()
}

func groupedEuros(cents int64) string {
	return fmt.Sprintf("%s,%02d", groupedWhole(cents), absCents(cents)%100)
}

// monthName is "februari"; an invalid month gives "".
func monthName(m time.Month) string {
	if m < time.January || m > time.December {
		return ""
	}
	return longMonths[m-1]
}

// possessive is the Dutch genitive of a name: "Partners", "Anna's", "Thomas'".
// Names ending in a silent e just get an s ("Annes"); the spelling of those is a
// matter of taste.
func possessive(name string) string {
	name = oneLine(name)
	last, _ := utf8.DecodeLastRuneInString(name)
	switch unicode.ToLower(last) {
	case 0, utf8.RuneError:
		return name
	case 'a', 'i', 'o', 'u', 'y':
		return name + "'s"
	case 's', 'x', 'z':
		return name + "'"
	}
	return name + "s"
}

// plural picks the singular for exactly one.
func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// softBreak puts a zero-width space after every n runes of any run without
// spaces that is longer than n. Names come from banks and users: without a
// break opportunity a long one pushes the 520 px card (or a receipt column)
// wider than the phone. Normal text is returned unchanged. HTML only; the
// plain-text part and the subject never get the invisible character.
func softBreak(s string, n int) string {
	if n < 1 || utf8.RuneCountInString(s) <= n {
		return s
	}
	var b strings.Builder
	run := 0
	for _, r := range s {
		if unicode.IsSpace(r) || r == '​' {
			run = 0
		} else {
			if run == n {
				b.WriteString(zwsp)
				run = 0
			}
			run++
		}
		b.WriteRune(r)
	}
	return b.String()
}
