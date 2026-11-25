package push

import (
	"crypto/ecdh"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestValidateEndpoint(t *testing.T) {
	ok := []string{
		"https://fcm.googleapis.com/fcm/send/abc:def",
		"https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
		"https://web.push.apple.com/QH2k",
		"https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
		"https://FCM.googleapis.com:443/fcm/send/abc",
	}
	for _, e := range ok {
		if err := ValidateEndpoint(e); err != nil {
			t.Errorf("%s: %v", e, err)
		}
	}
	bad := map[string]string{
		"http":              "http://fcm.googleapis.com/fcm/send/abc",
		"other scheme":      "ftp://fcm.googleapis.com/x",
		"port":              "https://fcm.googleapis.com:8443/fcm/send/abc",
		"host not on list":  "https://push.example.net/abc",
		"not a whole label": "https://evilpush.apple.com/abc",
		"bare apple domain": "https://push.apple.com/abc",
		"suffix trick":      "https://web.push.apple.com.evil.example/abc",
		"trailing dot":      "https://fcm.googleapis.com./fcm/send/abc",
		"IP literal":        "https://127.0.0.1/abc",
		"IPv6 literal":      "https://[::1]/abc",
		"userinfo":          "https://user:pw@fcm.googleapis.com/fcm/send/abc",
		"fragment":          "https://fcm.googleapis.com/fcm/send/abc#x",
		"empty fragment":    "https://fcm.googleapis.com/fcm/send/abc#",
		"too long":          "https://fcm.googleapis.com/" + strings.Repeat("a", maxEndpointLen),
		"no host":           "https:///abc",
		"opaque":            "https:fcm.googleapis.com",
		"empty":             "",
	}
	for name, e := range bad {
		if err := ValidateEndpoint(e); !errors.Is(err, ErrEndpoint) {
			t.Errorf("%s (%q): %v", name, e, err)
		}
	}
}

func TestValidateKeys(t *testing.T) {
	key, _ := ecdh.P256().GenerateKey(nil)
	point := key.PublicKey().Bytes()
	p256dh := b64.EncodeToString(point)
	auth := b64.EncodeToString(make([]byte, 16))
	if err := ValidateKeys(p256dh, auth); err != nil {
		t.Fatal(err)
	}
	// Padded base64url, as some browsers send it.
	if err := ValidateKeys(p256dh+"=", auth+"=="); err != nil {
		t.Fatalf("padded: %v", err)
	}

	offCurve := append([]byte(nil), point...)
	offCurve[64] ^= 1 // the same x with a different y is not on the curve
	compressed := append([]byte{0x02 | point[64]&1}, point[1:33]...)
	bad := map[string][2]string{
		"short point":       {b64.EncodeToString(point[:64]), auth},
		"compressed point":  {b64.EncodeToString(compressed), auth},
		"wrong prefix":      {b64.EncodeToString(append([]byte{0x05}, point[1:]...)), auth},
		"point not on P256": {b64.EncodeToString(offCurve), auth},
		"not base64url":     {"!!" + p256dh[2:], auth},
		"short auth":        {p256dh, b64.EncodeToString(make([]byte, 15))},
		"long auth":         {p256dh, b64.EncodeToString(make([]byte, 17))},
		"empty auth":        {p256dh, ""},
	}
	for name, c := range bad {
		if err := ValidateKeys(c[0], c[1]); !errors.Is(err, ErrKeys) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestDialControl(t *testing.T) {
	refused := []string{
		"127.0.0.1:443", "127.8.9.10:443", "[::1]:443",
		"10.0.0.1:443", "172.16.0.1:443", "192.168.1.1:443", "[fc00::1]:443", "[fd12::1]:443",
		"169.254.169.254:443", "[fe80::1]:443",
		"0.0.0.0:443", "0.1.2.3:443", "[::]:443",
		"224.0.0.1:443", "255.255.255.255:443", "[ff02::1]:443",
		"100.64.0.1:443", "100.127.255.254:443",
		"[::ffff:127.0.0.1]:443", "[::ffff:10.0.0.1]:443",
		"[64:ff9b::7f00:1]:443",
		"8.8.8.8:80", "8.8.8.8:8443", // public, but not the https port
		"not-an-address",
	}
	for _, a := range refused {
		if err := dialControl("tcp", a, nil); !errors.Is(err, errAddress) {
			t.Errorf("%s: %v", a, err)
		}
	}
	for _, a := range []string{"8.8.8.8:443", "142.250.74.10:443", "[2001:4860:4860::8888]:443"} {
		if err := dialControl("tcp", a, nil); err != nil {
			t.Errorf("%s refused: %v", a, err)
		}
	}
}

// A host name that resolves to 127.0.0.1 (here "localhost", resolved by the
// operating system) is refused by the production client after resolution,
// before any connection is made. This is what stops DNS rebinding.
func TestProductionDialerRefusesLoopbackName(t *testing.T) {
	_, err := newClient().Get("https://localhost/")
	if !errors.Is(err, errAddress) {
		t.Fatalf("got %v, want the dialer's refusal", err)
	}
}

func TestProductionClientDefaults(t *testing.T) {
	c := newClient()
	if c.Timeout != sendTimeout || sendTimeout.Seconds() != 15 {
		t.Errorf("timeout %v", c.Timeout)
	}
	tr := c.Transport.(*http.Transport)
	if tr.Proxy != nil {
		t.Error("the client must not use a proxy: the dialer would only check the proxy's address")
	}
	if c.CheckRedirect == nil || c.CheckRedirect(nil, nil) != http.ErrUseLastResponse {
		t.Error("redirects must not be followed")
	}
}
