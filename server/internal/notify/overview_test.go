package notify

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand/v2"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
	"github.com/BertVanBaelen/Saldo/server/internal/receipt"
)

// The week and month overviews on the demo story (history to Wednesday 18
// November 2026) with a fake clock, the fake push sender and a recording
// mailer. Weeks and months after the 18th hold only the rows a test books.

// ovH is the harness with the e-mails and pushes it has seen, in full.
type ovH struct {
	*harness
	mails     []mail.Message // every e-mail that went out, oldest first
	pushes    []push.Sent    // every push
	freshMail []mail.Message // what the last take returned
	freshPush []push.Sent
}

func ovHarness(t *testing.T) *ovH {
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
	h := &ovH{harness: newHarnessOn(t, d)}
	h.subscribe(demo.Bert, "bert")
	h.subscribe(demo.Partner, "partner")
	return h
}

// ovAt is a moment in Brussels.
func ovAt(y int, m time.Month, d, hour, minute int) time.Time {
	return time.Date(y, m, d, hour, minute, 0, 0, clock.Brussels)
}

// at is a moment in November 2026 (day may run into December).
func ovNov(d, hour, minute int) time.Time { return ovAt(2026, time.November, d, hour, minute) }

// on switches the push and the e-mail chip of both types on for the users.
func (h *ovH) on(users ...int64) {
	for _, u := range users {
		for _, typ := range []string{TypeWeek, TypeMonth} {
			h.prefs(u, typ, true, true)
		}
	}
}

func (h *ovH) prefs(user int64, typ string, pushOn, emailOn bool) {
	h.t.Helper()
	h.exec(`INSERT INTO notification_prefs (user_id, type, push, email) VALUES (?, ?, ?, ?)
		ON CONFLICT (user_id, type) DO UPDATE SET push = excluded.push, email = excluded.email`, user, typ, pushOn, emailOn)
}

// book adds a booked transaction (amount in cents, negative = out) in the
// category with this name ("" = uncategorised).
func (h *ovH) book(account int64, date string, amount int64, counterparty, category string) {
	h.t.Helper()
	h.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, category_id, category_origin)
		VALUES (?, ?, ?, ?, 'booked', 'ov-' || (SELECT COALESCE(MAX(id), 0) + 1 FROM transactions),
		(SELECT id FROM categories WHERE name = ?), CASE WHEN ? = '' THEN NULL ELSE 'manual' END)`,
		account, amount, date, counterparty, category, category)
}

// lines runs the week and month triggers at now (as Run does, but without
// the other triggers, so this test does not depend on their warnings) and
// returns the overview messages that went out, sorted.
func (h *ovH) lines(now time.Time) []string {
	h.t.Helper()
	return h.linesOn(h.s, now)
}

func (h *ovH) linesOn(s *Service, now time.Time) []string {
	h.t.Helper()
	if err := ovTriggers(s, now); err != nil {
		h.t.Fatal(err)
	}
	return h.take()
}

// check runs the triggers at now and compares what went out.
func (h *ovH) check(now time.Time, want ...[]string) {
	h.t.Helper()
	h.compare(now, h.lines(now), want...)
}

func (h *ovH) compare(now time.Time, got []string, want ...[]string) {
	h.t.Helper()
	all := slices.Concat(want...)
	slices.Sort(all)
	if strings.Join(got, "\n") != strings.Join(all, "\n") {
		h.t.Errorf("run at %s:\n got %q\nwant %q", now.Format(time.DateTime), got, all)
	}
}

// ovTriggers is Run for the two overview triggers: the baseline of a
// trigger's first run, else the trigger.
func ovTriggers(s *Service, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ctx := context.Background()
	var errs []error
	for _, tr := range s.triggers() {
		if tr.name != "week" && tr.name != "month" {
			continue
		}
		first, err := s.baseline(ctx, now, tr.name, tr.baseline)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if first {
			continue
		}
		if err := tr.run(ctx, now); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// take is the harness' take, filtered to the overview messages, that also
// keeps the messages themselves.
func (h *ovH) take() []string {
	h.mail.mu.Lock()
	fresh := slices.Clone(h.mail.sent)
	h.mail.mu.Unlock()
	freshPush := h.push.Sent()[h.seen:]
	var out []string
	for _, l := range h.harness.take() {
		if low := strings.ToLower(l); strings.Contains(low, "weekoverzicht") || strings.Contains(low, "maandoverzicht") {
			out = append(out, l)
		}
	}
	h.freshMail, h.freshPush = fresh, freshPush
	h.mails = append(h.mails, fresh...)
	h.pushes = append(h.pushes, freshPush...)
	return out
}

// mailTo is the e-mail of the last take sent to the user's address.
func (h *ovH) mailTo(email, subjectPart string) mail.Message {
	h.t.Helper()
	for _, m := range h.freshMail {
		if m.To == email && strings.Contains(m.Subject, subjectPart) {
			return m
		}
	}
	h.t.Fatalf("no e-mail %q to %s among %d", subjectPart, email, len(h.freshMail))
	return mail.Message{}
}

const (
	bertMail    = "bert@jouw-domein.be"
	partnerMail = "partner@jouw-domein.be"
)

// weekLines and monthLines are the e-mail and the push of one overview.
func weekLines(who, label, monday string) []string {
	return []string{who + " email: Je weekoverzicht · " + label,
		who + " push: Weekoverzicht: je bon staat klaar /overzicht/bon/week/" + monday + "?scope=alles"}
}

func monthLines(who, label, month string) []string {
	return []string{who + " email: Je maandoverzicht · " + label,
		who + " push: Maandoverzicht: je bon staat klaar /overzicht/bon/maand/" + month + "-01?scope=alles"}
}

// ovWeek47 is the week of Monday 16 to Sunday 22 November, the last one the
// demo has rows in.
func ovWeek47(who string) []string { return weekLines(who, "week 47", "2026-11-16") }

func (h *ovH) logged(where string, args ...any) int { return h.count(where, args...) }

// --- when it is due --------------------------------------------------------------

func TestOverviewDueMoments(t *testing.T) {
	utc := func(y int, m time.Month, d, hh, mm int) time.Time { return time.Date(y, m, d, hh, mm, 0, 0, time.UTC) }
	for _, c := range []struct {
		now             time.Time
		weekFrom, wDue  string // the Monday and the deadline of the latest week due
		monthKey, mDue  string
		weekLabelPrefix string
	}{
		// The Sunday itself: before 19:00 the previous week is the latest one due.
		{ovNov(22, 18, 59), "2026-11-09", "2026-11-15 19:00", "2026-10", "2026-10-31 19:00", "Week 46"},
		{ovNov(22, 19, 0), "2026-11-16", "2026-11-22 19:00", "2026-10", "2026-10-31 19:00", "Week 47"},
		// A catch-up on Monday is still about the Sunday's week, not the new one.
		{ovNov(23, 0, 5), "2026-11-16", "2026-11-22 19:00", "2026-10", "2026-10-31 19:00", "Week 47"},
		{ovNov(26, 12, 0), "2026-11-16", "2026-11-22 19:00", "2026-10", "2026-10-31 19:00", "Week 47"},
		// The last day of the month.
		{ovNov(30, 18, 59), "2026-11-23", "2026-11-29 19:00", "2026-10", "2026-10-31 19:00", "Week 48"},
		{ovNov(30, 19, 0), "2026-11-23", "2026-11-29 19:00", "2026-11", "2026-11-30 19:00", "Week 48"},
		{ovAt(2026, 12, 1, 7, 5), "2026-11-23", "2026-11-29 19:00", "2026-11", "2026-11-30 19:00", "Week 48"},
		// A month end that is a Sunday: both are due at once.
		{ovAt(2027, 1, 31, 19, 0), "2027-01-25", "2027-01-31 19:00", "2027-01", "2027-01-31 19:00", "Week 4"},
		// The ISO week-year: the week of 28 Dec 2026 is week 53 and ends on 3 Jan.
		{ovAt(2027, 1, 3, 19, 0), "2026-12-28", "2027-01-03 19:00", "2026-12", "2026-12-31 19:00", "Week 53"},
		{ovAt(2026, 12, 31, 19, 0), "2026-12-21", "2026-12-27 19:00", "2026-12", "2026-12-31 19:00", "Week 52"},
		// The Brussels date counts, not the zone now arrives in: 23:30 UTC on
		// the Sunday is already Monday 00:30 in Brussels, and 18:30 UTC on the
		// Sunday is 19:30 there.
		{utc(2026, 11, 22, 18, 30), "2026-11-16", "2026-11-22 19:00", "2026-10", "2026-10-31 19:00", "Week 47"},
		{utc(2026, 11, 22, 17, 59), "2026-11-09", "2026-11-15 19:00", "2026-10", "2026-10-31 19:00", "Week 46"},
		{utc(2026, 11, 22, 23, 30), "2026-11-16", "2026-11-22 19:00", "2026-10", "2026-10-31 19:00", "Week 47"},
		{utc(2026, 11, 30, 23, 30), "2026-11-23", "2026-11-29 19:00", "2026-11", "2026-11-30 19:00", "Week 48"},
		// Daylight saving: the clocks go back on Sunday 25 October 2026.
		{ovAt(2026, 10, 25, 19, 0), "2026-10-19", "2026-10-25 19:00", "2026-09", "2026-09-30 19:00", "Week 43"},
		// February in a leap year.
		{ovAt(2028, 2, 29, 19, 0), "2028-02-21", "2028-02-27 19:00", "2028-02", "2028-02-29 19:00", "Week 8"},
	} {
		wp, wDue := ovWeek.latest(c.now)
		mp, mDue := ovMonth.latest(c.now)
		if wp.From != c.weekFrom || wDue.In(clock.Brussels).Format("2006-01-02 15:04") != c.wDue || !strings.HasPrefix(wp.Label, c.weekLabelPrefix) {
			t.Errorf("week at %s: %s %s %q, want %s %s %s", c.now.Format(time.DateTime), wp.From, wDue.In(clock.Brussels).Format("2006-01-02 15:04"), wp.Label, c.weekFrom, c.wDue, c.weekLabelPrefix)
		}
		if ovMonth.key(mp) != c.monthKey || mDue.In(clock.Brussels).Format("2006-01-02 15:04") != c.mDue {
			t.Errorf("month at %s: %s %s, want %s %s", c.now.Format(time.DateTime), ovMonth.key(mp), mDue.In(clock.Brussels).Format("2006-01-02 15:04"), c.monthKey, c.mDue)
		}
	}
	// The paths and keys of the receipt route.
	p, _ := ovWeek.latest(ovNov(22, 19, 0))
	if got := ovWeek.path(p); got != "/overzicht/bon/week/2026-11-16?scope=alles" {
		t.Errorf("week path %q", got)
	}
	p, _ = ovMonth.latest(ovNov(30, 19, 0))
	if got := ovMonth.path(p); got != "/overzicht/bon/maand/2026-11-01?scope=alles" {
		t.Errorf("month path %q", got)
	}
}

// The triggers are registered after the others and the week goes first, so a
// month end that is a Sunday sends the week, then the month.
func TestOverviewTriggersRegistered(t *testing.T) {
	h := ovHarness(t)
	var names []string
	for _, tr := range h.s.triggers() {
		names = append(names, tr.name)
	}
	w, m := slices.Index(names, "week"), slices.Index(names, "month")
	if w < 0 || m != w+1 || slices.Index(names, "planning") > w {
		t.Errorf("triggers %v", names)
	}
	// Run itself runs them: the baselines are written by a plain Run.
	if err := h.s.Run(context.Background(), ovNov(18, 7, 5)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"baseline:week", "baseline:month"} {
		if day, _ := h.s.runDay(context.Background(), name); day != "2026-11-18" {
			t.Errorf("%s = %q after the first Run", name, day)
		}
	}
}

// --- what is sent --------------------------------------------------------------

// Sunday 19:00 sends the week, once, to everyone who switched it on; a
// restart, a lost marker and a later run send nothing more.
func TestOverviewSundaySendsTheWeek(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.check(ovNov(18, 7, 5)) // the baseline
	h.check(ovNov(22, 18, 55))
	h.check(ovNov(22, 19, 0), ovWeek47("Bert"), ovWeek47("Partner"))
	h.check(ovNov(22, 19, 15))
	h.check(ovNov(22, 22, 30))
	h.check(ovNov(23, 7, 5))
	h.compare(ovNov(23, 9, 0), h.linesOn(h.service(), ovNov(23, 9, 0))) // a restart
	h.exec(`DELETE FROM notify_runs WHERE name LIKE 'overview:%'`)
	h.compare(ovNov(23, 9, 15), h.linesOn(h.service(), ovNov(23, 9, 15))) // a restart that lost the markers: the log holds
	if n := h.logged(`type = 'week' AND dedupe = 'overview:week:2026-11-16' AND status = 'sent'`); n != 4 {
		t.Errorf("%d sent rows for the week, want one per user and channel", n)
	}

	// The e-mail: Bert's own subject, the snapshot line of 19:00, the button.
	h2 := ovHarness(t)
	h2.on(demo.Bert)
	h2.lines(ovNov(18, 7, 5))
	h2.lines(ovNov(22, 19, 0))
	m := h2.mailTo(bertMail, "weekoverzicht")
	if m.Subject != "Je weekoverzicht · week 47" {
		t.Errorf("subject %q", m.Subject)
	}
	for _, want := range []string{"Stand zondag 22 nov, 19:00", "Week 47 · 16–22 nov 2026", "Alle rekeningen samen",
		"https://saldo.example.com/overzicht/bon/week/2026-11-16?scope=alles", "Bekijk de bon", "Meldingen aanpassen", "Weekoverzicht\" aanstaat"} {
		if !strings.Contains(m.Text, want) {
			t.Errorf("the text part lacks %q:\n%s", want, m.Text)
		}
	}
	if strings.Contains(m.Text, "budget") {
		t.Errorf("a week has no budget lines:\n%s", m.Text)
	}
	if len(h2.freshPush) != 1 {
		t.Fatalf("%d pushes", len(h2.freshPush))
	}
	p := h2.freshPush[0].Message
	if p.Tag != "overview-week-2026-11-16" || p.Tone != "info" || p.Body != LineOverview || p.URL != "/overzicht/bon/week/2026-11-16?scope=alles" {
		t.Errorf("push %+v", p.Payload)
	}
}

// A push is generic: no euro sign, no amount, no account or bank name, in the
// title, the line or the address.
func TestOverviewPushIsGeneric(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.lines(ovNov(18, 7, 5))
	h.lines(ovNov(22, 19, 0))
	if len(h.pushes) != 2 {
		t.Fatalf("%d pushes", len(h.pushes))
	}
	leaks := []string{"€", "Argenta", "KBC", "Belfius", "Bert", "Partner", "BE68", "BE41"}
	rows, err := h.d.Query(`SELECT name FROM accounts`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		leaks = append(leaks, name)
	}
	rows.Close()
	for _, p := range h.pushes {
		text := p.Message.Title + "\n" + p.Message.Body + "\n" + p.Message.URL + "\n" + p.Message.Tag
		for _, leak := range leaks {
			if strings.Contains(text, leak) {
				t.Errorf("the push %q leaks %q", text, leak)
			}
		}
		if regexp.MustCompile(`\d[.,]\d`).MatchString(p.Message.Title + p.Message.Body) {
			t.Errorf("an amount in %q", text)
		}
	}
}

// The last day of the month sends the month, with its budget lines; the week
// before it (no rows) sends nothing and writes nothing.
func TestOverviewLastDayOfTheMonth(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(30, 18, 59)) // the week of 23 to 29 November is empty, the month is not over
	h.check(ovNov(30, 19, 0), monthLines("Bert", "november 2026", "2026-11"), monthLines("Partner", "november 2026", "2026-11"))
	m := h.mailTo(bertMail, "maandoverzicht")
	pushes := h.freshPush
	if n := h.logged(`type = 'week' AND dedupe = 'overview:week:2026-11-23'`); n != 0 {
		t.Errorf("an empty week wrote %d rows", n)
	}
	h.check(ovAt(2026, 12, 1, 7, 5))
	h.check(ovAt(2026, 12, 1, 19, 0))

	if m.Subject != "Je maandoverzicht · november 2026" {
		t.Errorf("subject %q", m.Subject)
	}
	if !strings.Contains(m.Text, "https://saldo.example.com/overzicht/bon/maand/2026-11-01?scope=alles") {
		t.Errorf("the receipt link:\n%s", m.Text)
	}
	// The month has the budget lines of the model (a budget or the average of
	// the last six months), the week none.
	if !strings.Contains(m.Text, "gemiddeld ") && !strings.Contains(m.Text, "budget ") {
		t.Errorf("a month without a budget line:\n%s", m.Text)
	}
	for _, p := range pushes {
		if p.Message.Tag != "overview-month-2026-11" || p.Message.Title != "Maandoverzicht: je bon staat klaar" {
			t.Errorf("push %+v", p.Message.Payload)
		}
	}
}

// A month that ends on a Sunday sends the week and then the month, as two
// messages with different push tags.
func TestOverviewBothOnAMonthEndSunday(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.book(1, "2027-01-26", -5000, "Delhaize", "Boodschappen")
	h.book(5, "2027-01-27", -3000, "Delhaize", "Boodschappen")
	h.book(1, "2027-01-04", -2000, "Delhaize", "Boodschappen")
	h.check(ovAt(2027, 1, 28, 7, 5))
	h.check(ovAt(2027, 1, 31, 18, 59))
	now := ovAt(2027, 1, 31, 19, 0)
	got := h.lines(now)
	h.compare(now, got,
		weekLines("Bert", "week 4", "2027-01-25"), weekLines("Partner", "week 4", "2027-01-25"),
		monthLines("Bert", "januari 2027", "2027-01"), monthLines("Partner", "januari 2027", "2027-01"))
	var tags []string
	for _, p := range h.pushes {
		tags = append(tags, p.Message.Tag)
	}
	if want := []string{"overview-week-2027-01-25", "overview-week-2027-01-25", "overview-month-2027-01", "overview-month-2027-01"}; !slices.Equal(tags, want) {
		t.Errorf("push tags in order %v, want %v", tags, want)
	}
	if a, b := h.freshPush[0].Message.Topic, h.freshPush[2].Message.Topic; a == b {
		t.Errorf("the week and the month share the topic %q", a)
	}
	var subjects []string
	for _, m := range h.mails {
		subjects = append(subjects, m.Subject)
	}
	if want := []string{"Je weekoverzicht · week 4", "Je weekoverzicht · week 4", "Je maandoverzicht · januari 2027", "Je maandoverzicht · januari 2027"}; !slices.Equal(subjects, want) {
		t.Errorf("e-mails in order %v, want %v", subjects, want)
	}
	h.check(ovAt(2027, 1, 31, 19, 15))
}

// --- opt-in ---------------------------------------------------------------------

// Both types are off by default: a user with no preference rows is sent
// nothing, and the period is logged suppressed on both channels.
func TestOverviewOffByDefault(t *testing.T) {
	h := ovHarness(t)
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(22, 19, 0))
	h.check(ovNov(22, 19, 30))
	if n := h.logged(`dedupe = 'overview:week:2026-11-16' AND status = 'suppressed'`); n != 4 {
		t.Errorf("%d suppressed rows, want Bert and Partner on both channels", n)
	}
	if n := h.logged(`dedupe LIKE 'overview:%' AND status <> 'suppressed'`); n != 0 {
		t.Errorf("%d rows that are not suppressed", n)
	}
	// Nothing is stored for the preferences: the defaults are off/off.
	for _, typ := range []string{TypeWeek, TypeMonth} {
		if p := Effective(nil)[typ]; p.Push || p.Email {
			t.Errorf("%s is on by default: %+v", typ, p)
		}
	}
}

// The chips are independent, and a switched-off e-mail switch silences the mail.
func TestOverviewChannelsAreIndependent(t *testing.T) {
	h := ovHarness(t)
	h.prefs(demo.Bert, TypeWeek, true, false)
	h.prefs(demo.Partner, TypeWeek, false, true)
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(22, 19, 0),
		[]string{"Bert push: Weekoverzicht: je bon staat klaar /overzicht/bon/week/2026-11-16?scope=alles", "Partner email: Je weekoverzicht · week 47"})
	if n := h.logged(`dedupe = 'overview:week:2026-11-16' AND status = 'suppressed'`); n != 2 {
		t.Errorf("%d suppressed rows, want Bert's e-mail and Partner's push", n)
	}
	// The user's own e-mail switch (Meldingen: E-mail) is respected too.
	g := ovHarness(t)
	g.exec(`UPDATE users SET notify_email = 0 WHERE id = ?`, demo.Bert)
	g.on(demo.Bert)
	g.check(ovNov(18, 7, 5))
	g.check(ovNov(22, 19, 0), []string{"Bert push: Weekoverzicht: je bon staat klaar /overzicht/bon/week/2026-11-16?scope=alles"})
}

// Switching a type on in the middle of the week sends the next overview only,
// never the last Sunday's.
func TestOverviewSwitchedOnMidWeekSendsTheNextOne(t *testing.T) {
	h := ovHarness(t)
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(22, 19, 0)) // off: logged suppressed
	h.prefs(demo.Bert, TypeWeek, true, true)
	h.check(ovNov(23, 10, 0)) // Monday: switched on, the old week stays suppressed
	h.check(ovNov(25, 18, 55))
	h.book(1, "2026-11-26", -4200, "Delhaize", "Boodschappen")
	h.check(ovNov(28, 12, 0))
	h.check(ovNov(29, 19, 0), weekLines("Bert", "week 48", "2026-11-23"))
	h.check(ovNov(29, 19, 15))
	// The same on the day itself: the 19:00 run found the type off.
	g := ovHarness(t)
	g.check(ovNov(18, 7, 5))
	g.check(ovNov(22, 19, 0))
	g.prefs(demo.Bert, TypeWeek, true, true)
	g.check(ovNov(22, 22, 30))
	g.check(ovNov(23, 7, 5))
}

// The first run after the upgrade sends nothing, even at 19:30 on a Sunday;
// the period is recorded as suppressed and the next Sunday is sent.
func TestOverviewFirstRunSendsNothing(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.check(ovNov(22, 19, 30)) // the very first run
	if n := h.logged(`dedupe = 'overview:week:2026-11-16' AND status = 'suppressed'`); n != 4 {
		t.Errorf("the baseline logged %d week rows, want 4", n)
	}
	// October's 19:00 is three weeks past: nothing could ever be sent for it, so
	// nothing is written either (only the week of 16 November is still open).
	if n := h.logged(`dedupe = 'overview:month:2026-10'`); n != 0 {
		t.Errorf("the baseline logged %d rows for a month that expired long ago", n)
	}
	h.check(ovNov(22, 19, 45))
	h.check(ovNov(22, 22, 30))
	h.check(ovNov(23, 7, 5))
	h.compare(ovNov(24, 9, 0), h.linesOn(h.service(), ovNov(24, 9, 0)))
	h.book(1, "2026-11-25", -3000, "Delhaize", "Boodschappen")
	h.book(5, "2026-11-25", -3000, "Delhaize", "Boodschappen")
	h.check(ovNov(29, 19, 0), weekLines("Bert", "week 48", "2026-11-23"), weekLines("Partner", "week 48", "2026-11-23"))

	// The same a day after the Sunday, and a week later than the deadline:
	// nothing old is sent at any time of day.
	for _, now := range []time.Time{ovNov(23, 10, 0), ovNov(24, 18, 0), ovNov(26, 10, 0), ovNov(30, 19, 30)} {
		g := ovHarness(t)
		g.on(demo.Bert, demo.Partner)
		g.check(now)
		g.check(now.Add(15 * time.Minute))
		g.check(now.Add(3 * time.Hour))
	}
	// A receipt that cannot be built still never sends an old overview.
	f := ovHarness(t)
	f.on(demo.Bert, demo.Partner)
	failBuild(t, demo.Bert)
	f.check(ovNov(22, 19, 30))
	if n := f.logged(`user_id = ? AND dedupe = 'overview:week:2026-11-16' AND status = 'suppressed'`, demo.Bert); n != 2 {
		t.Errorf("Bert has %d suppressed rows after a failed receipt in the baseline", n)
	}
	buildReceipt = receipt.Build
	f.check(ovNov(22, 19, 45))
}

// failBuild makes the receipt of one user fail until the test (or a later
// assignment) restores it.
func failBuild(t *testing.T, user int64) {
	t.Helper()
	buildReceipt = func(ctx context.Context, d *sql.DB, s *ledger.Store, viewer int64, q receipt.Query) (receipt.Model, error) {
		if viewer == user {
			return receipt.Model{}, errors.New("the receipt is broken")
		}
		return receipt.Build(ctx, d, s, viewer, q)
	}
	t.Cleanup(func() { buildReceipt = receipt.Build })
}

// --- catch-up and expiry -----------------------------------------------------------

// A catch-up at 23:00 sends the e-mail at once and the push at 07:00.
func TestOverviewCatchUpWaitsForTheMorningForThePush(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(22, 23, 0), []string{"Bert email: Je weekoverzicht · week 47", "Partner email: Je weekoverzicht · week 47"})
	h.check(ovNov(22, 23, 15))
	h.check(ovNov(23, 3, 0))
	h.check(ovNov(23, 6, 45))
	h.check(ovNov(23, 7, 0),
		[]string{"Bert push: Weekoverzicht: je bon staat klaar /overzicht/bon/week/2026-11-16?scope=alles",
			"Partner push: Weekoverzicht: je bon staat klaar /overzicht/bon/week/2026-11-16?scope=alles"})
	h.check(ovNov(23, 7, 15))
	if n := h.logged(`dedupe = 'overview:week:2026-11-16' AND status = 'sent'`); n != 4 {
		t.Errorf("%d sent rows, want 4", n)
	}
	// With the quiet hours switched off the push does not wait.
	g := ovHarness(t)
	g.on(demo.Bert)
	g.exec(`UPDATE users SET quiet_hours = 0 WHERE id = ?`, demo.Bert)
	g.check(ovNov(18, 7, 5))
	g.check(ovNov(22, 23, 0), weekLines("Bert", "week 47", "2026-11-16"))
}

// A catch-up two days late still goes out; after three days the overview is
// dropped, to the minute, and nothing is logged for it.
func TestOverviewExpiresAfterThreeDays(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(24, 10, 0), ovWeek47("Bert"), ovWeek47("Partner")) // Tuesday: two days late

	g := ovHarness(t)
	g.on(demo.Bert, demo.Partner)
	g.check(ovNov(18, 7, 5))
	g.check(ovNov(25, 18, 59), ovWeek47("Bert"), ovWeek47("Partner")) // one minute before the expiry

	for _, now := range []time.Time{ovNov(25, 19, 0), ovNov(25, 20, 30), ovNov(26, 10, 0)} {
		e := ovHarness(t)
		e.on(demo.Bert, demo.Partner)
		e.check(ovNov(18, 7, 5))
		e.check(now) // the service was down since Sunday
		e.check(now.Add(15 * time.Minute))
		if n := e.logged(`dedupe = 'overview:week:2026-11-16' AND status <> 'suppressed'`); n != 0 {
			t.Errorf("a dropped overview left %d rows at %s", n, now.Format(time.DateTime))
		}
		// The next one is not affected.
		e.book(1, "2026-11-26", -4200, "Delhaize", "Boodschappen")
		e.check(ovNov(29, 19, 0), weekLines("Bert", "week 48", "2026-11-23"))
	}

	// The month: due Monday 30 November 19:00, gone from Thursday 3 December 19:00.
	m := ovHarness(t)
	m.on(demo.Bert)
	m.check(ovNov(18, 7, 5))
	m.check(ovAt(2026, 12, 3, 18, 59), monthLines("Bert", "november 2026", "2026-11"))
	n := ovHarness(t)
	n.on(demo.Bert)
	n.check(ovNov(18, 7, 5))
	n.check(ovAt(2026, 12, 3, 19, 0))
}

// A failed send is tried again on the next run until the overview expires; the
// users before and after the failing one are not held up.
func TestOverviewRetriesAFailedSend(t *testing.T) {
	flaky := func(t *testing.T) (*ovH, *ovFlaky) {
		h := ovHarness(t)
		f := &ovFlaky{recorder: h.mail, failTo: bertMail}
		h.s = New(Options{DB: h.d, Mailer: f, Pushes: push.NewStore(h.d), Push: h.push, PublicURL: "https://saldo.example.com"})
		h.on(demo.Bert, demo.Partner)
		h.check(ovNov(18, 7, 5))
		return h, f
	}
	h, f := flaky(t)
	h.check(ovNov(22, 19, 0), []string{ovWeek47("Bert")[1], ovWeek47("Partner")[0], ovWeek47("Partner")[1]})
	h.check(ovNov(22, 19, 15)) // Bert's mailbox still refuses
	if day, _ := h.s.runDay(context.Background(), "overview:week"); day == "2026-11-16" {
		t.Errorf("the period is recorded as done (%q) while a send keeps failing", day)
	}
	f.failTo = ""
	h.check(ovNov(23, 10, 0), []string{ovWeek47("Bert")[0]})
	h.check(ovNov(23, 10, 15))
	if day, _ := h.s.runDay(context.Background(), "overview:week"); day != "2026-11-16" {
		t.Errorf("the period is not recorded as done after the retry: %q", day)
	}

	// Still failing at the expiry: dropped, not sent when the mailbox returns.
	g, f2 := flaky(t)
	g.check(ovNov(22, 19, 0), []string{ovWeek47("Bert")[1], ovWeek47("Partner")[0], ovWeek47("Partner")[1]})
	g.check(ovNov(24, 10, 0))
	g.check(ovNov(25, 18, 45))
	f2.failTo = ""
	g.check(ovNov(25, 19, 0))
	g.check(ovNov(25, 19, 15))
}

// ovFlaky is a mailer that refuses one address.
type ovFlaky struct {
	*recorder
	failTo string
}

func (f *ovFlaky) Send(ctx context.Context, m mail.Message) error {
	if m.To == f.failTo {
		return errors.New("550 mailbox full")
	}
	return f.recorder.Send(ctx, m)
}

// One user's failing receipt does not stop the others; it is tried again.
func TestOverviewOneUsersFailureDoesNotStopTheOthers(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.check(ovNov(18, 7, 5))
	failBuild(t, demo.Bert)
	now := ovNov(22, 19, 0)
	err := ovTriggers(h.s, now)
	if err == nil || !strings.Contains(err.Error(), "user 1") {
		t.Errorf("error %v, want the failure of user 1", err)
	}
	h.compare(now, h.take(), ovWeek47("Partner"))
	err = ovTriggers(h.s, ovNov(22, 19, 15))
	if err == nil {
		t.Error("the failure is not reported on the next run")
	}
	h.compare(now, h.take())
	buildReceipt = receipt.Build
	h.check(ovNov(22, 19, 30), ovWeek47("Bert"))
	h.check(ovNov(22, 19, 45))
}

// --- who gets what ---------------------------------------------------------------

// An empty period sends nothing and writes no row; so does a user without
// accounts and a user who has a savings account only.
func TestOverviewNothingToSay(t *testing.T) {
	h := ovHarness(t)
	h.exec(`INSERT INTO users (id, email, display_name) VALUES (3, 'lezer@jouw-domein.be', 'Lezer'), (4, 'spaarder@jouw-domein.be', 'Spaarder')`)
	h.names["lezer@jouw-domein.be"], h.names["spaarder@jouw-domein.be"] = "Lezer", "Spaarder"
	h.exec(`INSERT INTO accounts (id, type, source, name) VALUES (9, 'savings', 'manual', 'Spaarpot')`)
	h.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (9, 4, 'manager', 'edit')`)
	h.book(9, "2026-11-17", 25000, "Storting", "")
	h.book(9, "2026-11-18", -1000, "Opname", "")
	h.subscribe(3, "lezer")
	h.subscribe(4, "spaarder")
	h.on(demo.Bert, demo.Partner, 3, 4)
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(22, 19, 0), ovWeek47("Bert"), ovWeek47("Partner"))
	h.check(ovNov(22, 19, 15))
	if n := h.logged(`user_id IN (3, 4)`); n != 0 {
		t.Errorf("a user with nothing to say has %d log rows", n)
	}
	// The empty week 23 to 29 November: nobody, no row.
	h.check(ovNov(29, 19, 0))
	if n := h.logged(`dedupe = 'overview:week:2026-11-23'`); n != 0 {
		t.Errorf("an empty week wrote %d rows", n)
	}
	// The user without accounts gets the overview of a week once they have one.
	h.exec(`INSERT INTO accounts (id, type, source, name) VALUES (10, 'current', 'manual', 'Lopende rekening')`)
	h.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (10, 3, 'manager', 'edit')`)
	h.book(10, "2026-12-01", -9000, "Delhaize", "Boodschappen")
	h.check(ovAt(2026, 12, 6, 19, 0), weekLines("Lezer", "week 49", "2026-11-30"))
}

// Partner's receipt is about Partner's accounts: nothing of Bert's personal
// accounts is in the e-mail, while Bert's own has it.
func TestOverviewVisibility(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.exec(`INSERT INTO categories (name, type, colour, sort_order) VALUES ('Geheime hobby', 'expense', 'c1', 99)`)
	h.book(1, "2026-11-17", -77777, "Hobbywinkel", "Geheime hobby") // Bert's personal account
	h.book(5, "2026-11-17", -1234, "Delhaize", "Boodschappen")      // Partner's
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(22, 19, 0), ovWeek47("Bert"), ovWeek47("Partner"))
	bert, partner := h.mailTo(bertMail, "week"), h.mailTo(partnerMail, "week")
	for _, part := range []string{"Geheime hobby", "777,77", "Naar Spaarrekening"} {
		if !strings.Contains(bert.Text, part) {
			t.Errorf("Bert's e-mail lacks %q:\n%s", part, bert.Text)
		}
	}
	for _, part := range []string{"Geheime hobby", "Hobbywinkel", "777,77", "Spaarrekening", "Reserve", "Naar spaarrekening"} {
		if strings.Contains(partner.Text, part) || strings.Contains(partner.HTML, part) {
			t.Errorf("Partner's e-mail has %q:\n%s", part, partner.Text)
		}
	}
	// What each sees is what the report rules say for them: the models differ.
	ctx := context.Background()
	st := ledger.New(h.d)
	p := receipt.Week(ovNov(22, 12, 0))
	bm, err := receipt.Build(ctx, h.d, st, demo.Bert, receipt.Query{Period: p, Scope: "alles", Now: ovNov(22, 19, 0)})
	if err != nil {
		t.Fatal(err)
	}
	pm, err := receipt.Build(ctx, h.d, st, demo.Partner, receipt.Query{Period: p, Scope: "alles", Now: ovNov(22, 19, 0)})
	if err != nil {
		t.Fatal(err)
	}
	if bm.Expenses.Total == pm.Expenses.Total {
		t.Errorf("Bert and Partner have the same expenses (%d)", bm.Expenses.Total)
	}
	// A shared account is in the overview of whoever sees it when it goes out,
	// and of nobody else: the receipt is built for the recipient at that moment.
	for _, leaves := range []bool{false, true} {
		g := ovHarness(t)
		g.on(demo.Bert, demo.Partner)
		g.exec(`INSERT INTO categories (name, type, colour, sort_order) VALUES ('Gedeelde pot', 'expense', 'c2', 98)`)
		g.book(4, "2026-11-17", -55555, "Pot", "Gedeelde pot")
		g.check(ovNov(18, 7, 5))
		if leaves {
			g.exec(`DELETE FROM account_access WHERE user_id = ? AND account_id = 4`, demo.Partner)
		}
		g.check(ovNov(22, 19, 0), ovWeek47("Bert"), ovWeek47("Partner"))
		if m := g.mailTo(bertMail, "week"); !strings.Contains(m.Text, "Gedeelde pot") || !strings.Contains(m.Text, "555,55") {
			t.Errorf("Bert's e-mail lacks the shared account's row:\n%s", m.Text)
		}
		pt := g.mailTo(partnerMail, "week").Text
		if has := strings.Contains(pt, "Gedeelde pot"); has == leaves {
			t.Errorf("Partner (left the shared account: %v) has the shared row: %v\n%s", leaves, has, pt)
		}
		if has := strings.Contains(pt, "555,55"); has == leaves {
			t.Errorf("Partner (left the shared account: %v) has the amount: %v", leaves, has)
		}
	}
}

// Every category and subcategory of the model is in the e-mail's plain text
// (and, escaped, in the HTML), for a week and a month.
func TestOverviewTextHasEveryCategory(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert)
	for _, b := range []struct {
		amount   int64
		category string
	}{{-12000, "Boodschappen"}, {-8000, "Supermarkt"}, {-3000, "Bakker"}, {-60000, "Huur"}, {-2500, "Energie"}, {-4500, "Wonen"},
		{-1500, "Streaming"}, {-900, ""}, {10000, "Terugbetaling"}, {-5000, "Vakantie"}, {-700, "Sport"}} {
		h.book(1, "2026-11-17", b.amount, "Test", b.category)
	}
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(22, 19, 0), ovWeek47("Bert"))
	week := h.mailTo(bertMail, "week")
	h.check(ovNov(30, 19, 0), monthLines("Bert", "november 2026", "2026-11"))
	month := h.mailTo(bertMail, "maand")

	ctx := context.Background()
	st := ledger.New(h.d)
	for _, c := range []struct {
		m     mail.Message
		p     receipt.Period
		label string
	}{{week, receipt.Week(ovNov(22, 12, 0)), "week"}, {month, receipt.Month(ovNov(30, 12, 0)), "month"}} {
		model, err := receipt.Build(ctx, h.d, st, demo.Bert, receipt.Query{Period: c.p, Scope: "alles", Now: ovNov(30, 19, 0)})
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		children := 0
		for _, rows := range [][]receipt.Row{model.Income.Rows, model.Expenses.Groups, model.Saved.Rows} {
			for _, r := range rows {
				names = append(names, r.Name)
				for _, ch := range r.Children {
					names = append(names, ch.Name)
					children++
				}
			}
		}
		if len(names) < 8 || children < 5 {
			t.Fatalf("%s: the model has %d names and %d subcategories, the test needs more", c.label, len(names), children)
		}
		for _, name := range names {
			if !strings.Contains(c.m.Text, name) {
				t.Errorf("%s: the text part lacks %q:\n%s", c.label, name, c.m.Text)
			}
			if !strings.Contains(c.m.HTML, name) {
				t.Errorf("%s: the HTML part lacks %q", c.label, name)
			}
		}
		for _, note := range model.Notes {
			if !strings.Contains(c.m.Text, note) {
				t.Errorf("%s: the text part lacks the note %q", c.label, note)
			}
		}
		// The headline of the model is the e-mail's figure.
		if !strings.Contains(c.m.Text, "OVER: ") || !strings.Contains(c.m.Text, "UITGAVEN: ") {
			t.Errorf("%s: no totals", c.label)
		}
	}
}

// A name with markup in it is escaped in the HTML part and shown as written in
// the plain text; nothing of it reaches the push.
func TestOverviewEscapesNames(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert)
	const name = `<b>Vrij & "tijd" 'x'</b><script>alert(1)</script>`
	h.exec(`UPDATE categories SET name = ? WHERE name = 'Vrije tijd'`, name)
	h.book(1, "2026-11-17", -4000, "Test", name)
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(22, 19, 0), ovWeek47("Bert"))
	m := h.mailTo(bertMail, "week")
	if !strings.Contains(m.Text, name) {
		t.Errorf("the text part does not show the name as written:\n%s", m.Text)
	}
	for _, bad := range []string{"<b>Vrij", "<script", "alert(1)</script>", `& "tijd"`} {
		if strings.Contains(m.HTML, bad) {
			t.Errorf("the HTML part has %q unescaped", bad)
		}
	}
	for _, good := range []string{"&lt;b&gt;Vrij &amp; ", "&lt;script&gt;"} {
		if !strings.Contains(m.HTML, good) {
			t.Errorf("the HTML part lacks the escaped %q", good)
		}
	}
	for _, p := range h.freshPush {
		if strings.Contains(p.Message.Title+p.Message.Body+p.Message.URL, "Vrij") {
			t.Errorf("a name in the push %+v", p.Message.Payload)
		}
	}
}

// A long category name does not stretch the receipt past the layout's width:
// the mail package's block wraps it (a long name has no leader), here the row
// only has to survive the conversion whole.
func TestOverviewLongNames(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert)
	long := strings.Repeat("Langeafkortingsloosecategorienaam ", 4)
	h.exec(`UPDATE categories SET name = ? WHERE name = 'Overig' AND parent_id IS NULL`, strings.TrimSpace(long))
	h.book(1, "2026-11-17", -4000, "Test", strings.TrimSpace(long))
	h.check(ovNov(18, 7, 5))
	h.check(ovNov(22, 19, 0), ovWeek47("Bert"))
	m := h.mailTo(bertMail, "week")
	// The HTML part may break a long word with zero-width spaces.
	if !strings.Contains(m.Text, strings.TrimSpace(long)) || !strings.Contains(strings.ReplaceAll(m.HTML, "​", ""), strings.TrimSpace(long)) {
		t.Error("the long name is cut")
	}
}

// --- concurrency and restarts ------------------------------------------------------

// Two services at once send each message once.
func TestOverviewTwoServicesSendOnce(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	h.check(ovNov(18, 7, 5))
	h.mail.wait = 20 * time.Millisecond
	now := ovNov(22, 19, 5)
	var wg sync.WaitGroup
	for range 3 {
		s := h.service()
		wg.Go(func() {
			if err := ovTriggers(s, now); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	h.compare(now, h.take(), ovWeek47("Bert"), ovWeek47("Partner"))
	h.check(ovNov(22, 19, 20))
}

// --- push text -----------------------------------------------------------------------

// Generic until the lock-screen spike decides; at detail full the label and the
// three figures in whole euros.
func TestOverviewPayload(t *testing.T) {
	model := func(label string, spent, saved, left int64) receipt.Model {
		return receipt.Model{Label: label, Expenses: receipt.Expenses{Total: spent}, Saved: receipt.Section{Total: saved}, Result: receipt.Result{Total: left}}
	}
	week := model("Week 47 · 16–22 nov 2026", 41200, 5000, 39003)
	month := model("Oktober 2026", 275997, 20000, -12050)
	for _, c := range []struct {
		typ, detail, want string
		m                 receipt.Model
	}{
		{TypeWeek, DetailGeneric, "Weekoverzicht: je bon staat klaar / " + LineOverview, week},
		{TypeMonth, DetailGeneric, "Maandoverzicht: je bon staat klaar / " + LineOverview, month},
		{TypeWeek, DetailFull, "Weekoverzicht · week 47 / Uitgegeven € 412 · gespaard € 50 · over € 390", week},
		{TypeMonth, DetailFull, "Maandoverzicht · oktober 2026 / Uitgegeven € 2.760 · gespaard € 200 · over −€ 121", month},
	} {
		p := overviewPayload(c.typ, c.m, c.detail)
		if got := p.Title + " / " + p.Body; got != c.want || p.Tone != "info" {
			t.Errorf("%s at %s: %q (%s), want %q", c.typ, c.detail, got, p.Tone, c.want)
		}
	}

	// The property: generic says the same to everyone, whatever the numbers and
	// the label.
	r := rand.New(rand.NewPCG(5, 8))
	labels := []string{"Week 47 · 16–22 nov 2026", "Oktober 2026", "Week 1 · 29 dec 2025 – 4 jan 2026", "Huis & Tuin 2026"}
	for range 300 {
		m := model(labels[r.IntN(len(labels))], r.Int64N(5_000_000), r.Int64N(1_000_000), r.Int64N(2_000_000)-1_000_000)
		for _, typ := range []string{TypeWeek, TypeMonth} {
			g := overviewPayload(typ, m, DetailGeneric)
			text := g.Title + "\n" + g.Body
			for _, leak := range []string{"€", ledger.Eur0(m.Expenses.Total), ledger.Eur0(m.Saved.Total), ledger.Eur0(m.Result.Total), "47", "2026", "Huis"} {
				if strings.Contains(text, leak) {
					t.Fatalf("the generic %s push %q leaks %q", typ, text, leak)
				}
			}
			if want := Payload(typ, Text{}, DetailGeneric); g != want {
				t.Fatalf("the generic %s push %+v differs from the type's text %+v", typ, g, want)
			}
		}
	}
}

// The detail switch is the one variable: at full the pushes of a run carry the
// figures of the receipt the e-mail shows.
func TestOverviewPushAtDetailFull(t *testing.T) {
	old := Detail
	Detail = DetailFull
	t.Cleanup(func() { Detail = old })
	h := ovHarness(t)
	h.on(demo.Bert)
	h.check(ovNov(18, 7, 5))
	h.lines(ovNov(22, 19, 0))
	if len(h.freshPush) != 1 {
		t.Fatalf("%d pushes", len(h.freshPush))
	}
	model, err := receipt.Build(context.Background(), h.d, ledger.New(h.d), demo.Bert,
		receipt.Query{Period: receipt.Week(ovNov(22, 12, 0)), Scope: "alles", Now: ovNov(22, 19, 0)})
	if err != nil {
		t.Fatal(err)
	}
	want := "Uitgegeven " + ledger.Eur0(model.Expenses.Total) + " · gespaard " + ledger.Eur0(model.Saved.Total) + " · over " + ledger.Eur0(model.Result.Total)
	p := h.freshPush[0].Message
	if p.Title != "Weekoverzicht · week 47" || p.Body != want || p.Tag != "overview-week-2026-11-16" {
		t.Errorf("push %+v, want body %q", p.Payload, want)
	}
	if !regexp.MustCompile(`^Uitgegeven € [\d.]+ · gespaard € [\d.]+ · over −?€ [\d.]+$`).MatchString(p.Body) {
		t.Errorf("body %q", p.Body)
	}
}

// --- the model → mail conversion -----------------------------------------------------

func TestOverviewData(t *testing.T) {
	pct := func(n int) *int { return &n }
	prev := int64(40000)
	m := receipt.Model{
		Label: "Oktober 2026", ScopeLabel: "Alle rekeningen samen · ter info",
		Income: receipt.Section{Total: 335000, Trend: &receipt.Trend{Kind: "up", Pct: pct(2)}, Rows: []receipt.Row{
			{Name: "Salaris", Amount: 330000, Children: []receipt.Row{{Name: "Basis", Amount: 300000}, {Name: "Salaris zelf", Amount: 30000}}},
			{Name: "Terugbetaling", Amount: 5000}}},
		Expenses: receipt.Expenses{Total: 275997, Trend: &receipt.Trend{Kind: "flat", Pct: pct(0)}, Groups: []receipt.Row{
			{Name: "Wonen", Amount: 120000, Trend: &receipt.Trend{Kind: "down", Pct: pct(-7)},
				Budget:   &receipt.Budget{Amount: 100000, Kind: "mixed", Pct: pct(120)},
				Children: []receipt.Row{{Name: "Huur", Amount: 110000}, {Name: "Energie", Amount: 10000}}},
			{Name: "Vrije tijd", Amount: 9800, Trend: &receipt.Trend{Kind: "new"}, Budget: &receipt.Budget{Amount: 18000, Kind: "average", Pct: pct(54)}},
			{Name: "Overig", Amount: 500, Budget: &receipt.Budget{Amount: 0, Kind: "average"}}}},
		Saved:  receipt.Section{Total: 20000, Rows: []receipt.Row{{Name: "Naar Spaarrekening", Amount: 20000}}},
		Result: receipt.Result{Total: 39003, Prev: &prev},
		Notes:  []string{"Loopt nog, tot zo 22 nov: de bank geeft de transacties van vandaag pas morgen door."},
	}
	now := ovNov(22, 19, 0)
	links := mail.Links{BaseURL: "https://saldo.example.com", SettingsURL: "https://saldo.example.com/meldingen"}
	d := overviewData(m, links, "https://saldo.example.com/overzicht/bon/maand/2026-10-01?scope=alles", now)
	if d.Label != m.Label || d.ScopeLabel != m.ScopeLabel || d.Links != links || d.Stand != "Stand zondag 22 nov, 19:00" ||
		d.ReceiptURL != "https://saldo.example.com/overzicht/bon/maand/2026-10-01?scope=alles" {
		t.Errorf("head %+v", d)
	}
	if d.Income.Total != 335000 || d.Income.Trend != (mail.OverviewTrend{Kind: "up", Pct: 2}) || len(d.Income.Rows) != 2 ||
		len(d.Income.Rows[0].Children) != 2 || d.Income.Rows[0].Children[1] != (mail.OverviewChild{Name: "Salaris zelf", Amount: 30000}) {
		t.Errorf("income %+v", d.Income)
	}
	if d.Expenses.Total != 275997 || d.Expenses.Trend != (mail.OverviewTrend{Kind: "flat"}) {
		t.Errorf("expenses %+v", d.Expenses)
	}
	w, v, o := d.Expenses.Rows[0], d.Expenses.Rows[1], d.Expenses.Rows[2]
	if w.Trend != (mail.OverviewTrend{Kind: "down", Pct: -7}) || w.Budget == nil || *w.Budget != (mail.OverviewBudget{Kind: "mixed", Amount: 100000, Pct: 120}) ||
		len(w.Children) != 2 || w.Children[0].Name != "Huur" {
		t.Errorf("Wonen %+v", w)
	}
	if v.Trend != (mail.OverviewTrend{Kind: "new"}) || v.Budget == nil || v.Budget.Kind != "average" {
		t.Errorf("Vrije tijd %+v", v)
	}
	if o.Trend != (mail.OverviewTrend{}) || o.Budget != nil {
		t.Errorf("a category without a comparison or a reference carries %+v", o)
	}
	if d.Saved.Total != 20000 || len(d.Saved.Rows) != 1 || d.Saved.Rows[0].Name != "Naar Spaarrekening" || d.Result != 39003 ||
		d.PrevResult == nil || *d.PrevResult != 40000 || len(d.Notes) != 1 {
		t.Errorf("saved, result and notes: %+v", d)
	}
	*d.PrevResult = 1 // a copy: the model is not shared with the mail
	if *m.Result.Prev != 40000 {
		t.Error("the previous result is shared with the model")
	}
	// Both builders take it and show every row.
	for _, send := range []func(string, mail.OverviewData) (mail.Message, error){mail.WeekOverview, mail.MonthOverview} {
		msg, err := send("bert@example.com", overviewData(m, links, "", now))
		if err != nil {
			t.Fatal(err)
		}
		for _, want := range []string{"Salaris", "Basis", "Salaris zelf", "Huur", "Energie", "Naar Spaarrekening", "nieuw"} {
			if !strings.Contains(msg.Text, want) {
				t.Errorf("%s lacks %q", msg.Subject, want)
			}
		}
	}
}

// --- the fortnight ------------------------------------------------------------------------

// TestOverviewFortnight runs the whole dispatcher (Run, every trigger) over a
// fortnight of the demo with both types switched on for Bert and Partner, with
// some rows booked each day, a restart every fourth day and a service that is
// down on Sunday evening; it logs the transcript of the overview messages.
func TestOverviewFortnight(t *testing.T) {
	h := ovHarness(t)
	h.on(demo.Bert, demo.Partner)
	ctx := context.Background()
	var transcript []string
	run := func(now time.Time) {
		t.Helper()
		if err := h.s.Run(ctx, now); err != nil {
			t.Fatal(err)
		}
		for _, line := range h.take() {
			who, rest, _ := strings.Cut(line, " ")
			channel, rest, _ := strings.Cut(rest, ": ")
			typ := "week"
			if strings.Contains(strings.ToLower(rest), "maand") {
				typ = "month"
			}
			title, _, _ := strings.Cut(rest, " /")
			transcript = append(transcript, fmt.Sprintf("%s  %-5s  %-7s  %-5s  %s", now.Format("Mon 02 Jan 15:04"), typ, who, strings.TrimSuffix(channel, ":"), title))
		}
	}
	for n := 0; n <= 13; n++ {
		day := ovNov(18+n, 0, 0)
		if n > 0 {
			iso := day.Format(time.DateOnly)
			h.book(1, iso, -2000-int64(n)*100, "Delhaize", "Boodschappen")
			h.book(5, iso, -1500, "Apotheek", "Overig")
		}
		if n%4 == 3 {
			h.s = h.service() // a restart
		}
		run(ovNov(18+n, 7, 5))
		run(ovNov(18+n, 12, 30))
		if day.Day() != 29 || day.Month() != time.November { // the service is down on Sunday the 29th, until 23:10
			run(ovNov(18+n, 19, 5))
		}
		if day.Month() == time.November && day.Day() == 29 {
			run(ovNov(29, 23, 10))
		}
		run(ovNov(18+n, 22, 30))
	}
	t.Logf("simulated fortnight on the demo (%d overview messages), time, type, user, channel, title:\n%s", len(transcript), strings.Join(transcript, "\n"))

	want := []string{
		"Sun 22 Nov 19:05  week   Bert     email  Je weekoverzicht · week 47",
		"Sun 22 Nov 19:05  week   Bert     push   Weekoverzicht: je bon staat klaar",
		"Sun 22 Nov 19:05  week   Partner  email  Je weekoverzicht · week 47",
		"Sun 22 Nov 19:05  week   Partner  push   Weekoverzicht: je bon staat klaar",
		"Sun 29 Nov 23:10  week   Bert     email  Je weekoverzicht · week 48",
		"Sun 29 Nov 23:10  week   Partner  email  Je weekoverzicht · week 48",
		"Mon 30 Nov 07:05  week   Bert     push   Weekoverzicht: je bon staat klaar",
		"Mon 30 Nov 07:05  week   Partner  push   Weekoverzicht: je bon staat klaar",
		"Mon 30 Nov 19:05  month  Bert     email  Je maandoverzicht · november 2026",
		"Mon 30 Nov 19:05  month  Bert     push   Maandoverzicht: je bon staat klaar",
		"Mon 30 Nov 19:05  month  Partner  email  Je maandoverzicht · november 2026",
		"Mon 30 Nov 19:05  month  Partner  push   Maandoverzicht: je bon staat klaar",
	}
	if strings.Join(transcript, "\n") != strings.Join(want, "\n") {
		t.Errorf("the transcript differs from the story:\n%s", strings.Join(transcript, "\n"))
	}
}
