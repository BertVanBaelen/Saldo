// Package banklink links a user's bank accounts through their own Enable
// Banking application (analysis 6.2, docs/api.md "Bank link"): it keeps the
// application's credentials sealed on the user's connection, starts and
// completes the consent, matches the shared accounts by IBAN and syncs their
// transactions and balances.
//
// Demo mode and the tests run this same code against the fake bank; only the
// Opener differs.
package banklink

import (
	"cmp"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/enablebanking"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/secrets"
)

// Client is one user's bank: its data and the consent steps.
// *enablebanking.Client and fake.Client implement it.
type Client interface {
	bank.Provider
	CheckApplication(ctx context.Context) error
	StartAuth(ctx context.Context, aspspName, country, state, redirectURL string, validUntil time.Time) (string, error)
	CreateSession(ctx context.Context, code string) (bank.SessionInfo, error)
}

// Opener returns the client for a user's stored credentials, or
// ErrNotConfigured when there are none.
type Opener func(user int64, appID string, keyPEM []byte) (Client, error)

// EnableBanking is the Opener of the real bank.
func EnableBanking(_ int64, appID string, keyPEM []byte) (Client, error) {
	if appID == "" || len(keyPEM) == 0 {
		return nil, ErrNotConfigured
	}
	c, err := enablebanking.New(appID, keyPEM)
	if err != nil {
		return nil, err
	}
	return c, nil
}

var (
	// ErrNotConfigured: the user has stored no Enable Banking credentials.
	ErrNotConfigured = errors.New("banklink: no Enable Banking credentials")
	// ErrNoRedirectURL: Saldo has no public address for the bank to send the
	// user back to.
	ErrNoRedirectURL = errors.New("banklink: no redirect URL")
	// ErrUnavailable: the provider could not be reached or had a server error.
	ErrUnavailable = errors.New("banklink: bank provider unavailable")
)

// The only bank for now (analysis 6.1).
const (
	aspspName    = "Argenta"
	aspspCountry = "BE"
)

// consentDays is the longest consent Argenta gives (analysis 6.1).
// verify in S1: the provider refuses rather than shortens a longer one.
const consentDays = 180

const (
	msgNotConfigured = "Vul eerst de application-id en de privésleutel van je Enable Banking-app in bij Instellingen."
	// msgBadState is the one answer for every state that does not check out,
	// so a caller learns nothing about which check failed.
	msgBadState = "Deze koppeling is verlopen of ongeldig. Begin opnieuw bij Bankkoppelingen."
)

// Service links and syncs bank connections.
type Service struct {
	db     *sql.DB
	box    *secrets.Box
	open   Opener
	now    func() time.Time
	log    *slog.Logger
	states *states
}

// New returns the service. now is the real clock of the link states and the
// consent's end (time.Now when nil); syncs take their time from the caller.
func New(db *sql.DB, box *secrets.Box, open Opener, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Service{db: db, box: box, open: open, now: now, log: log, states: &states{now: now}}
}

// connection is a provider_connections row with its sealed secrets.
type connection struct {
	id, user        int64
	aspsp, country  string
	appID           string
	keyEnc, sessEnc []byte
}

const connectionColumns = `id, user_id, aspsp_name, aspsp_country, COALESCE(application_id, ''), private_key_enc, session_id_enc`

func scanConnection(row *sql.Row) (connection, error) {
	var c connection
	err := row.Scan(&c.id, &c.user, &c.aspsp, &c.country, &c.appID, &c.keyEnc, &c.sessEnc)
	return c, err
}

// client unseals the connection's key and opens its bank.
func (s *Service) client(c connection) (Client, error) {
	var key []byte
	if c.keyEnc != nil {
		var err error
		if key, err = s.box.Open(c.keyEnc); err != nil {
			// A lost or replaced secret.key: only storing the key again helps.
			return nil, fmt.Errorf("banklink: unseal the key of connection %d: %v: %w", c.id, err, ErrNotConfigured)
		}
	}
	return s.open(c.user, c.appID, key)
}

// ApplicationID is the viewer's stored application id, "" when none is.
func (s *Service) ApplicationID(ctx context.Context, viewer int64) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `
		SELECT application_id FROM provider_connections
		WHERE user_id = ? AND status <> 'revoked' AND application_id IS NOT NULL AND private_key_enc IS NOT NULL
		ORDER BY id LIMIT 1`, viewer).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// SaveCredentials checks the application id and key against the provider and
// stores them on every connection of the viewer, so existing links keep
// working; the first time it creates the viewer's pending Argenta connection.
func (s *Service) SaveCredentials(ctx context.Context, viewer int64, appID, keyPEM string) error {
	appID = strings.TrimSpace(appID)
	if !validAppID(appID) {
		return apperr.Invalid("Vul de application-id van je Enable Banking-app in.")
	}
	key := []byte(strings.TrimSpace(keyPEM))
	if len(key) == 0 {
		return apperr.Invalid("Kies het .pem-bestand met de privésleutel van je Enable Banking-app.")
	}
	c, err := s.open(viewer, appID, key)
	if err != nil {
		return apperr.Invalid("Dit is geen bruikbare privésleutel. Kies het .pem-bestand van je Enable Banking-app (een RSA-sleutel zonder wachtwoord).")
	}
	if err := c.CheckApplication(ctx); err != nil {
		return s.refusal("connection test", err,
			"Enable Banking aanvaardt deze application-id en sleutel niet. Kies de sleutel die bij deze app hoort.")
	}
	sealed := s.box.Seal(key)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE provider_connections SET application_id = ?, private_key_enc = ?
		WHERE user_id = ? AND status <> 'revoked'`, appID, sealed, viewer)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO provider_connections
			(user_id, provider, aspsp_name, aspsp_country, application_id, private_key_enc, status)
			VALUES (?, 'enablebanking', ?, ?, ?, ?, 'pending')`, viewer, aspspName, aspspCountry, appID, sealed); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// validAppID accepts what an application id looks like (a UUID) and nothing
// that could break the token header it goes into.
func validAppID(s string) bool {
	if s == "" || len(s) > 100 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.') {
			return false
		}
	}
	return true
}

// linkTarget is the connection a link is for: the viewer's connection id, or
// without one the viewer's Argenta connection (made with the credentials).
// Someone else's connection answers apperr.ErrNotFound.
func (s *Service) linkTarget(ctx context.Context, viewer, id int64) (connection, error) {
	q := `SELECT ` + connectionColumns + ` FROM provider_connections WHERE user_id = ? AND status <> 'revoked' AND `
	var row *sql.Row
	if id > 0 {
		row = s.db.QueryRowContext(ctx, q+`id = ?`, viewer, id)
	} else {
		row = s.db.QueryRowContext(ctx, q+`aspsp_name = ? ORDER BY id LIMIT 1`, viewer, aspspName)
	}
	c, err := scanConnection(row)
	if errors.Is(err, sql.ErrNoRows) {
		if id > 0 {
			return c, apperr.ErrNotFound
		}
		return c, apperr.Invalid(msgNotConfigured)
	}
	return c, err
}

// StartLink starts a consent for the connection (0: the viewer's Argenta
// connection) and returns the bank's consent page. The bank sends the browser
// back to redirectURL with a code and a state that only this viewer can use,
// once, within 15 minutes.
func (s *Service) StartLink(ctx context.Context, viewer, connectionID int64, redirectURL string) (string, error) {
	c, err := s.linkTarget(ctx, viewer, connectionID)
	if err != nil {
		return "", err
	}
	client, err := s.client(c)
	if errors.Is(err, ErrNotConfigured) {
		return "", apperr.Invalid(msgNotConfigured)
	}
	if err != nil {
		return "", err
	}
	if redirectURL == "" {
		return "", ErrNoRedirectURL
	}
	state := s.states.add(viewer, c.id)
	u, err := client.StartAuth(ctx, c.aspsp, c.country, state, redirectURL, s.now().AddDate(0, 0, consentDays))
	if err != nil {
		return "", s.refusal("start authorisation", err,
			"Enable Banking weigert de koppeling. Controleer of "+redirectURL+" als redirect-URL in je Enable Banking-app staat.")
	}
	return u, nil
}

// Linked is the outcome of a completed consent.
type Linked struct {
	Connection int64
	Accounts   []int64 // the accounts this consent feeds, new or matched again
	Skipped    []Skipped
}

// Skipped is an account of the consent that was not linked.
type Skipped struct {
	IBAN   string `json:"iban"`   // masked
	Reason string `json:"reason"` // "exists": the IBAN belongs to another user (joining is 0.6-1)
}

// Complete finishes the consent the bank redirected back with: it checks the
// state, creates the session, matches the accounts by IBAN and runs the first
// sync. A failing first sync keeps the link; the connection shows "failed".
func (s *Service) Complete(ctx context.Context, viewer int64, code, state string, now time.Time) (Linked, error) {
	id, ok := s.states.take(state, viewer)
	if !ok || code == "" {
		return Linked{}, apperr.Invalid(msgBadState)
	}
	c, err := s.linkTarget(ctx, viewer, id)
	if errors.Is(err, apperr.ErrNotFound) {
		return Linked{}, apperr.Invalid(msgBadState)
	}
	if err != nil {
		return Linked{}, err
	}
	client, err := s.client(c)
	if errors.Is(err, ErrNotConfigured) {
		return Linked{}, apperr.Invalid(msgNotConfigured)
	}
	if err != nil {
		return Linked{}, err
	}
	info, err := client.CreateSession(ctx, code)
	if err != nil {
		return Linked{}, s.refusal("create session", err, "De bank heeft de koppeling niet bevestigd. Begin opnieuw bij Bankkoppelingen.")
	}
	linked, err := s.storeConsent(ctx, c, info, now)
	if err != nil {
		return Linked{}, err
	}
	s.log.Info("bank linked", "connection", c.id, "accounts", len(linked.Accounts), "skipped", len(linked.Skipped))
	return linked, s.syncConnection(ctx, c.id, now)
}

// storeConsent stores the sealed session and matches the consent's accounts.
func (s *Service) storeConsent(ctx context.Context, c connection, info bank.SessionInfo, now time.Time) (Linked, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Linked{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE provider_connections
		SET session_id_enc = ?, consent_since = ?, valid_until = ?, status = 'active', last_error = NULL WHERE id = ?`,
		s.box.Seal([]byte(info.ID)), now.In(clock.Brussels).Format(time.DateOnly),
		info.ValidUntil.UTC().Format(time.RFC3339), c.id); err != nil {
		return Linked{}, err
	}
	// Account ids change per session: forget the old ones, so an account the
	// new consent leaves out is not fetched with a session that lacks it.
	if _, err := tx.ExecContext(ctx, `UPDATE account_sources SET external_account_id = NULL WHERE connection_id = ?`, c.id); err != nil {
		return Linked{}, err
	}
	linked := Linked{Connection: c.id, Accounts: []int64{}, Skipped: []Skipped{}}
	for _, a := range info.Accounts {
		iban := ledger.NormalizeIBAN(a.IBAN)
		if iban == "" {
			// verify in S1: Argenta always sends the IBAN.
			s.log.Warn("bank account without IBAN left out", "connection", c.id)
			continue
		}
		id, ok, err := match(ctx, tx, c, iban, a)
		if err != nil {
			return Linked{}, err
		}
		switch {
		case !ok:
			linked.Skipped = append(linked.Skipped, Skipped{IBAN: ledger.MaskIBAN(iban), Reason: "exists"})
		case !slices.Contains(linked.Accounts, id):
			linked.Accounts = append(linked.Accounts, id)
		}
	}
	return linked, tx.Commit()
}

// match links one account by IBAN: a new IBAN becomes a current account that
// the viewer manages; an IBAN this connection already feeds gets its new
// provider id (re-authorisation); an IBAN of anyone else is not linked (ok
// false).
func match(ctx context.Context, tx *sql.Tx, c connection, iban string, a bank.Account) (id int64, ok bool, err error) {
	err = tx.QueryRowContext(ctx, `SELECT id FROM accounts WHERE source = 'bank' AND iban = ?`, iban).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		// Another user linking the same new IBAN at the same moment is the
		// "exists" skip, not a unique-index error.
		res, err := tx.ExecContext(ctx, `INSERT INTO accounts (type, source, iban, name, currency, bank_name, created_by)
			VALUES ('current', 'bank', ?, ?, ?, ?, ?) ON CONFLICT (iban) WHERE source = 'bank' DO NOTHING`,
			iban, accountName(a.Name), cmp.Or(a.Currency, "EUR"), cmp.Or(a.Bank, c.aspsp), c.user)
		if err != nil {
			return 0, false, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, false, nil
		}
		if id, err = res.LastInsertId(); err != nil {
			return 0, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO account_access (account_id, user_id, role, permission)
			VALUES (?, ?, 'manager', 'edit')`, id, c.user); err != nil {
			return 0, false, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO account_sources (account_id, connection_id, priority, external_account_id)
			VALUES (?, ?, 'primary', ?)`, id, c.id, a.ID)
		return id, err == nil, err
	}
	if err != nil {
		return 0, false, err
	}
	res, err := tx.ExecContext(ctx, `UPDATE account_sources SET external_account_id = ? WHERE account_id = ? AND connection_id = ?`,
		a.ID, id, c.id)
	if err != nil {
		return 0, false, err
	}
	n, _ := res.RowsAffected()
	return id, n > 0, nil
}

// accountName is the bank's product name, cut to what an account name may be.
func accountName(product string) string {
	name := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(product))
	if r := []rune(name); len(r) > 40 {
		name = strings.TrimSpace(string(r[:40]))
	}
	if name == "" {
		return "Zichtrekening"
	}
	return name
}

// refusal turns a provider error into what the user sees: a request the
// provider refused (4xx) is invalid with the Dutch message; anything else (a
// server error, a rate limit, no network) means it is unavailable. Only the
// error code is logged.
func (s *Service) refusal(op string, err error, message string) error {
	var api *enablebanking.APIError
	if errors.As(err, &api) && api.Status >= 400 && api.Status < 500 && api.Status != http.StatusTooManyRequests {
		s.log.Warn("bank provider refused", "op", op, "code", errorCode(err))
		return apperr.Invalid(message)
	}
	s.log.Warn("bank provider unavailable", "op", op, "code", errorCode(err))
	return ErrUnavailable
}
