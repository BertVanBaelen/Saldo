package server

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// Manual accounts, their balances, and removing a bank link (phase 0.3-4).

func (s *Server) postAccount(w http.ResponseWriter, r *http.Request) {
	var body ledger.NewAccount
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	a, err := s.store.CreateAccount(r.Context(), viewerOf(r), body, s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

func (s *Server) putBalance(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	var body struct {
		Balance *int64 `json:"balance"`
		Date    string `json:"date"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	if body.Balance == nil {
		writeError(w, http.StatusBadRequest, "invalid", "Vul het saldo in.")
		return
	}
	a, err := s.store.SetBalance(r.Context(), viewerOf(r), id, *body.Balance, body.Date, s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (s *Server) listBalances(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	list, err := s.store.Balances(r.Context(), viewerOf(r), id)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	viewer := viewerOf(r)
	if err := s.store.DeleteAccount(r.Context(), viewer, id); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	s.audit(r, auth.EventAccountDeleted, viewer, "account="+strconv.FormatInt(id, 10))
	w.WriteHeader(http.StatusNoContent)
}

// deleteConnection removes the viewer's bank link (analysis 4.8). history is
// required, so deleting is never a default.
func (s *Server) deleteConnection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgConnectionNotFound)
	if !ok {
		return
	}
	history := r.URL.Query().Get("history")
	if history != "keep" && history != "delete" {
		writeError(w, http.StatusBadRequest, "invalid", "Kies of je de geschiedenis bewaart of verwijdert.")
		return
	}
	viewer := viewerOf(r)
	var removed ledger.Removed
	remove := func() error {
		var err error
		removed, err = s.store.RemoveConnection(r.Context(), viewer, id, history == "delete")
		return err
	}
	var err error
	if s.opts.Bank != nil {
		// No sync of this link may write while its accounts go.
		err = s.opts.Bank.Exclusive(r.Context(), id, remove)
	} else {
		err = remove()
	}
	if err != nil {
		s.fail(w, r, err, msgConnectionNotFound)
		return
	}
	s.audit(r, auth.EventBankLinkRemoved, viewer, fmt.Sprintf("connection=%d history=%s deleted=%d kept=%d",
		id, history, len(removed.Deleted), len(removed.Kept)))
	writeJSON(w, http.StatusOK, removed)
}
