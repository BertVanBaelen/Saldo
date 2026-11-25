package push

import (
	"bytes"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"time"
)

// vapidLifetime is the "exp" of a VAPID token. RFC 8292 allows at most 24
// hours; a push service whose clock runs ahead would refuse a token that
// sits right at that limit, so we stay well inside it.
const vapidLifetime = 12 * time.Hour

// GenerateVAPIDKeys makes a new VAPID key pair: the private key as the raw
// 32-octet P-256 scalar (to be sealed by the caller) and the public key as a
// base64url uncompressed point, the form the browser's
// PushManager.subscribe wants as applicationServerKey.
func GenerateVAPIDKeys() (private []byte, public string, err error) {
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, "", err
	}
	return key.Bytes(), b64.EncodeToString(key.PublicKey().Bytes()), nil
}

// b64 is base64url without padding, the encoding of every key and of the
// JWT segments in the Web Push RFCs.
var b64 = base64.RawURLEncoding

// decodeB64 accepts base64url with or without trailing padding: browsers
// and libraries differ on whether they keep the "=".
func decodeB64(s string) ([]byte, error) {
	return b64.DecodeString(trimPadding(s))
}

func trimPadding(s string) string {
	for len(s) > 0 && s[len(s)-1] == '=' {
		s = s[:len(s)-1]
	}
	return s
}

// vapid signs the tokens that identify Saldo to the push services.
type vapid struct {
	key     *ecdsa.PrivateKey
	public  string // base64url uncompressed point, the "k" parameter
	subject string
}

// newVAPID checks the key pair and the subject. The public key is derived
// from the private one and must match the one given: the browser subscribed
// with that public key, and a mismatch would only show as 403s from every
// push service.
func newVAPID(private []byte, public, subject string) (*vapid, error) {
	key, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), private)
	if err != nil {
		return nil, fmt.Errorf("push: VAPID private key: %w", err)
	}
	derived, err := key.PublicKey.Bytes()
	if err != nil {
		return nil, fmt.Errorf("push: VAPID public key: %w", err)
	}
	given, err := decodeB64(public)
	if err != nil || !bytes.Equal(given, derived) {
		return nil, errors.New("push: VAPID public key does not match the private key")
	}
	// RFC 8292 2.1 allows mailto: too; Saldo uses its public https URL so no
	// mailbox is handed to Google, Apple, Mozilla and Microsoft.
	u, err := url.Parse(subject)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return nil, errors.New("push: VAPID subject must be an https URL")
	}
	return &vapid{key: key, public: b64.EncodeToString(derived), subject: subject}, nil
}

// authorization returns the Authorization header value for a push resource
// on the given origin (RFC 8292 section 3): "vapid t=<JWT>, k=<public key>".
func (v *vapid) authorization(origin string, now time.Time) (string, error) {
	token, err := v.token(origin, now)
	if err != nil {
		return "", err
	}
	return "vapid t=" + token + ", k=" + v.public, nil
}

// token is a JWS compact ES256 token with the claims of RFC 8292 section 2.
func (v *vapid) token(aud string, now time.Time) (string, error) {
	header, err := json.Marshal(map[string]string{"typ": "JWT", "alg": "ES256"})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(struct {
		Aud string `json:"aud"`
		Exp int64  `json:"exp"`
		Sub string `json:"sub"`
	}{aud, now.Add(vapidLifetime).Unix(), v.subject})
	if err != nil {
		return "", err
	}
	input := b64.EncodeToString(header) + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, v.key, digest[:])
	if err != nil {
		return "", err
	}
	// JWS ES256 (RFC 7518 3.4) is R and S as two 32-octet big-endian
	// integers, not the ASN.1 DER that ecdsa.SignASN1 produces; push
	// services reject the DER form.
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return input + "." + b64.EncodeToString(sig), nil
}
