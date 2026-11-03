package fake

import (
	"context"
	"errors"
	"math/big"
	"reflect"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
)

func TestDeterministic(t *testing.T) {
	ctx := context.Background()
	p := Provider{}
	s := bank.Session{ID: SessionBert}
	accs, err := p.ListAccounts(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	first, _ := p.FetchTransactions(ctx, s, accs[0].ID, StoryStart, StoryEnd)
	second, _ := p.FetchTransactions(ctx, s, accs[0].ID, StoryStart, StoryEnd)
	if len(first) < 100 || !reflect.DeepEqual(first, second) {
		t.Fatalf("want the same long history twice, got %d and %d rows", len(first), len(second))
	}
}

func TestSessionsAndAccounts(t *testing.T) {
	ctx := context.Background()
	p := Provider{}
	bert, _ := p.ListAccounts(ctx, bank.Session{ID: SessionBert})
	partner, _ := p.ListAccounts(ctx, bank.Session{ID: SessionPartner})
	if len(bert) != 2 || bert[0].IBAN != IBANBertCurrent || bert[1].IBAN != IBANShared {
		t.Fatalf("Bert's consent: %+v", bert)
	}
	if len(partner) != 2 || partner[0].IBAN != IBANPartnerCurrent || partner[1].IBAN != IBANShared {
		t.Fatalf("Partner's consent: %+v", partner)
	}
	if bert[1].ID == partner[1].ID {
		t.Error("account ids must differ per session, like a real provider")
	}
	// A session cannot read an account of another consent.
	if _, err := p.FetchTransactions(ctx, bank.Session{ID: SessionBert}, partner[0].ID, StoryStart, StoryEnd); err == nil {
		t.Error("Bert's session read Partner's account")
	}
	if _, err := p.ListAccounts(ctx, bank.Session{ID: "nope"}); !errors.Is(err, bank.ErrSessionExpired) {
		t.Errorf("unknown session: %v", err)
	}
	// Both consents see the same shared rows, with the same references.
	a, _ := p.FetchTransactions(ctx, bank.Session{ID: SessionBert}, bert[1].ID, StoryStart, StoryEnd)
	b, _ := p.FetchTransactions(ctx, bank.Session{ID: SessionPartner}, partner[1].ID, StoryStart, StoryEnd)
	if !reflect.DeepEqual(a, b) {
		t.Error("the shared account differs between consents")
	}
	bal, _ := p.FetchBalances(ctx, bank.Session{ID: SessionBert}, bert[0].ID)
	if len(bal) != 1 || bal[0].Amount != 196882 || bal[0].Date != StoryEnd {
		t.Errorf("balance: %+v", bal)
	}
}

func TestRecentRows(t *testing.T) {
	ctx := context.Background()
	p := Provider{}
	s := bank.Session{ID: SessionBert}
	accs, _ := p.ListAccounts(ctx, s)
	var rows []bank.Transaction
	for _, a := range accs {
		tx, err := p.FetchTransactions(ctx, s, a.ID, "2026-11-12", "2026-11-18")
		if err != nil {
			t.Fatal(err)
		}
		rows = append(rows, tx...)
	}
	if len(rows) != 16 {
		t.Fatalf("Bert's accounts have %d rows on 12–18 Nov, want the 16 of the design", len(rows))
	}
	pending := 0
	for _, r := range rows {
		if r.Status == bank.StatusPending {
			pending++
			if r.CounterpartyName != "Bol.com" || r.EntryReference != "" {
				t.Errorf("unexpected pending row %+v", r)
			}
		} else if r.EntryReference == "" {
			t.Errorf("booked row without reference: %+v", r)
		}
	}
	if pending != 1 {
		t.Errorf("pending rows: %d", pending)
	}
}

func TestDateRange(t *testing.T) {
	ctx := context.Background()
	p := Provider{}
	s := bank.Session{ID: SessionPartner}
	accs, _ := p.ListAccounts(ctx, s)
	rows, _ := p.FetchTransactions(ctx, s, accs[0].ID, "2026-10-01", "2026-10-31")
	if len(rows) == 0 {
		t.Fatal("no rows in October")
	}
	for i, r := range rows {
		if r.BookingDate < "2026-10-01" || r.BookingDate > "2026-10-31" {
			t.Errorf("row outside the range: %+v", r)
		}
		if i > 0 && r.BookingDate > rows[i-1].BookingDate {
			t.Error("rows are not newest first")
		}
	}
}

// The demo IBANs must fail the IBAN check, so they can never be a real account.
func TestDemoIBANsAreNotRealIBANs(t *testing.T) {
	for _, iban := range []string{IBANBertCurrent, IBANShared, IBANPartnerCurrent, IBANSavings} {
		if validIBAN(iban) {
			t.Errorf("%s passes the IBAN check; change its digits", iban)
		}
	}
	if !validIBAN("BE71096123456769") { // the documented example IBAN
		t.Error("validIBAN is broken")
	}
}

func validIBAN(s string) bool {
	r := s[4:] + s[:4]
	digits := ""
	for _, c := range r {
		if c >= 'A' && c <= 'Z' {
			digits += big.NewInt(int64(c - 'A' + 10)).String()
		} else {
			digits += string(c)
		}
	}
	n, ok := new(big.Int).SetString(digits, 10)
	return ok && new(big.Int).Mod(n, big.NewInt(97)).Int64() == 1
}
