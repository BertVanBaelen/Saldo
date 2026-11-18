package ledger_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/apperr"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// potStates are the three states of A9 in plan 0.8-0b, Tests: flagged with
// one member, flag cleared, and flag cleared with Partner as a second member.
var potStates = []struct {
	name          string
	flag, partner bool
	shared        bool
}{
	{"flagged", true, false, true},
	{"cleared", false, false, false},
	{"two members", false, true, true},
}

func setPot(t *testing.T, d *sql.DB, flag, partnerMember bool) {
	t.Helper()
	if _, err := d.Exec(`UPDATE accounts SET shared = ? WHERE id = ?`, flag, rwPot); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`DELETE FROM account_access WHERE account_id = ? AND user_id = ?`, rwPot, partner); err != nil {
		t.Fatal(err)
	}
	if partnerMember {
		if _, err := d.Exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (?, ?, 'member', 'edit')`, rwPot, partner); err != nil {
			t.Fatal(err)
		}
	}
}

// The scopes, the reports and kind follow the derived shared value, not the
// number of members (plan 0.8-0b).
func TestScopeFollowsSharedFlag(t *testing.T) {
	ctx := context.Background()
	d, s, ids := reportWorld(t)
	for _, st := range potStates {
		setPot(t, d, st.flag, st.partner)
		month := func(scope string, account int64) ledger.ReportMonth {
			t.Helper()
			rep, err := s.ReportMonths(ctx, bert, ledger.ReportQuery{Scope: scope, AccountID: account, From: "2026-05", To: "2026-05", Now: reportNow})
			if err != nil {
				t.Fatal(err)
			}
			return rep.Months[0]
		}
		toShared, gedeeldIncome := map[string]int64{}, int64(0)
		if st.shared {
			toShared, gedeeldIncome = map[string]int64{"toShared": 1000}, 1000
		}
		if got := month("persoonlijk", 0); got.Income != 0 || !maps.Equal(got.Expenses, toShared) {
			t.Errorf("%s: persoonlijk %+v, want %v", st.name, got, toShared)
		}
		alone := map[string]int64{"toOwn": 1000}
		if st.shared {
			alone = map[string]int64{"toShared": 1000}
		}
		if got := month("", rwZicht); !maps.Equal(got.Expenses, alone) {
			t.Errorf("%s: A1 alone %+v, want %v", st.name, got.Expenses, alone)
		}
		if got := month("gedeeld", 0); got.Income != gedeeldIncome {
			t.Errorf("%s: gedeeld income %d, want %d", st.name, got.Income, gedeeldIncome)
		}
		rep, err := s.ReportMonths(ctx, bert, ledger.ReportQuery{Scope: "gedeeld", From: "2026-05", To: "2026-05", Now: reportNow})
		if err != nil || slices.Contains(rep.Accounts, rwPot) != st.shared {
			t.Errorf("%s: gedeeld selection %v, %v", st.name, rep.Accounts, err)
		}
		listed := slices.ContainsFunc(allTransactions(t, s, bert, ledger.TxQuery{Scope: "gedeeld", Limit: ledger.MaxLimit}),
			func(x ledger.Transaction) bool { return x.ID == ids["t2"] })
		if listed != st.shared {
			t.Errorf("%s: t2 in Transacties gedeeld = %v", st.name, listed)
		}
		a, err := s.Account(ctx, bert, rwPot, reportNow)
		if want := map[bool]string{true: "shared", false: "personal"}[st.shared]; err != nil || a.Kind != want {
			t.Errorf("%s: kind %q, want %q (%v)", st.name, a.Kind, want, err)
		}
	}
}

// t1 (A1 to A9) is "Naar gedeelde rekening" exactly while A9 is shared.
func TestTransferKindFollowsSharedFlag(t *testing.T) {
	d, s, ids := reportWorld(t)
	for _, st := range potStates {
		setPot(t, d, st.flag, st.partner)
		want := map[bool]string{true: "shared", false: "internal"}[st.shared]
		for _, x := range allTransactions(t, s, bert, ledger.TxQuery{AccountID: rwZicht, Limit: ledger.MaxLimit}) {
			if x.ID == ids["t1"] && (x.TransferKind == nil || *x.TransferKind != want) {
				t.Errorf("%s: t1 transferKind %v, want %s", st.name, x.TransferKind, want)
			}
		}
	}
}

func patchShared(s *ledger.Store, viewer int64, on bool) (ledger.Account, error) {
	return s.UpdateAccount(context.Background(), viewer, rwPot, ledger.AccountPatch{Shared: &on}, reportNow)
}

// Only the manager switches the flag; switching off is refused with a second
// member or an open invitation; the flag stays when the last other member leaves.
func TestSharedFlag(t *testing.T) {
	ctx := context.Background()
	d, s, _ := reportWorld(t)
	step := func(name string, err error, want error) {
		t.Helper()
		if (want == nil) != (err == nil) || want != nil && err.Error() != want.Error() {
			t.Errorf("%s: %v, want %v", name, err, want)
		}
	}
	kind := func(name, want string) {
		t.Helper()
		if a, err := s.Account(ctx, bert, rwPot, reportNow); err != nil || a.Kind != want {
			t.Errorf("%s: kind %q, want %q (%v)", name, a.Kind, want, err)
		}
	}
	_, err := patchShared(s, bert, false)
	step("off alone", err, nil)
	kind("off alone", "personal")
	_, err = patchShared(s, bert, true)
	step("on", err, nil)
	kind("on", "shared")
	inv, err := s.Invite(ctx, bert, rwPot, partner, reportNow)
	step("invite", err, nil)
	_, err = patchShared(s, bert, false)
	step("off with an invitation", err, apperr.Invalid("Trek eerst de uitnodiging in."))
	_, err = s.AcceptInvitation(ctx, partner, inv.ID, reportNow)
	step("accept", err, nil)
	_, err = patchShared(s, partner, true)
	step("a member", err, ledger.ErrNotManager)
	_, err = patchShared(s, bert, false)
	step("off with two members", err, apperr.Invalid("Een rekening met meer leden blijft gedeeld."))
	_, err = s.Leave(ctx, partner, rwPot, reportNow)
	step("leave", err, nil)
	kind("after the leave", "shared")
	_, err = patchShared(s, bert, false)
	step("off after the leave", err, nil)
	kind("off after the leave", "personal")
	// A join into an unflagged account (a 0.6 join offer; here the flag is cleared under an open
	// invitation) sets the flag, so the account stays shared after the leave.
	_, _ = patchShared(s, bert, true)
	inv, err = s.Invite(ctx, bert, rwPot, partner, reportNow)
	step("invite again", err, nil)
	if _, err := d.Exec(`UPDATE accounts SET shared = 0 WHERE id = ?`, rwPot); err != nil {
		t.Fatal(err)
	}
	_, err = s.AcceptInvitation(ctx, partner, inv.ID, reportNow)
	step("join unflagged", err, nil)
	_, err = s.Leave(ctx, partner, rwPot, reportNow)
	step("leave again", err, nil)
	kind("join then leave", "shared")
}

// Invite, accept, decline, revoke, expiry and the cascade (plan 0.8-0b).
func TestInvitations(t *testing.T) {
	ctx := context.Background()
	d, s, _ := reportWorld(t)
	const derde int64 = 3
	if _, err := d.Exec(`INSERT INTO users (id, email, display_name) VALUES (?, 'derde@example.com', 'Derde')`, derde); err != nil {
		t.Fatal(err)
	}
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := d.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// A flagged account with one member has contributions: that member, equal.
	if c, err := s.Contributions(ctx, bert, rwPot, "2026-05", reportNow); err != nil || len(c.Members) != 1 || c.Members[0].Share != nil {
		t.Errorf("one-member contributions: %+v, %v", c, err)
	}
	if err := s.SetShares(ctx, bert, rwPot, json.RawMessage(fmt.Sprintf(`{"%d": 100}`, bert))); err != nil {
		t.Fatal(err)
	}

	inv, err := s.Invite(ctx, bert, rwPot, partner, reportNow)
	if err != nil || inv.UserID != partner || inv.Name != "Partner" {
		t.Fatalf("invite: %+v, %v", inv, err)
	}
	for _, c := range []struct {
		name          string
		account, user int64
		want          error
	}{
		{"twice", rwPot, partner, apperr.Conflict("Partner is al uitgenodigd.")},
		{"a member", rwGedeeld, partner, apperr.Invalid("Partner is al lid.")},
		{"not shared", rwZicht, partner, apperr.Invalid("Zet de rekening eerst op gedeeld.")},
		{"yourself", rwPot, bert, apperr.Invalid("Je kunt jezelf niet uitnodigen.")},
		{"unknown user", rwPot, 99, apperr.ErrNotFound},
	} {
		if _, err := s.Invite(ctx, bert, c.account, c.user, reportNow); err == nil || err.Error() != c.want.Error() {
			t.Errorf("%s: %v, want %v", c.name, err, c.want)
		}
	}

	// Before accepting the invitee sees the name and the inviter, nothing else.
	if _, err := s.Account(ctx, partner, rwPot, reportNow); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("invitee reads the account: %v", err)
	}
	alerts, err := s.Alerts(ctx, partner, "", reportNow)
	if err != nil {
		t.Fatal(err)
	}
	want := ledger.Alert{Kind: "ok", Type: "invite", Title: "Bert nodigt je uit voor Pot", Note: "Voeg de rekening toe om ze samen te volgen",
		Href: fmt.Sprintf("/rekeningen?uitnodiging=%d", inv.ID), InvitationID: inv.ID}
	if !slices.Contains(alerts, want) {
		t.Errorf("invitee alerts %+v lack %+v", alerts, want)
	}
	if a, _ := s.Account(ctx, bert, rwPot, reportNow); len(a.Invitations) != 1 || a.Invitations[0].ID != inv.ID {
		t.Errorf("manager's invitations: %+v", a.Invitations)
	}
	if list, err := s.Invitable(ctx, bert, rwPot, reportNow); err != nil || len(list) != 2 || list[1].Name != "Partner" ||
		list[1].State != "invited" || *list[1].InvitationID != inv.ID || list[0].State != "free" || list[0].Initial != "D" {
		t.Errorf("invitable: %+v, %v", list, err)
	}
	if _, err := s.AcceptInvitation(ctx, bert, inv.ID, reportNow); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("someone else accepts: %v", err)
	}

	// Accept: a member with edit, no source, shares reset, a notice for Bert.
	a, err := s.AcceptInvitation(ctx, partner, inv.ID, reportNow)
	if err != nil || a.Role != "member" || a.Permission != "edit" || a.Kind != "shared" {
		t.Fatalf("accept: %+v, %v", a, err)
	}
	if n := count(`SELECT COUNT(*) FROM account_sources WHERE account_id = ?`, rwPot); n != 0 {
		t.Errorf("%d sources", n)
	}
	if n := count(`SELECT COUNT(*) FROM account_access WHERE account_id = ? AND contribution_share IS NOT NULL`, rwPot); n != 0 {
		t.Errorf("%d shares not reset", n)
	}
	if n := count(`SELECT COUNT(*) FROM account_notices WHERE user_id = ? AND account_id = ? AND type = 'member' AND actor_id = ?`, bert, rwPot, partner); n != 1 {
		t.Errorf("%d member notices for Bert", n)
	}
	if n := count(`SELECT COUNT(*) FROM account_invitations`); n != 0 {
		t.Errorf("%d invitations left", n)
	}
	if _, err := s.Invitable(ctx, partner, rwPot, reportNow); !errors.Is(err, ledger.ErrNotManager) {
		t.Errorf("a member lists invitable users: %v", err)
	}

	// Decline (the invitee), revoke (the manager); a member cannot.
	for _, by := range []int64{derde, bert} {
		inv, err := s.Invite(ctx, bert, rwPot, derde, reportNow)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteInvitation(ctx, partner, inv.ID, reportNow); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("a member deletes: %v", err)
		}
		if err := s.DeleteInvitation(ctx, by, inv.ID, reportNow); err != nil {
			t.Errorf("delete by %d: %v", by, err)
		}
	}

	// Expiry after 30 days: not acceptable, free again, and invitable anew.
	inv, _ = s.Invite(ctx, bert, rwPot, derde, reportNow)
	later := reportNow.Add(ledger.InvitationTTL)
	if _, err := s.AcceptInvitation(ctx, derde, inv.ID, later); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("expired accept: %v", err)
	}
	if again, err := s.Invite(ctx, bert, rwPot, derde, later); err != nil || again.CreatedAt == inv.CreatedAt {
		t.Errorf("invite after expiry: %+v, %v", again, err)
	}

	// A deleted user's invitation cascades.
	if _, err := d.Exec(`DELETE FROM users WHERE id = ?`, derde); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT COUNT(*) FROM account_invitations`); n != 0 {
		t.Errorf("%d invitations after the user delete", n)
	}
}
