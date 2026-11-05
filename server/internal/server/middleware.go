package server

import (
	"context"
	"errors"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
)

// contentSecurityPolicy allows only Saldo's own origin.
const contentSecurityPolicy = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
	"font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

// securityHeaders sets the headers of every answer; hsts only when Saldo is
// opened over https (public_url), so a plain-http test setup is not locked out.
func securityHeaders(next http.Handler, hsts bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		if hsts {
			// No includeSubDomains: other services on the domain are not Saldo's to decide.
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		if isAPI(r.URL.Path) || r.URL.Path == "/healthz" {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func isAPI(path string) bool { return path == "/api" || strings.HasPrefix(path, "/api/") }

// tokenPaths end in a one-time token (setup, invitation, password reset).
var tokenPaths = []string{"/api/auth/token/", "/setup/", "/uitnodiging/", "/nieuw-wachtwoord/"}

// logPath is the path as it may be logged: a token in it is left out, since
// anyone who can read the add-on log could otherwise redeem the link.
func logPath(path string) string {
	for _, p := range tokenPaths {
		if strings.HasPrefix(path, p) && len(path) > len(p) {
			return p + "…"
		}
	}
	return path
}

// session is the signed-in viewer and their device (0 in demo mode and with
// Options.Viewer).
type session struct{ user, device int64 }

type sessionKey struct{}

// viewerOf returns the viewer that requireViewer put in the context.
func viewerOf(r *http.Request) int64 {
	s, _ := r.Context().Value(sessionKey{}).(session)
	return s.user
}

// deviceOf returns the viewer's current device, 0 when there is none.
func deviceOf(r *http.Request) int64 {
	s, _ := r.Context().Value(sessionKey{}).(session)
	return s.device
}

// isPublic lists the /api routes that need no viewer: health and the steps
// before a device is trusted.
func isPublic(path string) bool {
	switch path {
	case "/api/health", "/api/auth/login", "/api/auth/verify", "/api/auth/redeem":
		return true
	}
	token, ok := strings.CutPrefix(path, "/api/auth/token/")
	return ok && token != "" && !strings.ContainsAny(token, "/.")
}

// requireViewer resolves the viewer of every /api request except the public
// ones. Without one the request answers 401.
func (s *Server) requireViewer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || isPublic(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		sess, err := s.resolve(w, r)
		if errors.Is(err, apperr.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Log in om verder te gaan.")
			return
		}
		if err != nil {
			s.fail(w, r, err, msgNotFound)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, sess)))
	})
}

// resolve finds the viewer: Options.Viewer when set, Bert in demo mode,
// otherwise the trusted device of the cookie (renewing it while used).
func (s *Server) resolve(w http.ResponseWriter, r *http.Request) (session, error) {
	if s.opts.Viewer != nil {
		if id, ok := s.opts.Viewer(r); ok && id > 0 {
			return session{user: id}, nil
		}
		return session{}, apperr.ErrNotFound
	}
	if s.opts.Demo {
		return session{user: DemoViewer}, nil
	}
	c, err := r.Cookie(deviceCookie)
	if err != nil {
		return session{}, apperr.ErrNotFound
	}
	dev, renewed, err := s.auth.Resolve(r.Context(), c.Value)
	if errors.Is(err, apperr.ErrNotFound) {
		s.clearDeviceCookie(w, r)
	}
	if err != nil {
		return session{}, err
	}
	if renewed {
		s.setDeviceCookie(w, r, c.Value)
	}
	return session{user: dev.UserID, device: dev.DeviceID}, nil
}

// recoverPanics turns a panic into a logged 500.
func (s *Server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w}
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			if v == http.ErrAbortHandler {
				panic(v)
			}
			s.log.ErrorContext(r.Context(), "panic", "method", r.Method, "path", logPath(r.URL.Path), "panic", v, "stack", string(debug.Stack()))
			if !rec.wrote {
				writeError(rec, http.StatusInternalServerError, "internal", "Er ging iets mis. Probeer het later opnieuw.")
			}
		}()
		next.ServeHTTP(rec, r)
	})
}

// logRequests writes one structured line per request. It logs the path but
// never the query string, which can hold search terms.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		status := rec.status
		if status == 0 {
			status = http.StatusOK
		}
		level := s.log.Info
		if r.URL.Path == "/healthz" || r.URL.Path == "/api/health" {
			level = s.log.Debug
		}
		level("request", "method", r.Method, "path", logPath(r.URL.Path), "status", status,
			"bytes", rec.bytes, "duration_ms", time.Since(start).Milliseconds())
	})
}

// statusRecorder remembers the status code and size of a response.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
	wrote  bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.wrote {
		r.status, r.wrote = code, true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if !r.wrote {
		r.status, r.wrote = http.StatusOK, true
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }
