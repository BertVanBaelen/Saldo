package categorise

import "testing"

// The pairs of fixtures/csv/bilance-voorbeeld.csv against the default tree:
// the suggestions the wizard shows in its Categorieen step.
func TestSuggestTarget(t *testing.T) {
	var tree []Target
	id := int64(0)
	for _, d := range Defaults {
		id++
		tree = append(tree, Target{ID: id, Name: d.Name})
	}
	id = int64(len(Defaults))
	for _, d := range Defaults {
		for _, s := range d.Subs {
			id++
			tree = append(tree, Target{ID: id, Name: s.Name, Parent: d.Name})
		}
	}
	name := func(id int64) string {
		for _, t := range tree {
			if t.ID == id {
				return t.Name
			}
		}
		return ""
	}
	for _, c := range []struct{ top, sub, want string }{
		{"Wonen", "Huur, hypotheek", "Huur"},                         // contained, under its own parent
		{"Wonen", "Energie, nutsvoorzieningen", "Energie"},           // contained
		{"Eten & Drinken", "Boodschappen", "Boodschappen"},           // equal to a main category
		{"Vrije tijd & entertainment", "Telefoonkosten", "Telefoon"}, // contained, under another parent
		{"Winkelen", "Overig", "Overig"},                             // equal beats "Overig inkomen"
		{"Inkomen", "Loon", "Overig inkomen"},                        // by the main category alone
		{"Inkomen", "Terugbetaling", "Terugbetaling"},
		{"Gezondheid & Educatie", "Wellness, verzorging", ""}, // nothing resembles it
		{"Winkelen", "Kleding, accessoires", ""},
		{"Eten & Drinken", "Uit eten, bezorging", ""},
		{"Inkomen", "Rente", "Overig inkomen"},
		{"", "", ""},
		{"EEN", "Énergie!", "Energie"}, // case, accents and punctuation do not matter
	} {
		got, ok := SuggestTarget(c.top, c.sub, tree)
		if name(got) != c.want || ok != (c.want != "") {
			t.Errorf("%q / %q: %q (%v), want %q", c.top, c.sub, name(got), ok, c.want)
		}
	}
}
