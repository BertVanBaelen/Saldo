package auth

import (
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

// argon2id cost: 64 MiB, 2 passes, 2 lanes (between the RFC 9106 and OWASP
// recommendations, still well under a second on a Raspberry Pi).
const (
	argonTime    = 2
	argonMemory  = 64 * 1024
	argonThreads = 2
	argonKeyLen  = 32
)

// hashing bounds concurrent argon2 runs: each takes 64 MiB, and the sign-in
// endpoint is public.
var hashing = make(chan struct{}, 2)

func argon(password string, salt []byte, t, m uint32, p uint8, n uint32) []byte {
	hashing <- struct{}{}
	defer func() { <-hashing }()
	return argon2.IDKey([]byte(password), salt, t, m, p, n)
}

// HashPassword returns a PHC-style argon2id hash:
// $argon2id$v=19$m=65536,t=2,p=2$<salt>$<hash>.
func HashPassword(password string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	key := argon(password, salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads, b64.EncodeToString(salt), b64.EncodeToString(key))
}

// VerifyPassword reports whether password matches an encoded hash, in
// constant time for a given hash.
func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != fmt.Sprintf("v=%d", argon2.Version) {
		return false
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil || t == 0 || p == 0 {
		return false
	}
	b64 := base64.RawStdEncoding
	salt, err1 := b64.DecodeString(parts[4])
	want, err2 := b64.DecodeString(parts[5])
	if err1 != nil || err2 != nil || len(want) == 0 {
		return false
	}
	got := argon(password, salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// dummyHash is checked when the address is unknown, so an unknown address
// costs as much time as a wrong password. It has the cost of a real hash and
// no password matches it.
var dummyHash = fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
	base64.RawStdEncoding.EncodeToString(make([]byte, 16)), base64.RawStdEncoding.EncodeToString(make([]byte, argonKeyLen)))

// MinPasswordLength is the shortest password Saldo accepts.
const MinPasswordLength = 12

//go:embed common-passwords.txt
var commonList string

var common = sync.OnceValue(func() map[string]bool {
	m := map[string]bool{}
	for _, line := range strings.Split(commonList, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			m[line] = true
		}
	}
	return m
})

// CheckPassword applies the password rules: at least 12 characters, not a
// well-known password and not the e-mail address.
func CheckPassword(password, email string) error {
	if utf8.RuneCountInString(password) < MinPasswordLength {
		return apperr.Invalid(fmt.Sprintf("Kies een wachtwoord van minstens %d tekens.", MinPasswordLength))
	}
	if strings.EqualFold(strings.TrimSpace(password), strings.TrimSpace(email)) {
		return apperr.Invalid("Je wachtwoord mag niet je e-mailadres zijn.")
	}
	if common()[strings.ToLower(password)] {
		return apperr.Invalid("Dit wachtwoord is te bekend. Kies er een dat niemand kan raden.")
	}
	return nil
}
