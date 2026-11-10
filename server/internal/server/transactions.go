package server

import (
	"net/http"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Categorising one transaction (phase 0.4-3): category, note, "apply to
// similar and create a rule" and splits.

const msgTxNotFound = "Transactie niet gevonden."

func (s *Server) patchTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgTxNotFound)
	if !ok {
		return
	}
	var body ledger.TxPatch
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgTxNotFound)
		return
	}
	t, err := s.store.UpdateTransaction(r.Context(), viewerOf(r), id, body)
	if err != nil {
		s.fail(w, r, err, msgTxNotFound)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) getSimilar(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgTxNotFound)
	if !ok {
		return
	}
	v, err := s.store.SimilarPreview(r.Context(), viewerOf(r), id)
	if err != nil {
		s.fail(w, r, err, msgTxNotFound)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// postSimilar takes no body; an empty JSON object is allowed.
func (s *Server) postSimilar(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgTxNotFound)
	if !ok {
		return
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &struct{}{}); err != nil {
			s.fail(w, r, err, msgTxNotFound)
			return
		}
	}
	v, err := s.store.ApplySimilar(r.Context(), viewerOf(r), id)
	if err != nil {
		s.fail(w, r, err, msgTxNotFound)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) putSplit(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgTxNotFound)
	if !ok {
		return
	}
	var body struct {
		Parts []ledger.SplitPart `json:"parts"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgTxNotFound)
		return
	}
	t, err := s.store.SetSplit(r.Context(), viewerOf(r), id, body.Parts)
	if err != nil {
		s.fail(w, r, err, msgTxNotFound)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) deleteSplit(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgTxNotFound)
	if !ok {
		return
	}
	t, err := s.store.RemoveSplit(r.Context(), viewerOf(r), id)
	if err != nil {
		s.fail(w, r, err, msgTxNotFound)
		return
	}
	writeJSON(w, http.StatusOK, t)
}
