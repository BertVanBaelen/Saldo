package ledger

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/categorise"
)

// Overlap and duplicates of an import (phase 0.5-4). One matcher serves the
// import and the sync: the stored booked rows of an account are read once
// (storedBooked) and matched by the exact rule of 0.3-6 (ContentHash: date,
// amount, counterparty and communication equal, counted per occurrence). A
// Bilance file also gets the fuzzy rule on what the exact rule left over
// (matchStored). The sync keeps the exact rule only (storedContent).

// SourceBilance is the import source that gets the cutoff and the fuzzy rule.
const SourceBilance = "bilance"

// MaxListedDuplicates bounds the probable duplicates an answer lists; the
// total counts all of them.
const MaxListedDuplicates = 200

// ImportOptions are what an import does beyond the exact rule (0.5-4); both
// parts are for a Bilance file.
type ImportOptions struct {
	// Include holds file lines of probable duplicates to import anyway; a
	// line that is not a probable duplicate is ignored.
	Include map[int]bool
	// Cutoffs maps an account id to a date "yyyy-mm-dd": rows of that account
	// booked on or after it are skipped. No entry: no cutoff.
	Cutoffs map[int64]string
}

// CategoryRef is a category as the duplicate list shows it.
type CategoryRef struct {
	Name   string `json:"name"`
	Icon   string `json:"icon"`
	Colour string `json:"colour"`
}

// Duplicate is a probable duplicate of an import: the incoming row, and the
// stored row it probably is. Category is the Saldo category the incoming row
// gets through the mapping (nil: none); Takes tells that the stored row has
// no category and no split parts, so it takes that category when the
// incoming row is skipped. Nothing sensitive: no raw row, no IBAN.
type Duplicate struct {
	Line         int          `json:"line"`
	AccountID    int64        `json:"accountId"`
	Date         string       `json:"date"`
	Amount       int64        `json:"amount"`
	Counterparty string       `json:"counterparty"`
	Note         string       `json:"note"`
	Source       [2]string    `json:"source"` // the file's category and subcategory
	Category     *CategoryRef `json:"category"`
	Takes        bool         `json:"takes"`
	Existing     Existing     `json:"existing"`
}

// Existing is the stored row of a Duplicate.
type Existing struct {
	ID            int64        `json:"id"`
	Date          string       `json:"date"`
	Amount        int64        `json:"amount"`
	Counterparty  string       `json:"counterparty"`
	Communication string       `json:"communication"`
	Category      *CategoryRef `json:"category"`
	Imported      bool         `json:"imported"` // brought by an import, not by the bank
}

// storedRow is a booked row an account holds, as the matchers see it.
type storedRow struct {
	id int64
	bank.Transaction
	category   int64
	split      bool
	fromImport bool
}

// storedBooked reads the account's stored booked rows between lo and hi
// (booking dates), slack days wider on both sides, oldest id first.
func storedBooked(ctx context.Context, tx *sql.Tx, accountID int64, lo, hi string, slack int) ([]storedRow, error) {
	q, err := tx.QueryContext(ctx, `SELECT id, booking_date, amount, counterparty_name, communication, COALESCE(category_id, 0),
		    EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = transactions.id), import_batch_id IS NOT NULL
		FROM transactions WHERE account_id = ? AND status = 'booked'
		  AND booking_date BETWEEN date(?, ?) AND date(?, ?) ORDER BY id`,
		accountID, lo, fmt.Sprintf("-%d days", slack), hi, fmt.Sprintf("+%d days", slack))
	if err != nil {
		return nil, err
	}
	defer q.Close()
	var out []storedRow
	for q.Next() {
		var s storedRow
		if err := q.Scan(&s.id, &s.BookingDate, &s.Amount, &s.CounterpartyName, &s.Communication, &s.category, &s.split, &s.fromImport); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, q.Err()
}

// dateRange is the earliest and the latest booking date of rows.
func dateRange(rows []NewTransaction) (lo, hi string) {
	lo, hi = rows[0].BookingDate, rows[0].BookingDate
	for _, r := range rows {
		lo, hi = min(lo, r.BookingDate), max(hi, r.BookingDate)
	}
	return lo, hi
}

// storedContent counts the account's stored booked rows per ContentHash
// between the earliest and the latest booking date of rows: all of them, and
// those an import brought. It is the sync's side of the exact rule.
func storedContent(ctx context.Context, tx *sql.Tx, accountID int64, rows []NewTransaction) (all, imported map[string]int, err error) {
	lo, hi := dateRange(rows)
	stored, err := storedBooked(ctx, tx, accountID, lo, hi, 0)
	if err != nil {
		return nil, nil, err
	}
	all, imported = map[string]int{}, map[string]int{}
	for _, s := range stored {
		h := ContentHash(s.Transaction)
		all[h]++
		if s.fromImport {
			imported[h]++
		}
	}
	return all, imported, nil
}

// matchStored matches the rows of a file against the account's stored booked
// rows. exact[i] is true when row i equals a stored row (ContentHash),
// counting: k equal rows against m stored rows match the first min(k, m) in
// file order, so a second real purchase on one day is not lost. With fuzzy
// (a Bilance file) the rows left over are then matched on same account, same
// amount, booking date at most one day apart and a similar counterparty
// (similarNames), giving probable[i]. A stored row is matched at most once,
// by the exact rule or the fuzzy one, so one stored row never swallows
// several incoming rows; among candidates the closest date, then the oldest
// id, wins, and rows go in file order.
func matchStored(ctx context.Context, tx *sql.Tx, accountID int64, rows []NewTransaction, fuzzy bool) (exact []bool, probable map[int]storedRow, err error) {
	exact = make([]bool, len(rows))
	if len(rows) == 0 {
		return exact, nil, nil
	}
	slack := 0
	if fuzzy {
		slack = 1
	}
	lo, hi := dateRange(rows)
	stored, err := storedBooked(ctx, tx, accountID, lo, hi, slack)
	if err != nil {
		return nil, nil, err
	}
	free := map[string][]int{} // content hash -> unmatched stored rows
	byAmount := map[int64][]int{}
	for i, s := range stored {
		h := ContentHash(s.Transaction)
		free[h] = append(free[h], i)
		byAmount[s.Amount] = append(byAmount[s.Amount], i)
	}
	used := make([]bool, len(stored))
	for i, r := range rows {
		h := ContentHash(r.Transaction)
		if l := free[h]; len(l) > 0 {
			used[l[0]], free[h], exact[i] = true, l[1:], true
		}
	}
	if !fuzzy {
		return exact, nil, nil
	}
	probable = map[int]storedRow{}
	for i, r := range rows {
		if exact[i] {
			continue
		}
		best, bestGap := -1, 2
		for _, j := range byAmount[r.Amount] {
			if used[j] {
				continue
			}
			if gap := dayGap(stored[j].BookingDate, r.BookingDate); gap < bestGap && similarNames(stored[j].CounterpartyName, r.CounterpartyName) {
				best, bestGap = j, gap
			}
		}
		if best >= 0 {
			used[best], probable[i] = true, stored[best]
		}
	}
	return exact, probable, nil
}

// dayGap is the number of days between two "yyyy-mm-dd" dates; 99 when one
// does not parse (never a match).
func dayGap(a, b string) int {
	x, err1 := time.Parse(time.DateOnly, a)
	y, err2 := time.Parse(time.DateOnly, b)
	if err1 != nil || err2 != nil {
		return 99
	}
	return int(x.Sub(y).Abs() / (24 * time.Hour))
}

// noiseWords are left out when counterparties are compared: legal forms and
// the country, which a bank adds or drops ("SPOTIFY AB" and "Spotify").
var noiseWords = map[string]bool{"be": true, "bv": true, "bvba": true, "nv": true, "sa": true, "sprl": true, "vzw": true, "ab": true}

// nameWords is a counterparty as comparable words: lower case, accents
// folded, punctuation as a space, without all-digit words (a branch or
// terminal number) and noiseWords.
func nameWords(s string) []string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return r
		}
		return ' '
	}, categorise.Normalise(s))
	var out []string
	for _, w := range strings.Fields(s) {
		if !noiseWords[w] && strings.IndexFunc(w, func(r rune) bool { return !unicode.IsDigit(r) }) >= 0 {
			out = append(out, w)
		}
	}
	return out
}

// similarNames tells whether two counterparties are probably the same
// payee: equal as nameWords, or one contains the other as whole words (the
// shorter at least 4 characters: "De Graankorrel" in "Bakkerij De
// Graankorrel"), or at least half of the larger name's words are shared
// words of 3 letters or more. A name without words (empty, or only digits)
// is similar to nothing.
// shortcut: no spelling distance, so "Collruyt" does not match "Colruyt";
// add one when a real export shows it.
func similarNames(a, b string) bool {
	wa, wb := nameWords(a), nameWords(b)
	if len(wa) == 0 || len(wb) == 0 {
		return false
	}
	na, nb := strings.Join(wa, " "), strings.Join(wb, " ")
	if na == nb {
		return true
	}
	short, long := na, nb
	if len(short) > len(long) {
		short, long = long, short
	}
	if len(short) >= 4 && strings.Contains(" "+long+" ", " "+short+" ") {
		return true
	}
	in := map[string]bool{}
	for _, w := range wb {
		in[w] = true
	}
	shared := 0
	for _, w := range wa {
		if len(w) >= 3 && in[w] {
			shared++
			delete(in, w) // a repeated word counts once
		}
	}
	return shared > 0 && shared*2 >= max(len(wa), len(wb))
}
