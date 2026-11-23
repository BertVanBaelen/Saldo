package server

import (
	"net/http"
	"strconv"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// reportQuery reads the selection and the months of a report route
// (scope, account, from, to); a malformed account is the 404 of a missing one.
// ok is false once the answer is written.
func (s *Server) reportQuery(w http.ResponseWriter, r *http.Request) (q ledger.ReportQuery, ok bool) {
	v := r.URL.Query()
	q = ledger.ReportQuery{Scope: v.Get("scope"), From: v.Get("from"), To: v.Get("to"), Now: s.now()}
	if raw := v.Get("account"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			writeError(w, http.StatusNotFound, "not_found", msgAccountNotFound)
			return q, false
		}
		q.AccountID = id
	}
	return q, true
}

// getReportMonths answers income, saved and expenses per month (0.7-1,
// docs/api.md "Reports"); with detail=1 also per category and subcategory
// (0.8.1-1). The rules and the validation live in ledger.ReportMonths; this
// only reads the query.
func (s *Server) getReportMonths(w http.ResponseWriter, r *http.Request) {
	q, ok := s.reportQuery(w, r)
	if !ok {
		return
	}
	q.Detail = r.URL.Query().Get("detail") == "1"
	rep, err := s.store.ReportMonths(r.Context(), viewerOf(r), q)
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}
