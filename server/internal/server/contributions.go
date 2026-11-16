package server

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// Contributions to a shared account (0.6-5, docs/api.md "Contributions").

const msgSenderNotFound = "Afzender niet gevonden."

func (s *Server) getContributions(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	c, err := s.store.Contributions(r.Context(), viewerOf(r), id, r.URL.Query().Get("month"), s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) postContributionSender(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	var body struct {
		FromAccountID int64 `json:"fromAccountId"`
		TransactionID int64 `json:"transactionId"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	c, err := s.store.ClaimSender(r.Context(), viewerOf(r), id, body.FromAccountID, body.TransactionID)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) deleteContributionSender(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgSenderNotFound)
	if !ok {
		return
	}
	sender, err := strconv.ParseInt(r.PathValue("senderId"), 10, 64)
	if err != nil || sender <= 0 {
		writeError(w, http.StatusNotFound, "not_found", msgSenderNotFound)
		return
	}
	if err := s.store.RemoveSender(r.Context(), viewerOf(r), id, sender); err != nil {
		s.fail(w, r, err, msgSenderNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// putContributionShares sets the split (manager only) and answers the
// current month's contributions.
func (s *Server) putContributionShares(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	var body struct {
		Shares json.RawMessage `json:"shares"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	viewer := viewerOf(r)
	if err := s.store.SetShares(r.Context(), viewer, id, body.Shares); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	c, err := s.store.Contributions(r.Context(), viewer, id, "", s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, c)
}
