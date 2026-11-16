package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// assertInvariant: every account has at least one member, exactly one
// manager, and the manager may edit (plan 0.6-1, decision 4).
func (p *pair) assertInvariant() {
	p.t.Helper()
	if n := p.count(`SELECT COUNT(*) FROM accounts a
		WHERE (SELECT COUNT(*) FROM account_access x WHERE x.account_id = a.id) = 0
		   OR (SELECT COUNT(*) FROM account_access x WHERE x.account_id = a.id AND x.role = 'manager') <> 1
		   OR EXISTS (SELECT 1 FROM account_access x WHERE x.account_id = a.id AND x.role = 'manager' AND x.permission <> 'edit')`); n != 0 {
		p.t.Errorf("%d accounts break the invariant (>= 1 member, exactly 1 manager, who edits)", n)
	}
}

// snapshot is every row of every table but the audit log: a refused call
// must leave it as it was.
func (p *pair) snapshot() string {
	p.t.Helper()
	rows, err := p.db.Query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('audit_log', 'sqlite_sequence') ORDER BY name`)
	if err != nil {
		p.t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			p.t.Fatal(err)
		}
		tables = append(tables, name)
	}
	rows.Close()
	var b strings.Builder
	for _, table := range tables {
		rows, err := p.db.Query(`SELECT * FROM "` + table + `"`)
		if err != nil {
			p.t.Fatal(err)
		}
		cols, _ := rows.Columns()
		for rows.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				p.t.Fatal(err)
			}
			fmt.Fprintf(&b, "%s%v\n", table, vals)
		}
		rows.Close()
	}
	return b.String()
}

// postForm posts a multipart form through a handler.
func postForm(t *testing.T, h http.Handler, path string, parts ...formPart) response {
	t.Helper()
	body, ct := multipartForm(t, parts...)
	req := httptest.NewRequest("POST", path, strings.NewReader(body))
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return response{status: rec.Code, header: rec.Header(), body: rec.Body.String()}
}

func TestPatchMember(t *testing.T) {
	p := newPair(t)
	r := p.bert("PATCH", "/api/accounts/4/members/2", `{"permission": "read"}`)
	if r.status != http.StatusOK {
		t.Fatalf("patch: %d %s", r.status, r.body)
	}
	equalJSON(t, r.body, `{
		"id": 4, "name": "Gedeelde rekening", "type": "current", "source": "bank", "kind": "shared",
		"iban": "BE12 •••• •••• 7730", "colour": "violet", "buffer": 60000, "balance": 94608,
		"balanceDate": "2026-11-18", "state": "ok", "bank": "Argenta", "lastSync": "2026-11-18T04:02:00+01:00",
		"syncStatus": "ok", "syncError": null, "lastAttempt": "2026-11-18T04:05:00+01:00", "syncReport": null, "permission": "edit", "role": "manager",
		"members": [
			{"userId": 1, "name": "Bert", "initial": "B", "role": "manager", "permission": "edit", "me": true, "joinedAt": "2026-06-03T10:10:00+02:00"},
			{"userId": 2, "name": "Partner", "initial": "P", "role": "member", "permission": "read", "me": false, "joinedAt": "2026-06-05T21:00:00+02:00"}
		],
		"convertibleRules": 0, "sourceRole": "primary", "carriedBy": {"name": "Bert", "me": true}, "viaReserve": false
	}`)
	if n := p.count(`SELECT COUNT(*) FROM audit_log WHERE event = 'member_permission' AND user_id = 1 AND detail = 'account=4 user=2 permission=read'`); n != 1 {
		t.Errorf("%d audit lines", n)
	}
	p.assertInvariant()

	// Partner sees her own permission and the co-holders, and is read-only now.
	for _, acc := range decode[[]ledger.Account](t, p.partner("GET", "/api/accounts", "").body) {
		if acc.ID == 4 && (acc.Permission != "read" || len(acc.Members) != 2 || acc.Members[0].UserID != 1 || !acc.Members[1].Me) {
			t.Errorf("Partner's view: %+v", acc)
		}
	}
	if r := p.bert("PATCH", "/api/accounts/4/members/2", `{"permission": "edit"}`); r.status != http.StatusOK {
		t.Fatalf("back to edit: %d %s", r.status, r.body)
	}

	before := p.snapshot()
	if msg := expectError(t, p.partner("PATCH", "/api/accounts/4/members/2", `{"permission": "read"}`), http.StatusForbidden, "forbidden"); msg != "Alleen de beheerder kan dit wijzigen." {
		t.Errorf("member: %q", msg)
	}
	expectError(t, p.partner("PATCH", "/api/accounts/4/members/1", `{"permission": "read"}`), http.StatusForbidden, "forbidden")
	// A member cannot probe who is a member: 403 before the target is looked up.
	expectError(t, p.partner("PATCH", "/api/accounts/4/members/99", `{"permission": "read"}`), http.StatusForbidden, "forbidden")
	for _, path := range []string{"/api/accounts/5/members/2", "/api/accounts/4/members/99",
		"/api/accounts/999/members/1", "/api/accounts/4/members/abc", "/api/accounts/4/members/0"} {
		expectError(t, p.bert("PATCH", path, `{"permission": "read"}`), http.StatusNotFound, "not_found")
	}
	// Bert's personal account: Partner is not a member of it.
	expectError(t, p.bert("PATCH", "/api/accounts/1/members/2", `{"permission": "read"}`), http.StatusNotFound, "not_found")
	expectError(t, p.partner("PATCH", "/api/accounts/1/members/1", `{"permission": "read"}`), http.StatusNotFound, "not_found")
	for body, want := range map[string]string{
		`{"permission": "admin"}`: "Kies Lezen of Bewerken.",
		`{}`:                      "Kies Lezen of Bewerken.",
		`{"permission": 1}`:       "De gegevens kloppen niet.",
	} {
		if msg := expectError(t, p.bert("PATCH", "/api/accounts/4/members/2", body), http.StatusBadRequest, "invalid"); msg != want {
			t.Errorf("%s: %q, want %q", body, msg, want)
		}
	}
	for _, perm := range []string{"read", "edit"} {
		if msg := expectError(t, p.bert("PATCH", "/api/accounts/4/members/1", `{"permission": "`+perm+`"}`), http.StatusBadRequest, "invalid"); msg != "De beheerder kan niet op Alleen lezen gezet worden." {
			t.Errorf("manager's own row: %q", msg)
		}
	}
	if p.snapshot() != before {
		t.Error("a refused request wrote")
	}
	p.assertInvariant()
}

// The "joins" alert says what the member may do now, not at joining.
func TestJoinAlertFollowsPermission(t *testing.T) {
	p := newPair(t)
	p.exec(`INSERT INTO account_notices (user_id, account_id, type, actor_id, created_at) VALUES (1, 4, 'member', 2, '2026-11-18T19:00:00Z')`)
	note := func() string {
		t.Helper()
		for _, a := range decode[[]ledger.Alert](t, p.bert("GET", "/api/alerts", "").body) {
			if a.Type == "member" {
				return a.Note
			}
		}
		t.Fatal("no member alert")
		return ""
	}
	const tail = " · ziet de geschiedenis van deze rekening, nooit je persoonlijke rekeningen"
	if got := note(); got != "Partner mag bewerken"+tail {
		t.Errorf("edit: %q", got)
	}
	if r := p.bert("PATCH", "/api/accounts/4/members/2", `{"permission": "read"}`); r.status != http.StatusOK {
		t.Fatalf("patch: %d %s", r.status, r.body)
	}
	if got := note(); got != "Partner mag alleen lezen"+tail {
		t.Errorf("read: %q", got)
	}
	p.assertInvariant()
}

// Every write route over (manager, member with edit, member with read, no
// access): the manager and an editing member may (manager-only routes: the
// manager alone), a read-only member gets 403, someone without access 404,
// and a refused call writes nothing.
func TestWritePermissions(t *testing.T) {
	type fixture struct {
		tx, split, rule, batch int64
	}
	csv := csvHeader + csvCoffee
	routes := []struct {
		name    string
		manager bool // only the manager may
		call    func(p *pair, h http.Handler, f fixture) response
	}{
		{"category", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "PATCH", txPath(f.tx, ""), `{"categoryId": 5}`)
		}},
		{"note", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "PATCH", txPath(f.tx, ""), `{"note": "x"}`)
		}},
		{"similar", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "POST", txPath(f.tx, "/similar"), "")
		}},
		{"split", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "PUT", txPath(f.tx, "/split"), `{"parts":[{"categoryId":3,"amount":-1000},{"categoryId":6,"amount":-1000}]}`)
		}},
		{"unsplit", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "DELETE", txPath(f.split, "/split"), "")
		}},
		{"new rule", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "POST", "/api/rules", `{"accountId": 4, "counterparty": "Nieuw Proef", "categoryId": 5}`)
		}},
		{"edit rule", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "PATCH", rulePath(f.rule, ""), `{"categoryId": 5}`)
		}},
		{"delete rule", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "DELETE", rulePath(f.rule, ""), "")
		}},
		{"apply rule", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "POST", rulePath(f.rule, "/apply"), "")
		}},
		{"import", false, func(p *pair, h http.Handler, f fixture) response {
			return postForm(t, h, "/api/imports", importForm(csvHeader+csvBread, 4, csvMapping)...)
		}},
		{"undo import", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "POST", "/api/imports/"+strconv.FormatInt(f.batch, 10)+"/undo", "")
		}},
		{"reapply categories", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "POST", "/api/imports/"+strconv.FormatInt(f.batch, 10)+"/reapply-categories", "")
		}},
		{"balance", false, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "PUT", "/api/accounts/2/balance", `{"balance": 10000}`)
		}},
		{"account", true, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "PATCH", "/api/accounts/4", `{"name": "Samen", "colour": "teal", "buffer": 10000}`)
		}},
		{"member", true, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "PATCH", "/api/accounts/4/members/2", `{"permission": "read"}`)
		}},
		{"convert rules", true, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "POST", "/api/accounts/4/convert-rules", "")
		}},
		{"delete account", true, func(p *pair, h http.Handler, f fixture) response {
			return do(t, h, "DELETE", "/api/accounts/2?confirm=Spaarrekening", "")
		}},
	}
	roles := []struct {
		name  string
		setup string // SQL on Partner's access to the shared accounts 2 and 4
	}{
		{"manager", ""},
		{"edit", ""},
		{"read", `UPDATE account_access SET permission = 'read' WHERE account_id IN (2, 4) AND user_id = 2`},
		{"none", `DELETE FROM account_access WHERE account_id IN (2, 4) AND user_id = 2`},
	}
	for _, route := range routes {
		for _, role := range roles {
			t.Run(route.name+"/"+role.name, func(t *testing.T) {
				p := newPair(t)
				// The manual savings account 2 is shared too, for the balance.
				p.exec(`INSERT INTO account_access (account_id, user_id, role, permission, joined_at) VALUES (2, 2, 'member', 'edit', '2026-11-01T08:00:00Z')`)
				f := fixture{
					tx:    p.addRow(4, "Proef Gedeeld", -2000, "booked", 3, "manual"),
					split: p.addRow(4, "Proef Gesplitst", -2000, "booked", nil, nil),
					rule:  p.newRule(p.bert, `{"accountId": 4, "counterparty": "Proef Gedeeld", "categoryId": 3}`),
				}
				p.tx(p.bert, "PUT", txPath(f.split, "/split"), `{"parts":[{"categoryId":3,"amount":-1000},{"categoryId":6,"amount":-1000}]}`)
				r := postForm(t, p.bertH, "/api/imports", importForm(csv, 4, csvMapping)...)
				if r.status != http.StatusCreated {
					t.Fatalf("import: %d %s", r.status, r.body)
				}
				f.batch = decode[importBody](t, r.body).Batches[0].ID
				if role.setup != "" {
					p.exec(role.setup)
				}
				h := p.partnerH
				if role.name == "manager" {
					h = p.bertH
				}
				before := p.snapshot()
				r = route.call(p, h, f)
				want := http.StatusOK
				switch {
				case role.name == "none":
					want = http.StatusNotFound
				case role.name == "read", route.manager && role.name == "edit":
					want = http.StatusForbidden
				}
				if want == http.StatusOK {
					if r.status < 200 || r.status > 299 {
						t.Errorf("%d %s, want 2xx", r.status, r.body)
					}
				} else {
					if r.status != want {
						t.Errorf("%d %s, want %d", r.status, r.body, want)
					}
					if p.snapshot() != before {
						t.Error("a refused call wrote")
					}
				}
				p.assertInvariant()
			})
		}
	}
}

// Routes without an account (apply all, order, suggestions, backfill) act on
// the accounts the viewer may edit: a read-only member's calls leave the
// shared account as it was.
func TestReadOnlyViewerScopedRoutes(t *testing.T) {
	p := newPair(t)
	rule := p.newRule(p.bert, `{"accountId": 4, "counterparty": "Proef Gedeeld", "categoryId": 3}`)
	p.addRow(4, "Proef Gedeeld", -2000, "booked", nil, nil)
	p.exec(`UPDATE account_access SET permission = 'read' WHERE account_id = 4 AND user_id = 2`)
	shared := func() string {
		return p.query(`SELECT group_concat(id || ':' || COALESCE(category_id, '-') || ':' || COALESCE(rule_id, '-'), ';') FROM transactions WHERE account_id = 4`) +
			"|" + p.query(`SELECT group_concat(id || ':' || priority || ':' || category_id, ';') FROM rules WHERE account_id = 4`)
	}
	before := shared()
	p.partner("POST", "/api/rules/apply", "")
	p.partner("PUT", "/api/rules/order", `{"ids": [`+strconv.FormatInt(rule, 10)+`]}`)
	for _, s := range decode[[]struct {
		CounterpartyKey string `json:"counterpartyKey"`
		CategoryID      int64  `json:"categoryId"`
	}](t, p.partner("GET", "/api/suggestions", "").body) {
		p.partner("POST", "/api/suggestions/confirm", fmt.Sprintf(`{"counterpartyKey": %q, "categoryId": %d}`, s.CounterpartyKey, s.CategoryID))
	}
	p.partner("POST", "/api/suggestions/backfill", `{}`)
	if got := shared(); got != before {
		t.Errorf("the shared account changed:\n%s\n%s", before, got)
	}
	p.assertInvariant()
}
