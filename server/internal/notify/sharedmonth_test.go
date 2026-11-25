package notify

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/planning"
)

// TestSharedMonth simulates a month of the 0.9-3b types on the shared world,
// from the upgrade on Monday 23 November 2026 06:00 to 22 December. The
// dispatcher runs at 03:00, 07:05, 12:30, 19:05 and 22:30, with a restart (a
// new Service) every fourth day; the sync at 04:00 records a good sync for
// every link whose consent still runs. Everyone switched "Bijdrage ontbreekt"
// on. The story:
//
//	Partner's KBC link (it alone feeds the Gedeelde rekening and the
//	Vakantiepot, which Bert manages) ends on 6 December: the 14-day and
//	3-day reminders and the lapse go to Partner and, as the manager
//	variant, to Bert
//	24 Nov 12:00  Bert invites Lezer onto the Gedeelde rekening
//	25 Nov 12:00  Lezer accepts: three parties from December on
//	24, 27 Nov, 2 Dec  the sync brings a new uncategorised row on Bert's
//	              Zichtrekening; 26 Nov a CSV import of 50 rows
//	1 Dec         Bert's contribution arrives; Partner's comes late (5 Dec);
//	              Lezer's never
//
// It checks the behaviours, not a golden list, and logs the transcript.
func TestSharedMonth(t *testing.T) {
	ctx := context.Background()
	h := sharedWorld(t, time.Date(2026, 12, 6, 11, 0, 0, 0, time.UTC))
	h.live = false
	store := ledger.New(h.d)
	h.exec(`INSERT INTO notification_prefs (user_id, type, push, email) VALUES (1, 'contrib', 1, 1), (2, 'contrib', 1, 1), (3, 'contrib', 1, 1)`)
	// The Gedeelde rekening: a balance and the month's costs, so it needs
	// contributions; each member pays from their own account.
	h.exec(`UPDATE accounts SET buffer = 50000 WHERE id = 4`)
	h.exec(`INSERT INTO balance_snapshots (account_id, balance, date, origin) VALUES (4, 40000, '2026-11-22', 'bank')`)
	h.exec(`INSERT INTO planned_items (account_id, date, amount, description) VALUES (4, '2026-12-15', -90000, 'Huur'), (4, '2027-01-15', -90000, 'Huur')`)
	if _, err := store.ClaimSender(ctx, bert, sharedA, a1, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimSender(ctx, partner, sharedA, ownP, 0); err != nil {
		t.Fatal(err)
	}

	at := func(n, hour, minute int) time.Time {
		return time.Date(2026, 11, 23+n, hour, minute, 0, 0, clock.Brussels)
	}
	var transcript []string
	var mails []mail.Message
	run := func(now time.Time) {
		t.Helper()
		if err := h.s.Run(ctx, now); err != nil {
			t.Fatal(err)
		}
		h.mail.mu.Lock()
		mails = append(mails, h.mail.sent...)
		h.mail.mu.Unlock()
		for _, line := range h.take() {
			user, rest, _ := strings.Cut(line, " ")
			channel, title, _ := strings.Cut(rest, ": ")
			transcript = append(transcript, fmt.Sprintf("%s  %-7s  %-7s  %-5s  %s", now.Format("Mon 02 Jan 15:04"), user, sharedType(title), channel, title))
		}
	}
	incoming := func(iban, date string, amount int64) {
		h.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, counterparty_iban, status, dedupe_key, source_connection_id)
			VALUES (4, ?, ?, 'Bijdrage', ?, 'booked', ?, 2)`, amount, date, iban, "in-"+date+iban)
	}
	var invitation int64
	for n := 0; n <= 29; n++ {
		if n == 0 {
			run(at(0, 6, 0)) // the upgrade: every baseline
		} else {
			run(at(n, 3, 0))
		}
		h.syncAll(at(n, 4, 0))
		date := at(n, 4, 0).Format(time.DateOnly)
		switch date {
		case "2026-11-24", "2026-11-27", "2026-12-02":
			h.bankRows(a1, 1, 1, date, 0)
		case "2026-11-26":
			batch := h.exec(`INSERT INTO import_batches (source, file_name, file_hash, account_id) VALUES ('csv', 'export.csv', 'h', 1)`)
			h.bankRows(a1, 0, 50, "2026-10-15", batch)
		case "2026-12-01":
			incoming(fullIBAN, date, 60000)
		case "2026-12-05":
			incoming(partnerIBAN, date, 60000)
		}
		if n%4 == 3 {
			h.s = h.service() // a restart
		}
		run(at(n, 7, 5))
		switch date {
		case "2026-11-24":
			inv, err := store.Invite(ctx, bert, sharedA, lezer, at(n, 12, 0))
			if err != nil {
				t.Fatal(err)
			}
			invitation = inv.ID
		case "2026-11-25":
			if _, err := store.AcceptInvitation(ctx, lezer, invitation, at(n, 12, 0)); err != nil {
				t.Fatal(err)
			}
		case "2026-12-03":
			f, err := planning.Forecast(ctx, h.d, sharedA, date, 0)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("the Gedeelde rekening needs %s in December (%+v)", ledger.Eur0(f.Months[0].Need.Amount), f.Months[0].Need)
		}
		run(at(n, 12, 30))
		run(at(n, 19, 5))
		run(at(n, 22, 30))
	}
	t.Logf("simulated month of 0.9-3b (%d messages):\n%s", len(transcript), strings.Join(transcript, "\n"))

	// count counts the lines of user (any when ""), typ and channel whose
	// line contains every part.
	count := func(user, typ, channel string, parts ...string) int {
		n := 0
		for _, line := range transcript {
			f := strings.Fields(line[18:])
			if user != "" && f[0] != user || typ != "" && f[1] != typ || channel != "" && f[2] != channel {
				continue
			}
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
		what               string
		user, typ, channel string
		parts              []string
		want               int
	}{
		{"nothing at the upgrade", "", "", "", []string{"Mon 23 Nov 06:00"}, 0},
		{"Partner's 14-day reminder", "Partner", "consent", "email", []string{"Je KBC-koppeling verloopt over 13 dagen (3 rekeningen)"}, 1},
		{"the manager's 14-day reminder, naming the 2 shared accounts", "Bert", "consent", "email", []string{"Partners KBC-koppeling verloopt over 13 dagen (2 rekeningen)"}, 1},
		{"the manager's last reminder", "Bert", "consent", "email", []string{"Laatste herinnering: Partners KBC"}, 1},
		{"every consent message, owner and manager", "", "consent", "", nil, 8},
		{"the manager's lapse", "Bert", "stop", "email", []string{"Partners KBC-koppeling is verlopen (2 rekeningen)"}, 1},
		{"Partner's lapse", "Partner", "stop", "email", nil, 1},
		{"no reminder about Bert's own link", "", "", "", []string{"Argenta"}, 0},
		{"the invitation e-mail", "Lezer", "invite", "email", nil, 1},
		{"the invitation push", "Lezer", "invite", "push", nil, 1},
		{"the join, to the manager", "Bert", "joined", "email", []string{"Lezer is erbij op de Gedeelde rekening"}, 1},
		{"the join, never to the member", "Partner", "joined", "", nil, 0},
		{"no digest e-mail (off by default)", "", "cat", "email", nil, 0},
		{"Bert's digests: his rows of 24, 27 Nov and 2 Dec, Partner's payment on 5 Dec", "Bert", "cat", "push", []string{"1 transactie"}, 4},
		{"no digest on the day of the import", "", "cat", "", []string{"Thu 26 Nov"}, 0},
		{"Partner's digest: Bert's payment, income for her", "Partner", "cat", "push", []string{"Tue 01 Dec"}, 1},
		{"Partner's own payment is a transfer for her", "Partner", "cat", "", []string{"Sat 05 Dec"}, 0},
		{"Lezer's own contribution", "Lezer", "contrib", "email", []string{"Thu 03 Dec 07:05", "Je bijdrage"}, 1},
		{"Partner's own (late) contribution", "Partner", "contrib", "email", []string{"Thu 03 Dec 07:05", "Je bijdrage"}, 1},
		{"the manager about Lezer and Partner", "Bert", "contrib", "email", []string{"Thu 03 Dec 07:05", "s bijdrage"}, 2},
		{"Bert paid: nothing about him", "", "contrib", "email", []string{"Berts"}, 0},
		{"the contributions only on the 3rd (4 e-mails, 4 pushes)", "", "contrib", "", []string{"Thu 03 Dec 07:05"}, 8},
		{"no other contribution message", "", "contrib", "", nil, 8},
		{"no push in quiet hours", "", "", "push", []string{"03:00"}, 0},
	} {
		if got := count(c.user, c.typ, c.channel, c.parts...); got != c.want {
			t.Errorf("%s: %d lines of %q %q %q with %q, want %d", c.what, got, c.user, c.typ, c.channel, c.parts, c.want)
		}
	}
	// The manager never learns anything about Partner's own account.
	for _, m := range mails {
		if m.To == "bert@example.com" || m.To == "lezer@example.com" {
			noneOf(t, m.Subject, m, "Rekening van Partner", partnerIBAN, "6769")
		}
	}
	// Nothing twice: every e-mail is a different message.
	seen := map[string]bool{}
	for _, line := range transcript {
		msg := line[18:]
		if strings.Contains(msg, "email") && seen[msg] {
			t.Errorf("sent twice: %q", line)
		}
		seen[msg] = true
	}
	assertVisible(t, h.d)
}

// sharedType names a transcript line's type from its subject or push title.
func sharedType(title string) string {
	for _, c := range []struct{ part, typ string }{
		{"is erbij op de", TypeJoined}, {"nodigt je uit", TypeInvite}, {"uitnodiging=", TypeInvite},
		{"bijdrage", TypeContrib}, {"Gedeelde rekening: let op", TypeContrib},
		{"Gedeelde rekening: er is iets nieuws", TypeJoined}, {"te categoriseren", TypeCat},
		{"koppeling verloopt", TypeConsent}, {"Laatste herinnering", TypeConsent}, {"Bankkoppeling verloopt", TypeConsent},
		{"Synchronisatie gestopt", TypeStop}, {"Bankkoppeling: actie nodig", TypeStop}, {"is verlopen", TypeStop}, {"werkt niet meer", TypeStop},
		{"staat rood", TypeRood}, {"Planning: actie nodig", TypeRood}, {"in de buffer", TypeBuffer}, {"Planning: let op", TypeBuffer},
	} {
		if strings.Contains(title, c.part) {
			return c.typ
		}
	}
	return "?"
}
