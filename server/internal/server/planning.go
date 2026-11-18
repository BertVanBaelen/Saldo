package server

import (
	"net/http"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// Planning data (0.8-1, docs/api.md "Planning data"): recurring items,
// budgets and planned items of an account. The rules and the checks live in
// ledger/planning.go; the handlers only read the request. A write to a hidden
// account, item or planned item answers the not-found message of its route
// before anything else is looked at.

const (
	msgItemNotFound    = "Post niet gevonden."
	msgPlannedNotFound = "Geplande post niet gevonden."
)

func (s *Server) planningRoutes() {
	m := s.mux
	m.HandleFunc("GET /api/planning", s.getPlanningForecast)
	m.HandleFunc("GET /api/planning/items", s.getPlanningItems)
	m.HandleFunc("POST /api/planning/items", s.postPlanningItem)
	m.HandleFunc("PATCH /api/planning/items/{id}", s.patchPlanningItem)
	m.HandleFunc("DELETE /api/planning/items/{id}", s.deletePlanningItem)
	m.HandleFunc("GET /api/planning/budgets", s.getPlanningBudgets)
	m.HandleFunc("PUT /api/planning/budgets", s.putPlanningBudget)
	m.HandleFunc("GET /api/planning/planned", s.getPlanned)
	m.HandleFunc("POST /api/planning/planned", s.postPlanned)
	m.HandleFunc("PATCH /api/planning/planned/{id}", s.patchPlanned)
	m.HandleFunc("DELETE /api/planning/planned/{id}", s.deletePlanned)
	s.planningDetectRoutes()
}

func (s *Server) getPlanningItems(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.PlanningItems(r.Context(), viewerOf(r), r.URL.Query().Get("scope"))
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) postPlanningItem(w http.ResponseWriter, r *http.Request) {
	var body ledger.ItemInput
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	it, err := s.store.CreateItem(r.Context(), viewerOf(r), body, s.now(), planning.Key)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, it)
}

func (s *Server) patchPlanningItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgItemNotFound)
	if !ok {
		return
	}
	var body ledger.ItemFields
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgItemNotFound)
		return
	}
	it, err := s.store.UpdateItem(r.Context(), viewerOf(r), id, body, s.now())
	if err != nil {
		s.fail(w, r, err, msgItemNotFound)
		return
	}
	writeJSON(w, http.StatusOK, it)
}

func (s *Server) deletePlanningItem(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgItemNotFound)
	if !ok {
		return
	}
	if err := s.store.DeleteItem(r.Context(), viewerOf(r), id); err != nil {
		s.fail(w, r, err, msgItemNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getPlanningBudgets(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Budgets(r.Context(), viewerOf(r), r.URL.Query().Get("scope"))
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"budgets": list})
}

func (s *Server) putPlanningBudget(w http.ResponseWriter, r *http.Request) {
	var body ledger.BudgetInput
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	list, err := s.store.SetBudget(r.Context(), viewerOf(r), body, s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"budgets": list})
}

func (s *Server) getPlanned(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.PlannedItems(r.Context(), viewerOf(r), r.URL.Query().Get("scope"), s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"planned": list})
}

func (s *Server) postPlanned(w http.ResponseWriter, r *http.Request) {
	var body ledger.PlannedInput
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	p, err := s.store.CreatePlanned(r.Context(), viewerOf(r), body, s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) patchPlanned(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgPlannedNotFound)
	if !ok {
		return
	}
	var body ledger.PlannedFields
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgPlannedNotFound)
		return
	}
	p, err := s.store.UpdatePlanned(r.Context(), viewerOf(r), id, body, s.now())
	if err != nil {
		s.fail(w, r, err, msgPlannedNotFound)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) deletePlanned(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgPlannedNotFound)
	if !ok {
		return
	}
	if err := s.store.DeletePlanned(r.Context(), viewerOf(r), id); err != nil {
		s.fail(w, r, err, msgPlannedNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
