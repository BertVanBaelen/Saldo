package notify

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
)

// "Bijdrage ontbreekt" (0.9-3b step 5) on the demo: the Gedeelde rekening (4)
// needs € 872 in November, € 436 from Bert (manager) and from Partner, 50/50;
// nobody claimed a sender, so nothing has arrived for either. Both switched
// "Bijdrage ontbreekt" on (it is off by default). The trigger's baseline is
// taken as done on 1 November (before anything was due), so 18 November,
// 07:05 is the first day it acts.

func contribHarness(t *testing.T) *harness {
	t.Helper()
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
	h.exec(`INSERT INTO notification_prefs (user_id, type, push, email) VALUES (1, 'contrib', 1, 1), (2, 'contrib', 1, 1)`)
	h.exec(`INSERT INTO notify_runs (name, day) VALUES ('baseline:contrib', '2026-11-01')`)
	h.run(nov(18, 6, 0)) // every other trigger's baseline; contributions not yet (07:00)
	return h
}

func nov(d, hour, minute int) time.Time {
	return time.Date(2026, 11, d, hour, minute, 0, 0, clock.Brussels)
}

// contribOnly runs at now and returns the mails of the contribution type,
// checking their subjects; other types' lines are ignored.
func (h *harness) contribOnly(now time.Time, want ...string) []mail.Message {
	h.t.Helper()
	if err := h.s.Run(context.Background(), now); err != nil {
		h.t.Fatal(err)
	}
	h.mail.mu.Lock()
	var mails []mail.Message
	for _, m := range h.mail.sent {
		if strings.Contains(m.Subject, "bijdrage") {
			mails = append(mails, m)
		}
	}
	h.mail.mu.Unlock()
	var got []string
	for _, line := range h.take() {
		if strings.Contains(line, "bijdrage") || strings.Contains(line, "Gedeelde rekening: let op") {
			got = append(got, line)
		}
	}
	if strings.Join(got, "\n") != strings.Join(sorted(want), "\n") {
		h.t.Errorf("run at %s:\n got %q\nwant %q", now.Format(time.DateTime), got, sorted(want))
	}
	return mails
}

func sorted(s []string) []string {
	out := append([]string{}, s...)
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

// eur writes € as the mails do, with a non-breaking space.
func eur(s string) string { return strings.ReplaceAll(s, "€ ", "€ ") }

const contribPush = " push: Gedeelde rekening: let op /rekeningen/4"

func TestContribDemo436Each(t *testing.T) {
	h := contribHarness(t)
	mails := h.contribOnly(nov(18, 7, 5),
		"Bert email: Je bijdrage voor de Gedeelde rekening is er nog niet",
		"Bert email: Partners bijdrage voor de Gedeelde rekening is er nog niet",
		"Partner email: Je bijdrage voor de Gedeelde rekening is er nog niet",
		"Bert"+contribPush, "Bert"+contribPush, "Partner"+contribPush)
	for _, m := range mails {
		if !strings.Contains(m.Text, eur("€ 436")) || !strings.Contains(m.Text, "november") {
			t.Errorf("%s: no € 436 or month:\n%s", m.Subject, m.Text)
		}
		// The shared account only: no personal account, no IBAN of one.
		noneOf(t, m.Subject, m, "Zichtrekening", "4821", "5038")
	}
	if m := mailOf(t, mails, "partner@jouw-domein.be"); !strings.Contains(m.Text, eur("Je bijdrage van € 436 is er nog niet")) {
		t.Errorf("the member variant:\n%s", m.Text)
	}
	h.contribOnly(nov(18, 12, 30)) // once a day
	h.contribOnly(nov(19, 7, 5))   // once a month
	h.contribOnly(nov(30, 7, 5))
	assertVisible(t, h.d)
	if n := h.count(`type = 'contrib' AND dedupe = 'contrib:4|2026-11|2'`); n != 4 {
		t.Errorf("Partner's part: %d log rows, want 4 (her own and the manager's, two channels each)", n)
	}
}

func TestContribPartial(t *testing.T) {
	h := contribHarness(t)
	// Bert owes nothing (share 0), Partner all (100 %): her € 450 of 1
	// November (claimed from her own account) is part of € 872.
	h.exec(`UPDATE account_access SET contribution_share = CASE user_id WHEN 1 THEN 0 ELSE 100 END WHERE account_id = 4`)
	if _, err := ledger.New(h.d).ClaimSender(context.Background(), demo.Partner, 4, 5, 0); err != nil {
		t.Fatal(err)
	}
	mails := h.contribOnly(nov(18, 7, 5),
		"Partner email: Je bijdrage voor de Gedeelde rekening is nog niet volledig",
		"Bert email: Partners bijdrage voor de Gedeelde rekening is nog niet volledig",
		"Bert"+contribPush, "Partner"+contribPush)
	if m := mailOf(t, mails, "partner@jouw-domein.be"); !strings.Contains(m.Text, eur("€ 450 van € 872 is binnen")) {
		t.Errorf("partial:\n%s", m.Text)
	}
}

// TestContribPaidBeforeTheRun: Partner claims her sender on the morning of
// the first day the check acts, before 07:00: nothing is sent about her.
func TestContribPaidBeforeTheRun(t *testing.T) {
	h := contribHarness(t)
	if _, err := ledger.New(h.d).ClaimSender(context.Background(), demo.Partner, 4, 5, 0); err != nil {
		t.Fatal(err)
	}
	h.contribOnly(nov(18, 7, 5), "Bert email: Je bijdrage voor de Gedeelde rekening is er nog niet", "Bert"+contribPush)
}

func TestContribSplit7030(t *testing.T) {
	h := contribHarness(t)
	h.exec(`UPDATE account_access SET contribution_share = CASE user_id WHEN 1 THEN 70 ELSE 30 END WHERE account_id = 4`)
	mails := h.contribOnly(nov(18, 7, 5),
		"Bert email: Je bijdrage voor de Gedeelde rekening is er nog niet",
		"Bert email: Partners bijdrage voor de Gedeelde rekening is er nog niet",
		"Partner email: Je bijdrage voor de Gedeelde rekening is er nog niet",
		"Bert"+contribPush, "Bert"+contribPush, "Partner"+contribPush)
	// 87118 cents × 70 % = € 609,83 → € 610; × 30 % = € 261,35 → € 262.
	if m := mailOf(t, mails, "partner@jouw-domein.be"); !strings.Contains(m.Text, eur("Je bijdrage van € 262 is er nog niet")) {
		t.Errorf("Partner's 30 %%:\n%s", m.Text)
	}
	for _, m := range mails {
		if m.To == "bert@jouw-domein.be" && strings.HasPrefix(m.Subject, "Je") && !strings.Contains(m.Text, eur("Je bijdrage van € 610 is er nog niet")) {
			t.Errorf("Bert's 70 %%:\n%s", m.Text)
		}
	}
	// A share of 0 owes nothing.
	h2 := contribHarness(t)
	h2.exec(`UPDATE account_access SET contribution_share = CASE user_id WHEN 1 THEN 100 ELSE 0 END WHERE account_id = 4`)
	h2.contribOnly(nov(18, 7, 5), "Bert email: Je bijdrage voor de Gedeelde rekening is er nog niet", "Bert"+contribPush)
}

// TestContribNotInTheJoinMonthNorBeforeThe3rd: a member who joined this month
// owes nothing yet; nothing goes before the 3rd; a contributor without Saldo
// is told to the manager only.
func TestContribJoinMonthAndContributor(t *testing.T) {
	h := contribHarness(t)
	h.exec(`UPDATE account_access SET joined_at = '2026-11-10T10:00:00Z' WHERE account_id = 4 AND user_id = 2`)
	name, iban := "Anna", "BE71096123456769"
	if _, err := ledger.New(h.d).AddContributor(context.Background(), demo.Bert, 4, ledger.ContributorInput{Name: &name, IBAN: &iban}); err != nil {
		t.Fatal(err)
	}
	h.exec(`UPDATE contributors SET created_at = '2026-10-01T10:00:00Z'`) // added last month
	// Three parties: € 871,18 / 3 → € 291 each.
	mails := h.contribOnly(nov(18, 7, 5),
		"Bert email: Je bijdrage voor de Gedeelde rekening is er nog niet",
		"Bert email: Anna's bijdrage voor de Gedeelde rekening is er nog niet",
		"Bert"+contribPush, "Bert"+contribPush)
	for _, m := range mails {
		if !strings.Contains(m.Text, eur("€ 291")) {
			t.Errorf("a third: %s\n%s", m.Subject, m.Text)
		}
	}
	if n := h.count(`dedupe LIKE 'contrib:4|2026-11|c%' AND user_id = 2`); n != 0 {
		t.Errorf("Partner (a member, not the manager) has %d rows about the contributor", n)
	}
	// Before the 3rd of December nothing; on the 3rd December's parts.
	h.contribOnly(time.Date(2026, 12, 2, 7, 5, 0, 0, clock.Brussels))
	if n := h.count(`dedupe LIKE 'contrib:4|2026-12|%'`); n != 0 {
		t.Errorf("%d December rows before the 3rd", n)
	}
	h.s.Run(context.Background(), time.Date(2026, 12, 3, 7, 5, 0, 0, clock.Brussels))
	h.take()
	if n := h.count(`dedupe LIKE 'contrib:4|2026-12|%' AND status = 'sent'`); n == 0 {
		t.Error("nothing for December on the 3rd")
	}
}

// TestContribBaseline: what is missing at the upgrade is suppressed.
func TestContribBaseline(t *testing.T) {
	h := contribHarness(t)
	h.exec(`DELETE FROM notify_runs WHERE name = 'baseline:contrib'`)
	h.contribOnly(nov(18, 7, 5))
	h.contribOnly(nov(19, 7, 5))
	if n := h.count(`type = 'contrib' AND status = 'suppressed'`); n != 6 {
		t.Errorf("%d suppressed rows, want 6", n)
	}
}
