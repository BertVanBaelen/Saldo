package push

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Limits of the outbound client (docs/security-baseline.md, SSRF and
// timeouts rows).
const (
	sendTimeout = 15 * time.Second
	maxResponse = 4 << 10 // a push service answers with an empty body or a short error
)

// Web sends real pushes. Its HTTP client is its own: it never uses a proxy
// from the environment (the dialer would then only check the proxy's
// address), checks every address after DNS resolution, follows no
// redirects and gives up after 15 seconds.
type Web struct {
	vapid *vapid

	// Unexported so that only this package's tests can point a Web at a
	// local httptest server; NewWeb always sets the production values.
	client        *http.Client
	checkEndpoint func(string) error
	now           func() time.Time
}

// NewWeb returns a sender for the VAPID key pair (private: the raw 32-octet
// scalar; public: base64url uncompressed point, as GenerateVAPIDKeys
// returns them). subject is Saldo's public https URL, the RFC 8292 "sub"
// claim a push service uses to contact the operator.
func NewWeb(private []byte, public, subject string) (*Web, error) {
	v, err := newVAPID(private, public, subject)
	if err != nil {
		return nil, err
	}
	return &Web{vapid: v, client: newClient(), checkEndpoint: ValidateEndpoint, now: time.Now}, nil
}

// newClient is the production HTTP client of the SSRF guard.
func newClient() *http.Client {
	dialer := &net.Dialer{Timeout: sendTimeout, Control: dialControl}
	return &http.Client{
		Timeout: sendTimeout,
		Transport: &http.Transport{
			Proxy:               nil,
			DialContext:         dialer.DialContext,
			TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
			TLSHandshakeTimeout: sendTimeout,
			ForceAttemptHTTP2:   true, // a custom DialContext switches HTTP/2 off otherwise
			MaxIdleConns:        10,
			IdleConnTimeout:     90 * time.Second,
		},
		CheckRedirect: noRedirect,
	}
}

// noRedirect hands a 3xx back to Send as the answer: a redirect could point
// anywhere, and a push service has no reason to send one.
func noRedirect(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

// Send encrypts m for sub and posts it to the push service (RFC 8030 5).
// It returns ErrGone on 404 and 410; every other failure is an ordinary
// error that the caller retries on its next run.
func (w *Web) Send(ctx context.Context, sub Subscription, m Message) error {
	if err := w.checkEndpoint(sub.Endpoint); err != nil {
		return err
	}
	ua, secret, err := decodeKeys(sub.P256dh, sub.Auth)
	if err != nil {
		return err
	}
	headers, err := deliveryHeaders(m)
	if err != nil {
		return err
	}
	plaintext, err := json.Marshal(m.Payload)
	if err != nil {
		return err
	}
	if len(plaintext) > maxPlaintext {
		return ErrTooLarge
	}
	body, err := encryptMessage(plaintext, ua, secret)
	if err != nil {
		return err
	}

	u, err := url.Parse(sub.Endpoint)
	if err != nil {
		return ErrEndpoint
	}
	auth, err := w.vapid.authorization(origin(u), w.now())
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		return ErrEndpoint
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Authorization", auth)

	resp, err := w.client.Do(req)
	if err != nil {
		// The *url.Error names the full endpoint, which is a capability: anyone
		// holding it can push to that phone. Keep only the host in the error.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return fmt.Errorf("push: post to %s: %w", u.Hostname(), err)
	}
	defer resp.Body.Close()
	answer, _ := readCapped(resp.Body)

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return ErrGone
	default:
		if len(answer) > 200 {
			answer = answer[:200]
		}
		return fmt.Errorf("push: %s answered %d: %q", u.Hostname(), resp.StatusCode, answer)
	}
}

// origin is the RFC 6454 serialization of the endpoint's origin, the VAPID
// "aud" claim (RFC 8292 2): lowercase host, default port left out. The
// guard accepts "https://FCM.googleapis.com:443/...", and a push service
// would refuse a token whose aud kept that spelling.
func origin(u *url.URL) string {
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port := u.Port(); port != "" && port != "443" {
		host += ":" + port
	}
	return "https://" + host
}

// readCapped reads at most maxResponse octets: a hostile or broken endpoint
// cannot make Saldo buffer more than that.
func readCapped(r io.Reader) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r, maxResponse))
}

// deliveryHeaders turns the RFC 8030 options of m into headers, refusing
// values the push service would reject with a 400.
func deliveryHeaders(m Message) (map[string]string, error) {
	ttl := m.TTL
	if ttl == 0 {
		ttl = DefaultTTL
	}
	if ttl < 0 {
		return nil, errors.New("push: negative TTL")
	}
	// Round up: a TTL under a second must not become "TTL: 0", which tells
	// the push service to drop the message unless the phone is online.
	h := map[string]string{"TTL": strconv.FormatInt(int64((ttl+time.Second-1)/time.Second), 10)}
	switch m.Urgency {
	case "":
	case "very-low", "low", "normal", "high":
		h["Urgency"] = m.Urgency
	default:
		return nil, fmt.Errorf("push: urgency %q", m.Urgency)
	}
	if m.Topic != "" {
		if !validTopic(m.Topic) {
			return nil, fmt.Errorf("push: topic %q must be at most 32 base64url characters", m.Topic)
		}
		h["Topic"] = m.Topic
	}
	return h, nil
}

func validTopic(t string) bool {
	if len(t) > 32 {
		return false
	}
	for _, c := range t {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
