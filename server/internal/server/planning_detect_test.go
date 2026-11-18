package server

import (
	"strings"
	"testing"
)

func TestPlanningDetectRoutes(t *testing.T) {
	h, _ := demoServer(t)
	hp, _ := demoServer(t, asPartner)
	for _, tc := range []struct {
		target string
		status int
		has    string
	}{
		{"/api/planning/suggestions", 200, `"counterparty":"Decathlon","description":"Decathlon","amount":-4290,"amountRule":"fixed","frequency":"quarterly","day":27,"month":9,"kind":"expense","seen":4`},
		{"/api/planning/suggestions?scope=elders", 400, "Kies alles, persoonlijk of gedeeld."},
		{"/api/planning/detection?account=1", 200, `"frequency":"quarterly","length":4,"extras":1`},
		{"/api/planning/detection?account=2", 400, "Kies een betaalrekening."},
		{"/api/planning/detection?account=5", 404, msgAccountNotFound},
		{"/api/planning/detection?account=x", 404, msgAccountNotFound},
	} {
		r := do(t, h, "GET", tc.target, "")
		if r.status != tc.status || !strings.Contains(r.body, tc.has) {
			t.Errorf("%s: %d %s", tc.target, r.status, r.body)
		}
	}
	// The shared account's suggestions do not depend on who looks.
	b, p := do(t, h, "GET", "/api/planning/suggestions?scope=gedeeld", ""), do(t, hp, "GET", "/api/planning/suggestions?scope=gedeeld", "")
	if b.status != 200 || b.body != p.body || !strings.Contains(b.body, `"counterparty":"Action"`) {
		t.Errorf("gedeeld: Bert %d %s, Partner %d %s", b.status, b.body, p.status, p.body)
	}
}
