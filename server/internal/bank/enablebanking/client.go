// Package enablebanking is the bank.Provider for the Enable Banking API
// (analysis 6.1, 6.2): it signs its own JWT with the user's application key,
// starts and completes the consent at the bank, and reads accounts,
// transactions and balances.
//
// It is built from the public API reference only. Assumptions that only a
// real consent can confirm are marked "verify in S1" (spike 0.2-1).
package enablebanking

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// DefaultBaseURL is the production API.
const DefaultBaseURL = "https://api.enablebanking.com"

const (
	// tokenLifetime stays well under the provider's 24 h maximum, so a leaked
	// token is short-lived and clock skew never pushes it over the limit.
	tokenLifetime = time.Hour
	// renewBefore renews the cached token early, so a slow request never
	// carries one that expires on the way.
	renewBefore = 5 * time.Minute
	// maxBody bounds how much of one response is read.
	maxBody = 32 << 20
)

// Client talks to Enable Banking as one application. It is safe for
// concurrent use; change BaseURL, HTTP or Now only before the first call.
type Client struct {
	BaseURL string           // DefaultBaseURL unless a test overrides it
	HTTP    *http.Client     // has a timeout; the caller's ctx can cut it shorter
	Now     func() time.Time // token times; the real time, never demo mode's fixed date

	appID string
	key   *rsa.PrivateKey

	mu       sync.Mutex
	token    string
	tokenExp time.Time
}

var _ bank.Provider = (*Client)(nil)

// New returns a client for the application id and its RSA private key in
// PEM form, PKCS#1 ("RSA PRIVATE KEY") or PKCS#8 ("PRIVATE KEY").
func New(appID string, keyPEM []byte) (*Client, error) {
	if appID == "" {
		return nil, errors.New("enablebanking: empty application id")
	}
	key, err := parseKey(keyPEM)
	if err != nil {
		return nil, err
	}
	return &Client{
		BaseURL: DefaultBaseURL,
		// verify in S1: strategy=longest makes extra calls to the bank, so
		// a first sync may need this much.
		HTTP:  &http.Client{Timeout: 60 * time.Second},
		Now:   time.Now,
		appID: appID,
		key:   key,
	}, nil
}

// parseKey reads the first PEM block. Its errors never quote the key.
func parseKey(keyPEM []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(keyPEM)
	if block == nil {
		return nil, errors.New("enablebanking: private key is not in PEM format")
	}
	if _, ok := block.Headers["Proc-Type"]; ok {
		return nil, errors.New("enablebanking: private key is encrypted; upload it without a passphrase")
	}
	switch block.Type {
	case "RSA PRIVATE KEY":
		key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("enablebanking: invalid PKCS#1 private key: %w", err)
		}
		return key, nil
	case "PRIVATE KEY":
		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("enablebanking: invalid PKCS#8 private key: %w", err)
		}
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, errors.New("enablebanking: private key is not an RSA key")
		}
		return rsaKey, nil
	}
	return nil, fmt.Errorf("enablebanking: PEM block is %q, want RSA PRIVATE KEY or PRIVATE KEY", block.Type)
}

// bearer returns the cached JWT, signing a new one when it nears expiry.
func (c *Client) bearer() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.Now()
	if c.token != "" && now.Before(c.tokenExp.Add(-renewBefore)) {
		return c.token, nil
	}
	iat := now.Truncate(time.Second)
	exp := iat.Add(tokenLifetime)
	token, err := signJWT(c.key, c.appID, iat, exp)
	if err != nil {
		return "", err
	}
	c.token, c.tokenExp = token, exp
	return token, nil
}

// signJWT builds the RS256 token the API reference asks for; a JWT library
// would be a dependency for twenty lines.
func signJWT(key *rsa.PrivateKey, kid string, iat, exp time.Time) (string, error) {
	// Marshalling maps of strings and numbers cannot fail.
	header, _ := json.Marshal(map[string]string{"typ": "JWT", "alg": "RS256", "kid": kid})
	claims, _ := json.Marshal(map[string]any{
		"iss": "enablebanking.com",
		"aud": "api.enablebanking.com",
		"iat": iat.Unix(),
		"exp": exp.Unix(),
	})
	enc := base64.RawURLEncoding
	unsigned := enc.EncodeToString(header) + "." + enc.EncodeToString(claims)
	sum := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(nil, key, crypto.SHA256, sum[:])
	if err != nil {
		return "", fmt.Errorf("enablebanking: sign token: %w", err)
	}
	return unsigned + "." + enc.EncodeToString(sig), nil
}

// APIError is a non-2xx answer other than a lapsed session. It carries only
// the status and the provider's error code, never the token, the key or the
// body, so it is safe to log and to show.
type APIError struct {
	Op     string // what the client was doing, for example "fetch transactions"
	Status int    // HTTP status
	Code   string // the provider's error code, for example "ASPSP_RATE_LIMIT_EXCEEDED"; may be empty
}

func (e *APIError) Error() string {
	msg := fmt.Sprintf("enablebanking: %s: HTTP %d", e.Op, e.Status)
	if e.Code != "" {
		msg += " " + e.Code
	}
	return msg
}

// sessionGone are the error codes after which only a new consent helps.
// verify in S1: which of these the account endpoints really send, and with
// which HTTP status (the reference does not say).
var sessionGone = map[string]bool{
	"EXPIRED_SESSION":        true,
	"CLOSED_SESSION":         true,
	"REVOKED_SESSION":        true,
	"SESSION_DOES_NOT_EXIST": true,
}

// do sends one request and decodes a 2xx JSON answer into out. op names the
// call in errors, which never contain the URL: it holds the session id.
func (c *Client) do(ctx context.Context, op, method, path string, query url.Values, body, out any) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("enablebanking: %s: %w", op, err)
		}
		reqBody = bytes.NewReader(b)
	}
	u := strings.TrimRight(c.BaseURL, "/") + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, reqBody)
	if err != nil {
		return fmt.Errorf("enablebanking: %s: %w", op, unwrapURL(err))
	}
	token, err := c.bearer()
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("enablebanking: %s: %w", op, unwrapURL(err))
	}
	defer resp.Body.Close()
	r := io.LimitReader(resp.Body, maxBody)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(r).Decode(&e) // a body that is not JSON still yields the status
		if sessionGone[e.Error] {
			return fmt.Errorf("enablebanking: %s: %s: %w", op, e.Error, bank.ErrSessionExpired)
		}
		return &APIError{Op: op, Status: resp.StatusCode, Code: e.Error}
	}
	if err := json.NewDecoder(r).Decode(out); err != nil {
		return fmt.Errorf("enablebanking: %s: decode response: %w", op, err)
	}
	return nil
}

// unwrapURL drops the URL from a transport error and keeps the cause, so
// errors.Is still sees context.Canceled or DeadlineExceeded.
func unwrapURL(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err
	}
	return err
}

// SessionInfo is a completed consent: the session to sync with, the accounts
// the user shared and the moment the consent lapses.
type SessionInfo struct {
	ID         string // the credential for the Provider methods, as bank.Session{ID: ID}
	Accounts   []bank.Account
	ValidUntil time.Time
}

// validUntilLayout matches the reference's example, "2025-12-01T12:00:00.000000+00:00".
const validUntilLayout = "2006-01-02T15:04:05.000000-07:00"

// StartAuth starts a consent for a personal account at the bank (aspspName
// and country as Enable Banking lists them, for example "Argenta" and "BE")
// and returns the bank's URL to send the user to. The bank sends the browser
// back to redirectURL with a code and the same state. validUntil is the
// longest consent the caller wants.
func (c *Client) StartAuth(ctx context.Context, aspspName, country, state, redirectURL string, validUntil time.Time) (string, error) {
	req := map[string]any{
		// verify in S1: a valid_until past the bank's maximum (about 180
		// days for Argenta) is refused rather than shortened.
		"access":       map[string]string{"valid_until": validUntil.UTC().Format(validUntilLayout)},
		"aspsp":        map[string]string{"name": aspspName, "country": country},
		"state":        state,
		"redirect_url": redirectURL,
		"psu_type":     "personal",
	}
	var resp struct {
		URL string `json:"url"`
	}
	if err := c.do(ctx, "start authorisation", http.MethodPost, "/auth", nil, req, &resp); err != nil {
		return "", err
	}
	if resp.URL == "" {
		return "", errors.New("enablebanking: start authorisation: no redirect URL in the response")
	}
	return resp.URL, nil
}

// CreateSession completes the consent with the code from the bank's
// redirect and returns the new session and the accounts the user shared.
func (c *Client) CreateSession(ctx context.Context, code string) (SessionInfo, error) {
	var resp struct {
		SessionID string            `json:"session_id"`
		Accounts  []accountResource `json:"accounts"`
		ASPSP     struct {
			Name string `json:"name"`
		} `json:"aspsp"`
		Access struct {
			ValidUntil string `json:"valid_until"`
		} `json:"access"`
	}
	if err := c.do(ctx, "create session", http.MethodPost, "/sessions", nil, map[string]string{"code": code}, &resp); err != nil {
		return SessionInfo{}, err
	}
	if resp.SessionID == "" {
		return SessionInfo{}, errors.New("enablebanking: create session: no session id in the response")
	}
	validUntil, err := time.Parse(time.RFC3339, resp.Access.ValidUntil)
	if err != nil {
		return SessionInfo{}, fmt.Errorf("enablebanking: create session: valid_until: %w", err)
	}
	info := SessionInfo{ID: resp.SessionID, ValidUntil: validUntil}
	for _, a := range resp.Accounts {
		info.Accounts = append(info.Accounts, a.account(resp.ASPSP.Name))
	}
	return info, nil
}

// accountResource is the provider's account object.
type accountResource struct {
	UID       string `json:"uid"`
	AccountID struct {
		IBAN string `json:"iban"`
	} `json:"account_id"`
	Product  string `json:"product"`
	Details  string `json:"details"`
	Currency string `json:"currency"`
}

func (a accountResource) account(bankName string) bank.Account {
	// The provider's "name" is the holder's name, not the account's.
	// verify in S1: Argenta fills product (or at least details).
	name := a.Product
	if name == "" {
		name = a.Details
	}
	return bank.Account{
		ID:       a.UID,
		IBAN:     normIBAN(a.AccountID.IBAN), // verify in S1: Argenta always sends the IBAN, never only "other"
		Name:     name,
		Currency: a.Currency,
		Bank:     bankName,
	}
}

func normIBAN(s string) string {
	return strings.ToUpper(strings.ReplaceAll(s, " ", ""))
}
