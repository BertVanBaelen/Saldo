package push

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"
)

// verifyES256 checks a JWS compact token as RFC 7518 3.4 says a verifier
// must: the signature is exactly 64 octets, R then S. It returns the claims.
func verifyES256(token, k string) (map[string]any, error) {
	token = strings.Join(strings.Fields(token), "")
	k = strings.Join(strings.Fields(k), "")
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("not three segments")
	}
	keyBytes, err := decodeB64(k)
	if err != nil {
		return nil, err
	}
	pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), keyBytes)
	if err != nil {
		return nil, err
	}
	sig, err := b64.DecodeString(parts[2])
	if err != nil {
		return nil, err
	}
	if len(sig) != 64 {
		return nil, errors.New("signature is not 64 octets")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r := new(big.Int).SetBytes(sig[:32])
	s := new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(pub, digest[:], r, s) {
		return nil, errors.New("bad signature")
	}
	var header map[string]string
	raw, _ := b64.DecodeString(parts[0])
	if err := json.Unmarshal(raw, &header); err != nil || header["alg"] != "ES256" || header["typ"] != "JWT" {
		return nil, errors.New("bad header")
	}
	var claims map[string]any
	raw, _ = b64.DecodeString(parts[1])
	if err := json.Unmarshal(raw, &claims); err != nil {
		return nil, err
	}
	return claims, nil
}

// The example of RFC 8292 section 2.4 (Figure 1), verbatim: our verifier
// accepts a token from the RFC, so the raw R||S form we sign is the one push
// services expect.
func TestVerifierAcceptsRFC8292Example(t *testing.T) {
	token := `eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3
        B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1ha
        Wx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_H
        LGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA`
	k := `BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dR
        uU_RCPCfA5aq9ojSwk5Y2EmClBPs`
	claims, err := verifyES256(token, k)
	if err != nil {
		t.Fatal(err)
	}
	if claims["aud"] != "https://push.example.net" || claims["exp"] != float64(1453523768) {
		t.Fatalf("claims %v", claims)
	}
}

func TestVAPIDToken(t *testing.T) {
	priv, pub, err := GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	if len(priv) != 32 {
		t.Fatalf("private key is %d octets", len(priv))
	}
	if raw, _ := decodeB64(pub); len(raw) != 65 || raw[0] != 4 {
		t.Fatalf("public key %q is not an uncompressed point", pub)
	}
	v, err := newVAPID(priv, pub, "https://saldo.example.org")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	header, err := v.authorization("https://fcm.googleapis.com", now)
	if err != nil {
		t.Fatal(err)
	}
	token, k, ok := parseVapidHeader(header)
	if !ok || k != pub {
		t.Fatalf("header %q", header)
	}
	claims, err := verifyES256(token, k)
	if err != nil {
		t.Fatal(err)
	}
	exp := int64(claims["exp"].(float64))
	if claims["aud"] != "https://fcm.googleapis.com" || claims["sub"] != "https://saldo.example.org" ||
		exp <= now.Unix() || exp > now.Add(24*time.Hour).Unix() {
		t.Fatalf("claims %v", claims)
	}
}

// parseVapidHeader splits "vapid t=<token>, k=<key>" (RFC 8292 3).
func parseVapidHeader(h string) (token, k string, ok bool) {
	rest, ok := strings.CutPrefix(h, "vapid ")
	if !ok {
		return "", "", false
	}
	for _, p := range strings.Split(rest, ",") {
		name, value, _ := strings.Cut(strings.TrimSpace(p), "=")
		switch name {
		case "t":
			token = value
		case "k":
			k = value
		}
	}
	return token, k, token != "" && k != ""
}

func TestNewVAPIDRefuses(t *testing.T) {
	priv, pub, _ := GenerateVAPIDKeys()
	_, otherPub, _ := GenerateVAPIDKeys()
	cases := map[string]struct {
		priv         []byte
		pub, subject string
	}{
		"mismatched public key": {priv, otherPub, "https://saldo.example.org"},
		"short private key":     {priv[:31], pub, "https://saldo.example.org"},
		"mailto subject":        {priv, pub, "mailto:someone@example.org"},
		"http subject":          {priv, pub, "http://saldo.example.org"},
	}
	for name, c := range cases {
		if _, err := NewWeb(c.priv, c.pub, c.subject); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// Padded base64url of the right key is fine.
	if _, err := NewWeb(priv, pub+"=", "https://saldo.example.org"); err != nil {
		t.Errorf("padded public key: %v", err)
	}
}
