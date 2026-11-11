// Package server is Saldo's HTTP layer: the JSON API under /api (the
// contract is docs/api.md), the health endpoints and the built web app.
package server

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/banklink"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/ratelimit"
)

// DemoViewer is the user demo mode acts as (Bert).
const DemoViewer int64 = 1

// SyncCooldown is the minimum time between two "Sync now" calls of a user.
const SyncCooldown = 15 * time.Minute

// Syncer runs "Sync now" for the viewer's connections. The server calls it
// in the background and answers the request at once.
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
	// Viewer, when set, resolves the signed-in user instead of the device
	// cookie (for tests). Demo mode acts as DemoViewer without a cookie.
	Viewer func(*http.Request) (int64, bool)
	Syncer Syncer
	// Bank links bank accounts (docs/api.md, "Bank link"); nil answers 503
	// on those routes.
	Bank *banklink.Service
	// Mailer sends the sign-in mails; nil means mail is not configured and
	// the endpoints that need it answer 503.
	Mailer mail.Sender
	// PublicURL is the address Saldo is opened on (no trailing slash): the
	// trusted origin, the cookie's Secure flag and the links in mails.
	PublicURL string
	// Now is the clock of rate limits, sign-in codes, links and devices;
	// time.Now when nil.
	Now func() time.Time
}

// Server holds the handler's dependencies.
type Server struct {
	opts     Options
	db       *sql.DB
	store    *ledger.Store
	auth     *auth.Store
	log      *slog.Logger
	cooldown *ratelimit.Cooldown
	limits   limits
	imports  importLimits
	secure   bool // device cookie only over https
	mails    sync.WaitGroup
	syncs    sync.WaitGroup // background syncs, for tests
	runsMu   sync.Mutex
	runs     map[int64]syncRun
	mux      *http.ServeMux
}

// New returns the complete HTTP handler with its middleware.
func New(o Options) http.Handler {
	_, h := newServer(o)
	return h
}

func newServer(o Options) (*Server, http.Handler) {
	if o.Logger == nil {
		o.Logger = slog.New(slog.DiscardHandler)
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	s := &Server{
		opts:     o,
		db:       o.DB,
		store:    ledger.New(o.DB),
		auth:     auth.New(o.DB, o.Now),
		log:      o.Logger,
		cooldown: ratelimit.NewCooldown(SyncCooldown, o.Now),
		limits:   newLimits(o.Now),
		imports:  importLimits{preview: ratelimit.NewLimiter(60, time.Hour, o.Now), run: ratelimit.NewLimiter(20, time.Hour, o.Now)},
		secure:   strings.HasPrefix(o.PublicURL, "https://"),
		runs:     map[int64]syncRun{},
		mux:      http.NewServeMux(),
	}
	s.routes()

	csrf := http.NewCrossOriginProtection()
	if u, err := url.Parse(o.PublicURL); err == nil && u.Host != "" {
		if err := csrf.AddTrustedOrigin(u.Scheme + "://" + u.Host); err != nil {
			s.log.Error("public_url is not a usable origin", "error", err)
		}
	}
	csrf.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusForbidden, "forbidden", "Deze aanvraag komt niet van Saldo zelf en is geweigerd.")
	}))
	return s, s.logRequests(s.recoverPanics(securityHeaders(csrf.Handler(s.requireViewer(s.mux)), s.secure)))
}

func (s *Server) routes() {
	m := s.mux
	m.HandleFunc("GET /api/health", s.health)
	m.HandleFunc("GET /healthz", s.health)
	m.HandleFunc("GET /api/me", s.getMe)
	m.HandleFunc("PATCH /api/me", s.patchMe)
	m.HandleFunc("PUT /api/me/preferences", s.putPreferences)
	m.HandleFunc("PUT /api/me/password", s.putPassword)
	m.HandleFunc("POST /api/auth/login", s.postLogin)
	m.HandleFunc("POST /api/auth/verify", s.postVerify)
	m.HandleFunc("POST /api/auth/logout", s.postLogout)
	m.HandleFunc("GET /api/auth/token/{token}", s.getToken)
	m.HandleFunc("POST /api/auth/redeem", s.postRedeem)
	m.HandleFunc("GET /api/devices", s.listDevices)
	m.HandleFunc("DELETE /api/devices/{id}", s.deleteDevice)
	m.HandleFunc("POST /api/devices/sign-out-others", s.signOutOthers)
	m.HandleFunc("GET /api/users", s.listUsers)
	m.HandleFunc("POST /api/users/invitations", s.postInvitation)
	m.HandleFunc("DELETE /api/users/invitations/{id}", s.deleteInvitation)
	m.HandleFunc("POST /api/users/{id}/password-reset", s.postPasswordReset)
	m.HandleFunc("GET /api/accounts", s.listAccounts)
	m.HandleFunc("POST /api/accounts", s.postAccount)
	m.HandleFunc("PATCH /api/accounts/{id}", s.patchAccount)
	m.HandleFunc("DELETE /api/accounts/{id}", s.deleteAccount)
	m.HandleFunc("PUT /api/accounts/{id}/balance", s.putBalance)
	m.HandleFunc("GET /api/accounts/{id}/balances", s.listBalances)
	m.HandleFunc("GET /api/transactions", s.listTransactions)
	m.HandleFunc("PATCH /api/transactions/{id}", s.patchTransaction)
	m.HandleFunc("GET /api/transactions/{id}/similar", s.getSimilar)
	m.HandleFunc("POST /api/transactions/{id}/similar", s.postSimilar)
	m.HandleFunc("PUT /api/transactions/{id}/split", s.putSplit)
	m.HandleFunc("DELETE /api/transactions/{id}/split", s.deleteSplit)
	m.HandleFunc("GET /api/alerts", s.listAlerts)
	m.HandleFunc("GET /api/connections", s.listConnections)
	m.HandleFunc("DELETE /api/connections/{id}", s.deleteConnection)
	m.HandleFunc("POST /api/sync", s.postSync)
	m.HandleFunc("GET /api/sync", s.getSync)
	m.HandleFunc("GET /api/bank/enablebanking", s.getEnableBanking)
	m.HandleFunc("PUT /api/bank/enablebanking", s.putEnableBanking)
	m.HandleFunc("POST /api/bank/link", s.postBankLink)
	m.HandleFunc("POST /api/bank/callback", s.postBankCallback)
	m.HandleFunc("POST /api/imports/preview", s.postImportPreview)
	m.HandleFunc("POST /api/imports", s.postImport)
	m.HandleFunc("GET /api/imports", s.listImports)
	m.HandleFunc("GET /api/imports/mappings", s.getImportMappings)
	m.HandleFunc("PUT /api/imports/mappings", s.putImportMappings)
	m.HandleFunc("POST /api/imports/{id}/reapply-categories", s.postReapplyCategories)
	m.HandleFunc("GET /api/imports/{id}/undo-preview", s.getUndoPreview)
	m.HandleFunc("POST /api/imports/{id}/undo", s.postUndo)
	m.HandleFunc("GET /api/categories", s.listCategories)
	m.HandleFunc("POST /api/categories", s.postCategory)
	m.HandleFunc("PATCH /api/categories/{id}", s.patchCategory)
	m.HandleFunc("DELETE /api/categories/{id}", s.deleteCategory)
	m.HandleFunc("GET /api/rules", s.listRules)
	m.HandleFunc("POST /api/rules", s.postRule)
	m.HandleFunc("POST /api/rules/apply", s.applyRules)
	m.HandleFunc("POST /api/rules/preview", s.postRulePreview)
	m.HandleFunc("PUT /api/rules/order", s.putRulesOrder)
	m.HandleFunc("POST /api/rules/{id}/apply", s.postRuleApply)
	m.HandleFunc("PATCH /api/rules/{id}", s.patchRule)
	m.HandleFunc("DELETE /api/rules/{id}", s.deleteRule)
	m.HandleFunc("GET /api/suggestions", s.listSuggestions)
	m.HandleFunc("POST /api/suggestions/confirm", s.postSuggestionConfirm)
	m.HandleFunc("POST /api/suggestions/dismiss", s.postSuggestionDismiss)
	m.HandleFunc("GET /api/suggestions/backfill", s.getBackfill)
	m.HandleFunc("POST /api/suggestions/backfill", s.postBackfill)
	m.HandleFunc("/api/", s.apiFallback)
	m.HandleFunc("/api", s.apiFallback)
	m.HandleFunc("/", s.serveWeb)
}

// now is the server's current time (Brussels, with the demo date override).
func (s *Server) now() time.Time { return s.opts.Clock.Now() }
