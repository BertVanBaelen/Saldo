package server

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/auth"
)

// Join offers, notices and converting rules (phase 0.6-1a, docs/api.md "Join").

const (
	msgOfferNotFound  = "Aanbod niet gevonden."
	msgNoticeNotFound = "Melding niet gevonden."
)

func (s *Server) listJoinOffers(w http.ResponseWriter, r *http.Request) {
	offers, err := s.store.JoinOffers(r.Context(), viewerOf(r), s.now())
	if err != nil {
		s.fail(w, r, err, msgOfferNotFound)
		return
	}
	writeJSON(w, http.StatusOK, offers)
}

func (s *Server) acceptJoinOffer(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgOfferNotFound)
	if !ok {
		return
	}
	viewer := viewerOf(r)
	a, err := s.store.AcceptJoin(r.Context(), viewer, id, s.now())
	if err != nil {
		s.fail(w, r, err, msgOfferNotFound)
		return
	}
	s.audit(r, auth.EventAccountJoined, viewer, "account="+strconv.FormatInt(a.ID, 10))
	writeJSON(w, http.StatusOK, map[string]any{"account": a})
}

func (s *Server) deleteJoinOffer(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgOfferNotFound)
	if !ok {
		return
	}
	if err := s.store.DeclineJoin(r.Context(), viewerOf(r), id); err != nil {
		s.fail(w, r, err, msgOfferNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) postNoticeRead(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgNoticeNotFound)
	if !ok {
		return
	}
	if err := s.store.ReadNotice(r.Context(), viewerOf(r), id, s.now()); err != nil {
		s.fail(w, r, err, msgNoticeNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) postConvertRules(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	n, err := s.store.ConvertRules(r.Context(), viewerOf(r), id)
	if errors.Is(err, apperr.ErrForbidden) {
		writeError(w, http.StatusForbidden, "forbidden", "Alleen de beheerder van de rekening kan regels omzetten.")
		return
	}
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"converted": n})
}
