package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/push"
)

// Web Push (0.9-2, docs/api.md "Push"). A subscription belongs to the
// session's device: it is stored, removed and tested for that device only,
// and it goes when the device is signed out (package auth).

const (
	msgPushDevice  = "Dit toestel kan geen pushmeldingen krijgen."
	msgPushTooMany = "Je hebt al 10 toestellen met pushmeldingen."
	msgPushOff     = "Pushmeldingen staan uit op dit toestel."
	msgPushNone    = "Pushmeldingen zijn niet beschikbaar: Saldo heeft een https-adres nodig."
)

// testMessage is the generic test push: nothing personal, so it may show on
// a locked screen. A short TTL: a test that arrives an hour later only confuses.
var testMessage = push.Message{
	Payload: push.Payload{Title: "Testmelding", Body: "Pushmeldingen werken op dit toestel.", URL: "/meldingen", Tone: "info", Tag: "test"},
	TTL:     15 * time.Minute,
	Urgency: "normal",
	Topic:   "test",
}

// pushEnabled reports whether a browser can subscribe: a sender and a key,
// and an https origin (a phone subscribes only on https). Demo mode uses the
// fake sender, so it is enabled there whatever the address.
func (s *Server) pushEnabled() bool {
	return s.opts.Push != nil && s.opts.PushKey != "" &&
		(s.opts.Demo || strings.HasPrefix(s.opts.PublicURL, "https://"))
}

// errNoPushDevice means the session has no device to bind a subscription to.
var errNoPushDevice = errors.New("push: session without a device")

// pushDevice is the session's device. Demo mode has no device cookie, so
// each demo user gets one stand-in device ("Demo-toestel") the first time it
// subscribes; its token hash is not a hash of any token, so it never signs in.
func (s *Server) pushDevice(r *http.Request) (int64, error) {
	if d := deviceOf(r); d != 0 {
		return d, nil
	}
	if !s.opts.Demo {
		return 0, errNoPushDevice
	}
	user := viewerOf(r)
	at := s.opts.Now().UTC().Format("2006-01-02T15:04:05Z")
	var id int64
	err := s.db.QueryRowContext(r.Context(), `INSERT INTO devices (user_id, name, token_hash, created_at, last_used_at)
		VALUES (?, 'Demo-toestel', ?, ?, ?)
		ON CONFLICT (token_hash) DO UPDATE SET last_used_at = excluded.last_used_at RETURNING id`,
		user, "demo-push-"+strconv.FormatInt(user, 10), at, at).Scan(&id)
	return id, err
}

// GET /api/push/key
func (s *Server) getPushKey(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"key": s.opts.PushKey, "enabled": s.pushEnabled()})
}

// PUT /api/push/subscription: the body is PushSubscription.toJSON().
func (s *Server) putPushSubscription(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Endpoint       string          `json:"endpoint"`
		ExpirationTime json.RawMessage `json:"expirationTime"` // sent by toJSON (null), not used
		Keys           struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	if !s.pushEnabled() {
		writeError(w, http.StatusServiceUnavailable, "unavailable", msgPushNone)
		return
	}
	device, err := s.pushDevice(r)
	if errors.Is(err, errNoPushDevice) {
		writeError(w, http.StatusBadRequest, "invalid", msgPushDevice)
		return
	}
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	sub := push.Subscription{Endpoint: body.Endpoint, P256dh: body.Keys.P256dh, Auth: body.Keys.Auth}
	err = s.pushes.Upsert(r.Context(), viewerOf(r), device, sub, push.Platform(r.UserAgent()), s.opts.Now())
	switch {
	case errors.Is(err, push.ErrEndpoint), errors.Is(err, push.ErrKeys), errors.Is(err, push.ErrNoDevice):
		writeError(w, http.StatusBadRequest, "invalid", msgPushDevice)
	case errors.Is(err, push.ErrTooMany):
		writeError(w, http.StatusBadRequest, "invalid", msgPushTooMany)
	case err != nil:
		s.fail(w, r, err, msgNotFound)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// DELETE /api/push/subscription: this device's subscription, if any.
func (s *Server) deletePushSubscription(w http.ResponseWriter, r *http.Request) {
	device, err := s.pushDevice(r)
	if errors.Is(err, errNoPushDevice) {
		w.WriteHeader(http.StatusNoContent) // nothing can be bound to it, so nothing to remove
		return
	}
	if err == nil {
		_, err = s.pushes.DeleteDevice(r.Context(), viewerOf(r), device)
	}
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/notifications/test: the generic test push to this device only.
func (s *Server) postNotificationTest(w http.ResponseWriter, r *http.Request) {
	if !s.pushEnabled() {
		writeError(w, http.StatusServiceUnavailable, "unavailable", msgPushNone)
		return
	}
	viewer := viewerOf(r)
	var subs []push.Stored
	device, err := s.pushDevice(r)
	if err == nil {
		subs, err = s.pushes.ForDevice(r.Context(), viewer, device)
	}
	if err != nil && !errors.Is(err, errNoPushDevice) {
		s.fail(w, r, err, msgNotFound)
		return
	}
	if len(subs) == 0 {
		writeError(w, http.StatusConflict, "conflict", msgPushOff)
		return
	}
	if s.limited(w, r, s.limits.pushTest, strconv.FormatInt(viewer, 10), "push_test", viewer) {
		return
	}
	sent := false
	for _, sub := range subs {
		err := s.opts.Push.Send(r.Context(), sub.Subscription, testMessage)
		switch {
		case errors.Is(err, push.ErrGone), errors.Is(err, push.ErrEndpoint), errors.Is(err, push.ErrKeys):
			// The push service no longer knows it, or the guard refuses the
			// stored row: it is of no use, so it goes.
			if err := s.pushes.DeleteEndpoint(r.Context(), sub.Endpoint); err != nil {
				s.fail(w, r, err, msgNotFound)
				return
			}
		case err != nil:
			s.fail(w, r, err, msgNotFound) // logged; push errors never carry the endpoint
			return
		default:
			sent = true
		}
	}
	if !sent {
		writeError(w, http.StatusConflict, "conflict", msgPushOff)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"sent": true})
}
