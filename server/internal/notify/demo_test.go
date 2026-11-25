package notify

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
)

// TestDemoMonth simulates a month of the demo story with a fake clock, from
// the upgrade on Wednesday 18 November 2026 07:05 to 18 December: the
// nightly sync at 04:00 for every link whose consent still runs, the
// dispatcher at 03:00, 07:05, 12:30 and 22:30, with a restart (a new
// Service) every fourth day. The story, edits made at 12:00:
//
//	19 Nov  Bert sets the yearly Familiale verzekering aside and deletes the
//	        Autoherstelling of February (both of the demo's warnings go)
//	20 Nov  he confirms the insurance again: January in the buffer again
//	21 Nov  he plans the Autoherstelling again: February red again
//	24 Nov  he deletes it: February stays in the buffer (€ 866 of € 900),
//	        so the red row is kept (a silent downgrade); 25 Nov he plans it
//	        again: still the same red month, nothing new
//	26 Nov  he deletes it and plans € 300 from his savings in January:
//	        February ok, re-armed; 27 Nov he plans the repair once more:
//	        red again, a second message
//	28 Nov  he renews his Argenta consent; Partner never renews hers (2 Dec)
//
// The sync brings each monthly confirmed item on its day as a booked row
// (the demo's own rows end on 18 November).
//
// It checks the behaviours, not a golden list, and logs the transcript.
func TestDemoMonth(t *testing.T) {
	ctx := context.Background()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(ctx, d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := demo.Seed(ctx, d, fake.Provider{}, nil); err != nil {
		t.Fatal(err)
	}
	h := newHarnessOn(t, d)
	h.subscribe(demo.Bert, "bert")
	h.subscribe(demo.Partner, "partner")

	at := func(n, hour, minute int) time.Time {
		return time.Date(2026, 11, 18+n, hour, minute, 0, 0, clock.Brussels)
	}
	var transcript []string
	run := func(now time.Time) {
		t.Helper()
		if err := h.s.Run(ctx, now); err != nil {
			t.Fatal(err)
		}
		for _, line := range h.take() {
			transcript = append(transcript, fmt.Sprintf("%s  %-7s  %s", now.Format("Mon 02 Jan 15:04"), typeOf(line), line))
		}
	}
	autoherstelling := func() {
		h.exec(`INSERT INTO planned_items (account_id, created_by, date, amount, description) VALUES (1, 1, '2027-02-10', -200000, 'Autoherstelling')`)
	}

	for n := 0; n <= 30; n++ {
		if n > 0 {
			run(at(n, 3, 0))
			sync := stamp(at(n, 4, 0))
			h.exec(`UPDATE account_sources SET last_sync_at = ? WHERE status = 'ok' AND connection_id IN
				(SELECT id FROM provider_connections WHERE valid_until > ?)`, sync, sync)
			h.exec(`UPDATE provider_connections SET last_sync_at = ?, sync_status = 'ok' WHERE valid_until > ?`, sync, sync)
			// The sync brings yesterday's bookings: every confirmed monthly item
			// due yesterday, as the bank books it (the demo's rows end on the 18th).
			y := at(n-1, 12, 0)
			h.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, counterparty_iban, status, dedupe_key)
				SELECT account_id, amount, ?, counterparty, counterparty_iban, 'booked', 'sim-' || id || '-' || ?
				FROM recurring_items WHERE state = 'confirmed' AND frequency = 'monthly' AND expected_day = ?`,
				y.Format(time.DateOnly), y.Format(time.DateOnly), y.Day())
		}
		if n%4 == 3 {
			h.s = h.service() // a restart
		}
		run(at(n, 7, 5))
		switch n {
		case 1:
			h.exec(`UPDATE recurring_items SET state = 'ignored' WHERE description = 'Familiale verzekering'`)
			h.exec(`DELETE FROM planned_items WHERE description = 'Autoherstelling'`)
		case 2:
			h.exec(`UPDATE recurring_items SET state = 'confirmed' WHERE description = 'Familiale verzekering'`)
		case 3, 7, 9:
			autoherstelling()
		case 6:
			h.exec(`DELETE FROM planned_items WHERE description = 'Autoherstelling'`)
		case 8:
			h.exec(`DELETE FROM planned_items WHERE description = 'Autoherstelling'`)
			h.exec(`INSERT INTO planned_items (account_id, created_by, date, amount, description) VALUES (1, 1, '2027-01-05', 30000, 'Van spaarrekening')`)
		case 10:
			h.exec(`UPDATE provider_connections SET valid_until = '2027-05-27T11:00:00Z', consent_since = '2026-11-28' WHERE id = 1`)
		}
		run(at(n, 12, 30))
		run(at(n, 22, 30))
	}
	t.Logf("simulated month on the demo (%d messages):\n%s", len(transcript), strings.Join(transcript, "\n"))

	count := func(parts ...string) int {
		n := 0
		for _, line := range transcript {
			all := true
			for _, p := range parts {
				all = all && strings.Contains(line, p)
			}
			if all {
				n++
			}
		}
		return n
	}
	for _, c := range []struct {
		what  string
		parts []string
		want  int
	}{
		{"nothing on the morning of the upgrade (the baseline)", []string{"Wed 18 Nov 07:05"}, 0},
		{"the red February e-mail, after each new Autoherstelling", []string{"Bert email: Zichtrekening staat rood in februari"}, 2},
		{"the red February push", []string{"Bert push: Planning: actie nodig /planning?maand=2027-02&rekening=1#maanden"}, 2},
		{"the January buffer, push only, once after the insurance came back", []string{"Bert push: Planning: let op /planning?maand=2027-01&rekening=1#maanden"}, 1},
		{"no buffer e-mail (off by default)", []string{"email: Zichtrekening zakt"}, 0},
		{"nothing for a red month that never was ok in between", []string{"Thu 26 Nov"}, 0},
		{"Partner never hears of Bert's account", []string{"Partner", "rekening=1"}, 0},
		{"nothing about the shared account", []string{"rekening=4"}, 0},
		{"nothing about Partner's account", []string{"rekening=5"}, 0},
		{"a planning push only at 07:05", []string{"22:30", "Planning:"}, 0},
		{"no push in quiet hours", []string{"03:00", "push:"}, 0},
		{"Partner's consent lapses once", []string{"Partner email: Synchronisatie gestopt bij"}, 1},
	} {
		if got := count(c.parts...); got != c.want {
			t.Errorf("%s: %d lines with %q, want %d", c.what, got, c.parts, c.want)
		}
	}
	// Nothing twice: every e-mail is a different message (the generic pushes
	// repeat their text by design).
	seen := map[string]string{}
	for _, line := range transcript {
		msg := line[strings.LastIndex(line, "  ")+2:]
		if prev, ok := seen[msg]; ok && strings.Contains(msg, "email:") && !strings.Contains(msg, "rood in februari") {
			t.Errorf("sent twice: %q (%s)", msg, prev)
		}
		seen[msg] = line
	}
	// Each red February went out the morning after it was planned, and only then.
	for _, when := range []string{"Sun 22 Nov 07:05", "Sat 28 Nov 07:05"} {
		if count(when, "rood in februari") != 1 {
			t.Errorf("no red February e-mail on %s", when)
		}
	}
}

// typeOf names the type of a transcript line from its subject or push title.
func typeOf(line string) string {
	for _, c := range []struct{ part, typ string }{
		{"staat rood", TypeRood}, {"Planning: actie nodig", TypeRood}, {"in de buffer", TypeBuffer}, {"Planning: let op", TypeBuffer},
		{"koppeling verloopt", TypeConsent}, {"Laatste herinnering", TypeConsent}, {"Bankkoppeling verloopt", TypeConsent},
		{"Synchronisatie gestopt", TypeStop}, {"Bankkoppeling: actie nodig", TypeStop},
	} {
		if strings.Contains(line, c.part) {
			return c.typ
		}
	}
	return "?"
}
