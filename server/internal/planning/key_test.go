package planning

import "testing"

func TestKey(t *testing.T) {
	for in, want := range map[string]string{
		"Immo Verhaeghe":        "immo verhaeghe",
		"PAYPAL *NETFLIX 1234":  "paypal *netflix",
		"Paypal *Netflix  5678": "paypal *netflix",
		"Café Ölçer 12":         "cafe olcer",
		"1234":                  "",
		"Q8 #123":               "q",
		"":                      "",
	} {
		if got := Key(in); got != want {
			t.Errorf("Key(%q) = %q, want %q", in, got, want)
		}
	}
}
