// Package push sends Web Push messages to the installed Saldo app (phase
// 0.9-2): RFC 8030 delivery, RFC 8291 "aes128gcm" content encryption and
// RFC 8292 VAPID, all on the standard library. Web is the real sender; Fake
// records what it was asked to send and is used by every test and by demo
// mode, so CI and the demo never call a real push service.
//
// The endpoint of a subscription is a URL the browser supplies, so the
// package also carries the SSRF guard: ValidateEndpoint and ValidateKeys run
// when a subscription is stored and again before every send, and the HTTP
// client of Web refuses private addresses after DNS resolution.
package push

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Subscription is what the browser's PushManager returns: the push resource
// URL and the two keys of RFC 8291, both base64url.
type Subscription struct {
	Endpoint string
	P256dh   string // the user agent's ECDH public key, 65-byte uncompressed P-256 point
	Auth     string // the 16-byte authentication secret
}

// Payload is the JSON the service worker (web/sw/sw.js) reads and shows. It
// is encrypted end to end, but it does show on the lock screen, so the
// caller decides how much detail it may carry (README decision 3).
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`  // a same-origin path the click opens
	Tone  string `json:"tone"` // info, warn or error: picks the icon
	Tag   string `json:"tag"`  // a notification with the same tag replaces the old one on the phone
}

// Message is one push: the payload plus the RFC 8030 delivery headers.
type Message struct {
	Payload

	// TTL is how long the push service keeps the message for an offline
	// device. Zero means DefaultTTL: a caller that forgets it should not
	// silently get "drop unless the phone is online right now".
	TTL time.Duration
	// Urgency is very-low, low, normal or high (RFC 8030 5.3); empty sends
	// none, which the push service treats as normal.
	Urgency string
	// Topic lets a newer message replace an undelivered older one at the
	// push service (RFC 8030 5.4): at most 32 base64url characters.
	Topic string
}

// DefaultTTL is used when Message.TTL is zero.
const DefaultTTL = 24 * time.Hour

// Sender delivers one message to one subscription.
type Sender interface {
	Send(ctx context.Context, sub Subscription, m Message) error
}

// ErrGone means the push service answered 404 or 410: the subscription no
// longer exists (the user unsubscribed or the OS revoked it). The caller
// deletes it; any other error is retried on the next run.
var ErrGone = errors.New("push: subscription gone")

// Sent is one message the Fake was asked to deliver.
type Sent struct {
	Subscription Subscription
	Message      Message
}

// Fake is a Sender that delivers nothing. It records every message and
// returns the error given to SetErr, so tests can check what would have gone out
// and exercise the failure paths (SetErr(ErrGone) for a revoked phone).
type Fake struct {
	mu   sync.Mutex
	sent []Sent
	err  error
}

// Send records the message, or returns the SetErr error without recording it.
func (f *Fake) Send(_ context.Context, sub Subscription, m Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.sent = append(f.sent, Sent{Subscription: sub, Message: m})
	return nil
}

// SetErr makes every later Send fail with err (nil to succeed again).
func (f *Fake) SetErr(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

// Sent returns a copy of what was delivered so far, oldest first.
func (f *Fake) Sent() []Sent {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Sent(nil), f.sent...)
}
