package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// Contributions to a shared account (0.6-5, docs/api.md "Contributions").

const msgSenderNotFound = "Afzender niet gevonden."

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
		need := ceilEuros(m.Need.Amount, 100)
		c.Need = &need
		for i := range c.Members {
			_, required := memberPart(m.Need.Amount, c.Members[i].Share, len(c.Members))
			covered := c.Members[i].Received >= required
			c.Members[i].Required, c.Members[i].Covered = &required, &covered
		}
	}
	return c, nil
}
