// Package server is Saldo's HTTP layer: the JSON API under /api (the
// contract is docs/api.md), the health endpoints and the built web app.
package server

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/ratelimit"
)

// DemoViewer is the user demo mode acts as (Bert).
const DemoViewer int64 = 1

// SyncCooldown is the minimum time between two "Sync now" calls of a user.
const SyncCooldown = 15 * time.Minute

// Syncer runs "Sync now" for the viewer's connections.
type Syncer interface {
	Sync(ctx context.Context, viewer int64, now time.Time) error
}

// Options configure the HTTP handler.
type Options struct {
	DB      *sql.DB
	Version string
	Demo    bool
	Clock   clock.Clock
	WebDir  string // built web app; empty or missing shows a short notice
	Logger  *slog.Logger
	// Viewer resolves the signed-in user of a request. When nil, demo mode
	// acts as DemoViewer and outside demo mode nobody is signed in (sign-in
	// arrives in phase 0.2-4).
	Viewer func(*http.Request) (int64, bool)
	Syncer Syncer
	// Now is the clock of the sync rate limit; time.Now when nil.
	Now func() time.Time
}

// Server holds the handler's dependencies.
type Server struct {
	opts     Options
	db       *sql.DB
	store    *ledger.Store
	log      *slog.Logger
	cooldown *ratelimit.Cooldown
	mux      *http.ServeMux
}

// New returns the complete HTTP handler with its middleware.
func New(o Options) http.Handler {
	if o.Logger == nil {
		o.Logger = slog.New(slog.DiscardHandler)
	}
	if o.Viewer == nil {
		demo := o.Demo
		o.Viewer = func(*http.Request) (int64, bool) { return DemoViewer, demo }
	}
	s := &Server{
		opts:     o,
		db:       o.DB,
		store:    ledger.New(o.DB),
		log:      o.Logger,
		cooldown: ratelimit.NewCooldown(SyncCooldown, o.Now),
		mux:      http.NewServeMux(),
	}
	s.routes()
	return s.logRequests(s.recoverPanics(securityHeaders(s.requireViewer(s.mux))))
}

func (s *Server) routes() {
	m := s.mux
	m.HandleFunc("GET /api/health", s.health)
	m.HandleFunc("GET /healthz", s.health)
	m.HandleFunc("GET /api/me", s.getMe)
	m.HandleFunc("PUT /api/me/preferences", s.putPreferences)
	m.HandleFunc("GET /api/accounts", s.listAccounts)
	m.HandleFunc("PATCH /api/accounts/{id}", s.patchAccount)
	m.HandleFunc("GET /api/transactions", s.listTransactions)
	m.HandleFunc("GET /api/alerts", s.listAlerts)
	m.HandleFunc("GET /api/connections", s.listConnections)
	m.HandleFunc("POST /api/sync", s.postSync)
	m.HandleFunc("/api/", s.apiFallback)
	m.HandleFunc("/api", s.apiFallback)
	m.HandleFunc("/", s.serveWeb)
}

// now is the server's current time (Brussels, with the demo date override).
func (s *Server) now() time.Time { return s.opts.Clock.Now() }
