package server

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/users"
)

const (
	msgAccountNotFound = "Rekening niet gevonden."
	msgNotFound        = "Niet gevonden."
)

type healthBody struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	Demo    bool   `json:"demo"`
}

// health answers the add-on watchdog and the Docker healthcheck.
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.PingContext(ctx); err != nil {
		s.log.ErrorContext(r.Context(), "health: database unreachable", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, healthBody{Status: "error", Version: s.opts.Version, Demo: s.opts.Demo})
		return
	}
	writeJSON(w, http.StatusOK, healthBody{Status: "ok", Version: s.opts.Version, Demo: s.opts.Demo})
}

type meBody struct {
	User        users.User        `json:"user"`
	Preferences users.Preferences `json:"preferences"`
	Today       string            `json:"today"`
}

func (s *Server) getMe(w http.ResponseWriter, r *http.Request) {
	u, p, err := users.Get(r.Context(), s.db, viewerOf(r))
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, meBody{User: u, Preferences: p, Today: s.opts.Clock.Today()})
}

func (s *Server) putPreferences(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Scope *string `json:"scope"`
		Theme *string `json:"theme"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	p, err := users.SetPreferences(r.Context(), s.db, viewerOf(r), body.Scope, body.Theme)
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) listAccounts(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Accounts(r.Context(), viewerOf(r), s.now())
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) patchAccount(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", msgAccountNotFound)
		return
	}
	var patch ledger.AccountPatch
	if err := decodeJSON(w, r, &patch); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	a, err := s.store.UpdateAccount(r.Context(), viewerOf(r), id, patch, s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) listTransactions(w http.ResponseWriter, r *http.Request) {
	v := r.URL.Query()
	q := ledger.TxQuery{Scope: v.Get("scope"), Q: v.Get("q"), Before: v.Get("before")}
	if raw := v.Get("account"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			writeError(w, http.StatusNotFound, "not_found", msgAccountNotFound)
			return
		}
		q.AccountID = id
	}
	switch v.Get("uncategorised") {
	case "", "0", "false":
	case "1", "true":
		q.Uncategorised = true
	default:
		writeError(w, http.StatusBadRequest, "invalid", "Gebruik uncategorised=1 of laat het weg.")
		return
	}
	if raw := v.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, "invalid", fmt.Sprintf("Kies een limiet van 1 tot %d.", ledger.MaxLimit))
			return
		}
		q.Limit = n
	}
	page, err := s.store.Transactions(r.Context(), viewerOf(r), q)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) listAlerts(w http.ResponseWriter, r *http.Request) {
	alerts, err := s.store.Alerts(r.Context(), viewerOf(r), s.now())
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, alerts)
}

func (s *Server) listConnections(w http.ResponseWriter, r *http.Request) {
	conns, err := s.store.Connections(r.Context(), viewerOf(r), s.now())
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, conns)
}

func (s *Server) postSync(w http.ResponseWriter, r *http.Request) {
	if s.opts.Syncer == nil {
		writeError(w, http.StatusServiceUnavailable, "unavailable", "Synchroniseren is nog niet beschikbaar.")
		return
	}
	viewer := viewerOf(r)
	if ok, wait := s.cooldown.Allow(viewer); !ok {
		rateLimited(w, wait, "Je hebt net gesynchroniseerd. Probeer het over %d %s opnieuw.")
		return
	}
	if err := s.opts.Syncer.Sync(r.Context(), viewer, s.now()); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]bool{"started": true})
}

var methods = []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete}

// apiFallback answers unknown API paths with 404 and known paths with the
// wrong method with 405, both as JSON.
func (s *Server) apiFallback(w http.ResponseWriter, r *http.Request) {
	var allowed []string
	for _, m := range methods {
		probe := r.Clone(r.Context())
		probe.Method = m
		if _, pattern := s.mux.Handler(probe); pattern != "" && pattern != "/api/" && !strings.HasPrefix(pattern, "/") {
			allowed = append(allowed, m)
		}
	}
	if len(allowed) == 0 {
		writeError(w, http.StatusNotFound, "not_found", msgNotFound)
		return
	}
	if slices.Contains(allowed, http.MethodGet) {
		allowed = append(allowed, http.MethodHead)
	}
	w.Header().Set("Allow", strings.Join(allowed, ", "))
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Deze actie bestaat hier niet.")
}
