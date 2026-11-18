package server

import (
	"slices"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// The HTTP side of the shared flag and the invitations (plan 0.8-0b). The
// ledger tests own the rules (shares, notices, expiry, cascades); these check
// that the routes map them to the documented statuses, codes and messages.

// invStep is one request of a sequence: the status (and, for an error, its
// code and Dutch message; for a 200 with an account, its kind) it must answer.
type invStep struct {
	name               string
	as                 int64
	method, path, body string
	status             int
	msg, kind          string // "" skips the check
}

var invCodes = map[int]string{400: "invalid", 403: "forbidden", 404: "not_found", 409: "conflict"}

func (e *bankEnv) invSteps(t *testing.T, steps ...invStep) {
	t.Helper()
	for _, s := range steps {
		r := e.as(s.as, s.method, s.path, s.body)
		if r.status != s.status {
			t.Fatalf("%s: %s %s: %d %s, want %d", s.name, s.method, s.path, r.status, r.body, s.status)
		}
		if s.status >= 400 {
			if got := decode[errorBody](t, r.body).Error; got.Code != invCodes[s.status] || s.msg != "" && got.Message != s.msg {
				t.Errorf("%s: error %+v, want %s %q", s.name, got, invCodes[s.status], s.msg)
			}
		} else if s.kind != "" {
			if got := decode[ledger.Account](t, r.body).Kind; got != s.kind {
				t.Errorf("%s: kind %q, want %q", s.name, got, s.kind)
			}
		}
	}
}

// manualAccount creates a manual current account of user and returns its id.
func (e *bankEnv) manualAccount(user int64, name string) int64 {
	e.t.Helper()
	r := e.as(user, "POST", "/api/accounts", jsonBody(map[string]string{"name": name, "type": "current"}))
	if r.status != 201 {
		e.t.Fatalf("create %s: %d %s", name, r.status, r.body)
	}
	return decode[ledger.Account](e.t, r.body).ID
}

// PATCH /api/accounts/{id} with "shared": only the manager, off only alone
// and without an open invitation, and the flag stays when the last other
// member leaves.
func TestSharedFlagRoute(t *testing.T) {
	e := newBankEnv(t)
	pot := "/api/accounts/" + id(e.manualAccount(e.bert, "Vakantiepot"))
	on, off := `{"shared": true}`, `{"shared": false}`
	e.invSteps(t,
		invStep{name: "hidden", as: e.partner, method: "PATCH", path: pot, body: on, status: 404, msg: "Rekening niet gevonden."},
		invStep{name: "bad value", as: e.bert, method: "PATCH", path: pot, body: `{"shared": "ja"}`, status: 400, msg: "De gegevens kloppen niet."},
		invStep{name: "on", as: e.bert, method: "PATCH", path: pot, body: on, status: 200, kind: "shared"},
		invStep{name: "off alone", as: e.bert, method: "PATCH", path: pot, body: off, status: 200, kind: "personal"},
		invStep{name: "on again", as: e.bert, method: "PATCH", path: pot, body: on, status: 200, kind: "shared"},
		invStep{name: "invite", as: e.bert, method: "POST", path: pot + "/invitations", body: `{"userId": 2}`, status: 201},
		invStep{name: "off with an invitation", as: e.bert, method: "PATCH", path: pot, body: off, status: 400, msg: "Trek eerst de uitnodiging in."},
		invStep{name: "accept", as: e.partner, method: "POST", path: "/api/invitations/1/accept", status: 200, kind: "shared"},
		invStep{name: "a member switches", as: e.partner, method: "PATCH", path: pot, body: on, status: 403, msg: "Alleen de beheerder kan dit wijzigen."},
		invStep{name: "off with a member", as: e.bert, method: "PATCH", path: pot, body: off, status: 400, msg: "Een rekening met meer leden blijft gedeeld."},
		invStep{name: "leave", as: e.partner, method: "POST", path: pot + "/leave", status: 200},
		invStep{name: "the flag stays", as: e.bert, method: "PATCH", path: pot, body: `{"name": "Vakantiepot"}`, status: 200, kind: "shared"},
		invStep{name: "off after the leave", as: e.bert, method: "PATCH", path: pot, body: off, status: 200, kind: "personal"},
	)
}

// The invitation routes: invite (and its refusals), what the invitee sees,
// accept, decline, revoke and expiry.
func TestInvitationRoutes(t *testing.T) {
	e := newBankEnv(t)
	derde := e.addUser("derde@example.com", "Derde", "user", "Derde kiest ook een zin")
	pot, zicht := "/api/accounts/"+id(e.manualAccount(e.bert, "Vakantiepot")), "/api/accounts/"+id(e.manualAccount(e.bert, "Zichtrekening"))
	e.invSteps(t, invStep{name: "flag", as: e.bert, method: "PATCH", path: pot, body: `{"shared": true}`, status: 200, kind: "shared"})

	// The answers the web reads.
	if r := e.as(e.bert, "POST", pot+"/invitations", `{"userId": 2}`); r.status != 201 {
		t.Fatalf("invite: %d %s", r.status, r.body)
	} else {
		equalJSON(t, r.body, `{"id": 1, "userId": 2, "name": "Partner", "createdAt": "2026-11-18T20:00:00+01:00"}`)
	}
	equalJSON(t, e.as(e.bert, "GET", pot+"/invitable", "").body, `{"users": [
		{"id": 3, "name": "Derde", "initial": "D", "state": "free", "invitationId": null},
		{"id": 2, "name": "Partner", "initial": "P", "state": "invited", "invitationId": 1}]}`)
	equalJSON(t, jsonBody(e.alertsOf(e.partner, "invite")), `[{"kind": "ok", "type": "invite", "title": "Bert nodigt je uit voor Vakantiepot",
		"note": "Voeg de rekening toe om ze samen te volgen", "href": "/rekeningen?uitnodiging=1", "invitationId": 1}]`)

	const noInv, noAcc, noUser = "Uitnodiging niet gevonden.", "Rekening niet gevonden.", "Niet gevonden."
	const notManager = "Alleen de beheerder kan dit wijzigen."
	invite := func(user string) string { return `{"userId": ` + user + `}` }
	e.invSteps(t,
		invStep{name: "not shared", as: e.bert, method: "POST", path: zicht + "/invitations", body: invite("2"), status: 400, msg: "Zet de rekening eerst op gedeeld."},
		invStep{name: "yourself", as: e.bert, method: "POST", path: pot + "/invitations", body: invite("1"), status: 400, msg: "Je kunt jezelf niet uitnodigen."},
		invStep{name: "nobody", as: e.bert, method: "POST", path: pot + "/invitations", body: `{}`, status: 400, msg: "Kies iemand om uit te nodigen."},
		invStep{name: "unknown user", as: e.bert, method: "POST", path: pot + "/invitations", body: invite("99"), status: 404, msg: noUser},
		invStep{name: "twice", as: e.bert, method: "POST", path: pot + "/invitations", body: invite("2"), status: 409, msg: "Partner is al uitgenodigd."},
		invStep{name: "a stranger invites", as: derde, method: "POST", path: pot + "/invitations", body: invite("2"), status: 404, msg: noUser},
		invStep{name: "a stranger lists", as: derde, method: "GET", path: pot + "/invitable", status: 404, msg: noAcc},
		invStep{name: "the invitee lists", as: e.partner, method: "GET", path: pot + "/invitable", status: 404, msg: noAcc},
		invStep{name: "someone else accepts", as: e.bert, method: "POST", path: "/api/invitations/1/accept", status: 404, msg: noInv},
		invStep{name: "a stranger declines", as: derde, method: "DELETE", path: "/api/invitations/1", status: 404, msg: noInv},
		invStep{name: "unknown invitation", as: e.partner, method: "POST", path: "/api/invitations/99/accept", status: 404, msg: noInv},
	)

	// Accept: the account as the new member sees it, and the alert is gone.
	r := e.as(e.partner, "POST", "/api/invitations/1/accept", "")
	if a := decode[ledger.Account](t, r.body); r.status != 200 || a.Name != "Vakantiepot" || a.Role != "member" || a.Permission != "edit" || a.Kind != "shared" || len(a.Members) != 2 || len(a.Invitations) != 0 {
		t.Errorf("accept: %d %+v", r.status, a)
	}
	if got := e.alertsOf(e.partner, "invite"); len(got) != 0 {
		t.Errorf("alerts after accepting: %+v", got)
	}
	// Ids restart once the table is empty, so each invitation's id is read from its answer.
	newInvitation := func(user string) string {
		t.Helper()
		r := e.as(e.bert, "POST", pot+"/invitations", invite(user))
		if r.status != 201 {
			t.Fatalf("invite %s: %d %s", user, r.status, r.body)
		}
		return id(decode[ledger.Invitation](t, r.body).ID)
	}
	e.invSteps(t,
		invStep{name: "used", as: e.partner, method: "POST", path: "/api/invitations/1/accept", status: 404, msg: noInv},
		invStep{name: "a member lists", as: e.partner, method: "GET", path: pot + "/invitable", status: 403, msg: notManager},
		invStep{name: "a member invites", as: e.partner, method: "POST", path: pot + "/invitations", body: invite("3"), status: 403, msg: notManager},
		invStep{name: "already a member", as: e.bert, method: "POST", path: pot + "/invitations", body: invite("2"), status: 400, msg: "Partner is al lid."},
	)
	// Decline (the invitee) and revoke (the manager); a member cannot, nobody gets a notice.
	path := "/api/invitations/" + newInvitation("3")
	e.invSteps(t,
		invStep{name: "a member revokes", as: e.partner, method: "DELETE", path: path, status: 404, msg: noInv},
		invStep{name: "decline", as: derde, method: "DELETE", path: path, status: 204},
		invStep{name: "declined", as: derde, method: "DELETE", path: path, status: 404, msg: noInv},
	)
	path = "/api/invitations/" + newInvitation("3")
	e.invSteps(t, invStep{name: "revoke", as: e.bert, method: "DELETE", path: path, status: 204})

	// Expired after 30 days: as if it never existed, and the manager may invite again.
	path = "/api/invitations/" + newInvitation("3")
	e.exec(`UPDATE account_invitations SET created_at = '2026-10-01T00:00:00Z'`)
	e.invSteps(t, invStep{name: "expired", as: derde, method: "POST", path: path + "/accept", status: 404, msg: noInv})
	newInvitation("3")
	if n := e.count(`SELECT COUNT(*) FROM account_notices`); n != 1 {
		t.Errorf("%d notices, want the one member notice of the accept", n)
	}
}

// Linking the IBAN of an account one is invited to joins it at once: the
// callback lists it under "joined", with no join offer left.
func TestJoinByInvitationCallback(t *testing.T) {
	e := joinSetup(t)
	e.invSteps(t,
		invStep{name: "flag", as: e.bert, method: "PATCH", path: "/api/accounts/2", body: `{"shared": true}`, status: 200, kind: "shared"},
		invStep{name: "invite", as: e.bert, method: "POST", path: "/api/accounts/2/invitations", body: `{"userId": 2}`, status: 201},
	)
	got := e.link(e.partner, "")
	equalJSON(t, jsonBody(got.Joined), `[{"id": 2, "name": "Gezinsrekening"}]`)
	equalJSON(t, jsonBody(got.Offers), `[]`)
	if ids := accountIDs(got.Accounts); !slices.Contains(ids, 2) || !slices.Contains(ids, 3) {
		t.Errorf("Partner's linked accounts: %v", ids)
	}
	equalJSON(t, e.as(e.partner, "GET", "/api/join-offers", "").body, `[]`)
	if a, ok := e.accountOf(e.partner, 2); !ok || a.Role != "member" || a.Permission != "edit" || a.Kind != "shared" {
		t.Errorf("Partner's account 2: %+v, %v", a, ok)
	}
	if n := e.count(`SELECT COUNT(*) FROM account_invitations`); n != 0 {
		t.Errorf("%d invitations left", n)
	}
	e.assertInvariant()
}
