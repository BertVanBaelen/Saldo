// Package planning holds what the forecast is built on: the match key of
// recurring items (this file), and later the detection and the forecast
// engine. It may import ledger and categorise; ledger never imports it, so
// ledger takes Key as an argument where it needs it.
package planning

import (
	"strings"
	"unicode"

	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// Key is the key a counterparty name is matched by (detection, the forecast's
// matching, confirming a suggestion): categorise.Normalise with every digit
// removed, tokens that are only punctuation dropped and white space collapsed,
// so "PAYPAL *NETFLIX 1234" and "Paypal *Netflix 5678" are both
// "paypal *netflix". A name without a letter ("1234", "#12") gives "", which
// never matches anything.
func Key(name string) string {
	noDigits := strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return -1
		}
		return r
	}, categorise.Normalise(name))
	words := strings.Fields(noDigits)
	kept := words[:0]
	for _, w := range words {
		if strings.ContainsFunc(w, unicode.IsLetter) {
			kept = append(kept, w)
		}
	}
	return strings.Join(kept, " ")
}
