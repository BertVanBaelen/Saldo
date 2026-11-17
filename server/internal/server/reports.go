package server

import (
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// getReportMonths answers income, saved and expenses per month (0.7-1,
// docs/api.md "Reports"). The rules and the validation live in
// ledger.ReportMonths; this only reads the query.
func (s *Server) getReportMonths(w http.ResponseWriter, r *http.Request) {
	v := r.URL.Query()
	q := ledger.ReportQuery{Scope: v.Get("scope"), From: v.Get("from"), To: v.Get("to"), Now: s.now()}
	if raw := v.Get("account"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			writeError(w, http.StatusNotFound, "not_found", msgAccountNotFound)
			return
		}
		q.AccountID = id
	}
	rep, err := s.store.ReportMonths(r.Context(), viewerOf(r), q)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}
