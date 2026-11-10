package server

import (
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// The category tree (phase 0.4-1) and rules (phase 0.4-2).

const (
	msgCategoryNotFound = "Categorie niet gevonden."
	msgRuleNotFound     = "Regel niet gevonden."
)

func (s *Server) listCategories(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Categories(r.Context(), viewerOf(r))
	if err != nil {
		s.fail(w, r, err, msgCategoryNotFound)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) postCategory(w http.ResponseWriter, r *http.Request) {
	var body ledger.CategoryInput
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgCategoryNotFound)
		return
	}
	c, err := s.store.CreateCategory(r.Context(), viewerOf(r), body)
	if err != nil {
		s.fail(w, r, err, msgCategoryNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) patchCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgCategoryNotFound)
	if !ok {
		return
	}
	var body ledger.CategoryInput
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgCategoryNotFound)
		return
	}
	c, err := s.store.UpdateCategory(r.Context(), viewerOf(r), id, body)
	if err != nil {
		s.fail(w, r, err, msgCategoryNotFound)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// deleteCategory removes a category for everyone; moveTo is required, so
// where the transactions go is never a default.
func (s *Server) deleteCategory(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgCategoryNotFound)
	if !ok {
		return
	}
	moveTo := r.URL.Query().Get("moveTo")
	var target int64
	if moveTo != "none" {
		var err error
		if target, err = strconv.ParseInt(moveTo, 10, 64); err != nil || target <= 0 {
			writeError(w, http.StatusBadRequest, "invalid", "Kies waar de transacties naartoe gaan.")
			return
		}
	}
	viewer := viewerOf(r)
	if err := s.store.RemoveCategory(r.Context(), id, target); err != nil {
		s.fail(w, r, err, msgCategoryNotFound)
		return
	}
	s.audit(r, auth.EventCategoryRemoved, viewer, "category="+strconv.FormatInt(id, 10)+" moveTo="+moveTo)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listRules(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.Rules(r.Context(), viewerOf(r))
	if err != nil {
		s.fail(w, r, err, msgRuleNotFound)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) postRule(w http.ResponseWriter, r *http.Request) {
	var body ledger.RuleInput
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	v, err := s.store.CreateRule(r.Context(), viewerOf(r), body)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) patchRule(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgRuleNotFound)
	if !ok {
		return
	}
	var body ledger.RuleInput
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgRuleNotFound)
		return
	}
	v, err := s.store.UpdateRule(r.Context(), viewerOf(r), id, body)
	if err != nil {
		s.fail(w, r, err, msgRuleNotFound)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) deleteRule(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgRuleNotFound)
	if !ok {
		return
	}
	if err := s.store.DeleteRule(r.Context(), viewerOf(r), id); err != nil {
		s.fail(w, r, err, msgRuleNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) applyRules(w http.ResponseWriter, r *http.Request) {
	n, err := s.store.ApplyRules(r.Context(), viewerOf(r))
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"updated": n})
}
