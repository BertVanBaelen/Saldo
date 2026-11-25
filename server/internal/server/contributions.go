package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// Contributions to a shared account (0.6-5, docs/api.md "Contributions").

const (
	msgSenderNotFound      = "Afzender niet gevonden."
	msgContributorNotFound = "Bijdrager niet gevonden."
)

func (s *Server) getContributions(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	c, err := s.contributions(r.Context(), viewerOf(r), id, r.URL.Query().Get("month"))
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
	if c.Replaced > 0 { // ids only, never the IBAN
		s.audit(r, auth.EventContribReplaced, viewerOf(r), fmt.Sprintf("account=%d contributor=%d", id, c.Replaced))
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
	c, err := s.contributions(r.Context(), viewer, id, "")
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// contributions is Store.Contributions with what the forecast adds (0.8-4): the
// month's need and each member's required part and whether it is covered.
// They stay nil outside the forecast (the running month to the end of the
// 24-month horizon) and for an account without a balance or that is not a
// current account.
func (s *Server) contributions(ctx context.Context, viewer, id int64, month string) (ledger.Contributions, error) {
	c, err := s.store.Contributions(ctx, viewer, id, month, s.now())
	if err != nil || len(c.Members) == 0 {
		return c, err
	}
	var kind string
	if err := s.db.QueryRowContext(ctx, `SELECT type FROM accounts WHERE id = ?`, id).Scan(&kind); err != nil || kind != "current" {
		return c, err
	}
	f, err := planning.Forecast(ctx, s.db, id, s.brusselsToday(), 24)
	if errors.Is(err, planning.ErrNoBalance) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	for _, m := range f.Months {
		if m.Month != c.Month {
			continue
		}
		need := planning.CeilEuros(m.Need.Amount, 100)
		c.Need = &need
		n := len(c.Members) + len(c.Contributors) // contributors without Saldo get a part too (0.8.1-7)
		for i := range c.Members {
			_, required := planning.MemberPart(m.Need.Amount, c.Members[i].Share, n)
			covered := c.Members[i].Received >= required
			c.Members[i].Required, c.Members[i].Covered = &required, &covered
		}
		for i := range c.Contributors {
			_, required := planning.MemberPart(m.Need.Amount, c.Contributors[i].Share, n)
			covered := c.Contributors[i].Received >= required
			c.Contributors[i].Required, c.Contributors[i].Covered = &required, &covered
		}
	}
	return c, nil
}

// Contributors without Saldo (0.8.1-7). Every write answers the current
// month's contributions as the viewer sees them (one masking path).

// contributorBody is a contributor write: a name, and the IBAN typed or from
// an incoming row of the account (transactionId); the share is set with
// PUT contribution-shares only.
type contributorBody struct {
	Name          *string `json:"name"`
	IBAN          *string `json:"iban"`
	TransactionID int64   `json:"transactionId"`
}

func (b contributorBody) input() ledger.ContributorInput {
	return ledger.ContributorInput{Name: b.Name, IBAN: b.IBAN, TransactionID: b.TransactionID}
}

// answerContributions writes the current month's contributions after a write.
func (s *Server) answerContributions(w http.ResponseWriter, r *http.Request, id int64, status int) {
	c, err := s.contributions(r.Context(), viewerOf(r), id, "")
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, status, c)
}

// contributorPath reads {id} and {contributorId}.
func contributorPath(w http.ResponseWriter, r *http.Request) (int64, int64, bool) {
	id, ok := pathID(w, r, msgContributorNotFound)
	if !ok {
		return 0, 0, false
	}
	c, err := strconv.ParseInt(r.PathValue("contributorId"), 10, 64)
	if err != nil || c <= 0 {
		writeError(w, http.StatusNotFound, "not_found", msgContributorNotFound)
		return 0, 0, false
	}
	return id, c, true
}

func (s *Server) postContributor(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, msgAccountNotFound)
	if !ok {
		return
	}
	var body contributorBody
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	if _, err := s.store.AddContributor(r.Context(), viewerOf(r), id, body.input()); err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	s.answerContributions(w, r, id, http.StatusCreated)
}

func (s *Server) patchContributor(w http.ResponseWriter, r *http.Request) {
	id, c, ok := contributorPath(w, r)
	if !ok {
		return
	}
	var body contributorBody
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgContributorNotFound)
		return
	}
	if err := s.store.UpdateContributor(r.Context(), viewerOf(r), id, c, body.input()); err != nil {
		s.fail(w, r, err, msgContributorNotFound)
		return
	}
	s.answerContributions(w, r, id, http.StatusOK)
}

func (s *Server) deleteContributor(w http.ResponseWriter, r *http.Request) {
	id, c, ok := contributorPath(w, r)
	if !ok {
		return
	}
	if err := s.store.RemoveContributor(r.Context(), viewerOf(r), id, c); err != nil {
		s.fail(w, r, err, msgContributorNotFound)
		return
	}
	s.answerContributions(w, r, id, http.StatusOK)
}

// putContributorLink is the manager's offer to link a contributor to a
// member ({"userId": n}) or its withdrawal ({"userId": null}).
func (s *Server) putContributorLink(w http.ResponseWriter, r *http.Request) {
	id, c, ok := contributorPath(w, r)
	if !ok {
		return
	}
	var body struct {
		UserID *int64 `json:"userId"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgContributorNotFound)
		return
	}
	var user int64
	if body.UserID != nil {
		if user = *body.UserID; user <= 0 {
			writeError(w, http.StatusBadRequest, "invalid", "Kies een lid van deze rekening.")
			return
		}
	}
	if err := s.store.OfferLink(r.Context(), viewerOf(r), id, c, user); err != nil {
		s.fail(w, r, err, msgContributorNotFound)
		return
	}
	s.answerContributions(w, r, id, http.StatusOK)
}

// postContributorLinkAnswer is the offered member's Ja ({"yes": true}) or
// Nee ({"yes": false}).
func (s *Server) postContributorLinkAnswer(w http.ResponseWriter, r *http.Request) {
	id, c, ok := contributorPath(w, r)
	if !ok {
		return
	}
	var body struct {
		Yes *bool `json:"yes"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgContributorNotFound)
		return
	}
	if body.Yes == nil {
		writeError(w, http.StatusBadRequest, "invalid", "De gegevens kloppen niet.")
		return
	}
	viewer := viewerOf(r)
	linked, err := s.store.AnswerLink(r.Context(), viewer, id, c, *body.Yes)
	if err != nil {
		s.fail(w, r, err, msgContributorNotFound)
		return
	}
	if linked { // ids only, never the IBAN
		s.audit(r, auth.EventContributorLinked, viewer, fmt.Sprintf("account=%d contributor=%d user=%d", id, c, viewer))
	}
	s.answerContributions(w, r, id, http.StatusOK)
}
