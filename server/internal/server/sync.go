package server

import (
	"context"
	"net/http"
	"time"
)

// syncRun is the background sync state of one viewer, for GET /api/sync.
type syncRun struct {
	active            int // syncs running: "Sync now" and link callbacks
	started, finished time.Time
}

// startSync runs fn in the background for the viewer, detached from the
// request: behind Cloudflare a request over 100 seconds answers 524, and a
// first sync can take minutes. With exclusive it starts nothing while a sync
// of the viewer is running and returns false.
func (s *Server) startSync(viewer int64, exclusive bool, fn func(ctx context.Context) error) bool {
	s.runsMu.Lock()
	defer s.runsMu.Unlock()
	r := s.runs[viewer]
	if exclusive && r.active > 0 {
		return false
	}
	if r.active == 0 {
		r.started, r.finished = s.now(), time.Time{}
	}
	r.active++
	s.runs[viewer] = r
	s.syncs.Add(1)
	go func() {
		defer s.syncs.Done()
		ctx, cancel := context.WithTimeout(context.Background(), bankTimeout)
		defer cancel()
		if err := fn(ctx); err != nil {
			s.log.Error("sync failed", "viewer", viewer, "error", err)
		}
		s.runsMu.Lock()
		defer s.runsMu.Unlock()
		r := s.runs[viewer]
		if r.active--; r.active == 0 {
			r.finished = s.now()
		}
		s.runs[viewer] = r
	}()
	return true
}

func (s *Server) syncRunning(viewer int64) bool {
	s.runsMu.Lock()
	defer s.runsMu.Unlock()
	return s.runs[viewer].active > 0
}

func (s *Server) postSync(w http.ResponseWriter, r *http.Request) {
	if s.opts.Syncer == nil {
		writeError(w, http.StatusServiceUnavailable, "unavailable", "Synchroniseren is nog niet beschikbaar.")
		return
	}
	viewer := viewerOf(r)
	busy := map[string]bool{"started": false, "running": true}
	// A sync that is running already answers without using the cooldown.
	if s.syncRunning(viewer) {
		writeJSON(w, http.StatusAccepted, busy)
		return
	}
	if ok, wait := s.cooldown.Allow(viewer); !ok {
		rateLimited(w, wait, "Je hebt net gesynchroniseerd. Probeer het over %d %s opnieuw.")
		return
	}
	now := s.now()
	if !s.startSync(viewer, true, func(ctx context.Context) error { return s.opts.Syncer.Sync(ctx, viewer, now) }) {
		writeJSON(w, http.StatusAccepted, busy)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]bool{"started": true})
}

type syncConnection struct {
	ID       int64   `json:"id"`
	Status   string  `json:"status"`
	LastSync *string `json:"lastSync"`
	Error    *string `json:"error"`
}

type syncBody struct {
	Running     bool             `json:"running"`
	StartedAt   *string          `json:"startedAt"`
	FinishedAt  *string          `json:"finishedAt"`
	Connections []syncConnection `json:"connections"`
}

// getSync is the viewer's sync state, to poll after POST /api/sync.
func (s *Server) getSync(w http.ResponseWriter, r *http.Request) {
	viewer := viewerOf(r)
	s.runsMu.Lock()
	run := s.runs[viewer]
	s.runsMu.Unlock()
	conns, err := s.store.Connections(r.Context(), viewer, s.now())
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	body := syncBody{Running: run.active > 0, StartedAt: timestamp(run.started), FinishedAt: timestamp(run.finished),
		Connections: []syncConnection{}}
	for _, c := range conns {
		body.Connections = append(body.Connections, syncConnection{ID: c.ID, Status: c.Status, LastSync: c.LastSync, Error: c.Error})
	}
	writeJSON(w, http.StatusOK, body)
}

func timestamp(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	ts := t.Format(time.RFC3339)
	return &ts
}
