package categorise

import (
	"cmp"
	"context"
	"regexp"
	"slices"
	"strings"
	"unicode"
)

// Limits of a rule (docs/api.md, "Rules").
const (
	MaxCounterparty  = 140
	MaxCommunication = 200
	MaxRulesPerOwner = 200
	// matchedText bounds the communication a rule reads (runes).
	matchedText = 1000
)

// Rule is a stored rule. Counterparty, Communication and CounterpartyIBAN
// are "" when the rule has no such condition; CounterpartyIBAN is normalised
// (upper case, letters and digits). Prepare fills the matching fields.
type Rule struct {
	ID                 int64
	AccountID          int64 // 0: a user rule
	UserID             int64 // 0: an account rule
	Priority           int
	Counterparty       string
	CounterpartyExact  bool
	CounterpartyIBAN   string
	Communication      string
	CommunicationRegex bool
	AmountMin          *int64
	AmountMax          *int64
	CategoryID         int64

	cp, comm string
	re       *regexp.Regexp
}

// Candidate is what a rule looks at: a transaction's counterparty, its
// normalised counterparty IBAN, its communication and its signed amount.
type Candidate struct {
	Counterparty     string
	CounterpartyIBAN string
	Communication    string
	Amount           int64
}

// Compile compiles a communication pattern the way rules use it: RE2,
// case-insensitive. Go's regexp runs in time linear in the input, so a
// pattern cannot backtrack catastrophically.
func Compile(pattern string) (*regexp.Regexp, error) {
	return regexp.Compile("(?i)" + pattern)
}

// Prepare readies rules for Match: normalised texts, compiled patterns, and
// the evaluation order priority DESC, id DESC (a higher priority wins; on a
// tie the newest rule). A rule whose pattern no longer compiles is dropped.
func Prepare(rules []Rule) []Rule {
	out := make([]Rule, 0, len(rules))
	for _, r := range rules {
		r.cp = Normalise(r.Counterparty)
		if r.CommunicationRegex {
			re, err := Compile(r.Communication)
			if err != nil {
				continue
			}
			r.re = re
		} else {
			r.comm = Normalise(r.Communication)
		}
		out = append(out, r)
	}
	slices.SortStableFunc(out, func(a, b Rule) int {
		return cmp.Or(cmp.Compare(b.Priority, a.Priority), cmp.Compare(b.ID, a.ID))
	})
	return out
}

// Match returns the first prepared rule that matches c, or nil.
func Match(rules []Rule, c Candidate) *Rule {
	var cp, comm, raw string
	for i := range rules {
		r := &rules[i]
		if r.cp != "" {
			if cp == "" {
				cp = Normalise(c.Counterparty)
			}
			if r.CounterpartyExact && cp != r.cp || !r.CounterpartyExact && !strings.Contains(cp, r.cp) {
				continue
			}
		}
		if r.CounterpartyIBAN != "" && r.CounterpartyIBAN != c.CounterpartyIBAN {
			continue
		}
		if r.re != nil {
			if raw == "" {
				raw = collapse(bounded(c.Communication))
			}
			if !r.re.MatchString(raw) {
				continue
			}
		} else if r.comm != "" {
			if comm == "" {
				comm = Normalise(bounded(c.Communication))
			}
			if !strings.Contains(comm, r.comm) {
				continue
			}
		}
		abs := c.Amount
		if abs < 0 {
			abs = -abs
		}
		if r.AmountMin != nil && abs < *r.AmountMin || r.AmountMax != nil && abs > *r.AmountMax {
			continue
		}
		return r
	}
	return nil
}

func bounded(s string) string {
	n := 0
	for i := range s {
		if n == matchedText {
			return s[:i]
		}
		n++
	}
	return s
}

// collapse trims and turns every run of white space into one space.
func collapse(s string) string { return strings.Join(strings.Fields(s), " ") }

// Normalise is the text rules compare: lower case, Latin diacritics folded,
// white space collapsed and trimmed. "Café  Ölçer" becomes "cafe olcer".
func Normalise(s string) string {
	s = collapse(strings.ToLower(s))
	if !strings.ContainsFunc(s, func(r rune) bool { return r > unicode.MaxASCII }) {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		if f, ok := fold[r]; ok {
			b.WriteString(f)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// fold maps lower-case Latin letters with a diacritic to plain letters.
var fold = func() map[rune]string {
	m := map[rune]string{'ß': "ss", 'æ': "ae", 'œ': "oe", 'ø': "o", 'ł': "l", 'đ': "d", 'ð': "d", 'þ': "th"}
	for plain, letters := range map[string]string{
		"a": "àáâãäåāăą", "c": "çćĉċč", "d": "ď", "e": "èéêëēĕėęě", "g": "ĝğġģ", "h": "ĥħ",
		"i": "ìíîïĩīĭįı", "j": "ĵ", "k": "ķ", "l": "ĺļľŀ", "n": "ñńņňŉ", "o": "òóôõöōŏő",
		"r": "ŕŗř", "s": "śŝşšș", "t": "ţťŧț", "u": "ùúûüũūŭůűų", "w": "ŵ", "y": "ýÿŷ", "z": "źżž",
	} {
		for _, r := range letters {
			m[r] = plain
		}
	}
	return m
}()

// RulesFor loads the prepared rules that apply to an account (analysis
// 4.2): the account's own rules and, only when the account has exactly one
// member (a personal account), that member's user rules. A user rule never
// applies to an account with more than one member, and another user's rules
// never apply.
func RulesFor(ctx context.Context, db DB, accountID int64) ([]Rule, error) {
	rows, err := db.QueryContext(ctx, `SELECT `+RuleColumns+` FROM rules
		WHERE account_id = ?1
		   OR user_id = (SELECT MIN(user_id) FROM account_access WHERE account_id = ?1 HAVING COUNT(*) = 1)`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Rule
	for rows.Next() {
		r, err := ScanRule(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return Prepare(list), nil
}

// RuleColumns is the select list of ScanRule, for a query on the table rules.
const RuleColumns = `rules.id, COALESCE(rules.account_id, 0), COALESCE(rules.user_id, 0), rules.priority,
	COALESCE(rules.counterparty_match, ''), rules.counterparty_exact, COALESCE(rules.counterparty_iban, ''),
	COALESCE(rules.communication_regex, rules.communication_contains, ''), rules.communication_regex IS NOT NULL,
	rules.amount_min, rules.amount_max, rules.category_id`

// ScanRule reads one row selected with RuleColumns.
func ScanRule(row interface{ Scan(...any) error }) (Rule, error) {
	var r Rule
	err := row.Scan(&r.ID, &r.AccountID, &r.UserID, &r.Priority, &r.Counterparty, &r.CounterpartyExact,
		&r.CounterpartyIBAN, &r.Communication, &r.CommunicationRegex, &r.AmountMin, &r.AmountMax, &r.CategoryID)
	return r, err
}
