package importers

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// cleanText drops control characters, turns line breaks and tabs inside a
// cell into spaces, collapses runs of white space and trims.
func cleanText(s string) string {
	s = strings.Map(func(r rune) rune {
		switch {
		case r == '\t' || r == '\n' || r == '\r':
			return ' '
		case unicode.IsControl(r) || r == 0xFEFF:
			return -1
		}
		return r
	}, s)
	return strings.Join(strings.Fields(s), " ")
}

// capRunes truncates s to at most n runes.
func capRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n]))
}

// timeOfDay is a time after a date ("00:00:00.000" in Bilance); it is ignored.
var timeOfDay = regexp.MustCompile(`^\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$`)

// parseDate reads dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (day and month may have
// one digit) and yyyy-mm-dd, each optionally followed by a time of day, and
// returns YYYY-MM-DD. order "dmy", "mdy" or "ymd" fixes the order of the
// three parts; "" takes yyyy-mm-dd when the year comes first after dashes,
// else day first. Two-digit years and impossible dates are refused.
func parseDate(s, order string) (string, bool) {
	if day, tm, ok := strings.Cut(s, " "); ok && timeOfDay.MatchString(tm) {
		s = day
	}
	sep := strings.IndexAny(s, "/-.")
	if sep < 0 {
		return "", false
	}
	parts := strings.Split(s, s[sep:sep+1])
	if len(parts) != 3 {
		return "", false
	}
	d, m, y := parts[0], parts[1], parts[2]
	switch {
	case order == "mdy":
		d, m = m, d
	case order == "ymd" || order == "" && len(d) == 4 && s[sep] == '-':
		y, m, d = parts[0], parts[1], parts[2]
	}
	if len(y) != 4 || len(d) < 1 || len(d) > 2 || len(m) < 1 || len(m) > 2 || !digits(y+m+d) {
		return "", false
	}
	yi, _ := strconv.Atoi(y)
	mi, _ := strconv.Atoi(m)
	di, _ := strconv.Atoi(d)
	t := time.Date(yi, time.Month(mi), di, 0, 0, 0, 0, time.UTC)
	if t.Year() != yi || int(t.Month()) != mi || t.Day() != di {
		return "", false
	}
	return t.Format(time.DateOnly), true
}

// checkDate parses a booking date and keeps it between 1990 and today.
func checkDate(s, today, order string) (string, string) {
	if s == "" {
		return "", "Datum ontbreekt."
	}
	d, ok := parseDate(s, order)
	switch {
	case !ok:
		return "", "Datum is ongeldig. Gebruik dd/mm/jjjj, dd-mm-jjjj, dd.mm.jjjj of jjjj-mm-dd."
	case d < "1990-01-01":
		return "", "Datum ligt voor 1990."
	case d > today:
		return "", "Datum ligt in de toekomst."
	}
	return d, ""
}

func digits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return s != ""
}

// amountBody strips one sign (leading or trailing, + - or U+2212) and a
// leading or trailing "€" or "EUR", and returns the number that is left.
func amountBody(s string) (neg bool, body, msg string) {
	s = strings.ReplaceAll(s, "−", "-")
	switch strings.Count(s, "-") + strings.Count(s, "+") {
	case 0:
	case 1:
		i := strings.IndexAny(s, "+-")
		neg = s[i] == '-'
		s = s[:i] + " " + s[i+1:]
	default:
		return false, "", "Bedrag heeft meer dan één plus- of minteken."
	}
	s = strings.TrimSpace(s)
	for _, cur := range []string{"€", "EUR", "eur", "Eur"} {
		s = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(s, cur), cur))
	}
	if s == "" {
		return false, "", "Bedrag ontbreekt."
	}
	for _, c := range s {
		if (c < '0' || c > '9') && c != '.' && c != ',' {
			return false, "", "Bedrag is ongeldig."
		}
	}
	if !digits(s[:1]) || !digits(s[len(s)-1:]) {
		return false, "", "Bedrag is ongeldig."
	}
	return neg, s, ""
}

// decimalHint is the decimal separator a number shows on its own, or 0 when
// it does not tell (an integer, or one separator followed by three digits).
func decimalHint(body string) byte {
	c, d := strings.Count(body, ","), strings.Count(body, ".")
	switch {
	case c > 0 && d > 0:
		return body[strings.LastIndexAny(body, ",.")]
	case c > 1:
		return '.'
	case d > 1:
		return ','
	case c == 1 && len(body)-1-strings.IndexByte(body, ',') != 3:
		return ','
	case d == 1 && len(body)-1-strings.IndexByte(body, '.') != 3:
		return '.'
	}
	return 0
}

// fileDecimal decides the decimal separator of a whole amount column: the
// one the self-explaining cells agree on, or 0 when they show none or both.
func fileDecimal(cells []string) byte {
	var seen byte
	for _, c := range cells {
		_, body, msg := amountBody(c)
		if msg != "" {
			continue
		}
		h := decimalHint(body)
		if h == 0 {
			continue
		}
		if seen != 0 && seen != h {
			return 0
		}
		seen = h
	}
	return seen
}

// parseAmount returns signed cents without floating point. dec is the file's
// decimal separator (',' '.' or 0 for unknown); it only decides a single
// separator followed by exactly three digits ("1.234", "1,234"), which is
// refused when dec is unknown.
func parseAmount(s string, dec byte) (int64, string) {
	neg, body, msg := amountBody(s)
	if msg != "" {
		return 0, msg
	}
	sep := decimalHint(body)
	if sep == 0 && strings.ContainsAny(body, ",.") {
		if dec == 0 {
			return 0, "Bedrag is dubbelzinnig: niet te zeggen of punt of komma het decimaalteken is."
		}
		if strings.IndexByte(body, dec) >= 0 {
			sep = dec
		}
	}
	whole, frac := body, ""
	if i := strings.LastIndexByte(body, sep); sep != 0 && i >= 0 {
		whole, frac = body[:i], body[i+1:]
		if strings.IndexByte(whole, sep) >= 0 {
			return 0, "Bedrag is ongeldig."
		}
	}
	// What is left of whole may hold the other separator, as thousands groups.
	groups := strings.FieldsFunc(whole, func(r rune) bool { return r == '.' || r == ',' })
	if strings.Count(whole, ".")+strings.Count(whole, ",") != len(groups)-1 || len(groups[0]) > 3 && len(groups) > 1 {
		return 0, "Bedrag is ongeldig."
	}
	for _, g := range groups[1:] {
		if len(g) != 3 {
			return 0, "Bedrag is ongeldig."
		}
	}
	if len(frac) > 2 {
		if strings.Trim(frac[2:], "0") != "" {
			return 0, "Bedrag heeft meer dan twee decimalen."
		}
		frac = frac[:2]
	}
	for len(frac) < 2 {
		frac += "0"
	}
	cents := strings.TrimLeft(strings.Join(groups, "")+frac, "0")
	n, _ := strconv.ParseInt("0"+cents, 10, 64)
	// The web reads cents as a JS number: stay within Number.MAX_SAFE_INTEGER.
	if len(cents) > 16 || n > 1<<53-1 {
		return 0, "Bedrag is te groot."
	}
	if neg {
		n = -n
	}
	return n, ""
}

// validIBAN normalises an IBAN like ledger.NormalizeIBAN (copied: importers
// does not import ledger) and returns "" unless the mod-97 checksum holds.
func validIBAN(s string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		if r >= '0' && r <= '9' || r >= 'A' && r <= 'Z' {
			b.WriteRune(r)
		}
	}
	iban := b.String()
	if len(iban) < 15 || len(iban) > 34 || iban[0] < 'A' || iban[1] < 'A' || iban[0] > 'Z' || iban[1] > 'Z' || !digits(iban[2:4]) {
		return ""
	}
	rem := 0
	for _, r := range iban[4:] + iban[:4] {
		if r >= 'A' {
			rem = (rem*100 + int(r-'A'+10)) % 97
		} else {
			rem = (rem*10 + int(r-'0')) % 97
		}
	}
	if rem != 1 {
		return ""
	}
	return iban
}

// cardSep separates the parts of a Bilance card payment string.
const cardSep = "|.|"

var cardDate = regexp.MustCompile(`^\d{2}-\d{2}-\d{4}$`)

// cardSafe keeps only what is safe to store and show of a card payment
// string (merchant |.| dd-mm-yyyy |.| hh:mm |.| place |.| country |.| masked
// card number |.| category code |.| card holder's name): the merchant, the
// date and the place, as one line. A string of any other shape keeps its
// first part only, never a guess. A text without the separator passes as is.
// The card holder and the card number stay in the raw payload only.
func cardSafe(s string) string {
	if !strings.Contains(s, cardSep) {
		return s
	}
	parts := strings.Split(s, cardSep)
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	if len(parts) == 8 && cardDate.MatchString(parts[1]) {
		return strings.Join(strings.Fields(parts[0]+" "+parts[1]+" "+parts[3]), " ")
	}
	return parts[0]
}
