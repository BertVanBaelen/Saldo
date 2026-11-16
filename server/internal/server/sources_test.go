package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
)

// sourceFields is how a user sees who carries their accounts (0.6-1d):
// sourceRole, carriedBy and viaReserve plus syncStatus and syncError, per
// account id, as JSON.
func (p *pair) sourceFields(h http.Handler) string {
	p.t.Helper()
	var list []map[string]json.RawMessage
	if err := json.Unmarshal([]byte(do(p.t, h, "GET", "/api/accounts", "").body), &list); err != nil {
		p.t.Fatal(err)
	}
	var out []string
	for _, a := range list {
		for _, k := range []string{"sourceRole", "carriedBy", "viaReserve"} {
			if _, ok := a[k]; !ok {
				p.t.Errorf("account %s has no %s", a["id"], k)
			}
		}
		out = append(out, `"`+string(a["id"])+`": {"sourceRole": `+string(a["sourceRole"])+`, "carriedBy": `+string(a["carriedBy"])+
			`, "viaReserve": `+string(a["viaReserve"])+`, "syncStatus": `+string(a["syncStatus"])+`, "syncError": `+string(a["syncError"])+`}`)
	}
	return "{" + strings.Join(out, ", ") + "}"
}

// The demo pair: Bert's link 1 is the primary of the shared account 4,
// Partner's link 2 its fallback.
func TestAccountSources(t *testing.T) {
	p := newPair(t)
	none := `"sourceRole": null, "carriedBy": null, "viaReserve": false, "syncStatus": null, "syncError": null`
	bertCarries := `"carriedBy": {"name": "Bert", "me": true}, "viaReserve": false`
	equalJSON(t, p.sourceFields(p.bertH), `{
		"1": {"sourceRole": "primary", `+bertCarries+`, "syncStatus": "ok", "syncError": null},
		"2": {`+none+`}, "3": {`+none+`},
		"4": {"sourceRole": "primary", `+bertCarries+`, "syncStatus": "ok", "syncError": null}}`)
	equalJSON(t, p.sourceFields(p.partnerH), `{
		"4": {"sourceRole": "reserve", "carriedBy": {"name": "Bert", "me": false}, "viaReserve": false, "syncStatus": "ok", "syncError": null},
		"5": {"sourceRole": "primary", "carriedBy": {"name": "Partner", "me": true}, "viaReserve": false, "syncStatus": "ok", "syncError": null}}`)

	// Bert's link just failed: it still carries (it has not been failing for
	// 36 hours). Only Bert sees its error code.
	p.exec(`UPDATE provider_connections SET sync_status = 'failed', last_error = 'ASPSP_ERROR' WHERE id = 1`)
	p.exec(`UPDATE account_sources SET status = 'failed', last_error = 'ASPSP_ERROR', last_attempt_at = '2026-11-18T18:00:00Z' WHERE connection_id = 1`)
	shared := func(h http.Handler) string { return p.sourceFieldsOf(h, "4") }
	equalJSON(t, shared(p.bertH), `{"sourceRole": "primary", `+bertCarries+`, "syncStatus": "failed", "syncError": "ASPSP_ERROR"}`)
	equalJSON(t, shared(p.partnerH), `{"sourceRole": "reserve", "carriedBy": {"name": "Bert", "me": false}, "viaReserve": false, "syncStatus": "failed", "syncError": null}`)

	// Failing for longer than 36 hours: Partner's link carries the account,
	// which reads fine for both; Bert's own link still says it is broken.
	p.exec(`UPDATE account_sources SET last_sync_at = '2026-11-17T02:00:00Z' WHERE connection_id = 1`)
	equalJSON(t, shared(p.bertH), `{"sourceRole": "primary", "carriedBy": {"name": "Partner", "me": false}, "viaReserve": true, "syncStatus": "ok", "syncError": null}`)
	equalJSON(t, shared(p.partnerH), `{"sourceRole": "reserve", "carriedBy": {"name": "Partner", "me": true}, "viaReserve": true, "syncStatus": "ok", "syncError": null}`)
	if got := p.text(`SELECT group_concat(status) FROM (SELECT status FROM account_sources WHERE connection_id = 1)`); got != "failed,failed" {
		t.Errorf("Bert's sources: %s", got)
	}
	p.assertInvariant()

	// A failed fallback row (broken() and the not_shared marking write them):
	// the account follows its carrier, Bert's healthy link, for both; only
	// Partner sees her link's failure, on her own connection.
	p.exec(`UPDATE provider_connections SET sync_status = 'ok', last_error = NULL WHERE id = 1`)
	p.exec(`UPDATE account_sources SET status = 'ok', last_error = NULL, last_sync_at = '2026-11-18T03:02:00Z' WHERE connection_id = 1`)
	p.exec(`UPDATE provider_connections SET sync_status = 'failed', last_error = 'ASPSP_ERROR', last_attempt_at = '2026-11-18T18:00:00Z' WHERE id = 2`)
	p.exec(`UPDATE account_sources SET status = 'failed', last_error = 'not_shared' WHERE account_id = 4 AND connection_id = 2`)
	equalJSON(t, shared(p.bertH), `{"sourceRole": "primary", `+bertCarries+`, "syncStatus": "ok", "syncError": null}`)
	equalJSON(t, shared(p.partnerH), `{"sourceRole": "reserve", "carriedBy": {"name": "Bert", "me": false}, "viaReserve": false, "syncStatus": "ok", "syncError": null}`)
	for _, c := range []struct {
		name  string
		h     http.Handler
		sync  string
		alert bool
	}{
		{"Bert", p.bertH, `[{"id": 1, "status": "ok", "lastSync": "2026-11-18T04:02:00+01:00", "error": null}]`, false},
		{"Partner", p.partnerH, `[{"id": 2, "status": "failed", "lastSync": "2026-11-18T04:05:00+01:00", "error": "ASPSP_ERROR"}]`, true},
	} {
		body := decode[map[string]json.RawMessage](t, do(t, c.h, "GET", "/api/sync", "").body)
		equalJSON(t, string(body["connections"]), c.sync)
		var alerted bool
		for _, a := range decode[[]ledger.Alert](t, do(t, c.h, "GET", "/api/alerts", "").body) {
			if a.Type == "sync" {
				alerted = true
				if a.AccountID != 0 || !strings.Contains(a.Title, "Synchronisatie mislukt") {
					t.Errorf("%s: alert %+v", c.name, a)
				}
			}
		}
		if alerted != c.alert {
			t.Errorf("%s: sync alert %v, want %v", c.name, alerted, c.alert)
		}
	}
	p.assertInvariant()
}

// sourceFieldsOf is sourceFields for one account, as a JSON object.
func (p *pair) sourceFieldsOf(h http.Handler, id string) string {
	p.t.Helper()
	return string(decode[map[string]json.RawMessage](p.t, p.sourceFields(h))[id])
}
