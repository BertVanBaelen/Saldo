package server

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/ratelimit"
	"github.com/BertVanBaelen/Saldo/server/internal/users"
)

const deviceCookie = "saldo_device"

const (
	msgLinkNotFound = "Deze link werkt niet meer. Vraag een nieuwe aan."
	msgNoMail       = "Saldo kan nog geen e-mail versturen. Vul de SMTP-instellingen in bij de add-on."
	msgMailFailed   = "De e-mail kon niet verstuurd worden. Probeer het later opnieuw."
)

// limits are the in-memory limits per IP and per account (analysis 7); the
// codes per user are limited in package auth.
type limits struct {
	loginIP, loginEmail, verifyIP, tokenIP, password, bankLink *ratelimit.Limiter
}

func newLimits(now func() time.Time) limits {
	const window = 10 * time.Minute
	return limits{
		loginIP:    ratelimit.NewLimiter(20, window, now),
		loginEmail: ratelimit.NewLimiter(5, window, now),
		verifyIP:   ratelimit.NewLimiter(20, window, now),
		tokenIP:    ratelimit.NewLimiter(20, window, now),
		password:   ratelimit.NewLimiter(5, window, now), // wrong current passwords
		bankLink:   ratelimit.NewLimiter(10, time.Hour, now),
	}
}

// clientIP is the remote address, or CF-Connecting-IP when the connection
// comes from a private or loopback address (the Cloudflared add-on).
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		addr = addr.Unmap()
		if addr.IsPrivate() || addr.IsLoopback() {
			if cf, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))); err == nil {
				return cf.Unmap().String()
			}
		}
		return addr.String()
	}
	return host
}

// limited counts an attempt for key and answers 429 when its window is used
// up; the first refusal of a window is audited.
func (s *Server) limited(w http.ResponseWriter, r *http.Request, l *ratelimit.Limiter, key, name string, user int64) bool {
	wait, first := l.Allow(key)
	if wait <= 0 {
		return false
	}
	if first {
		s.audit(r, auth.EventRateLimited, user, name)
	}
	rateLimited(w, wait, "Te veel pogingen. Probeer het over %d %s opnieuw.")
	return true
}

// rateLimited answers 429 with Retry-After; message has %d and %s for the
// minutes left.
func rateLimited(w http.ResponseWriter, wait time.Duration, message string) {
	minutes := int(math.Ceil(wait.Minutes()))
	unit := "minuten"
	if minutes == 1 {
		unit = "minuut"
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
	writeError(w, http.StatusTooManyRequests, "rate_limited", fmt.Sprintf(message, minutes, unit))
}

// audit writes an audit line; a failure is logged, never shown.
func (s *Server) audit(r *http.Request, event string, user int64, detail string) {
	if err := s.auth.Audit(r.Context(), event, user, deviceOf(r), clientIP(r), detail); err != nil {
		s.log.ErrorContext(r.Context(), "audit log", "event", event, "error", err)
	}
}

func (s *Server) setDeviceCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{Name: deviceCookie, Value: token, Path: "/", MaxAge: int(auth.DeviceIdle.Seconds()),
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteStrictMode})
}

func (s *Server) clearDeviceCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: deviceCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteStrictMode})
}

// sendLater sends a mail in the background. The login code goes this way so
// a right password does not answer slower than a wrong one.
func (s *Server) sendLater(m mail.Message) {
	s.mails.Add(1)
	go func() {
		defer s.mails.Done()
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := s.opts.Mailer.Send(ctx, m); err != nil {
			s.log.Error("mail not sent", "error", err)
		}
	}()
}

func (s *Server) postLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	email, err := auth.CleanEmail(body.Email)
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	if body.Password == "" {
		writeError(w, http.StatusBadRequest, "invalid", "Vul je wachtwoord in.")
		return
	}
	if s.opts.Mailer == nil {
		writeError(w, http.StatusServiceUnavailable, "unavailable", msgNoMail)
		return
	}
	ip := clientIP(r)
	if s.limited(w, r, s.limits.loginIP, ip, "login_ip", 0) ||
		s.limited(w, r, s.limits.loginEmail, strings.ToLower(email), "login_email", 0) {
		return
	}
	device := auth.DeviceName(r.UserAgent())
	login, err := s.auth.StartLogin(r.Context(), email, body.Password, device, ip)
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	if login.Code != "" {
		m, err := mail.LoginCode(login.Email, login.Code, login.SentAt, auth.CodeTTL, device)
		if err != nil {
			s.fail(w, r, err, msgNotFound)
			return
		}
		s.sendLater(m)
	}
	writeJSON(w, http.StatusOK, map[string]string{"challenge": login.Challenge, "email": auth.MaskEmail(email)})
}

func (s *Server) postVerify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Challenge string `json:"challenge"`
		Code      string `json:"code"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	ip := clientIP(r)
	if s.limited(w, r, s.limits.verifyIP, ip, "verify_ip", 0) {
		return
	}
	device := auth.DeviceName(r.UserAgent())
	sess, err := s.auth.VerifyCode(r.Context(), body.Challenge, body.Code, device, ip)
	if errors.Is(err, auth.ErrInvalidCode) {
		writeError(w, http.StatusUnauthorized, "invalid_code", "Deze code klopt niet of is verlopen. Vraag een nieuwe code aan.")
		return
	}
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	u, _, err := users.Get(r.Context(), s.db, sess.UserID)
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	s.setDeviceCookie(w, sess.Token)
	if s.opts.Mailer != nil {
		devicesURL := ""
		if s.opts.PublicURL != "" {
			devicesURL = s.opts.PublicURL + "/instellingen/toestellen"
		}
		if m, err := mail.NewDevice(u.Email, device, s.opts.Now(), devicesURL); err != nil {
			s.log.ErrorContext(r.Context(), "new device mail", "error", err)
		} else {
			s.sendLater(m)
		}
	}
	writeJSON(w, http.StatusOK, map[string]users.User{"user": u})
}

func (s *Server) postLogout(w http.ResponseWriter, r *http.Request) {
	if dev := deviceOf(r); dev != 0 {
		if err := s.auth.SignOut(r.Context(), viewerOf(r), dev, clientIP(r)); err != nil && !errors.Is(err, apperr.ErrNotFound) {
			s.fail(w, r, err, msgNotFound)
			return
		}
	}
	s.clearDeviceCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getToken(w http.ResponseWriter, r *http.Request) {
	if s.limited(w, r, s.limits.tokenIP, clientIP(r), "token_ip", 0) {
		return
	}
	info, err := s.auth.Lookup(r.Context(), r.PathValue("token"))
	if err != nil {
		s.fail(w, r, err, msgLinkNotFound)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) postRedeem(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
		Name     string `json:"name"`
		Email    string `json:"email"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgLinkNotFound)
		return
	}
	ip := clientIP(r)
	if s.limited(w, r, s.limits.tokenIP, ip, "token_ip", 0) {
		return
	}
	if err := s.auth.Redeem(r.Context(), body.Token, body.Name, body.Email, body.Password, ip); err != nil {
		s.fail(w, r, err, msgLinkNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
