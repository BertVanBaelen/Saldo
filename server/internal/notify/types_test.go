package notify

import (
	"slices"
	"strings"
	"testing"
)

// TestTypesTable: every type of the Meldingen screen has a name, a subline, a
// dot and a group of Groups; groups and keys are unique, every group has a
// type, and the types are grouped in the order of Groups, so the list is
// ready to render.
func TestTypesTable(t *testing.T) {
	groups := map[string]bool{}
	var order []string
	for _, g := range Groups {
		if g.ID == "" || g.Label == "" || g.ID != strings.ToLower(g.ID) {
			t.Errorf("group %+v: want a lower-case id and a label", g)
		}
		if groups[g.ID] {
			t.Errorf("group %q twice", g.ID)
		}
		groups[g.ID] = true
		order = append(order, g.ID)
	}
	keys := map[string]bool{}
	used := map[string]bool{}
	last := -1
	for _, typ := range Types {
		if typ.Key == "" || typ.Name == "" || typ.Subline == "" {
			t.Errorf("type %+v: needs a key, a name and a subline", typ)
		}
		if !strings.HasPrefix(typ.Dot, "--") || len(typ.Dot) < 3 {
			t.Errorf("%s: dot %q is not a colour token", typ.Key, typ.Dot)
		}
		if keys[typ.Key] {
			t.Errorf("type %q twice", typ.Key)
		}
		keys[typ.Key] = true
		idx := slices.Index(order, typ.Group)
		if idx < 0 {
			t.Errorf("%s: group %q is not in Groups", typ.Key, typ.Group)
			continue
		}
		if idx < last {
			t.Errorf("%s: group %q comes after a later group: the types are not in screen order", typ.Key, typ.Group)
		}
		last = idx
		used[typ.Group] = true
	}
	for _, g := range Groups {
		if !used[g.ID] {
			t.Errorf("group %q has no type", g.ID)
		}
	}
}

// TestTypeTexts pins the Dutch texts of the screen spec
// (analysis/screens/meldingen.md): name, subline, group and dot per type.
func TestTypeTexts(t *testing.T) {
	want := []struct{ key, name, subline, group, dot string }{
		{"rood", "Rekening staat rood", "Als een rekening in de planning onder € 0 zakt", "planning", "--neg"},
		{"buffer", "Rekening komt in de buffer", "Als een rekening onder haar eigen buffer zakt", "planning", "--warn"},
		{"consent", "Koppeling verloopt", "14 en 3 dagen vooraf", "bank", "--warn"},
		{"stop", "Synchronisatie gestopt", "Als Saldo een rekening niet meer kan lezen", "bank", "--neg"},
		{"joined", "Iemand sluit aan", "Bij een gedeelde rekening waar jij beheerder bent", "gedeeld", "--shared"},
		{"invite", "Uitnodiging voor een gedeelde rekening", "Als een beheerder je uitnodigt", "gedeeld", "--shared"},
		{"contrib", "Bijdrage ontbreekt", "Als een bijdrage op de 3e nog niet binnen is", "gedeeld", "--shared"},
		{"cat", "Te categoriseren", "Eén keer per dag om 19:00, als er iets is", "transacties", "--green"},
		{"week", "Weekoverzicht", "Elke zondag om 19:00, met wat je uitgaf per categorie", "overzicht", "--green"},
		{"month", "Maandoverzicht", "Op de laatste dag van de maand om 19:00, met je budgetten", "overzicht", "--green"},
		{"device", "Nieuw toestel aangemeld", "Als iemand inlogt op een nieuw toestel", "beveiliging", "--warn"},
	}
	if len(want) != len(Types) {
		t.Fatalf("%d types, the spec has %d", len(Types), len(want))
	}
	for i, w := range want {
		got := Types[i]
		if got.Key != w.key || got.Name != w.name || got.Subline != w.subline || got.Group != w.group || got.Dot != w.dot {
			t.Errorf("type %d: %+v, want %+v", i, got, w)
		}
	}
	wantGroups := []Group{{"planning", "Planning"}, {"bank", "Bank"}, {"gedeeld", "Gedeeld"}, {"transacties", "Transacties"},
		{"overzicht", "Overzicht"}, {"beveiliging", "Beveiliging"}}
	if !slices.Equal(Groups, wantGroups) {
		t.Errorf("groups %+v, want %+v", Groups, wantGroups)
	}
}
