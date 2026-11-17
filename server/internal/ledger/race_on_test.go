//go:build race

package ledger_test

// raceEnabled is true when the tests run under the race detector, which
// makes SQLite (translated Go) about 85 times slower: a timing bound means
// nothing there.
const raceEnabled = true
