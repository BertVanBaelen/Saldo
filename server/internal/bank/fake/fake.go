// Package fake is a bank.Provider that serves the demo story (analysis
// section 12, analysis/concepts/demo-data.md) without any network access. It
// is used in demo mode, for local development and in tests; CI never talks to
// a real bank. The story is fully deterministic: the same call always returns
// the same data.
package fake

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// Demo sessions, one consent per demo user.
const (
	SessionBert    = "demo-bert"
	SessionPartner = "demo-partner"
)

// Bank is the demo bank's display name.
const Bank = "Argenta"

// Demo IBANs. They are deliberately invalid (the check digits do not match),
// so they can never belong to a real account; only the masked form
// (country, check digits and the last four digits) matches the design.
const (
	IBANBertCurrent    = "BE68000000004821" // Bert's Zichtrekening
	IBANShared         = "BE12000000007730" // Gedeelde rekening (Bert and Partner)
	IBANPartnerCurrent = "BE71000000005038" // Partner's Zichtrekening
	IBANSavings        = "BE41000000001196" // Bert's Spaarrekening (manual, never at the bank API)
)

// Story bounds: the first month of history and the demo date.
const (
	StoryStart = "2025-11-01"
	StoryEnd   = "2026-11-18"
)

// Bank-reported balances on StoryEnd, in cents.
var balances = map[string]int64{
	IBANBertCurrent:    196882,
	IBANShared:         94608,
	IBANPartnerCurrent: 143215,
}

// Which accounts each consent covers. The shared account is in both.
var sessions = map[string][]string{
	SessionBert:    {IBANBertCurrent, IBANShared},
	SessionPartner: {IBANPartnerCurrent, IBANShared},
}

var productNames = map[string]string{
	IBANBertCurrent:    "Zichtrekening",
	IBANShared:         "Zichtrekening",
	IBANPartnerCurrent: "Zichtrekening",
}

// Provider serves the demo story. The zero value is ready to use.
type Provider struct{}

var _ bank.Provider = Provider{}

// accountID is the provider's account id: like a real provider it differs
// per session, so callers must match accounts on IBAN.
func accountID(session, iban string) string {
	return session + "-" + strings.ToLower(iban[len(iban)-4:])
}

func ibanFor(s bank.Session, id string) (string, error) {
	ibans, ok := sessions[s.ID]
	if !ok {
		return "", bank.ErrSessionExpired
	}
	for _, iban := range ibans {
		if accountID(s.ID, iban) == id {
			return iban, nil
		}
	}
	return "", fmt.Errorf("fake: unknown account %q", id)
}

// ListAccounts returns the accounts of the session's consent.
func (Provider) ListAccounts(ctx context.Context, s bank.Session) ([]bank.Account, error) {
	ibans, ok := sessions[s.ID]
	if !ok {
		return nil, bank.ErrSessionExpired
	}
	out := make([]bank.Account, 0, len(ibans))
	for _, iban := range ibans {
		out = append(out, bank.Account{
			ID: accountID(s.ID, iban), IBAN: iban, Name: productNames[iban], Currency: "EUR", Bank: Bank,
		})
	}
	return out, nil
}

// FetchTransactions returns the account's story rows between from and to,
// newest first and, within a day, in the story's display order.
func (Provider) FetchTransactions(ctx context.Context, s bank.Session, id, from, to string) ([]bank.Transaction, error) {
	iban, err := ibanFor(s, id)
	if err != nil {
		return nil, err
	}
	var out []bank.Transaction
	for _, r := range story() {
		if r.account != iban || r.date < from || r.date > to {
			continue
		}
		out = append(out, r.transaction())
	}
	return out, nil
}

// FetchBalances returns the closing booked balance on the demo date.
func (Provider) FetchBalances(ctx context.Context, s bank.Session, id string) ([]bank.Balance, error) {
	iban, err := ibanFor(s, id)
	if err != nil {
		return nil, err
	}
	return []bank.Balance{{Amount: balances[iban], Date: StoryEnd, Type: "CLBD"}}, nil
}

// transaction renders a story row as the provider would return it, with a raw
// payload shaped like the Enable Banking transaction object.
func (r row) transaction() bank.Transaction {
	t := bank.Transaction{
		EntryReference:   r.ref,
		BookingDate:      r.date,
		ValueDate:        r.date,
		Amount:           r.amount,
		Currency:         "EUR",
		CounterpartyName: r.name,
		CounterpartyIBAN: r.iban,
		Communication:    r.comm,
		Status:           bank.StatusBooked,
	}
	if r.pending {
		t.Status = bank.StatusPending
	}
	t.Raw = rawPayload(t)
	return t
}

func rawPayload(t bank.Transaction) json.RawMessage {
	abs := t.Amount
	indicator, party, partyAccount := "DBIT", "creditor", "creditor_account"
	if abs >= 0 {
		indicator, party, partyAccount = "CRDT", "debtor", "debtor_account"
	} else {
		abs = -abs
	}
	status := "BOOK"
	if t.Status == bank.StatusPending {
		status = "PDNG"
	}
	m := map[string]any{
		"transaction_amount":     map[string]string{"currency": t.Currency, "amount": fmt.Sprintf("%d.%02d", abs/100, abs%100)},
		"credit_debit_indicator": indicator,
		"status":                 status,
		"booking_date":           t.BookingDate,
		"value_date":             t.ValueDate,
		party:                    map[string]string{"name": t.CounterpartyName},
		"remittance_information": []string{t.Communication},
	}
	if t.EntryReference != "" {
		m["entry_reference"] = t.EntryReference
	}
	if t.CounterpartyIBAN != "" {
		m[partyAccount] = map[string]string{"iban": t.CounterpartyIBAN}
	}
	b, err := json.Marshal(m)
	if err != nil {
		panic(err)
	}
	return b
}
