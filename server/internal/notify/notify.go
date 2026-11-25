// Package notify is the notification dispatcher (phase 0.9-3, NOTIF-3): one
// Deliver takes a typed message for a user and delivers it by push and
// e-mail as the user chose (Types, notification_prefs, the e-mail and
// quiet-hours switches, the push subscriptions), at most once per user,
// channel and message key (notification_log, migration 0019: the row is
// claimed before the send and marked sent after).
//
// The triggers decide what is due at the time they are given and hand it to
// Deliver: the bank reminders of 0.3-2 ("Koppeling verloopt" at 14 and 3 days
// before a consent ends, "Synchronisatie gestopt" when it lapsed or the sync
// keeps failing) and the planning warnings ("Rekening staat rood", "Rekening
// komt in de buffer", once a day from 07:00). Run runs every trigger in order;
// cmd/saldo calls it every 15 minutes. A trigger's first run records the
// state it finds without sending anything (its baseline), so an upgrade never
// sends old news.
package notify

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
)

// Options are what the Service needs. Mailer nil: no e-mail (the e-mail
// channel counts as off). Pushes or Push nil: no push.
type Options struct {
	DB     *sql.DB
	Mailer mail.Sender
	Pushes *push.Store
	Push   push.Sender
	// PublicURL is the address Saldo is opened on, without a trailing slash;
	// empty leaves the buttons, the logo and the settings link out of mails.
	PublicURL string
	Log       *slog.Logger
}

// Service runs the triggers and delivers their messages.
type Service struct {
	db        *sql.DB
	store     *ledger.Store
	mailer    mail.Sender
	pushes    *push.Store
	pusher    push.Sender
	publicURL string
	log       *slog.Logger

	// mu makes Run one at a time in this process. Repeat protection does not
	// depend on it (the log's unique key does); it keeps two runs from doing
	// the same forecasts at once.
	mu     sync.Mutex
	noMail sync.Once

	// afterClaim, when set (tests), runs between the claim and the send.
	afterClaim func(m Message, channel string)
}

// New returns the service.
func New(o Options) *Service {
	log := o.Log
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	s := &Service{db: o.DB, store: ledger.New(o.DB), mailer: o.Mailer, pushes: o.Pushes, pusher: o.Push,
		publicURL: strings.TrimRight(o.PublicURL, "/"), log: log}
	if s.pushes == nil || s.pusher == nil {
		s.pushes, s.pusher = nil, nil
	}
	return s
}

// trigger is one kind of notification: its first-run baseline and its run.
type trigger struct {
	name     string // also the baseline marker: baseline:<name>
	baseline func(ctx context.Context, now time.Time) error
	run      func(ctx context.Context, now time.Time) error
}

// triggers are the triggers in the order Run runs them. Later phases
// register theirs here, each with its own baseline: 0.9-3b joined, invite,
// contrib, digest (cat) after planning; 0.9-3e week and month after those.
// (The device message is not a trigger: sign-in delivers it directly.)
func (s *Service) triggers() []trigger {
	return []trigger{
		{"connections", s.baselineConnections, s.CheckConnections},
		{"planning", s.baselinePlanning, s.Planning},
		{"joined", s.baselineJoined, s.Joined},      // 0.9-3b
		{"invite", s.baselineInvite, s.Invitations}, // 0.9-3b
		{"contrib", s.baselineContrib, s.Contrib},   // 0.9-3b
		{"digest", s.baselineDigest, s.Digest},      // 0.9-3b, the cat digest
		// 0.9-3e, the week first, so a month that ends on a Sunday sends both in that order
		{"week", s.baselineWeek, s.OverviewWeek}, {"month", s.baselineMonth, s.OverviewMonth},
	}
}

// Run runs every trigger at now: each decides what is due (a catch-up, so a
// restart only delays). A trigger's first run is its baseline and sends
// nothing. One trigger's error does not stop the others.
func (s *Service) Run(ctx context.Context, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.mailer == nil {
		s.noMail.Do(func() { s.log.Info("mail is not configured: notifications go by push only") })
	}
	var errs []error
	for _, t := range s.triggers() {
		first, err := s.baseline(ctx, now, t.name, t.baseline)
		if err != nil {
			errs = append(errs, fmt.Errorf("notify %s baseline: %w", t.name, err))
			continue
		}
		if first {
			continue
		}
		if err := t.run(ctx, now); err != nil {
			errs = append(errs, fmt.Errorf("notify %s: %w", t.name, err))
		}
	}
	return errors.Join(errs...)
}

// baseline runs fn once per trigger: when notify_runs has no marker
// baseline:<name>, fn records the trigger's current state as suppressed and
// the marker is written (with the Brussels date). It reports whether this was
// that first run; the trigger sends nothing in it.
func (s *Service) baseline(ctx context.Context, now time.Time, name string, fn func(context.Context, time.Time) error) (bool, error) {
	marker := "baseline:" + name
	if day, err := s.runDay(ctx, marker); err != nil || day != "" {
		return false, err
	}
	if err := fn(ctx, now); err != nil {
		return false, err
	}
	return true, s.setRunDay(ctx, marker, now.In(clock.Brussels).Format(time.DateOnly))
}

// runDay is the day stored for name in notify_runs, "" without one.
func (s *Service) runDay(ctx context.Context, name string) (string, error) {
	var day sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT day FROM notify_runs WHERE name = ?`, name).Scan(&day)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("notify: %w", err)
	}
	return day.String, nil
}

func (s *Service) setRunDay(ctx context.Context, name, day string) error {
	if _, err := s.db.ExecContext(ctx, `INSERT INTO notify_runs (name, day) VALUES (?, ?)
		ON CONFLICT (name) DO UPDATE SET day = excluded.day`, name, day); err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	return nil
}

// links are the absolute addresses the notification mails carry.
func (s *Service) links() mail.Links {
	if s.publicURL == "" {
		return mail.Links{}
	}
	return mail.Links{BaseURL: s.publicURL, SettingsURL: s.publicURL + "/meldingen"}
}

// abs is the absolute URL of an app path, "" without a public URL.
func (s *Service) abs(path string) string {
	if s.publicURL == "" {
		return ""
	}
	return s.publicURL + path
}

// The bank reminders (0.3-2, now on the dispatcher) ---------------------------

// due is one bank reminder that should go out.
type due struct {
	typ, state string
	conn       ledger.Connection
}

// CheckConnections delivers the bank reminders that are due at now, to the
// connection's owner and (0.9-3b, risk 5b) to the manager of every shared
// account the link feeds that no other healthy source covers, in the manager
// variant (managerReminders). The key of a reminder is its connection episode,
// "connection:<id>|<type>|<state>", the same as the 0.3-2 log rows that
// migration 0019 keyed, so a reminder sent before the upgrade is not sent
// again.
func (s *Service) CheckConnections(ctx context.Context, now time.Time) error {
	owners, err := s.owners(ctx)
	if err != nil {
		return err
	}
	for _, o := range owners {
		conns, err := s.store.Connections(ctx, o.id, now)
		if err != nil {
			return err
		}
		var list []due
		for _, c := range conns {
			list = append(list, reminders(c, now)...)
		}
		if len(list) == 0 {
			continue
		}
		accounts, err := s.store.Accounts(ctx, o.id, now)
		if err != nil {
			return err
		}
		for _, d := range list {
			m, err := s.connectionMessage(o.id, d, accounts)
			if err != nil {
				return err
			}
			if _, err := s.Deliver(ctx, now, m); err != nil {
				return err
			}
			if err := s.managerReminders(ctx, now, o, d, false); err != nil {
				return err
			}
		}
	}
	return nil
}

// connectionKey is the repeat key of a bank reminder.
func connectionKey(conn int64, typ, state string) string {
	return fmt.Sprintf("connection:%d|%s|%s", conn, typ, state)
}

// reminders returns what a connection is due for at now, before the log is
// consulted. The state names the episode: the consent's last day for the
// consent mails, the last good sync for a failing connection.
func reminders(c ledger.Connection, now time.Time) []due {
	if c.Status == ledger.ConnPending || len(c.Accounts) == 0 {
		return nil
	}
	consent := ""
	if c.ValidUntil != nil {
		consent = *c.ValidUntil
	}
	if c.Status == ledger.ConnExpired {
		return []due{{TypeStop, "lapsed:" + consent, c}}
	}
	var out []due
	if c.DaysLeft != nil {
		switch {
		case *c.DaysLeft <= 3:
			out = append(out, due{TypeConsent, "3d:" + consent, c})
		case *c.DaysLeft <= ledger.ConsentWarnDays:
			out = append(out, due{TypeConsent, "14d:" + consent, c})
		}
	}
	if c.Stopped(now) {
		out = append(out, due{TypeStop, "failing:" + c.LastGood().UTC().Format(time.RFC3339), c})
	}
	return out
}

type owner struct {
	id    int64
	email string
	name  string // display name, for the manager variant
}

// owners are the users with a linked connection.
func (s *Service) owners(ctx context.Context) ([]owner, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT u.id, u.email, u.display_name FROM provider_connections c JOIN users u ON u.id = c.user_id
		WHERE c.status IN ('active', 'expired') ORDER BY u.id`)
	if err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	defer rows.Close()
	var out []owner
	for rows.Next() {
		var o owner
		if err := rows.Scan(&o.id, &o.email, &o.name); err != nil {
			return nil, fmt.Errorf("notify: %w", err)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// connectionMessage is the owner's message for a reminder: the 0.3-2 mail
// with the settings link and the logo, and a push to Bankkoppelingen.
func (s *Service) connectionMessage(user int64, d due, accounts []ledger.Account) (Message, error) {
	refs := accountRefs(d.conn.Accounts, accounts)
	em, err := s.bankMail(d, "", refs, s.abs("/bankkoppelingen"))
	if err != nil {
		return Message{}, err
	}
	text := Text{Bank: d.conn.Bank}
	if len(refs) > 0 {
		text.Account = refs[0].Name
	}
	if d.typ == TypeConsent {
		text.Days = *d.conn.DaysLeft
	}
	p := Payload(d.typ, text, Detail)
	p.URL, p.Tag = "/bankkoppelingen", fmt.Sprintf("bank-%d", d.conn.ID)
	return Message{User: user, Type: d.typ, Key: connectionKey(d.conn.ID, d.typ, d.state), Connection: d.conn.ID,
		State: d.state, Push: &p, Email: &em}, nil
}

// bankMail is the e-mail of a bank reminder: the owner's (owner "") or the
// manager variant naming only the shared accounts of refs (owner set).
func (s *Service) bankMail(d due, owner string, refs []mail.AccountRef, action string) (mail.Message, error) {
	if d.typ == TypeConsent {
		until, _ := time.ParseInLocation(time.DateOnly, *d.conn.ValidUntil, clock.Brussels)
		return mail.ConsentExpiringNotice("", mail.ConsentExpiringData{Links: s.links(), Bank: d.conn.Bank, Owner: owner, Accounts: refs,
			ValidUntil: until, DaysLeft: *d.conn.DaysLeft, ActionURL: action})
	}
	var last time.Time
	if d.conn.LastSync != nil {
		last, _ = time.Parse(time.RFC3339, *d.conn.LastSync)
	}
	reason := mail.StopFailing
	if d.conn.Status == ledger.ConnExpired {
		reason = mail.StopConsent
	}
	return mail.SyncStoppedNotice("", mail.SyncStoppedData{Links: s.links(), Bank: d.conn.Bank, Owner: owner, Accounts: refs,
		LastSuccess: last, Reason: reason, ActionURL: action})
}

// baselineConnections is the first run of the bank reminders: the reminders
// already mailed (0.3-2) are copied to the push channel as suppressed, so the
// new channel does not repeat them. Reminders that are due and were never
// mailed go out on the next run, as the old hourly check would have sent them.
func (s *Service) baselineConnections(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO notification_log
		(user_id, type, account_id, connection_id, month, state, channel, dedupe, status, claimed_at)
		SELECT user_id, type, account_id, connection_id, month, state, 'push', dedupe, 'suppressed', ?
		FROM notification_log WHERE channel = 'email' AND type IN ('consent', 'stop') AND status = 'sent'
		ON CONFLICT (user_id, channel, dedupe) DO NOTHING`, stamp(now))
	if err != nil {
		return fmt.Errorf("notify: %w", err)
	}
	// The manager variants (0.9-3b) of an episode the owner was already mailed
	// about are old news: suppressed for the managers too.
	owners, err := s.owners(ctx)
	if err != nil {
		return err
	}
	for _, o := range owners {
		conns, err := s.store.Connections(ctx, o.id, now)
		if err != nil {
			return err
		}
		for _, c := range conns {
			for _, d := range reminders(c, now) {
				var n int
				if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_log WHERE user_id = ? AND dedupe = ? AND status = 'sent'`,
					o.id, connectionKey(c.ID, d.typ, d.state)).Scan(&n); err != nil {
					return fmt.Errorf("notify: %w", err)
				}
				if n == 0 {
					continue
				}
				if err := s.managerReminders(ctx, now, o, d, true); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// accountRefs names the connection's accounts as the owner sees them; the
// IBAN comes masked from the ledger.
func accountRefs(ids []int64, accounts []ledger.Account) []mail.AccountRef {
	var out []mail.AccountRef
	for _, id := range ids {
		for _, a := range accounts {
			if a.ID == id {
				out = append(out, accountRef(a))
			}
		}
	}
	return out
}

// accountRef is the account block entry of an account as the viewer sees it.
func accountRef(a ledger.Account) mail.AccountRef {
	ref := mail.AccountRef{Name: a.Name, Shared: a.Kind == "shared"}
	if a.IBAN != nil {
		ref.MaskedIBAN = *a.IBAN
	}
	var others []string
	for _, m := range a.Members {
		if !m.Me {
			others = append(others, m.Name)
		}
	}
	ref.With = strings.Join(others, ", ")
	return ref
}
