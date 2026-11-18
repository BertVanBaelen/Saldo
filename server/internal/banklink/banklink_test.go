package banklink

import (
	"context"
	"errors"
	"fmt"
	"slices"
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

// A link removed (in another tab) while the bank confirmed a re-authorisation
// stays removed: no session, no accounts attached or created.
func TestStoreConsentKeepsARemovedLinkRemoved(t *testing.T) {
	e := newSyncEnv(t)
	for _, q := range []string{
		`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (1, 1, 'manager', 'edit')`,
		// What removing the link with "keep history" does (ledger.RemoveConnection).
		`DELETE FROM account_sources WHERE connection_id = 1`,
		`UPDATE provider_connections SET status = 'revoked', session_id_enc = NULL, private_key_enc = NULL, application_id = NULL WHERE id = 1`,
	} {
		if _, err := e.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	info := bank.SessionInfo{ID: "new-sess", ValidUntil: at(18, 10, 0).AddDate(0, 0, 90), Accounts: []bank.Account{
		{ID: "b1", IBAN: "BE68539007547034", Name: "Zicht"},  // the account the user just unlinked
		{ID: "b3", IBAN: "BE83363012345615", Name: "Nieuwe"}, // a new one
	}}
	_, err := e.svc.storeConsent(context.Background(), connection{id: 1, user: 1, aspsp: "Argenta"}, info, at(18, 10, 0))
	if err == nil || !strings.Contains(err.Error(), "verlopen of ongeldig") {
		t.Fatalf("err = %v, want the invalid-state error", err)
	}
	if got := e.query(`SELECT status, session_id_enc IS NULL, private_key_enc IS NULL FROM provider_connections WHERE id = 1`); got != "revoked 1 1" {
		t.Errorf("connection: %s", got)
	}
	if got := e.query(`SELECT COUNT(*) FROM account_sources`) + " " + e.query(`SELECT COUNT(*) FROM accounts`); got != "0 2" {
		t.Errorf("sources and accounts: %s, want 0 2", got)
	}
}

// A consent that leaves out an account the connection fed marks it not_shared
// at once and names it to the viewer, but only if the viewer holds it; a
// consent that lists it again clears the mark with its first sync, and one that
// adds an account names nothing.
func TestStoreConsentNamesWhatItLeavesOut(t *testing.T) {
	ctx := context.Background()
	b := &scriptBank{txs: map[string][]bank.Transaction{}, fail: map[string]error{}}
	svc, e := linkEnv(t, func(int64, string, []byte) (Client, error) { return b, nil })
	valid := at(18, 10, 0).AddDate(0, 0, 90)
	zicht := bank.Account{ID: "b1", IBAN: "BE68539007547034", Name: "Zichtrekening"}
	gezin := bank.Account{ID: "b2", IBAN: "BE71096123456769", Name: "Gezinsrekening"}
	consent := func(accs ...bank.Account) Linked {
		t.Helper()
		l, err := svc.storeConsent(ctx, connection{id: 1, user: 1, aspsp: "Argenta"}, bank.SessionInfo{ID: "s", ValidUntil: valid, Accounts: accs}, at(18, 10, 0))
		if err != nil {
			t.Fatal(err)
		}
		if l.Missing == nil {
			t.Fatal("Missing is nil: the answer must always hold an array")
		}
		return l
	}
	state := func(account int) string {
		return e.query(fmt.Sprintf(`SELECT status, COALESCE(last_error, '-'), last_attempt_at IS NOT NULL FROM account_sources WHERE account_id = %d AND connection_id = 1`, account))
	}

	// A first link has nothing missing.
	if l := consent(zicht, gezin); len(l.Accounts) != 2 || len(l.Missing) != 0 {
		t.Fatalf("first link: %+v", l)
	}
	// An account of someone else that this connection still has a row for (its
	// holder left it), and a new account of the viewer's for later.
	e.exec(`INSERT INTO users (id, email, display_name) VALUES (2, 'b@example.com', 'B')`)
	e.exec(`INSERT INTO accounts (id, type, source, iban, name) VALUES (9, 'current', 'bank', 'BE43068999999501', 'Van B')`)
	e.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (9, 2, 'manager', 'edit')`)
	e.exec(`INSERT INTO account_sources (account_id, connection_id, priority, external_account_id) VALUES (9, 1, 'fallback', 'b9')`)

	// Only the first account ticked at the bank: the second is named and marked
	// before any sync; the other user's account is marked but never named.
	l := consent(zicht)
	if want := []Missing{{IBAN: "BE71 •••• •••• 6769", Name: "Gezinsrekening"}}; !slices.Equal(l.Missing, want) {
		t.Errorf("missing %+v, want %+v", l.Missing, want)
	}
	if got := state(2); got != "failed not_shared 1" {
		t.Errorf("account 2 source %q, want failed not_shared", got)
	}
	if got := state(1); got != "ok - 0" {
		t.Errorf("account 1 source %q, want it untouched", got)
	}
	if got := state(9); got != "failed not_shared 1" {
		t.Errorf("account 9 source %q: the marking is the sync's, whoever holds it", got)
	}
	// Asking again says it again: the account is still not shared.
	if l := consent(zicht); len(l.Missing) != 1 {
		t.Errorf("second consent without it: %+v", l.Missing)
	}

	// Both listed again: nothing missing; the first sync clears the mark.
	if l := consent(zicht, gezin); len(l.Missing) != 0 {
		t.Errorf("both listed: %+v", l.Missing)
	}
	if err := svc.Sync(ctx, 1, at(18, 10, 5)); err != nil {
		t.Fatal(err)
	}
	if got := state(2); got != "ok - 1" {
		t.Errorf("account 2 source %q after the sync, want ok", got)
	}

	// A consent that adds an account names nothing.
	l = consent(zicht, gezin, bank.Account{ID: "b3", IBAN: "BE62510007547061", Name: "Spaarrekening"})
	if len(l.Accounts) != 3 || len(l.Missing) != 0 {
		t.Errorf("added an account: %+v", l)
	}
}

// Linking the IBAN of someone else's account with an open invitation joins it
// at once, the connection a fallback source and no offer left (plan 0.8-0b);
// without an invitation the join offer of 0.6-1a is unchanged.
func TestJoinByInvitationOnLink(t *testing.T) {
	ctx := context.Background()
	svc, e := linkEnv(t, func(int64, string, []byte) (Client, error) { return nil, nil })
	now := at(18, 10, 0)
	e.exec(`INSERT INTO users (id, email, display_name) VALUES (2, 'b@example.com', 'B')`)
	e.exec(`INSERT INTO accounts (id, type, source, iban, name, shared) VALUES (9, 'current', 'bank', 'BE43068999999501', 'Vakantiepot', 1),
		(10, 'current', 'bank', 'BE71096123456769', 'Van B', 0)`)
	e.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (9, 2, 'manager', 'edit'), (10, 2, 'manager', 'edit')`)
	e.exec(`INSERT INTO account_invitations (account_id, user_id, invited_by, created_at) VALUES (9, 1, 2, ?)`, now.UTC().Format(time.RFC3339))

	l, err := svc.storeConsent(ctx, connection{id: 1, user: 1, aspsp: "Argenta"}, bank.SessionInfo{ID: "s", ValidUntil: now.AddDate(0, 0, 90),
		Accounts: []bank.Account{{ID: "b9", IBAN: "BE43068999999501"}, {ID: "b10", IBAN: "BE71096123456769"}}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Joined) != 1 || l.Joined[0].ID != 9 || l.Joined[0].Name != "Vakantiepot" || !slices.Equal(l.Accounts, []int64{9}) || len(l.Offers) != 1 {
		t.Errorf("linked: %+v", l)
	}
	for q, want := range map[string]string{
		`SELECT role, permission FROM account_access WHERE account_id = 9 AND user_id = 1`:              "member edit",
		`SELECT priority, external_account_id FROM account_sources WHERE account_id = 9`:                "fallback b9",
		`SELECT COUNT(*) FROM account_invitations`:                                                      "0",
		`SELECT GROUP_CONCAT(account_id) FROM join_offers`:                                              "10",
		`SELECT COUNT(*) FROM account_notices WHERE user_id = 2 AND account_id = 9 AND type = 'member'`: "1",
	} {
		if got := e.query(q); got != want {
			t.Errorf("%s: %q, want %q", q, got, want)
		}
	}
}
