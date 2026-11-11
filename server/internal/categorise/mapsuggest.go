package categorise

import (
	"strings"
	"unicode"
)

// Target is a category of the tree as a mapping suggestion sees it: Parent is
// the name of the main category of a subcategory, "" for a main category.
type Target struct {
	ID     int64
	Name   string
	Parent string
}

// SuggestTarget proposes the category a source pair (Bilance's Categorie and
// Subcategorie) probably belongs to, by name only: case, accents and
// punctuation ignored; an equal name beats one that contains the other
// (either way, at least four letters), which beats a shared word of four
// letters. A pair with a subcategory looks at the subcategory first, then at
// the main category alone against the main categories. It is a suggestion:
// nothing applies it unasked. ok is false when nothing resembles the pair.
// shortcut: no synonyms or language knowledge, only the words as written;
// upgrade when real exports show names that never match.
func SuggestTarget(top, sub string, tree []Target) (id int64, ok bool) {
	if sub != "" {
		if id, ok = best(sub, top, tree, false); ok {
			return id, true
		}
		return best(top, "", tree, true)
	}
	return best(top, "", tree, false)
}

// best scores every candidate (main categories only when onlyTops) against
// the query; a candidate under the pair's own main category gets a small bonus.
func best(query, parent string, tree []Target, onlyTops bool) (int64, bool) {
	q, p := normName(query), normName(parent)
	if q == "" {
		return 0, false
	}
	var bestID int64
	bestScore := 0
	for _, t := range tree {
		if onlyTops && t.Parent != "" {
			continue
		}
		s := nameScore(q, normName(t.Name))
		if s == 0 {
			continue
		}
		if p != "" && normName(t.Parent) == p {
			s += 5
		}
		if s > bestScore { // the first in tree order wins a tie
			bestID, bestScore = t.ID, s
		}
	}
	return bestID, bestScore > 0
}

func nameScore(q, c string) int {
	switch {
	case c == "":
		return 0
	case q == c:
		return 100
	case min(len(q), len(c)) >= 4 && (strings.Contains(q, c) || strings.Contains(c, q)):
		return 70
	}
	for _, w := range strings.Fields(q) {
		if len(w) >= 4 && strings.Contains(" "+c+" ", " "+w+" ") {
			return 40
		}
	}
	return 0
}

var accents = strings.NewReplacer(
	"à", "a", "á", "a", "â", "a", "ä", "a", "ç", "c", "è", "e", "é", "e", "ê", "e", "ë", "e",
	"ì", "i", "í", "i", "î", "i", "ï", "i", "ñ", "n", "ò", "o", "ó", "o", "ô", "o", "ö", "o",
	"ù", "u", "ú", "u", "û", "u", "ü", "u", "ÿ", "y",
)

// normName lower-cases, drops accents and turns every run of other
// characters into one space: "Eten & Drinken" and "eten drinken" are equal.
func normName(s string) string {
	s = accents.Replace(strings.ToLower(s))
	return strings.Join(strings.FieldsFunc(s, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }), " ")
}
