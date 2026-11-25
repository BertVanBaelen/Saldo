package server

import (
	"net/http"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/receipt"
)

// GET /api/reports/receipt (0.9-3c, docs/api.md "Receipt"): the model of one
// week, month, quarter, year or custom range of months, built once in Go
// (receipt.Build) so the e-mail of 0.9-3e, the page of 0.9-3d and Overzicht's
// bon show the same numbers. This only reads and validates the query; every
// amount comes from ledger.ReportRange through the model.
//
// Validation runs before anything is read, in this order: account (a malformed
// one is the 404 of a missing one), periode, van, tot (eigen only), a period
// in the future. A hidden and an unknown account then answer alike inside
// Build, which asks the report's own selection; a custom range over 50 years
// is ReportRange's 400, checked before the selection is.

func (s *Server) getReportReceipt(w http.ResponseWriter, r *http.Request) {
	rq, ok := s.reportQuery(w, r)
	if !ok {
		return
	}
	if rq.Scope == "" {
		rq.Scope = "alles"
	}
	v := r.URL.Query()
	kind := v.Get("periode")
	switch kind {
	case receipt.KindWeek, receipt.KindMonth, receipt.KindQuarter, receipt.KindYear, receipt.KindCustom:
	default:
		writeError(w, http.StatusBadRequest, "invalid", "Kies week, maand, kwartaal, jaar of eigen.")
		return
	}
	// van is any date inside the period; the round trip rejects "2026-1-5" and "2026-02-30".
	day, ok := receiptDate(w, v.Get("van"))
	if !ok {
		return
	}
	var p receipt.Period
	switch kind {
	case receipt.KindWeek:
		p = receipt.Week(day)
	case receipt.KindMonth:
		p = receipt.Month(day)
	case receipt.KindQuarter:
		p = receipt.Quarter(day)
	case receipt.KindYear:
		p = receipt.Year(day)
	case receipt.KindCustom:
		// tot only counts for eigen; the other kinds ignore it, whatever it holds.
		if v.Get("tot") == "" {
			writeError(w, http.StatusBadRequest, "invalid", "Kies een einddatum.")
			return
		}
		end, ok := receiptDate(w, v.Get("tot"))
		if !ok {
			return
		}
		if end.Before(day) {
			writeError(w, http.StatusBadRequest, "invalid", "De einddatum ligt voor de begindatum.")
			return
		}
		p = receipt.Custom(day, end)
	}
	// The running period is fine: its snapshot is what the e-mail sends. Only one that has not begun is not.
	if p.From > s.brusselsToday() {
		writeError(w, http.StatusBadRequest, "invalid", "De periode ligt in de toekomst.")
		return
	}
	m, err := receipt.Build(r.Context(), s.db, s.store, viewerOf(r), receipt.Query{
		Period: p, Scope: rq.Scope, AccountID: rq.AccountID, Now: s.now()})
	if err != nil {
		s.fail(w, r, err, msgAccountNotFound)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// receiptDate parses a YYYY-MM-DD date of the query, answering the 400 itself.
func receiptDate(w http.ResponseWriter, raw string) (time.Time, bool) {
	t, err := time.Parse(time.DateOnly, raw)
	if err != nil || t.Format(time.DateOnly) != raw {
		writeError(w, http.StatusBadRequest, "invalid", "Kies een datum als JJJJ-MM-DD.")
		return time.Time{}, false
	}
	return t, true
}
