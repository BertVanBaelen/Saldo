package banklink

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/enablebanking"
)

func TestStates(t *testing.T) {
	now := time.Date(2026, 11, 18, 19, 0, 0, 0, time.UTC)
	s := &states{now: func() time.Time { return now }}

	a := s.add(1, 7)
	if len(a) < 40 || strings.ContainsAny(a, "+/=") {
		t.Errorf("state %q is not 32 random bytes in base64url", a)
	}
	if len(s.list) != 1 || strings.Contains(s.list[0].hash, a) {
		t.Fatal("the state must be kept hashed")
	}
	if c, ok := s.take(a, 1); !ok || c != 7 {
		t.Fatalf("own state: %d, %v", c, ok)
	}
	if _, ok := s.take(a, 1); ok {
		t.Error("a used state works again")
	}
	if _, ok := s.take("unknown", 1); ok {
		t.Error("an unknown state works")
	}

	b := s.add(1, 7)
	if _, ok := s.take(b, 2); ok {
		t.Error("someone else's state works")
	}
	if _, ok := s.take(b, 1); ok {
		t.Error("a state shown by someone else must be spent")
	}

	c := s.add(1, 7)
	now = now.Add(stateTTL)
	if _, ok := s.take(c, 1); ok {
		t.Error("an expired state works")
	}
	s.add(1, 7)
	now = now.Add(stateTTL)
	s.add(1, 7)
	if len(s.list) != 1 {
		t.Errorf("expired states are not swept: %d left", len(s.list))
	}
}

func TestPickBalance(t *testing.T) {
	b := func(typ, date string, amount int64) bank.Balance {
		return bank.Balance{Type: typ, Date: date, Amount: amount}
	}
	cases := []struct {
		name string
		in   []bank.Balance
		want int64
	}{
		{"closing booked over available", []bank.Balance{b("ITAV", "2026-11-18", 1), b("CLBD", "2026-11-17", 2)}, 2},
		{"newer booked wins", []bank.Balance{b("ITBD", "2026-11-16", 1), b("CLBD", "2026-11-17", 2)}, 2},
		{"interim on the same date", []bank.Balance{b("CLBD", "2026-11-17", 1), b("ITBD", "2026-11-17", 2)}, 2},
		{"expected without booked", []bank.Balance{b("CLAV", "2026-11-18", 1), b("XPCD", "2026-11-17", 2)}, 2},
		{"else the first", []bank.Balance{b("CLAV", "2026-11-18", 1), b("ITAV", "2026-11-18", 2)}, 1},
	}
	for _, tc := range cases {
		if got, ok := pickBalance(tc.in); !ok || got.Amount != tc.want {
			t.Errorf("%s: got %+v", tc.name, got)
		}
	}
	if _, ok := pickBalance(nil); ok {
		t.Error("no balance picked from none")
	}
}

func TestErrorCode(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{fmt.Errorf("x: %w", bank.ErrSessionExpired), "session_expired"},
		{&enablebanking.APIError{Status: 500, Code: "ASPSP_ERROR"}, "ASPSP_ERROR"},
		{&enablebanking.APIError{Status: 502}, "http_502"},
		{&enablebanking.APIError{Status: 400, Code: "bad <code>"}, "http_400"},
		{&enablebanking.APIError{Status: 400, Code: "BE68539007547034"}, "http_400"},
		{fmt.Errorf("fetch: %w", context.DeadlineExceeded), "timeout"},
		{errors.New("invalid amount \"12,30\" for BE68539007547034"), "provider_error"},
	}
	for _, tc := range cases {
		if got := errorCode(tc.err); got != tc.want {
			t.Errorf("errorCode(%v) = %q, want %q", tc.err, got, tc.want)
		}
	}
}

func TestAccountName(t *testing.T) {
	cases := map[string]string{
		"Zichtrekening":           "Zichtrekening",
		"  Groeirekening \n":      "Groeirekening",
		"":                        "Zichtrekening",
		"Rek\x00ening":            "Rekening",
		strings.Repeat("é", 45):   strings.Repeat("é", 40),
		strings.Repeat("a ", 30):  strings.TrimSpace(strings.Repeat("a ", 20)),
		"\t":                      "Zichtrekening",
		"Zichtrekening Plus 2026": "Zichtrekening Plus 2026",
	}
	for in, want := range cases {
		if got := accountName(in); got != want {
			t.Errorf("accountName(%q) = %q, want %q", in, got, want)
		}
	}
}
