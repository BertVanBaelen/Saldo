package notify

import (
	"context"
	"sync"
	"testing"
	"time"
)

// What the planning messages say (generic push, plan 0.9-3 step 4).
const (
	redFeb     = "Bert email: Zichtrekening staat rood in februari"
	redFebPush = "Bert push: Planning: actie nodig /planning?maand=2027-02&rekening=1#maanden"
	bufJanPush = "Bert push: Planning: let op /planning?maand=2027-01&rekening=1#maanden"
)

// sharedRed is the e-mail and push of a red month of the shared account.
func sharedRed(who, month, label string) []string {
	return []string{who + " email: Gedeelde rekening staat rood in " + label,
		who + " push: Planning: actie nodig /planning?maand=" + month + "&rekening=2#maanden"}
}

// TestPlanningFirstRunSendsNothing: an account that is already red and in the
// buffer at the upgrade sends nothing, on the first run or after it; a state
// that changes afterwards sends one message.
func TestPlanningFirstRunSendsNothing(t *testing.T) {
	h := planningHarness(t)
	h.plan(a1, "2027-01-10", -60000)  // January ends at € 400: buffer
	h.plan(a1, "2027-02-10", -200000) // February ends at −€ 1.600: red
	h.run(day(0, 7, 30))
	if n := h.count(`status = 'suppressed' AND account_id = 1`); n != 4 {
		t.Errorf("the baseline logged %d rows, want red and buffer on both channels", n)
	}
	h.run(day(0, 7, 45))
	h.run(day(1, 7, 5))
	h.runOn(h.service(), day(2, 7, 5))
	// December goes red: that is new.
	h.plan(a1, "2026-12-10", -150000)
	h.run(day(3, 7, 5), "Bert email: Zichtrekening staat rood in december", "Bert push: Planning: actie nodig /planning?maand=2026-12&rekening=1#maanden")
	h.run(day(4, 7, 5))
}

// TestPlanningOncePerKey is the repeat protection: two runs, a restart in
// between, two goroutines.
func TestPlanningOncePerKey(t *testing.T) {
	h := planningHarness(t)
	h.run(day(0, 6, 0)) // the baseline, before 07:00: nothing to record
	h.plan(a1, "2027-02-10", -200000)
	h.run(day(0, 6, 45))                    // not due before 07:00
	h.run(day(0, 7, 0), redFeb, redFebPush) // 07:00:00 is no longer quiet
	h.run(day(0, 7, 15))
	h.runOn(h.service(), day(0, 9, 0)) // a restart
	h.exec(`DELETE FROM notify_runs WHERE name = 'planning'`)
	h.runOn(h.service(), day(0, 9, 15)) // a restart that lost the day: the log still holds
	h.run(day(1, 7, 5))
	h.run(day(30, 7, 5)) // still red, still once

	// Two processes at once.
	g := planningHarness(t)
	g.run(day(0, 6, 0))
	g.plan(a1, "2027-02-10", -200000)
	var wg sync.WaitGroup
	for range 2 {
		s := g.service()
		wg.Go(func() {
			if err := s.Run(context.Background(), day(0, 7, 5)); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if got := g.take(); len(got) != 2 {
		t.Errorf("two runs at once sent %q, want one e-mail and one push", got)
	}
}

// TestPlanningReArm: red, back to ok, red again for the same month sends
// twice; a month that passed is re-armed too.
func TestPlanningReArm(t *testing.T) {
	h := planningHarness(t)
	h.run(day(0, 6, 0))
	p := h.plan(a1, "2027-02-10", -200000)
	h.run(day(1, 7, 5), redFeb, redFebPush)
	h.unplan(p)
	h.run(day(2, 7, 5))
	if n := h.count(`account_id = 1`); n != 0 {
		t.Errorf("%d rows left for an account that is ok again", n)
	}
	h.plan(a1, "2027-02-12", -200000)
	h.run(day(3, 7, 5), redFeb, redFebPush)
	h.run(day(4, 7, 5))

	// A row of a past month goes, whatever its state.
	h.exec(`INSERT INTO notification_log (user_id, type, account_id, month, state, channel, dedupe, status)
		VALUES (1, 'rood', 1, '2026-10', 'red', 'email', 'account:1|rood|2026-10|red', 'sent')`)
	h.run(day(5, 7, 5))
	if n := h.count(`month = '2026-10'`); n != 0 {
		t.Errorf("the row of October survived")
	}
}

// TestPlanningSilentDowngrade: a red month that improves to the buffer is
// silent; it re-arms only when the month is ok.
func TestPlanningSilentDowngrade(t *testing.T) {
	h := planningHarness(t)
	h.run(day(0, 6, 0))
	p := h.plan(a1, "2027-02-10", -200000)
	h.run(day(1, 7, 5), redFeb, redFebPush)
	h.unplan(p)
	p = h.plan(a1, "2027-02-10", -60000) // February ends at € 400: the buffer
	h.run(day(2, 7, 5))
	h.run(day(3, 7, 5))
	if n := h.count(`dedupe = 'account:1|buffer|2027-02|buffer' AND status = 'suppressed'`); n != 2 {
		t.Errorf("the downgrade logged %d suppressed rows, want 2", n)
	}
	h.unplan(p)
	h.plan(a1, "2027-02-10", -200000) // red again, without having been ok
	h.run(day(4, 7, 5))
	h.exec(`DELETE FROM planned_items`) // ok
	h.run(day(5, 7, 5))
	h.plan(a1, "2027-02-10", -60000) // buffer after ok: a message (push only, the buffer e-mail is off by default)
	h.run(day(6, 7, 5), "Bert push: Planning: let op /planning?maand=2027-02&rekening=1#maanden")
}

// TestPlanningOnePerMorning: red and buffer of one account become true on the
// same night: red the first morning, buffer the next (push only: the buffer
// e-mail is off by default); a restart in between changes nothing.
func TestPlanningOnePerMorning(t *testing.T) {
	h := planningHarness(t)
	h.run(day(0, 6, 0))
	h.plan(a1, "2027-01-10", -60000)
	h.plan(a1, "2027-02-10", -200000)
	h.run(day(1, 7, 5), redFeb, redFebPush)
	h.run(day(1, 7, 20))
	h.exec(`DELETE FROM notify_runs WHERE name = 'planning'`) // as if the day was never recorded
	h.runOn(h.service(), day(1, 8, 0))
	h.run(day(2, 7, 5), bufJanPush)
	h.run(day(3, 7, 5))
	if n := h.count(`dedupe = 'account:1|buffer|2027-01|buffer' AND channel = 'email' AND status = 'suppressed'`); n != 1 {
		t.Error("the buffer e-mail (off by default) has no suppressed row")
	}
}

// TestPlanningVisibility: Partner never hears of Bert's own account; the
// read-only member gets the shared account's; a member who left between the
// claim and the send gets nothing and nothing is logged for them.
func TestPlanningVisibility(t *testing.T) {
	h := planningHarness(t)
	h.run(day(0, 6, 0))
	h.plan(a1, "2027-02-10", -200000)
	h.plan(a2, "2027-01-10", -200000)
	left := false
	h.s.afterClaim = func(m Message, ch string) {
		if m.User == partner && !left {
			left = true
			h.exec(`DELETE FROM account_access WHERE account_id = 2 AND user_id = 2`)
		}
	}
	want := append([]string{redFeb, redFebPush}, sharedRed("Bert", "2027-01", "januari")...)
	want = append(want, sharedRed("Lezer", "2027-01", "januari")...)
	h.run(day(1, 7, 5), want...)
	if !left {
		t.Fatal("the hook did not run for Partner")
	}
	if n := h.count(`user_id = 2 AND dedupe <> ?`, digestStart); n != 0 { // the digest's silent first mark (0.9-3b) is no message
		t.Errorf("%d log rows for Partner, who left before the send", n)
	}
	h.run(day(2, 7, 5))

	// Partner back on the shared account: its message, never Bert's own.
	h.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (2, 2, 'member', 'edit')`)
	h.run(day(3, 7, 5), sharedRed("Partner", "2027-01", "januari")...)
	if n := h.count(`user_id = 2 AND account_id = 1`); n != 0 {
		t.Errorf("Partner has %d rows about Bert's own account", n)
	}
}

// TestPlanningStaleData: a bank account whose newest data is older than 3
// days warns nobody; once the sync brings fresh data it does.
func TestPlanningStaleData(t *testing.T) {
	h := planningHarness(t)
	h.exec(`INSERT INTO provider_connections (id, user_id, provider, aspsp_name, status, consent_since, valid_until, last_sync_at, sync_status)
		VALUES (1, 1, 'enablebanking', 'Argenta', 'active', '2026-11-01', '2027-05-01T11:00:00Z', ?, 'ok')`, stamp(day(0, 4, 0)))
	h.exec(`UPDATE accounts SET source = 'bank', bank_name = 'Argenta' WHERE id = 1`)
	h.exec(`INSERT INTO account_sources (account_id, connection_id, priority, status, last_sync_at) VALUES (1, 1, 'primary', 'ok', ?)`, stamp(day(-4, 4, 0)))
	h.run(day(0, 6, 0))
	h.plan(a1, "2027-02-10", -200000)
	h.run(day(1, 7, 5)) // newest data from the 14th: stale on the 19th
	h.exec(`UPDATE account_sources SET last_sync_at = ? WHERE account_id = 1`, stamp(day(1, 9, 0)))
	h.run(day(1, 9, 15)) // the day's run is done: tomorrow
	h.run(day(2, 7, 5), redFeb, redFebPush)
}

// TestPlanningQuietHours: a planning run that only gets to run late in the
// evening (the add-on was off all day) mails at once; the push waits for
// 07:00 and the day is not closed until it went.
func TestPlanningQuietHours(t *testing.T) {
	h := planningHarness(t)
	h.run(day(0, 6, 0))
	h.plan(a1, "2027-02-10", -200000)
	h.run(day(0, 23, 0), redFeb)
	h.run(day(0, 23, 15))
	h.run(day(1, 3, 0))
	h.run(day(1, 6, 59))
	h.run(day(1, 7, 0), redFebPush)
	h.run(day(2, 7, 5))

	// Quiet hours off: no waiting.
	g := planningHarness(t)
	g.exec(`UPDATE users SET quiet_hours = 0`)
	g.run(day(0, 6, 0))
	g.plan(a1, "2027-02-10", -200000)
	g.run(day(0, 23, 0), redFeb, redFebPush)

	for _, c := range []struct {
		at    time.Time
		quiet bool
	}{
		{day(0, 21, 59).Add(59 * time.Second), false}, {day(0, 22, 0), true}, {day(1, 3, 0), true},
		{day(1, 6, 59).Add(59 * time.Second), true}, {day(1, 7, 0), false}, {day(1, 12, 0), false},
	} {
		if quietAt(c.at) != c.quiet {
			t.Errorf("quietAt(%s) = %v", c.at.Format(time.TimeOnly), !c.quiet)
		}
	}
}

// TestPlanningLookAheadPerUser: each member is warned within their own
// look-ahead of 1, 3 or 6 months.
func TestPlanningLookAheadPerUser(t *testing.T) {
	h := planningHarness(t)
	h.exec(`UPDATE users SET lookahead_months = 1 WHERE id = 1`)
	h.exec(`UPDATE users SET lookahead_months = 3 WHERE id = 2`)
	h.exec(`UPDATE users SET lookahead_months = 6 WHERE id = 3`)
	h.run(day(0, 6, 0))
	h.plan(a2, "2027-04-10", -200000) // five months on
	h.run(day(1, 7, 5), sharedRed("Lezer", "2027-04", "april")...)
	h.plan(a2, "2027-01-10", -200000) // two months on
	h.run(day(2, 7, 5), append(sharedRed("Partner", "2027-01", "januari"), sharedRed("Lezer", "2027-01", "januari")...)...)
	h.plan(a2, "2026-12-10", -200000) // next month
	want := append(sharedRed("Bert", "2026-12", "december"), sharedRed("Partner", "2026-12", "december")...)
	h.run(day(3, 7, 5), append(want, sharedRed("Lezer", "2026-12", "december")...)...)
}

// TestPlanningChannels: a chip off, the e-mail channel off and a user without
// a push device get suppressed rows; switching them on later replays nothing.
func TestPlanningChannels(t *testing.T) {
	h := planningHarness(t)
	h.exec(`INSERT INTO notification_prefs (user_id, type, push, email) VALUES (1, 'rood', 1, 0)`) // Bert: no red e-mail
	h.exec(`UPDATE users SET notify_email = 0 WHERE id = 2`)                                       // Partner: no e-mail at all
	h.exec(`DELETE FROM push_subscriptions WHERE user_id = 3`)                                     // Lezer: no phone
	h.run(day(0, 6, 0))
	h.plan(a2, "2027-01-10", -200000)
	h.run(day(1, 7, 5),
		"Bert push: Planning: actie nodig /planning?maand=2027-01&rekening=2#maanden",
		"Partner push: Planning: actie nodig /planning?maand=2027-01&rekening=2#maanden",
		"Lezer email: Gedeelde rekening staat rood in januari")
	h.exec(`UPDATE notification_prefs SET email = 1 WHERE user_id = 1`)
	h.exec(`UPDATE users SET notify_email = 1 WHERE id = 2`)
	h.subscribe(lezer, "lezer2")
	h.run(day(2, 7, 5))
	h.run(day(3, 7, 5))
	if n := h.count(`status = 'suppressed' AND dedupe = 'account:2|rood|2027-01|red'`); n != 3 {
		t.Errorf("%d suppressed rows, want one per channel that was off", n)
	}
	// The next change goes to every channel that is on now.
	h.plan(a2, "2026-12-10", -200000)
	want := append(sharedRed("Bert", "2026-12", "december"), sharedRed("Partner", "2026-12", "december")...)
	h.run(day(4, 7, 5), append(want, sharedRed("Lezer", "2026-12", "december")...)...)
}

// TestPlanningFailingMailCloses: a mail server that keeps refusing keeps the
// day open until 10:00 (each run retries), then the day is recorded: a red
// month planned at 14:00 goes out the next morning, not at 14:15.
func TestPlanningFailingMailCloses(t *testing.T) {
	h := planningHarness(t)
	h.run(day(0, 6, 0))
	h.plan(a1, "2027-02-10", -200000)
	h.mail.fail = true
	h.run(day(1, 7, 5), redFebPush)
	h.run(day(1, 7, 20))
	if day, _ := h.s.runDay(context.Background(), "planning"); day != "" {
		t.Errorf("the day was recorded at %s while the e-mail failed", day)
	}
	h.run(day(1, 10, 5))
	if got, _ := h.s.runDay(context.Background(), "planning"); got != "2026-11-19" {
		t.Errorf("the day after 10:00: %q", got)
	}
	h.mail.fail = false
	h.plan(a1, "2026-12-10", -150000)
	h.run(day(1, 14, 15))
	h.run(day(2, 7, 5), "Bert email: Zichtrekening staat rood in december", "Bert push: Planning: actie nodig /planning?maand=2026-12&rekening=1#maanden")
}

// TestPlanningStaleClaimOfAChannelTurnedOff: a claim left by a crash on a
// channel that is off by the next run becomes suppressed, so the key is
// handled and the buffer warning can follow.
func TestPlanningStaleClaimOfAChannelTurnedOff(t *testing.T) {
	h := planningHarness(t)
	h.exec(`INSERT INTO notification_prefs (user_id, type, push, email) VALUES (1, 'buffer', 1, 1)`)
	h.run(day(0, 6, 0))
	h.plan(a1, "2027-01-10", -60000)
	h.plan(a1, "2027-02-10", -200000)
	h.exec(`INSERT INTO notification_log (user_id, type, account_id, month, state, channel, dedupe, status, claimed_at)
		VALUES (1, 'rood', 1, '2027-02', 'red', 'push', 'account:1|rood|2027-02|red', 'claimed', ?)`, stamp(day(1, 6, 54)))
	h.exec(`DELETE FROM push_subscriptions WHERE user_id = 1`) // the phone was signed out
	h.run(day(1, 7, 5), redFeb)
	if n := h.count(`dedupe = 'account:1|rood|2027-02|red' AND channel = 'push' AND status = 'suppressed'`); n != 1 {
		t.Error("the stale claim is still open")
	}
	h.run(day(2, 7, 5), "Bert email: Zichtrekening zakt in januari in de buffer")
}
