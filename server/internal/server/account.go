package server

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/users"
)

const (
	msgDeviceNotFound     = "Toestel niet gevonden."
	msgUserNotFound       = "Gebruiker niet gevonden."
	msgInvitationNotFound = "Uitnodiging niet gevonden."
)

// pathID reads a positive {id}; anything else answers 404.
func pathID(w http.ResponseWriter, r *http.Request, notFound string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not_found", notFound)
		return 0, false
	}
	return id, true
}

func (s *Server) patchMe(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name *string `json:"name"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	if body.Name == nil {
		writeError(w, http.StatusBadRequest, "invalid", "Geef een naam op.")
		return
	}
	u, err := users.SetName(r.Context(), s.db, viewerOf(r), *body.Name)
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) putPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	viewer := viewerOf(r)
	key := strconv.FormatInt(viewer, 10)
	if wait := s.limits.password.Blocked(key); wait > 0 {
		s.audit(r, auth.EventRateLimited, viewer, "password")
		rateLimited(w, wait, "Te veel pogingen. Probeer het over %d %s opnieuw.")
		return
	}
	err := s.auth.ChangePassword(r.Context(), viewer, deviceOf(r), body.Current, body.New, clientIP(r))
	if errors.Is(err, auth.ErrWrongPassword) {
		s.limits.password.Allow(key)
		writeError(w, http.StatusBadRequest, "invalid", "Je huidige wachtwoord klopt niet.")
		return
	}
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listDevices(w http.ResponseWriter, r *http.Request) {
	list, err := s.auth.Devices(r.Context(), viewerOf(r), deviceOf(r))
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) deleteDevice(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgDeviceNotFound)
	if !ok {
		return
	}
	if err := s.auth.SignOut(r.Context(), viewerOf(r), id, clientIP(r)); err != nil {
		s.fail(w, r, err, msgDeviceNotFound)
		return
	}
	if id == deviceOf(r) {
		s.clearDeviceCookie(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) signOutOthers(w http.ResponseWriter, r *http.Request) {
	if err := s.auth.SignOutOthers(r.Context(), viewerOf(r), deviceOf(r), clientIP(r)); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// admin returns the viewer when they are an admin; otherwise it answers 403.
func (s *Server) admin(w http.ResponseWriter, r *http.Request) (users.User, bool) {
	u, _, err := users.Get(r.Context(), s.db, viewerOf(r))
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return u, false
	}
	if u.Role != "admin" {
		writeError(w, http.StatusForbidden, "forbidden", "Alleen een beheerder kan gebruikers beheren.")
		return u, false
	}
	return u, true
}

// canMailLinks is false (and answers 503) when a mail with a link cannot be
// sent: no mailer, or no public address to link to.
func (s *Server) canMailLinks(w http.ResponseWriter) bool {
	switch {
	case s.opts.Mailer == nil:
		writeError(w, http.StatusServiceUnavailable, "unavailable", msgNoMail)
	case s.opts.PublicURL == "":
		writeError(w, http.StatusServiceUnavailable, "unavailable", "Vul eerst het publieke adres (public_url) in bij de add-on.")
	default:
		return true
	}
	return false
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.admin(w, r); !ok {
		return
	}
	list, err := users.List(r.Context(), s.db)
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	invitations, err := s.auth.Invitations(r.Context())
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": list, "invitations": invitations})
}

func (s *Server) postInvitation(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.admin(w, r)
	if !ok {
		return
	}
	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	if !s.canMailLinks(w) {
		return
	}
	inv, token, err := s.auth.Invite(r.Context(), admin.ID, body.Email, body.Role)
	if err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	days := int(auth.InvitationTTL.Hours() / 24)
	m, err := mail.Invitation(inv.Email, admin.Name, inv.Role, s.opts.PublicURL+"/uitnodiging/"+token, days)
	if err == nil {
		err = s.opts.Mailer.Send(r.Context(), m)
	}
	if err != nil {
		s.log.ErrorContext(r.Context(), "invitation not sent", "error", err)
		if err := s.auth.DeleteInvitation(r.Context(), inv.ID); err != nil {
			s.log.ErrorContext(r.Context(), "withdraw unsent invitation", "error", err)
		}
		writeError(w, http.StatusServiceUnavailable, "unavailable", msgMailFailed)
		return
	}
	s.audit(r, auth.EventInvitationSent, admin.ID, strconv.FormatInt(inv.ID, 10))
	writeJSON(w, http.StatusCreated, inv)
}

func (s *Server) deleteInvitation(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.admin(w, r); !ok {
		return
	}
	id, ok := pathID(w, r, msgInvitationNotFound)
	if !ok {
		return
	}
	if err := s.auth.DeleteInvitation(r.Context(), id); err != nil {
		s.fail(w, r, err, msgInvitationNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) postPasswordReset(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.admin(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r, msgUserNotFound)
	if !ok {
		return
	}
	target, _, err := users.Get(r.Context(), s.db, id)
	if errors.Is(err, apperr.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", msgUserNotFound)
		return
	}
	if err != nil {
		s.fail(w, r, err, msgUserNotFound)
		return
	}
	if !s.canMailLinks(w) {
		return
	}
	token, until, err := s.auth.CreateReset(r.Context(), admin.ID, target.ID)
	if err != nil {
		s.fail(w, r, err, msgUserNotFound)
		return
	}
	m, err := mail.PasswordReset(target.Email, admin.Name, s.opts.PublicURL+"/nieuw-wachtwoord/"+token, until)
	if err == nil {
		err = s.opts.Mailer.Send(r.Context(), m)
	}
	if err != nil {
		s.log.ErrorContext(r.Context(), "password reset not sent", "error", err)
		writeError(w, http.StatusServiceUnavailable, "unavailable", msgMailFailed)
		return
	}
	s.audit(r, auth.EventResetSent, target.ID, "by "+strconv.FormatInt(admin.ID, 10))
	w.WriteHeader(http.StatusNoContent)
}
