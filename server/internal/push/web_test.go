package push

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testSubject = "https://saldo.example.org"

// device is the browser side of a subscription: the private key the
// receiving test server decrypts with.
type device struct {
	priv *ecdh.PrivateKey
	auth []byte
}

func newDevice(t *testing.T) device {
	t.Helper()
	priv, err := ecdh.P256().GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	rand.Read(auth)
	return device{priv, auth}
}

func (d device) subscription(endpoint string) Subscription {
	return Subscription{
		Endpoint: endpoint,
		P256dh:   b64.EncodeToString(d.priv.PublicKey().Bytes()),
		Auth:     b64.EncodeToString(d.auth),
	}
}

// newProductionWeb is a Web exactly as NewWeb makes it.
func newProductionWeb(t *testing.T) *Web {
	t.Helper()
	priv, pub, err := GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	w, err := NewWeb(priv, pub, testSubject)
	if err != nil {
		t.Fatal(err)
	}
	return w
}

// newTestWeb points a production Web at a local httptest TLS server. Only
// the two unexported seams change: the client trusts the test certificate
// (keeping the production redirect policy, timeout and response cap), and
// the endpoint check accepts this server's address instead of the
// allowlist. Everything else, including every check that does not depend on
// host and port, runs as in production.
func newTestWeb(t *testing.T, ts *httptest.Server) *Web {
	t.Helper()
	w := newProductionWeb(t)
	c := ts.Client()
	c.CheckRedirect = noRedirect
	c.Timeout = sendTimeout
	w.client = c
	host := strings.TrimPrefix(ts.URL, "https://")
	w.checkEndpoint = func(e string) error {
		u, err := parseEndpoint(e)
		if err != nil {
			return err
		}
		if u.Host != host {
			return fmt.Errorf("%w: test host", ErrEndpoint)
		}
		return nil
	}
	return w
}

// pushService is the receiving side: it checks the RFC 8030 headers and the
// VAPID token and decrypts the body with the device's private key.
func pushService(t *testing.T, d device, got chan<- Payload, vapidKey *string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fail := func(format string, a ...any) {
			t.Errorf(format, a...)
			http.Error(w, "bad", http.StatusBadRequest)
		}
		if r.Method != http.MethodPost || r.Header.Get("Content-Encoding") != "aes128gcm" ||
			r.Header.Get("Content-Type") != "application/octet-stream" {
			fail("method %s, headers %v", r.Method, r.Header)
			return
		}
		token, k, ok := parseVapidHeader(r.Header.Get("Authorization"))
		if !ok || k != *vapidKey {
			fail("authorization %q", r.Header.Get("Authorization"))
			return
		}
		claims, err := verifyES256(token, k)
		if err != nil {
			fail("vapid: %v", err)
			return
		}
		exp := int64(claims["exp"].(float64))
		now := time.Now().Unix()
		if claims["aud"] != "https://"+r.Host || claims["sub"] != testSubject || exp < now || exp > now+24*3600 {
			fail("claims %v (host %s)", claims, r.Host)
			return
		}
		body, _ := io.ReadAll(r.Body)
		plain, err := decryptRecord(body, d.priv, d.auth)
		if err != nil {
			fail("decrypt: %v", err)
			return
		}
		var p Payload
		if err := json.Unmarshal(plain, &p); err != nil {
			fail("payload %q: %v", plain, err)
			return
		}
		w.Header().Set("Location", "/msg/1")
		w.WriteHeader(http.StatusCreated)
		got <- p
	}
}

func TestWebSendRoundTrip(t *testing.T) {
	d := newDevice(t)
	got := make(chan Payload, 1)
	var key string
	var headers http.Header
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers = r.Header.Clone()
		pushService(t, d, got, &key)(w, r)
	}))
	defer ts.Close()
	w := newTestWeb(t, ts)
	key = w.vapid.public

	m := Message{
		Payload: Payload{Title: "Planning: actie nodig", Body: "Ontgrendel om de details te zien", URL: "/planning", Tone: "warn", Tag: "planning"},
		TTL:     time.Hour, Urgency: "high", Topic: "planning",
	}
	if err := w.Send(context.Background(), d.subscription(ts.URL+"/push/abc"), m); err != nil {
		t.Fatal(err)
	}
	select {
	case p := <-got:
		if p != m.Payload {
			t.Fatalf("payload %+v", p)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the push service got nothing")
	}
	if headers.Get("TTL") != "3600" || headers.Get("Urgency") != "high" || headers.Get("Topic") != "planning" {
		t.Fatalf("headers %v", headers)
	}

	// Zero TTL means DefaultTTL, and no Urgency or Topic header is sent.
	if err := w.Send(context.Background(), d.subscription(ts.URL+"/push/abc"), Message{Payload: m.Payload}); err != nil {
		t.Fatal(err)
	}
	<-got
	if headers.Get("TTL") != "86400" || headers.Get("Urgency") != "" || headers.Get("Topic") != "" {
		t.Fatalf("headers %v", headers)
	}
}

func TestWebSendStatus(t *testing.T) {
	d := newDevice(t)
	for status, gone := range map[int]bool{http.StatusNotFound: true, http.StatusGone: true, http.StatusInternalServerError: false, http.StatusTooManyRequests: false, http.StatusForbidden: false} {
		ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "nope", status)
		}))
		err := newTestWeb(t, ts).Send(context.Background(), d.subscription(ts.URL+"/push/abc"), Message{})
		ts.Close()
		if err == nil || errors.Is(err, ErrGone) != gone {
			t.Errorf("status %d: %v", status, err)
		}
	}
}

func TestWebDoesNotFollowRedirects(t *testing.T) {
	d := newDevice(t)
	var followed atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/push/abc", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/elsewhere", http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("/elsewhere", func(w http.ResponseWriter, r *http.Request) {
		followed.Add(1)
		w.WriteHeader(http.StatusCreated)
	})
	ts := httptest.NewTLSServer(mux)
	defer ts.Close()
	err := newTestWeb(t, ts).Send(context.Background(), d.subscription(ts.URL+"/push/abc"), Message{})
	if err == nil || !strings.Contains(err.Error(), "307") {
		t.Fatalf("a redirect must be an error, got %v", err)
	}
	if followed.Load() != 0 {
		t.Fatal("the redirect was followed")
	}
}

// A push service that answers with an endless body: Send reads 4 KB, gives
// up and returns, instead of waiting for the rest.
func TestWebResponseIsCapped(t *testing.T) {
	d := newDevice(t)
	release := make(chan struct{})
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write(bytes.Repeat([]byte("x"), maxResponse+1000))
		w.(http.Flusher).Flush()
		select { // never finish the body until the test is over
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer ts.Close()
	defer close(release)

	done := make(chan error, 1)
	go func() {
		done <- newTestWeb(t, ts).Send(context.Background(), d.subscription(ts.URL+"/push/abc"), Message{})
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "500") {
			t.Fatalf("got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Send kept reading the response body")
	}
}

type countingReader struct{ n int }

func (c *countingReader) Read(p []byte) (int, error) {
	c.n += len(p)
	return len(p), nil
}

func TestReadCapped(t *testing.T) {
	r := &countingReader{}
	b, err := readCapped(r)
	if err != nil || len(b) != maxResponse || maxResponse != 4096 {
		t.Fatalf("read %d, err %v", len(b), err)
	}
	if r.n > maxResponse+1 {
		t.Fatalf("consumed %d octets", r.n)
	}
}

// The production defaults refuse the very server the other tests talk to:
// the endpoint check refuses its address and port, and the production
// client's dialer refuses its loopback address.
func TestProductionRefusesTestServer(t *testing.T) {
	d := newDevice(t)
	var hits atomic.Int32
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer ts.Close()

	err := newProductionWeb(t).Send(context.Background(), d.subscription(ts.URL+"/push/abc"), Message{})
	if !errors.Is(err, ErrEndpoint) {
		t.Fatalf("endpoint check: %v", err)
	}
	// Past the endpoint check, the production client still cannot connect.
	w := newProductionWeb(t)
	w.checkEndpoint = func(string) error { return nil }
	err = w.Send(context.Background(), d.subscription(ts.URL+"/push/abc"), Message{})
	if !errors.Is(err, errAddress) {
		t.Fatalf("dialer: %v", err)
	}
	if hits.Load() != 0 {
		t.Fatal("the production sender reached the local server")
	}
}

func TestWebSendRefusesBadInput(t *testing.T) {
	d := newDevice(t)
	var hits atomic.Int32
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer ts.Close()
	w := newTestWeb(t, ts)
	good := d.subscription(ts.URL + "/push/abc")

	badKeys := good
	badKeys.Auth = b64.EncodeToString(make([]byte, 8))
	if err := w.Send(context.Background(), badKeys, Message{}); !errors.Is(err, ErrKeys) {
		t.Errorf("keys: %v", err)
	}
	http1 := good
	http1.Endpoint = "http" + strings.TrimPrefix(good.Endpoint, "https")
	if err := w.Send(context.Background(), http1, Message{}); !errors.Is(err, ErrEndpoint) {
		t.Errorf("scheme: %v", err)
	}
	for name, m := range map[string]Message{
		"urgency":      {Urgency: "urgent"},
		"long topic":   {Topic: strings.Repeat("a", 33)},
		"topic chars":  {Topic: "a b"},
		"negative TTL": {TTL: -time.Second},
		"too large":    {Payload: Payload{Body: strings.Repeat("x", maxPlaintext)}},
	} {
		if err := w.Send(context.Background(), good, m); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if hits.Load() != 0 {
		t.Fatal("a refused message reached the push service")
	}
}

// A failed request names the host, never the endpoint path: the path is
// the capability to push to that phone, and errors end up in logs.
func TestWebErrorDoesNotLeakEndpoint(t *testing.T) {
	d := newDevice(t)
	ts := httptest.NewTLSServer(http.NotFoundHandler())
	w := newTestWeb(t, ts)
	ts.Close() // nothing listens any more
	err := w.Send(context.Background(), d.subscription(ts.URL+"/push/secret-token"), Message{})
	if err == nil || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("got %v", err)
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		t.Fatal("the *url.Error with the full endpoint is still in the chain")
	}
}

func TestFake(t *testing.T) {
	var f Fake
	var _ Sender = &f
	sub := Subscription{Endpoint: "https://fcm.googleapis.com/fcm/send/x"}
	if err := f.Send(context.Background(), sub, Message{Payload: Payload{Title: "a"}}); err != nil {
		t.Fatal(err)
	}
	f.SetErr(ErrGone)
	if err := f.Send(context.Background(), sub, Message{Payload: Payload{Title: "b"}}); !errors.Is(err, ErrGone) {
		t.Fatalf("got %v", err)
	}
	sent := f.Sent()
	if len(sent) != 1 || sent[0].Message.Title != "a" || sent[0].Subscription != sub {
		t.Fatalf("sent %+v", sent)
	}
}

func TestPayloadJSON(t *testing.T) {
	b, _ := json.Marshal(Message{Payload: Payload{Title: "t", Body: "b", URL: "/u", Tone: "info", Tag: "g"}, TTL: time.Hour, Topic: "x"}.Payload)
	if string(b) != `{"title":"t","body":"b","url":"/u","tone":"info","tag":"g"}` {
		t.Fatalf("payload %s", b)
	}
}

func TestOrigin(t *testing.T) {
	for raw, want := range map[string]string{
		"https://fcm.googleapis.com/fcm/send/x":     "https://fcm.googleapis.com",
		"https://FCM.googleapis.com:443/fcm/send/x": "https://fcm.googleapis.com",
		"https://127.0.0.1:50123/push/abc":          "https://127.0.0.1:50123",
		"https://[::1]:50123/push/abc":              "https://[::1]:50123",
	} {
		u, _ := url.Parse(raw)
		if got := origin(u); got != want {
			t.Errorf("%s: got %s, want %s", raw, got, want)
		}
	}
}

func TestTTLRoundsUp(t *testing.T) {
	h, err := deliveryHeaders(Message{TTL: 300 * time.Millisecond})
	if err != nil || h["TTL"] != "1" {
		t.Fatalf("headers %v, err %v", h, err)
	}
}
