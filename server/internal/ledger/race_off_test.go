//go:build !race

package ledger_test

// raceEnabled is false outside the race detector; see race_on_test.go.
const raceEnabled = false
