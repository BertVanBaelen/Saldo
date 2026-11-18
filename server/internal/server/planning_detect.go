package server

import (
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// Recurring-item detection (0.8-2, docs/api.md "Suggestions and the
// detection report"): both routes are read-only and computed on read; the
// heuristic lives in planning/detect.go.

func (s *Server) planningDetectRoutes() {
	s.mux.HandleFunc("GET /api/planning/suggestions", s.getPlanningSuggestions)
	s.mux.HandleFunc("GET /api/planning/detection", s.getPlanningDetection)
}

func (s *Server) getPlanningSuggestions(w http.ResponseWriter, r *http.Request) {
	list, err := planning.DetectSuggestions(r.Context(), s.db, s.store, viewerOf(r), r.URL.Query().Get("scope"), s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": list})
}

func (s *Server) getPlanningDetection(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.URL.Query().Get("account"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", msgAccountNotFound)
		return
	}
	rep, err := planning.DetectionReport(r.Context(), s.db, s.store, viewerOf(r), id, s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}
