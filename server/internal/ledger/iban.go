package ledger

import "strings"

// NormalizeIBAN upper-cases an IBAN and keeps only ASCII letters and digits.
func NormalizeIBAN(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= 'a' && r <= 'z':
			b.WriteRune(r - 'a' + 'A')
		}
	}
	return b.String()
}

// MaskIBAN shows only the country, the check digits and the last four
// characters: "BE68 •••• •••• 4821". Every hidden group of four becomes
// "••••". It returns "" for an empty or implausibly short IBAN.
func MaskIBAN(s string) string {
	s = NormalizeIBAN(s)
	if len(s) < 12 {
		return ""
	}
	hidden := len(s) - 8
	groups := (hidden + 3) / 4
	parts := make([]string, 0, groups+2)
	parts = append(parts, s[:4])
	for range groups {
		parts = append(parts, "••••")
	}
	parts = append(parts, s[len(s)-4:])
	return strings.Join(parts, " ")
}
