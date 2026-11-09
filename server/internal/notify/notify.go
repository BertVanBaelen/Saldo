// Package notify decides which bank reminders are due and mails them
// (phase 0.3-2): "Koppeling verloopt" at 14 and 3 days before a consent ends
// and "Synchronisatie gestopt" when it lapsed or the sync keeps failing.
// notification_log keeps every mail that was sent, so a reminder goes out
// once per consent or failure episode however often the check runs.
package notify

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	netmail "net/mail"
	"strings"
	"sync"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
)

// Notification types, as in notification_prefs and notification_log
// (analysis/concepts/notification.md).
const (
	TypeConsent = "consent" // Koppeling verloopt
	TypeStop    = "stop"    // Synchronisatie gestopt
)

// Service runs the reminder check.
type Service struct {
	db        *sql.DB
	store     *ledger.Store
	mailer    mail.Sender
	publicURL string
	log       *slog.Logger

	// mu makes runs one at a time: a run reads the log, sends, then writes
	// the log, and a second run in between would send the same mail again.
	// One Service per process (the add-on runs one).
	mu     sync.Mutex
	noMail sync.Once
}

// New returns the service. mailer nil means mail is not configured: the check
// then does nothing. publicURL is the address Saldo is opened on, without a
// trailing slash; empty leaves the button out of the mails.
func New(db *sql.DB, mailer mail.Sender, publicURL string, log *slog.Logger) *Service {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Service{db: db, store: ledger.New(db), mailer: mailer, publicURL: publicURL, log: log}
}

// due is one reminder that should go out.
type due struct {
	typ, state string
	conn       ledger.Connection
}

// CheckConnections mails the reminders that are due at now. It is idempotent
// and meant to run at start and about every hour. A mail the sender refuses
// is not logged and so tried again on the next run.
func (s *Service) CheckConnections(ctx context.Context, now time.Time) error {
	if s.mailer == nil {
		s.noMail.Do(func() { s.log.Info("mail is not configured: no consent or sync reminders are sent") })
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	owners, err := s.owners(ctx)
	if err != nil {
		return err
	}
	for _, o := range owners {
		if _, err := netmail.ParseAddress(o.email); err != nil {
			continue // no working address: nothing to send to
		}
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
			if err := s.send(ctx, o, d, accounts, now); err != nil {
				return err
			}
		}
	}
	return nil
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
}

// owners are the users with a linked connection. Reminders go to the owner
// only; members of shared accounts follow in 0.6.
func (s *Service) owners(ctx context.Context) ([]owner, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT u.id, u.email FROM provider_connections c JOIN users u ON u.id = c.user_id
		WHERE c.status IN ('active', 'expired') ORDER BY u.id`)
	if err != nil {
		return nil, fmt.Errorf("notify: %w", err)
	}
	defer rows.Close()
	var out []owner
	for rows.Next() {
		var o owner
		if err := rows.Scan(&o.id, &o.email); err != nil {
			return nil, fmt.Errorf("notify: %w", err)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Service) send(ctx context.Context, o owner, d due, accounts []ledger.Account, now time.Time) error {
	on, err := s.wanted(ctx, o.id, d)
	if err != nil || !on {
		return err
	}
	m, err := s.message(o.email, d, accounts, now)
	if err != nil {
		return err
	}
	sendCtx, cancel := context.WithTimeout(ctx, time.Minute)
	err = s.mailer.Send(sendCtx, m)
	cancel()
	if err != nil {
		// No address, no content: the error can quote the recipient.
		s.log.Warn("reminder not sent, tried again on the next run", "connection", d.conn.ID, "type", d.typ)
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO notification_log (user_id, type, connection_id, state, channel, sent_at) VALUES (?, ?, ?, ?, 'email', ?)`,
		o.id, d.typ, d.conn.ID, d.state, now.UTC().Format(time.RFC3339)); err != nil {
		return fmt.Errorf("notify: log the sent mail: %w", err)
	}
	s.log.Info("reminder sent", "connection", d.conn.ID, "type", d.typ)
	return nil
}

// wanted reports whether the reminder is still to be sent: not in the log
// yet and e-mail not turned off for its type (default on).
func (s *Service) wanted(ctx context.Context, user int64, d due) (bool, error) {
	var email int
	err := s.db.QueryRowContext(ctx, `SELECT email FROM notification_prefs WHERE user_id = ? AND type = ?`, user, d.typ).Scan(&email)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return false, fmt.Errorf("notify: %w", err)
	case email == 0:
		return false, nil
	}
	var n int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM notification_log
		WHERE user_id = ? AND connection_id = ? AND type = ? AND state = ? AND channel = 'email'`,
		user, d.conn.ID, d.typ, d.state).Scan(&n); err != nil {
		return false, fmt.Errorf("notify: %w", err)
	}
	return n == 0, nil
}

func (s *Service) message(to string, d due, accounts []ledger.Account, now time.Time) (mail.Message, error) {
	refs := accountRefs(d.conn.Accounts, accounts)
	relink := ""
	if s.publicURL != "" {
		relink = s.publicURL + "/bankkoppelingen"
	}
	if d.typ == TypeConsent {
		until, _ := time.ParseInLocation(time.DateOnly, *d.conn.ValidUntil, clock.Brussels)
		return mail.ConsentExpiring(to, d.conn.Bank, refs, until, *d.conn.DaysLeft, relink)
	}
	var last time.Time
	if d.conn.LastSync != nil {
		last, _ = time.Parse(time.RFC3339, *d.conn.LastSync)
	}
	reason := mail.StopFailing
	if d.conn.Status == ledger.ConnExpired {
		reason = mail.StopConsent
	}
	return mail.SyncStopped(to, d.conn.Bank, refs, last, reason, relink)
}

// accountRefs names the connection's accounts as the owner sees them; the
// IBAN comes masked from the ledger.
func accountRefs(ids []int64, accounts []ledger.Account) []mail.AccountRef {
	var out []mail.AccountRef
	for _, id := range ids {
		for _, a := range accounts {
			if a.ID != id {
				continue
			}
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
			out = append(out, ref)
		}
	}
	return out
}
