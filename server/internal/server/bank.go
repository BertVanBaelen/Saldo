package server

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/banklink"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

const msgConnectionNotFound = "Bankkoppeling niet gevonden."

// bankTimeout bounds a link or a sync with the bank: a first sync fetches the
// whole history, which can take longer than the server's write timeout.
const bankTimeout = 5 * time.Minute

// bankContext detaches the work from the request, so a browser or tunnel
// that gives up halfway does not cut off a consent the bank has already
// confirmed, and gives the answer as long to be written.
func bankContext(w http.ResponseWriter, r *http.Request) (context.Context, context.CancelFunc) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(bankTimeout + time.Minute))
	return context.WithTimeout(context.WithoutCancel(r.Context()), bankTimeout)
}

// redirectURL is the web page the bank sends the browser back to (analysis
// 6.2), "" without public_url. Demo mode then uses the request's own origin.
func (s *Server) redirectURL(r *http.Request) string {
	base := s.opts.PublicURL
	if base == "" && s.opts.Demo {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	if base == "" {
		return ""
	}
	return base + "/bankkoppelingen/terug"
}

// bankReady answers 503 when bank linking is not wired up.
func (s *Server) bankReady(w http.ResponseWriter) bool {
	if s.opts.Bank == nil {
		writeError(w, http.StatusServiceUnavailable, "unavailable", "Bankkoppelingen zijn nog niet beschikbaar.")
		return false
	}
	return true
}

// bankFail answers an error of package banklink.
func (s *Server) bankFail(w http.ResponseWriter, r *http.Request, err error, notFound string) {
	switch {
	case errors.Is(err, banklink.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "unavailable", "Enable Banking is nu niet bereikbaar. Probeer het later opnieuw.")
	case errors.Is(err, banklink.ErrNoRedirectURL):
		writeError(w, http.StatusServiceUnavailable, "unavailable", "Vul eerst het publieke adres (public_url) in bij de add-on.")
	default:
		s.fail(w, r, err, notFound)
	}
}

type enableBankingBody struct {
	Configured    bool    `json:"configured"`
	ApplicationID *string `json:"applicationId"`
	RedirectURL   *string `json:"redirectUrl"`
}

// writeEnableBanking answers the viewer's Enable Banking settings, never the key.
func (s *Server) writeEnableBanking(w http.ResponseWriter, r *http.Request) {
	appID := "demo"
	if !s.opts.Demo {
		var err error
		if appID, err = s.opts.Bank.ApplicationID(r.Context(), viewerOf(r)); err != nil {
			s.fail(w, r, err, msgNotFound)
			return
		}
	}
	var body enableBankingBody
	if appID != "" {
		body.Configured, body.ApplicationID = true, &appID
	}
	if u := s.redirectURL(r); u != "" {
		body.RedirectURL = &u
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) getEnableBanking(w http.ResponseWriter, r *http.Request) {
	if s.bankReady(w) {
		s.writeEnableBanking(w, r)
	}
}

func (s *Server) putEnableBanking(w http.ResponseWriter, r *http.Request) {
	if !s.bankReady(w) {
		return
	}
	if s.opts.Demo {
		writeError(w, http.StatusBadRequest, "invalid", "Niet beschikbaar in de demo.")
		return
	}
	var body struct {
		ApplicationID string `json:"applicationId"`
		PrivateKey    string `json:"privateKey"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgNotFound)
		return
	}
	if err := s.opts.Bank.SaveCredentials(r.Context(), viewerOf(r), body.ApplicationID, body.PrivateKey); err != nil {
		s.bankFail(w, r, err, msgNotFound)
		return
	}
	s.writeEnableBanking(w, r)
}

func (s *Server) postBankLink(w http.ResponseWriter, r *http.Request) {
	if !s.bankReady(w) {
		return
	}
	var body struct {
		ConnectionID *int64 `json:"connectionId"`
	}
	// The body is optional: no body is a new link.
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &body); err != nil {
			s.fail(w, r, err, msgConnectionNotFound)
			return
		}
	}
	viewer := viewerOf(r)
	if s.limited(w, r, s.limits.bankLink, strconv.FormatInt(viewer, 10), "bank_link", viewer) {
		return
	}
	var id int64
	if body.ConnectionID != nil {
		if id = *body.ConnectionID; id <= 0 {
			writeError(w, http.StatusNotFound, "not_found", msgConnectionNotFound)
			return
		}
	}
	u, err := s.opts.Bank.StartLink(r.Context(), viewer, id, s.redirectURL(r))
	if err != nil {
		s.bankFail(w, r, err, msgConnectionNotFound)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": u})
}

type callbackBody struct {
	Connection ledger.Connection  `json:"connection"`
	Accounts   []ledger.Account   `json:"accounts"`
	Skipped    []banklink.Skipped `json:"skipped"`
}

func (s *Server) postBankCallback(w http.ResponseWriter, r *http.Request) {
	if !s.bankReady(w) {
		return
	}
	var body struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		s.fail(w, r, err, msgConnectionNotFound)
		return
	}
	ctx, cancel := bankContext(w, r)
	defer cancel()
	viewer := viewerOf(r)
	linked, err := s.opts.Bank.Complete(ctx, viewer, body.Code, body.State, s.now())
	if err != nil {
		s.bankFail(w, r, err, msgConnectionNotFound)
		return
	}
	conns, err := s.store.Connections(ctx, viewer, s.now())
	if err != nil {
		s.fail(w, r, err, msgConnectionNotFound)
		return
	}
	i := slices.IndexFunc(conns, func(c ledger.Connection) bool { return c.ID == linked.Connection })
	if i < 0 {
		s.fail(w, r, errors.New("linked connection not listed"), msgConnectionNotFound)
		return
	}
	all, err := s.store.Accounts(ctx, viewer, s.now())
	if err != nil {
		s.fail(w, r, err, msgConnectionNotFound)
		return
	}
	accounts := []ledger.Account{}
	for _, a := range all {
		if slices.Contains(linked.Accounts, a.ID) {
			accounts = append(accounts, a)
		}
	}
	writeJSON(w, http.StatusOK, callbackBody{Connection: conns[i], Accounts: accounts, Skipped: linked.Skipped})
}
