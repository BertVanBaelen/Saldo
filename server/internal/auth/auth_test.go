package auth

import (
	"strings"
	"testing"
)

func TestPasswordHash(t *testing.T) {
	h := HashPassword("lange zin voor bert")
	if !strings.HasPrefix(h, "$argon2id$v=19$m=65536,t=2,p=2$") {
		t.Fatalf("hash %q", h)
	}
	// The dummy for unknown addresses costs the same as a real hash.
	if !strings.HasPrefix(dummyHash, "$argon2id$v=19$m=65536,t=2,p=2$") || VerifyPassword(dummyHash, "") {
		t.Errorf("dummy hash %q", dummyHash)
	}
	if h == HashPassword("lange zin voor bert") {
		t.Error("two hashes of one password must differ (salt)")
	}
	if !VerifyPassword(h, "lange zin voor bert") || VerifyPassword(h, "lange zin voor Bert") {
		t.Error("verify")
	}
	for _, bad := range []string{"", "plain", "$argon2i$v=19$m=65536,t=2,p=2$c2FsdA$aGFzaA", "$argon2id$v=19$m=65536,t=0,p=2$c2FsdA$aGFzaA", h[:len(h)-3] + "!!!"} {
		if VerifyPassword(bad, "lange zin voor bert") {
			t.Errorf("%q verified", bad)
		}
	}
}

func TestCheckPassword(t *testing.T) {
	tests := map[string]bool{
		"lange zin voor bert": true,
		"twaalf tekens":       true,
		"elf tekens!":         false,
		"Password1234":        false,
		"AZERTYUIOP123":       false,
		"bert@example.com":    false,
		" Bert@Example.com ":  false,
		"ééééééééééé":         false, // 11 characters, more bytes
	}
	for pw, ok := range tests {
		if err := CheckPassword(pw, "bert@example.com"); (err == nil) != ok {
			t.Errorf("CheckPassword(%q) = %v", pw, err)
		}
	}
}

func TestDeviceName(t *testing.T) {
	tests := map[string]string{
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1": "Safari op iPhone",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36":                         "Chrome op Windows",
		"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36":                   "Chrome op Android",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15":                   "Safari op Mac",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0":           "Edge op Windows",
		"Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0":                                                                  "Firefox op Linux",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1":  "Chrome op iPhone",
		"curl/8.10": "Onbekend toestel",
		"":          "Onbekend toestel",
	}
	for ua, want := range tests {
		if got := DeviceName(ua); got != want {
			t.Errorf("DeviceName(%q) = %q, want %q", ua, got, want)
		}
	}
}

func TestEmail(t *testing.T) {
	for in, want := range map[string]string{" bert@example.com ": "bert@example.com", "Partner@Example.be": "Partner@Example.be"} {
		if got, err := CleanEmail(in); err != nil || got != want {
			t.Errorf("CleanEmail(%q) = %q, %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "bert", "bert@", "@example.com", "Bert <bert@example.com>", "bert@localhost", "a@b.c\r\nBcc: x@example.com"} {
		if _, err := CleanEmail(bad); err == nil {
			t.Errorf("CleanEmail(%q) accepted", bad)
		}
	}
	if got := MaskEmail("émilie@example.com"); got != "é•••@example.com" {
		t.Errorf("MaskEmail = %q", got)
	}
}
