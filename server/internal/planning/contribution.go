package planning

// The parts of a shared account's need (0.8-4 decision 10, moved here from the
// server layer in 0.9-3b so the "Bijdrage ontbreekt" trigger computes the same
// figure as the Bijdragen card and GET /api/planning).

// CeilEuros is num/den cents rounded up to whole euros, in cents.
func CeilEuros(num, den int64) int64 { return (num + den - 1) / den * 100 }

// MemberPart is a party's share in percent (the stored one, else equal) and
// their part of the need in whole euros rounded up: ⌈need × share / 100⌉, and
// ⌈need / n⌉ for equal shares (so three parties never sum below the need).
// parties counts the members and the contributors without Saldo (0.8.1-7).
func MemberPart(need int64, share *int, parties int) (int, int64) {
	if share != nil {
		return *share, CeilEuros(need*int64(*share), 10000)
	}
	return 100 / parties, CeilEuros(need, int64(100*parties))
}
