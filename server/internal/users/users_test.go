package users

import "testing"

func TestCheckName(t *testing.T) {
	tests := map[string]string{"  Bert ": "Bert", "Émilie": "Émilie", "": "", "   ": "", "Bert\r\nBcc: x": "", "Ber\tt": ""}
	for in, want := range tests {
		got, err := CheckName(in)
		if got != want || (err == nil) != (want != "") {
			t.Errorf("CheckName(%q) = %q, %v", in, got, err)
		}
	}
	if _, err := CheckName("1234567890123456789012345678901234567890"); err != nil {
		t.Error("40 characters is allowed")
	}
	if _, err := CheckName("12345678901234567890123456789012345678901"); err == nil {
		t.Error("41 characters is too long")
	}
}

func TestInitial(t *testing.T) {
	tests := map[string]string{"Bert": "B", "partner": "P", " émilie": "É", "": "?"}
	for name, want := range tests {
		if got := Initial(name); got != want {
			t.Errorf("Initial(%q) = %q, want %q", name, got, want)
		}
	}
}
