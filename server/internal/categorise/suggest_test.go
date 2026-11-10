package categorise

import (
	"reflect"
	"testing"
)

func TestSuggest(t *testing.T) {
	training := []Group{
		// One key in three spellings: 3 + 1 rows of category 16, 1 of 2.
		{"Bakkerij De Graankorrel", 16, 3, "2026-11-01#1"},
		{"BAKKERIJ  DÉ GRAANKORREL", 16, 1, "2026-11-02#2"},
		{"bakkerij de graankorrel", 2, 1, "2026-11-03#3"},
		// A tie (1:1): the category of the newest row wins, 50 %.
		{"Kraam Een", 3, 1, "2026-11-05#9"},
		{"Kraam Een", 4, 1, "2026-11-06#4"},
		// Seen once: never offered.
		{"Eenmalig", 5, 1, "2026-11-01#5"},
		// 1:1:1 is 33 %, below MinConfidence.
		{"Verspreid", 2, 1, "x"}, {"Verspreid", 3, 1, "y"}, {"Verspreid", 4, 1, "z"},
		// No open rows: not offered.
		{"Alles Gedaan", 5, 4, "x"},
		// Decided before: not offered.
		{"Al Beslist", 5, 2, "x"},
		// An empty name has no key.
		{"   ", 5, 9, "x"},
	}
	open := []Group{
		{"Bakkerij De Graankorrel", 0, 1, "2026-11-10#20"},
		{"bakkerij de graankorrel ", 0, 2, "2026-11-12#21"},
		{"Kraam Een", 0, 1, "x"},
		{"Eenmalig", 0, 1, "x"}, {"Verspreid", 0, 1, "x"}, {"Al Beslist", 0, 1, "x"}, {"", 0, 3, "x"},
	}
	decided := func(k string, c int64) bool { return k == "al beslist" && c == 5 }
	got := Suggest(training, open, decided)
	want := []Suggestion{
		{CounterpartyKey: "bakkerij de graankorrel", Counterparty: "bakkerij de graankorrel ", CategoryID: 16, Confidence: 80, Seen: 5, Open: 3},
		{CounterpartyKey: "kraam een", Counterparty: "Kraam Een", CategoryID: 4, Confidence: 50, Seen: 2, Open: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
	// The same input in another order gives the same answer.
	rev := func(g []Group) []Group {
		out := make([]Group, len(g))
		for i := range g {
			out[len(g)-1-i] = g[i]
		}
		return out
	}
	if again := Suggest(rev(training), rev(open), decided); !reflect.DeepEqual(again, want) {
		t.Errorf("order dependent: %+v", again)
	}
	// Order: confidence desc, open desc, key.
	order := Suggest([]Group{{"b", 1, 2, "x"}, {"a", 1, 2, "x"}, {"c", 1, 2, "x"}, {"d", 1, 1, "x"}, {"d", 2, 1, "y"}},
		[]Group{{"a", 0, 1, "x"}, {"b", 0, 1, "x"}, {"c", 0, 5, "x"}, {"d", 0, 9, "x"}}, func(string, int64) bool { return false })
	var keys []string
	for _, s := range order {
		keys = append(keys, s.CounterpartyKey)
	}
	if !reflect.DeepEqual(keys, []string{"c", "a", "b", "d"}) {
		t.Errorf("order %v", keys)
	}
	if MinSeen != 2 || MinConfidence != 40 {
		t.Error("the thresholds changed: update docs/api.md")
	}
}
