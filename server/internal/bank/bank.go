// Package bank defines the provider adapter that every bank data source
// implements (analysis 6.4): list the accounts of a consent, fetch their
// transactions and fetch their balances.
//
// Two implementations are planned. The fake provider in package bank/fake
// serves the demo story for local development, demo mode and tests, so CI
// never calls a real bank. The Enable Banking client (JWT RS256 signed with
// the user's own application key) arrives with the first real bank link in
// phase 0.2-6 and implements the same interface; CSV imports feed the same
// pipeline later.
package bank

import (
	"context"
	"encoding/json"
	"errors"
)

// Status of a transaction at the bank.
const (
	StatusPending = "pending"
	StatusBooked  = "booked"
)

// ErrSessionExpired means the consent or provider session is no longer valid
// and the user has to re-authorise (Enable Banking's EXPIRED_SESSION).
var ErrSessionExpired = errors.New("bank: session expired")

// Session identifies an authorised consent at the provider.
type Session struct {
	ID string
}

// Account is a bank account as the provider reports it.
type Account struct {
	ID       string // provider id; changes per session, so match on IBAN
	IBAN     string // upper case, no spaces
	Name     string // the bank's product name
	Currency string
	Bank     string // the bank's display name, for example "Argenta"
}

// Transaction is one bank movement. Amounts are signed cents (negative is
// money going out); dates are YYYY-MM-DD.
type Transaction struct {
	EntryReference   string // the bank's id for booked rows; often empty while pending
	BookingDate      string
	ValueDate        string
	Amount           int64
	Currency         string
	CounterpartyName string
	CounterpartyIBAN string // upper case, no spaces; empty when unknown
	Communication    string
	Status           string          // StatusPending or StatusBooked
	Raw              json.RawMessage // the provider's original payload
}

// Balance is a bank-reported balance in cents on a date.
type Balance struct {
	Amount int64
	Date   string
	Type   string // the provider's balance type, for example "CLBD"
}

// Provider is the bank data source of one provider.
type Provider interface {
	// ListAccounts returns the accounts the consent covers.
	ListAccounts(ctx context.Context, s Session) ([]Account, error)
	// FetchTransactions returns the account's transactions booked between
	// from and to (inclusive, YYYY-MM-DD), newest first, all pages joined.
	FetchTransactions(ctx context.Context, s Session, accountID, from, to string) ([]Transaction, error)
	// FetchBalances returns the account's current balances.
	FetchBalances(ctx context.Context, s Session, accountID string) ([]Balance, error)
}
