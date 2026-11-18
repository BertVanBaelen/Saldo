package server

import (
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/auth"
)

// Inviting people to a shared account (0.8-0b, docs/api.md "Invitations").
// The shared flag itself is PATCH /api/accounts/{id} with {"shared": bool}.
// The two invitee routes answer 404 for anyone else's or an expired
// invitation; the account routes answer a hidden account as a missing one.

// getInvitable lists the other users of the instance, by name, for the
// account's manager (a member who does not manage it: 403).
func (s *Server) getInvitable(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	list, err := s.store.Invitable(r.Context(), viewerOf(r), id, s.now())
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": list})
}

// postAccountInvitation invites a user to a shared account the viewer manages.
// A hidden account and an unknown user are the same 404.
func (s *Server) postAccountInvitation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	var body struct {
		UserID int64 `json:"userId"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	if body.UserID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid", "Kies iemand om uit te nodigen.")
		return
	}
	inv, err := s.store.Invite(r.Context(), viewerOf(r), id, body.UserID, s.now())
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

// acceptAccountInvitation makes the invitee a member at once and answers the
// account as the new member sees it.
func (s *Server) acceptAccountInvitation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgInvitationNotFound)
	if !ok {
		return
	}
	viewer := viewerOf(r)
	a, err := s.store.AcceptInvitation(r.Context(), viewer, id, s.now())
	if err != nil {
		s.fail(w, r, err, msgInvitationNotFound)
		return
	}
	s.audit(r, auth.EventAccountJoined, viewer, "account="+strconv.FormatInt(a.ID, 10))
	writeJSON(w, http.StatusOK, a)
}

// deleteAccountInvitation declines (the invitee) or revokes (the manager).
func (s *Server) deleteAccountInvitation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgInvitationNotFound)
	if !ok {
		return
	}
	if err := s.store.DeleteInvitation(r.Context(), viewerOf(r), id, s.now()); err != nil {
		s.fail(w, r, err, msgInvitationNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
