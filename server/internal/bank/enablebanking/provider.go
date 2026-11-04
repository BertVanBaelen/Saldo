package enablebanking

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

// ListAccounts returns the accounts of the session's consent. The session
// lists only account ids, so each account costs one more call for its
// details; call it when linking, not on every sync.
func (c *Client) ListAccounts(ctx context.Context, s bank.Session) ([]bank.Account, error) {
	var sess struct {
		Status   string   `json:"status"`
		Accounts []string `json:"accounts"`
		ASPSP    struct {
			Name string `json:"name"`
		} `json:"aspsp"`
	}
	if err := c.do(ctx, "get session", http.MethodGet, "/sessions/"+url.PathEscape(s.ID), nil, nil, &sess); err != nil {
		return nil, err
	}
	// Any other status (EXPIRED, REVOKED, CLOSED, ...) needs a new consent.
	// verify in S1: a lapsed session answers 200 with its status here rather
	// than an error code.
	if sess.Status != "AUTHORIZED" {
		return nil, fmt.Errorf("enablebanking: get session: status %q: %w", sess.Status, bank.ErrSessionExpired)
	}
	out := make([]bank.Account, 0, len(sess.Accounts))
	for _, uid := range sess.Accounts {
		var a accountResource
		// verify in S1: details count against the bank's daily access limit.
		if err := c.do(ctx, "get account details", http.MethodGet, "/accounts/"+url.PathEscape(uid)+"/details", nil, nil, &a); err != nil {
			return nil, err
		}
		a.UID = uid
		out = append(out, a.account(sess.ASPSP.Name))
	}
	return out, nil
}

// FetchTransactions returns the account's transactions between from and to,
// newest first, all pages joined. An empty from asks for the longest history
// the bank gives (strategy=longest), meant for the first sync after a
// consent; later syncs pass a date and fetch only that window, because
// "longest" costs extra calls to the bank.
func (c *Client) FetchTransactions(ctx context.Context, _ bank.Session, accountID, from, to string) ([]bank.Transaction, error) {
	q := url.Values{}
	if from == "" {
		// The provider ignores date_to with this strategy; rows after to
		// are dropped below. verify in S1: how far back it reaches for
		// Argenta.
		q.Set("strategy", "longest")
	} else {
		q.Set("date_from", from)
		if to != "" {
			q.Set("date_to", to)
		}
	}
	path := "/accounts/" + url.PathEscape(accountID) + "/transactions"
	var out []bank.Transaction
	for {
		var page struct {
			Transactions    []json.RawMessage `json:"transactions"`
			ContinuationKey string            `json:"continuation_key"`
		}
		if err := c.do(ctx, "fetch transactions", http.MethodGet, path, q, nil, &page); err != nil {
			return nil, err
		}
		for _, raw := range page.Transactions {
			t, ok, err := transaction(raw)
			if err != nil {
				return nil, err
			}
			// Pending rows often have no booking date yet; keep them.
			if ok && (to == "" || t.BookingDate <= to) {
				out = append(out, t)
			}
		}
		if page.ContinuationKey == "" {
			break
		}
		// A key that does not move on would loop until the timeout.
		if page.ContinuationKey == q.Get("continuation_key") {
			return nil, errors.New("enablebanking: fetch transactions: the provider repeated its continuation key")
		}
		// verify in S1: the next page wants the same date and strategy
		// parameters next to the key.
		q.Set("continuation_key", page.ContinuationKey)
	}
	// verify in S1: the order the provider returns; within a day the
	// provider's order is kept.
	sort.SliceStable(out, func(i, j int) bool { return sortDate(out[i]) > sortDate(out[j]) })
	return out, nil
}

// sortDate orders a row by its booking date, or by its value date while it is
// pending; a row with neither is pending at the bank, so it is the newest.
func sortDate(t bank.Transaction) string {
	switch {
	case t.BookingDate != "":
		return t.BookingDate
	case t.ValueDate != "":
		return t.ValueDate
	}
	return "9999-12-31"
}

// FetchBalances returns the account's balances as the bank reports them.
func (c *Client) FetchBalances(ctx context.Context, _ bank.Session, accountID string) ([]bank.Balance, error) {
	var resp struct {
		Balances []struct {
			Amount        amount `json:"balance_amount"`
			Type          string `json:"balance_type"`
			ReferenceDate string `json:"reference_date"`
			LastChange    string `json:"last_change_date_time"`
		} `json:"balances"`
	}
	if err := c.do(ctx, "fetch balances", http.MethodGet, "/accounts/"+url.PathEscape(accountID)+"/balances", nil, nil, &resp); err != nil {
		return nil, err
	}
	out := make([]bank.Balance, 0, len(resp.Balances))
	for _, b := range resp.Balances {
		// verify in S1: a balance carries its own sign ("-12.30"); there is
		// no credit/debit indicator on it.
		cents, err := parseCents(b.Amount.Amount)
		if err != nil {
			return nil, err
		}
		// verify in S1: which of the two dates Argenta fills.
		date := b.ReferenceDate
		if date == "" && len(b.LastChange) >= len("2006-01-02") {
			date = b.LastChange[:len("2006-01-02")]
		}
		out = append(out, bank.Balance{Amount: cents, Date: date, Type: b.Type})
	}
	return out, nil
}

type amount struct {
	Currency string `json:"currency"`
	Amount   string `json:"amount"`
}

type party struct {
	Name string `json:"name"`
}

type accountRef struct {
	IBAN string `json:"iban"`
}

// txRow is the part of the provider's transaction object that is mapped.
type txRow struct {
	EntryReference  string     `json:"entry_reference"`
	Amount          amount     `json:"transaction_amount"`
	Indicator       string     `json:"credit_debit_indicator"`
	Status          string     `json:"status"`
	BookingDate     string     `json:"booking_date"`
	ValueDate       string     `json:"value_date"`
	Creditor        party      `json:"creditor"`
	CreditorAccount accountRef `json:"creditor_account"`
	Debtor          party      `json:"debtor"`
	DebtorAccount   accountRef `json:"debtor_account"`
	Remittance      []string   `json:"remittance_information"`
}

// statuses maps the provider's transaction status to ours. HOLD (a card
// reservation) and OTHR (unknown) are shown as pending, which keeps them out
// of the totals; CNCL, RJCT and SCHD never moved money and are skipped.
// verify in S1: which statuses Argenta sends.
var statuses = map[string]string{
	"BOOK": bank.StatusBooked,
	"PDNG": bank.StatusPending,
	"HOLD": bank.StatusPending,
	"OTHR": bank.StatusPending,
}

// transaction maps one provider row; ok is false for a row that is skipped.
func transaction(raw json.RawMessage) (t bank.Transaction, ok bool, err error) {
	var r txRow
	if err := json.Unmarshal(raw, &r); err != nil {
		return t, false, fmt.Errorf("enablebanking: decode transaction: %w", err)
	}
	status, ok := statuses[r.Status]
	if !ok {
		return t, false, nil
	}
	cents, err := parseCents(r.Amount.Amount)
	if err != nil {
		return t, false, err
	}
	// The sign comes from the indicator. verify in S1: amounts are
	// unsigned; a signed one is made absolute first, so it cannot flip twice.
	if cents < 0 {
		cents = -cents
	}
	// The counterparty is whoever is on the other side: the creditor of
	// money going out, the debtor of money coming in.
	who, acct := r.Debtor, r.DebtorAccount
	switch r.Indicator {
	case "DBIT":
		cents, who, acct = -cents, r.Creditor, r.CreditorAccount
	case "CRDT":
	default:
		return t, false, fmt.Errorf("enablebanking: transaction has credit_debit_indicator %q", r.Indicator)
	}
	return bank.Transaction{
		EntryReference:   r.EntryReference,
		BookingDate:      r.BookingDate,
		ValueDate:        r.ValueDate,
		Amount:           cents,
		Currency:         r.Amount.Currency,
		CounterpartyName: strings.TrimSpace(who.Name),
		CounterpartyIBAN: normIBAN(acct.IBAN),
		Communication:    communication(r.Remittance),
		Status:           status,
		Raw:              raw,
	}, true, nil
}

// communication joins the remittance lines with a space.
// verify in S1: Argenta does not split a word or a structured communication
// (+++123/4567/89012+++) across lines, which the space would break.
func communication(lines []string) string {
	parts := make([]string, 0, len(lines))
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			parts = append(parts, l)
		}
	}
	return strings.Join(parts, " ")
}

// parseCents turns the provider's decimal string ("12.3", "-0.05", "1234")
// into cents without floats, which round. More than two decimals are only
// accepted as trailing zeros.
func parseCents(s string) (int64, error) {
	digits := s
	neg := false
	if digits != "" && (digits[0] == '-' || digits[0] == '+') {
		neg, digits = digits[0] == '-', digits[1:]
	}
	whole, frac, dot := strings.Cut(digits, ".")
	if whole == "" || (dot && frac == "") || !isDigits(whole) || !isDigits(frac) {
		return 0, fmt.Errorf("enablebanking: invalid amount %q", s)
	}
	frac = strings.TrimRight(frac, "0")
	if len(frac) > 2 {
		return 0, fmt.Errorf("enablebanking: amount %q has more than two decimals", s)
	}
	frac += strings.Repeat("0", 2-len(frac))
	n, err := strconv.ParseInt(whole+frac, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("enablebanking: invalid amount %q", s)
	}
	if neg {
		n = -n
	}
	return n, nil
}

func isDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}
