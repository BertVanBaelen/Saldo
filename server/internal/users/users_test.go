package users

import "testing"

func TestInitial(t *testing.T) {
	tests := map[string]string{"Bert": "B", "partner": "P", " émilie": "É", "": "?"}
	for name, want := range tests {
		if got := Initial(name); got != want {
			t.Errorf("Initial(%q) = %q, want %q", name, got, want)
		}
	}
}
