package notify

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
)

// The shared world (0.9-3b): Bert (1), Partner (2) and Lezer (3). Bert's
// Argenta link (connection 1) feeds his Zichtrekening (1, BE68 …7034).
// Partner's KBC link (connection 2) feeds her own Rekening van Partner (5,
// BE71 …6769) and two shared accounts Bert manages and she is a member of:
// the Gedeelde rekening (4) and the Vakantiepot (6). Lezer has a Belfius link
// (connection 3) and no account. Every link synced an hour before t0.
const (
	lezerConn              int64 = 3
	sharedA, ownP, sharedB int64 = 4, 5, 6
	partnerIBAN                  = "BE71096123456769"
)

func sharedWorld(t *testing.T, partnerValid time.Time) *harness {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "saldo.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := db.Migrate(context.Background(), d, db.Migrations(), "", nil); err != nil {
		t.Fatal(err)
	}
	h := newHarnessOn(t, d)
	h.exec(`INSERT INTO users (id, email, display_name) VALUES (1, 'bert@example.com', 'Bert'), (2, 'partner@example.com', 'Partner'), (3, 'lezer@example.com', 'Lezer')`)
	h.names = map[string]string{"bert@example.com": "Bert", "partner@example.com": "Partner", "lezer@example.com": "Lezer"}
	addConnection(t, d, 1, bert, "Argenta", t0.AddDate(0, 6, 0), t0.Add(-time.Hour))
	addConnection(t, d, 2, partner, "KBC", partnerValid, t0.Add(-time.Hour))
	addConnection(t, d, lezerConn, lezer, "Belfius", t0.AddDate(0, 6, 0), t0.Add(-time.Hour))
	acct := func(id int64, name, iban string, shared bool, conn int64, access ...[3]any) {
		h.exec(`INSERT INTO accounts (id, type, source, iban, name, bank_name, shared, buffer) VALUES (?, 'current', 'bank', ?, ?, 'Bank', ?, 0)`, id, iban, name, shared)
		h.exec(`INSERT INTO account_sources (account_id, connection_id, priority, status, last_sync_at) VALUES (?, ?, 'primary', 'ok', ?)`, id, conn, ts(t0))
		for _, a := range access {
			h.exec(`INSERT INTO account_access (account_id, user_id, role, permission, joined_at) VALUES (?, ?, ?, ?, '2026-06-01T10:00:00Z')`, id, a[0], a[1], a[2])
		}
	}
	acct(a1, "Zichtrekening", fullIBAN, false, 1, [3]any{bert, "manager", "edit"})
	acct(sharedA, "Gedeelde rekening", "BE62510007547061", true, 2, [3]any{bert, "manager", "edit"}, [3]any{partner, "member", "edit"})
	acct(ownP, "Rekening van Partner", partnerIBAN, false, 2, [3]any{partner, "manager", "edit"})
	acct(sharedB, "Vakantiepot", "BE43068999999501", true, 2, [3]any{bert, "manager", "edit"}, [3]any{partner, "member", "edit"})
	h.subscribe(bert, "bert")
	h.subscribe(partner, "partner")
	h.subscribe(lezer, "lezer")
	h.live = true
	return h
}

// syncAll records a good sync at at for every link whose consent still runs.
func (h *harness) syncAll(at time.Time) {
	h.t.Helper()
	h.exec(`UPDATE provider_connections SET last_sync_at = ?, sync_status = 'ok' WHERE valid_until > ?`, ts(at), ts(at))
	h.exec(`UPDATE account_sources SET last_sync_at = ? WHERE connection_id IN (SELECT id FROM provider_connections WHERE valid_until > ?)`, ts(at), ts(at))
}

// runMails runs every trigger at now, checks the lines as run does and returns
// the mails that went out.
func (h *harness) runMails(now time.Time, want ...string) []mail.Message {
	h.t.Helper()
	if h.live {
		h.syncAll(now.Add(-time.Hour))
	}
	if err := h.s.Run(context.Background(), now); err != nil {
		h.t.Fatal(err)
	}
	h.mail.mu.Lock()
	mails := slices.Clone(h.mail.sent)
	h.mail.mu.Unlock()
	got := h.take()
	slices.Sort(want)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		h.t.Errorf("run at %s:\n got %q\nwant %q", now.Format(time.DateTime), got, want)
	}
	return mails
}

func mailOf(t *testing.T, mails []mail.Message, to string) mail.Message {
	t.Helper()
	for _, m := range mails {
		if m.To == to {
			return m
		}
	}
	t.Fatalf("no mail to %s among %d", to, len(mails))
	return mail.Message{}
}

// noneOf fails when a part of m names any of words.
func noneOf(t *testing.T, what string, m mail.Message, words ...string) {
	t.Helper()
	for _, w := range words {
		for part, s := range map[string]string{"subject": m.Subject, "text": m.Text, "html": m.HTML} {
			if i := strings.Index(s, w); i >= 0 {
				t.Errorf("%s names %q in its %s: …%s…", what, w, part, s[max(0, i-80):min(len(s), i+len(w)+40)])
			}
		}
	}
}

// The bank messages with the manager (step 1) -------------------------------

func TestBankManagerVariant(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 0, 14))
	h.run(t0.Add(-time.Minute)) // the baselines
	mails := h.runMails(t0,
		"Partner email: Je KBC-koppeling verloopt over 14 dagen (3 rekeningen)",
		"Partner push: Bankkoppeling verloopt binnenkort /bankkoppelingen",
		// Two shared accounts fed by one link: one message for their manager.
		"Bert email: Partners KBC-koppeling verloopt over 14 dagen (2 rekeningen)",
		"Bert push: Bankkoppeling verloopt binnenkort /rekeningen/4")
	m := mailOf(t, mails, "bert@example.com")
	noneOf(t, "the manager's mail", m, "Rekening van Partner", partnerIBAN, "6769", "BE71", "Opnieuw koppelen")
	for _, w := range []string{"Gedeelde rekening", "Vakantiepot", "Bekijk de rekening", "https://saldo.example.com/rekeningen/4"} {
		if !strings.Contains(m.HTML, w) {
			t.Errorf("the manager's mail lacks %q", w)
		}
	}
	// The manager's push says nothing but the generic text.
	for _, p := range h.push.Sent() {
		if strings.Contains(p.Message.Title+p.Message.Body, "Partner") || strings.Contains(p.Message.Title+p.Message.Body, "KBC") {
			t.Errorf("a push names the owner or the bank: %+v", p.Message)
		}
	}
	h.run(t0.Add(time.Hour)) // once per episode, for both
	h.syncAll(t0.AddDate(0, 0, 11).Add(-time.Hour))
	h.run(t0.AddDate(0, 0, 11),
		"Partner email: Laatste herinnering: KBC verloopt over 3 dagen (3 rekeningen)",
		"Partner push: Bankkoppeling verloopt binnenkort /bankkoppelingen",
		"Bert email: Laatste herinnering: Partners KBC-koppeling verloopt over 3 dagen (2 rekeningen)",
		"Bert push: Bankkoppeling verloopt binnenkort /rekeningen/4")
	mails = h.runMails(t0.AddDate(0, 0, 15),
		"Partner email: Synchronisatie gestopt bij KBC (3 rekeningen)",
		"Partner push: Bankkoppeling: actie nodig /bankkoppelingen",
		"Bert email: Partners KBC-koppeling is verlopen (2 rekeningen)",
		"Bert push: Bankkoppeling: actie nodig /rekeningen/4")
	noneOf(t, "the manager's stop mail", mailOf(t, mails, "bert@example.com"), "Rekening van Partner", partnerIBAN, "6769")
	h.run(t0.AddDate(0, 0, 16))
	if n := h.count(`user_id = ? AND account_id = ?`, bert, ownP); n != 0 {
		t.Errorf("%d log rows about Partner's own account for Bert", n)
	}
}

func TestBankManagerFallback(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 0, 14))
	// Bert linked the Gedeelde rekening himself: it is covered; the
	// Vakantiepot is not, so the message names it alone.
	h.exec(`INSERT INTO account_sources (account_id, connection_id, priority, status) VALUES (4, 1, 'fallback', 'ok')`)
	h.run(t0.Add(-time.Minute))
	mails := h.runMails(t0,
		"Partner email: Je KBC-koppeling verloopt over 14 dagen (3 rekeningen)",
		"Partner push: Bankkoppeling verloopt binnenkort /bankkoppelingen",
		"Bert email: Partners KBC-koppeling verloopt over 14 dagen (Vakantiepot)",
		"Bert push: Bankkoppeling verloopt binnenkort /rekeningen/6")
	m := mailOf(t, mails, "bert@example.com")
	noneOf(t, "the manager's mail", m, "Rekening van Partner", "BE62", "7061")
	if strings.Contains(m.Subject+m.Text, "Gedeelde rekening") {
		t.Errorf("the covered account is named:\n%s", m.Text)
	}

	// Both covered by a healthy link of Bert: the manager hears nothing.
	h2 := sharedWorld(t, t0.AddDate(0, 0, 14))
	h2.exec(`INSERT INTO account_sources (account_id, connection_id, priority, status) VALUES (4, 1, 'fallback', 'ok'), (6, 1, 'fallback', 'ok')`)
	h2.run(t0.Add(-time.Minute))
	h2.run(t0, "Partner email: Je KBC-koppeling verloopt over 14 dagen (3 rekeningen)",
		"Partner push: Bankkoppeling verloopt binnenkort /bankkoppelingen")

	// A fallback whose own link is failing covers nothing.
	h3 := sharedWorld(t, t0.AddDate(0, 0, 14))
	h3.exec(`INSERT INTO account_sources (account_id, connection_id, priority, status) VALUES (4, 1, 'fallback', 'ok'), (6, 1, 'fallback', 'ok')`)
	h3.exec(`UPDATE provider_connections SET sync_status = 'failed' WHERE id = 1`)
	h3.live = false // keep the failure
	h3.run(t0.Add(-time.Minute))
	h3.run(t0, "Partner email: Je KBC-koppeling verloopt over 14 dagen (3 rekeningen)",
		"Partner push: Bankkoppeling verloopt binnenkort /bankkoppelingen",
		"Bert email: Partners KBC-koppeling verloopt over 14 dagen (2 rekeningen)",
		"Bert push: Bankkoppeling verloopt binnenkort /rekeningen/4")
}

// TestBankOwnerIsManager: Bert's own link ending, on accounts he manages,
// is one message (the owner's), however many shared accounts it feeds.
func TestBankOwnerIsManager(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 6, 0))
	h.exec(`UPDATE provider_connections SET valid_until = ? WHERE id = 1`, ts(t0.AddDate(0, 0, 14)))
	h.exec(`DELETE FROM account_sources WHERE account_id IN (4, 6)`)
	h.exec(`INSERT INTO account_sources (account_id, connection_id, priority, status) VALUES (4, 1, 'primary', 'ok'), (6, 1, 'primary', 'ok')`)
	h.run(t0.Add(-time.Minute))
	h.run(t0, "Bert email: Je Argenta-koppeling verloopt over 14 dagen (3 rekeningen)",
		"Bert push: Bankkoppeling verloopt binnenkort /bankkoppelingen")
}

// TestBankManagerBaseline: an episode the owner was mailed about before the
// upgrade is old news for the manager too.
func TestBankManagerBaseline(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 0, 14))
	h.exec(`INSERT INTO notification_log (user_id, type, connection_id, state, channel, dedupe, status)
		VALUES (2, 'consent', 2, ?, 'email', ?, 'sent')`, "14d:"+t0.AddDate(0, 0, 14).In(clock.Brussels).Format(time.DateOnly),
		connectionKey(2, TypeConsent, "14d:"+t0.AddDate(0, 0, 14).In(clock.Brussels).Format(time.DateOnly)))
	h.run(t0)
	h.run(t0.Add(time.Hour))
	if n := h.count(`user_id = 1 AND type = 'consent' AND status = 'suppressed'`); n != 2 {
		t.Errorf("%d suppressed manager rows, want 2", n)
	}
}

// "Iemand sluit aan" and the invitation (steps 2 and 3) ----------------------

func TestJoinedAndInvited(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 6, 0))
	ctx := context.Background()
	store := ledger.New(h.d)
	h.run(t0) // the baselines

	// An invitation: the invited user only.
	at := t0.Add(time.Hour)
	inv, err := store.Invite(ctx, bert, sharedA, lezer, at)
	if err != nil {
		t.Fatal(err)
	}
	link := fmt.Sprintf("/rekeningen?uitnodiging=%d", inv.ID)
	mails := h.runMails(at.Add(time.Minute), "Lezer email: Bert nodigt je uit voor de Gedeelde rekening",
		"Lezer push: Gedeelde rekening: er is iets nieuws "+link)
	noneOf(t, "the invitation", mailOf(t, mails, "lezer@example.com"), "BE62", "7061")
	h.run(at.Add(time.Hour))

	// Accepted: the manager hears it, the other member does not (in-app only).
	at = t0.Add(3 * time.Hour)
	if _, err := store.AcceptInvitation(ctx, lezer, inv.ID, at); err != nil {
		t.Fatal(err)
	}
	mails = h.runMails(at.Add(time.Minute), "Bert email: Lezer is erbij op de Gedeelde rekening", "Bert push: Gedeelde rekening: er is iets nieuws /rekeningen/4")
	if m := mailOf(t, mails, "bert@example.com"); !strings.Contains(m.Text, "heeft je uitnodiging voor de Gedeelde rekening aangenomen") {
		t.Errorf("not the invitation variant:\n%s", m.Text)
	}
	h.run(at.Add(time.Hour))

	// Joined at the bank on an invitation (JoinByInvitation): the link
	// variant, and no invitation message (it was used before any run).
	at = t0.Add(5 * time.Hour)
	if _, err := store.Invite(ctx, bert, sharedB, lezer, at); err != nil {
		t.Fatal(err)
	}
	tx, err := h.d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := ledger.JoinByInvitation(ctx, tx, sharedB, lezer, lezerConn, "ext-6", at); err != nil || !ok {
		t.Fatal(ok, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	mails = h.runMails(at.Add(time.Minute), "Bert email: Lezer is erbij op de Vakantiepot", "Bert push: Gedeelde rekening: er is iets nieuws /rekeningen/6")
	if m := mailOf(t, mails, "bert@example.com"); !strings.Contains(m.Text, "ook bij Belfius gekoppeld") {
		t.Errorf("not the link variant:\n%s", m.Text)
	}

	// The join offer (AcceptJoin): Lezer links Bert's Zichtrekening.
	at = t0.Add(7 * time.Hour)
	offer := h.exec(`INSERT INTO join_offers (user_id, connection_id, account_id, external_account_id, created_at) VALUES (3, 3, 1, 'ext-1', ?)`, ts(at))
	if _, err := store.AcceptJoin(ctx, lezer, offer, at); err != nil {
		t.Fatal(err)
	}
	h.run(at.Add(time.Minute), "Bert email: Lezer is erbij op de Zichtrekening", "Bert push: Gedeelde rekening: er is iets nieuws /rekeningen/1")
	h.run(at.Add(24 * time.Hour))
	if n := h.count(`type = 'joined' AND user_id <> 1`); n != 0 {
		t.Errorf("%d joined rows for someone other than the manager", n)
	}
}

func TestJoinedOnlyTheManagerAtSendTimeAndWithinThreeDays(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 6, 0))
	notice := func(user, account, actor int64, at time.Time) {
		h.exec(`INSERT INTO account_notices (user_id, account_id, type, actor_id, created_at) VALUES (?, ?, 'member', ?, ?)`, user, account, actor, ts(at))
	}
	notice(bert, sharedA, partner, t0.Add(-time.Hour)) // before the upgrade: the baseline
	h.run(t0)
	h.run(t0.Add(time.Minute))
	notice(bert, sharedA, partner, t0.Add(-4*24*time.Hour)) // older than 3 days
	notice(partner, sharedA, bert, t0)                      // a member, not the manager
	h.run(t0.Add(2 * time.Minute))
	// A join nobody was told of within 3 days (Saldo was off) is dropped.
	notice(bert, sharedB, partner, t0.Add(time.Hour))
	h.run(t0.Add(time.Hour + 3*24*time.Hour + time.Minute))
	// The manager changes before the send: the old manager is not told.
	notice(bert, sharedB, partner, t0.AddDate(0, 0, 5))
	h.exec(`UPDATE account_access SET role = CASE user_id WHEN 1 THEN 'member' ELSE 'manager' END WHERE account_id = 6`)
	h.run(t0.AddDate(0, 0, 5).Add(time.Minute))
	if n := h.count(`type = 'joined' AND status = 'sent'`); n != 0 {
		t.Errorf("%d joined messages sent", n)
	}
}

func TestInvitationWithdrawn(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 6, 0))
	ctx := context.Background()
	store := ledger.New(h.d)
	h.run(t0)
	// Withdrawn before any run: nothing.
	inv, err := store.Invite(ctx, bert, sharedA, lezer, t0.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteInvitation(ctx, bert, inv.ID, t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	h.run(t0.Add(time.Hour + time.Minute))
	// At 23:00 the e-mail goes, the push waits for 07:00; withdrawn at 23:30,
	// the push never goes.
	night := time.Date(2026, 11, 16, 23, 0, 0, 0, clock.Brussels)
	inv, err = store.Invite(ctx, bert, sharedA, lezer, night)
	if err != nil {
		t.Fatal(err)
	}
	h.run(night.Add(5*time.Minute), "Lezer email: Bert nodigt je uit voor de Gedeelde rekening")
	if err := store.DeleteInvitation(ctx, bert, inv.ID, night.Add(30*time.Minute)); err != nil {
		t.Fatal(err)
	}
	h.run(night.Add(8*time.Hour + 5*time.Minute))
	// Not withdrawn: the held push goes at 07:00.
	inv, err = store.Invite(ctx, bert, sharedB, lezer, night.Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	h.run(night.Add(24*time.Hour+5*time.Minute), "Lezer email: Bert nodigt je uit voor de Vakantiepot")
	h.run(night.Add(32*time.Hour+5*time.Minute), fmt.Sprintf("Lezer push: Gedeelde rekening: er is iets nieuws /rekeningen?uitnodiging=%d", inv.ID))
}

// The digest (step 4) ------------------------------------------------------------

// bankRows adds n booked rows from the bank sync (conn) to an account on
// date; batch > 0 makes them an import instead.
func (h *harness) bankRows(account, conn int64, n int, date string, batch int64) []int64 {
	h.t.Helper()
	var ids []int64
	for i := range n {
		var src, imp any
		if conn != 0 {
			src = conn
		}
		if batch != 0 {
			imp = batch
		}
		// Arrived the night after it was booked, as a sync brings it (the digest ignores a backfill: see TestDigestIgnoresBackfill).
		ids = append(ids, h.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, source_connection_id, import_batch_id, created_at)
			VALUES (?, -1250, ?, 'Winkel', 'booked', ?, ?, ?, strftime('%Y-%m-%dT03:00:00Z', date(?, '+1 day')))`, account, date, fmt.Sprintf("row-%s-%d-%d-%d", date, account, i, time.Now().UnixNano()), src, imp, date))
	}
	return ids
}

func at19(day int) time.Time { return time.Date(2026, 11, day, 19, 5, 0, 0, clock.Brussels) }

func TestDigest(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 6, 0))
	h.bankRows(a1, 1, 3, "2026-11-15", 0) // the backlog at the upgrade
	h.run(t0)                             // the baselines: the mark
	h.run(at19(16))

	// A CSV import of 500 rows: nothing.
	batch := h.exec(`INSERT INTO import_batches (source, file_name, file_hash, account_id) VALUES ('csv', 'export.csv', 'h', 1)`)
	h.bankRows(a1, 0, 500, "2026-11-10", batch)
	h.bankRows(a1, 0, 2, "2026-11-17", 0) // manual rows: nothing
	h.run(at19(17))

	// Three rows from the sync; a rule categorises one before 19:00; a pending
	// row does not count. Bert sees two on his account and one on the shared
	// one; Partner the shared one; Lezer nothing.
	ids := h.bankRows(a1, 1, 2, "2026-11-18", 0)
	h.bankRows(sharedA, 2, 1, "2026-11-18", 0)
	h.exec(`INSERT INTO transactions (account_id, amount, booking_date, status, dedupe_key, source_connection_id) VALUES (1, -500, '2026-11-18', 'pending', 'p1', 1)`)
	cat := h.exec(`INSERT INTO categories (name, type) VALUES ('Boodschappen', 'expense')`)
	h.exec(`UPDATE transactions SET category_id = ?, category_origin = 'rule' WHERE id = ?`, cat, ids[0])
	h.run(at19(18), "Bert push: 2 transacties te categoriseren /transacties?filter=niet-gecategoriseerd",
		"Partner push: 1 transactie te categoriseren /transacties?filter=niet-gecategoriseerd")
	h.run(at19(18).Add(2 * time.Hour)) // once a day
	h.run(at19(19))                    // the backlog never repeats

	// A row after the mark counts once; the e-mail when switched on.
	h.exec(`INSERT INTO notification_prefs (user_id, type, push, email) VALUES (1, 'cat', 1, 1)`)
	h.bankRows(a1, 1, 1, "2026-11-20", 0)
	h.run(time.Date(2026, 11, 20, 18, 55, 0, 0, clock.Brussels)) // not before 19:00
	h.run(at19(20), "Bert email: 1 transactie te categoriseren", "Bert push: 1 transactie te categoriseren /transacties?filter=niet-gecategoriseerd")
	h.run(at19(21))

	// A late catch-up after 22:00: the e-mail goes, the push waits for 07:00.
	h.bankRows(a1, 1, 1, "2026-11-22", 0)
	late := time.Date(2026, 11, 22, 22, 30, 0, 0, clock.Brussels)
	h.run(late, "Bert email: 1 transactie te categoriseren")
	h.run(late.Add(30 * time.Minute))
	h.run(late.Add(8*time.Hour+35*time.Minute), "Bert push: 1 transactie te categoriseren /transacties?filter=niet-gecategoriseerd")
	h.run(at19(23))

	// A user added after the baseline starts with a silent mark.
	h.exec(`INSERT INTO users (id, email, display_name) VALUES (4, 'nieuw@example.com', 'Nieuw')`)
	h.exec(`INSERT INTO account_access (account_id, user_id, role, permission) VALUES (4, 4, 'member', 'edit')`)
	h.run(at19(24))
	h.bankRows(sharedA, 2, 1, "2026-11-25", 0)
	h.names["nieuw@example.com"] = "Nieuw"
	h.run(at19(25), "Bert push: 1 transactie te categoriseren /transacties?filter=niet-gecategoriseerd",
		"Bert email: 1 transactie te categoriseren", "Partner push: 1 transactie te categoriseren /transacties?filter=niet-gecategoriseerd")
	if n := h.count(`user_id = 4 AND type = 'cat' AND dedupe = ?`, digestKey("2026-11-25")); n != 2 {
		t.Errorf("Nieuw has %d rows for the digest (no channel: both suppressed), want 2", n)
	}
}

// Linking a bank (or a joiner's fallback link) backfills weeks of history with a source
// connection and no import batch. That is not news: only rows booked within a week of the
// day they arrived count, so the first evening after linking does not say "180 transacties".
func TestDigestIgnoresBackfill(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 6, 0))
	h.run(t0) // the baselines: the mark
	h.run(at19(16))

	// 40 rows booked in September and October arrive on 17 November (a new link's backfill),
	// together with one booked on the 16th and one the bank posted late, booked on the 12th.
	for i := range 40 {
		h.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, source_connection_id, created_at)
			VALUES (?, -1250, ?, 'Winkel', 'booked', ?, 1, '2026-11-17T03:00:00Z')`, a1, fmt.Sprintf("2026-10-%02d", 1+i%28), fmt.Sprintf("backfill-%d", i))
	}
	for _, d := range []string{"2026-11-16", "2026-11-12"} {
		h.exec(`INSERT INTO transactions (account_id, amount, booking_date, counterparty_name, status, dedupe_key, source_connection_id, created_at)
			VALUES (?, -1250, ?, 'Winkel', 'booked', ?, 1, '2026-11-17T03:00:00Z')`, a1, d, "fresh-"+d)
	}
	// Five days late counts (12 -> 17), a month late does not: two rows, not 42.
	h.run(at19(17), "Bert push: 2 transacties te categoriseren /transacties?filter=niet-gecategoriseerd")
	h.run(at19(18)) // and nothing repeats
}

// Defaults (no notification_prefs rows): cat push only, contrib nothing.
func TestNewTypesDefaults(t *testing.T) {
	p := Effective(nil)
	for k, want := range map[string]Pref{TypeJoined: {true, true}, TypeInvite: {true, true}, TypeContrib: {false, false},
		TypeCat: {true, false}, TypeDevice: {true, true}} {
		if p[k] != want {
			t.Errorf("%s: %+v, want %+v", k, p[k], want)
		}
	}
}

// The new device (step 6) ------------------------------------------------------------

func TestNewDevice(t *testing.T) {
	h := sharedWorld(t, t0.AddDate(0, 6, 0))
	// Bert's new laptop already registered a subscription (it should not, but
	// even then it is left out); his phone gets the push, at 03:00 too (a
	// security message ignores quiet hours).
	dev := h.exec(`INSERT INTO devices (user_id, name, token_hash) VALUES (1, 'Firefox op Windows', 'new')`)
	h.exec(`INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth) VALUES (1, ?, 'https://fcm.googleapis.com/fcm/send/laptop', 'k', 'a')`, dev)
	h.names["https://fcm.googleapis.com/fcm/send/laptop"] = "Bert's laptop"
	night := time.Date(2026, 11, 17, 3, 0, 0, 0, clock.Brussels)
	// Even with the chips off: the e-mail always goes.
	h.exec(`INSERT INTO notification_prefs (user_id, type, push, email) VALUES (1, 'device', 1, 0)`)
	h.exec(`UPDATE users SET notify_email = 0 WHERE id = 1`)
	if err := h.s.NewDevice(context.Background(), night, bert, dev, "Firefox op Windows"); err != nil {
		t.Fatal(err)
	}
	got := h.take()
	want := []string{"Bert email: Nieuw toestel aangemeld: Firefox op Windows", "Bert push: Nieuw toestel aangemeld /instellingen/toestellen"}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("got %q\nwant %q", got, want)
	}
	if err := h.s.NewDevice(context.Background(), night.Add(time.Minute), bert, dev, "Firefox op Windows"); err != nil {
		t.Fatal(err)
	}
	if got := h.take(); len(got) != 0 {
		t.Errorf("sent twice: %q", got)
	}
}

// Visibility sentinel: over every test world, nobody holds a log row about an
// account they cannot see (the invitee's has no account).
func assertVisible(t *testing.T, d *sql.DB) {
	t.Helper()
	var n int
	if err := d.QueryRow(`SELECT COUNT(*) FROM notification_log l WHERE l.account_id IS NOT NULL AND l.status = 'sent'
		AND NOT EXISTS (SELECT 1 FROM account_access x WHERE x.account_id = l.account_id AND x.user_id = l.user_id)`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d sent messages about an account their user cannot see", n)
	}
}
