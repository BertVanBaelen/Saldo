package notify

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	netmail "net/mail"
	"slices"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/push"
)

// Channels, as in notification_log.channel.
const (
	ChannelEmail = "email"
	ChannelPush  = "push"
)

// EventExpiry is how long an event message (a join, an invitation, a new
// device, an overview) may still go out after it happened; Deliver drops it
// after its Expires.
const EventExpiry = 3 * 24 * time.Hour

// claimTimeout: a claim this old without sent is taken over, because the
// process that claimed it stopped between claim and send.
const claimTimeout = 10 * time.Minute

// Quiet hours for push: the half-open interval [22:00, 07:00) in Brussels.
const (
	quietFrom = 22
	quietTo   = 7
)

// Message is one notification for one user, ready in every form; Deliver
// decides the channels.
type Message struct {
	User int64
	Type string // a key of Types
	// Key is the repeat key (notification_log.dedupe): a message is delivered
	// at most once per user, channel and key. "account:<id>|rood|<month>|red",
	// "connection:<id>|consent|14d:<valid_until>", "notice:<id>", ...
	Key string
	// Account and Connection are what the message is about: Deliver checks
	// right before claiming and again right before sending that the user can
	// still see the account (account_access) and still owns the connection.
	// Zero: no check of that kind. The manager's copy of a bank reminder
	// carries the shared account, not the connection (the manager does not own
	// it); an invitation carries neither (the invitee sees no account yet).
	Account    int64
	Connection int64
	// Month and State are written to the log row as they are (the planning
	// warnings re-arm on them); empty for other types.
	Month, State string
	// Push is the push to show (URL a same-origin path, Tag the notification
	// that a newer one replaces); nil: no push form.
	Push *push.Payload
	// Email is the rendered mail; Deliver sets its recipient. nil: no e-mail
	// form.
	Email *mail.Message
	// Expires: an event message is dropped (and not logged) from this moment
	// on. Zero: never (state messages are re-evaluated on every run).
	Expires time.Time
	// SkipDevice: the push leaves out this device's subscription (the device
	// that just signed in, for the new-device message). Zero: none.
	SkipDevice int64
}

// Result is what Deliver did.
type Result struct {
	// Dropped: expired, or the user can no longer see what it is about.
	// Nothing was logged.
	Dropped bool
	// Sent lists the channels that went out in this call.
	Sent []string
	// Retry: a push waits for the end of quiet hours or a send failed; the
	// next run delivers it.
	Retry bool
}

// Deliver delivers m to the channels the user has on. Per channel: a channel
// that is off (the type's chip, the e-mail switch, no address or mailer, no
// push subscription or sender, no form of that kind) gets a suppressed row, so
// turning it on later never replays; a push inside quiet hours waits without
// claiming anything; otherwise the row is claimed first (a unique key: an
// existing row means someone else handled it), the message sent and the row
// marked sent. A failed send deletes the claim, so the next run tries again.
// It returns an error for a database failure only; a refused send is logged.
func (s *Service) Deliver(ctx context.Context, now time.Time, m Message) (Result, error) {
	var res Result
	typ, ok := TypeByKey(m.Type)
	if !ok || m.Key == "" || m.User == 0 {
		return res, fmt.Errorf("notify: message of type %q with key %q for user %d", m.Type, m.Key, m.User)
	}
	if !m.Expires.IsZero() && !now.Before(m.Expires) {
		res.Dropped = true
		return res, nil
	}
	if ok, err := s.visible(ctx, m); err != nil || !ok {
		res.Dropped = err == nil
		return res, err
	}

	var address string
	var emailOn, quiet bool
	err := s.db.QueryRowContext(ctx, `SELECT email, notify_email = 1, quiet_hours = 1 FROM users WHERE id = ?`, m.User).Scan(&address, &emailOn, &quiet)
	if errors.Is(err, sql.ErrNoRows) {
		res.Dropped = true
		return res, nil
	}
	if err != nil {
		return res, fmt.Errorf("notify: %w", err)
	}
	prefs, err := Prefs(ctx, s.db, m.User)
	if err != nil {
		return res, err
	}
	pref := prefs[typ.Key]
	if _, err := netmail.ParseAddress(address); err != nil {
		address = ""
	}
	var subs []push.Stored
	if s.pushes != nil && s.pusher != nil && m.Push != nil && pref.Push {
		if subs, err = s.pushes.ForUser(ctx, m.User); err != nil {
			return res, fmt.Errorf("notify: %w", err)
		}
		if m.SkipDevice != 0 {
			subs = slices.DeleteFunc(subs, func(sub push.Stored) bool { return sub.DeviceID == m.SkipDevice })
		}
	}

	for _, ch := range []string{ChannelEmail, ChannelPush} {
		var on bool
		if ch == ChannelEmail {
			on = m.Email != nil && s.mailer != nil && address != "" && (typ.AlwaysEmail || pref.Email && emailOn)
		} else {
			on = m.Push != nil && len(subs) > 0
		}
		if !on {
			if err := s.suppress(ctx, now, m, ch); err != nil {
				return res, err
			}
			continue
		}
		if ch == ChannelPush && quiet && !typ.Security && quietAt(now) {
			final, err := s.final(ctx, m, ch)
			if err != nil {
				return res, err
			}
			if !final {
				res.Retry = true
			}
			continue
		}
		id, claimed, err := s.claim(ctx, now, m, ch)
		if err != nil || !claimed {
			if err != nil {
				return res, err
			}
			continue
		}
		if s.afterClaim != nil {
			s.afterClaim(m, ch)
		}
		if ok, err := s.visible(ctx, m); err != nil || !ok {
			if _, derr := s.db.ExecContext(context.WithoutCancel(ctx), `DELETE FROM notification_log WHERE id = ? AND status = 'claimed'`, id); derr != nil && err == nil {
				err = derr
			}
			res.Dropped = err == nil
			return res, err
		}
		var sent bool
		if ch == ChannelEmail {
			sent = s.sendEmail(ctx, m, address)
		} else {
			sent = s.sendPush(ctx, m, subs)
		}
		if !sent {
			res.Retry = true
			if _, err := s.db.ExecContext(context.WithoutCancel(ctx), `DELETE FROM notification_log WHERE id = ? AND status = 'claimed'`, id); err != nil {
				return res, fmt.Errorf("notify: release the claim: %w", err)
			}
			continue
		}
		if _, err := s.db.ExecContext(context.WithoutCancel(ctx), `UPDATE notification_log SET status = 'sent', sent_at = ? WHERE id = ?`, stamp(now), id); err != nil {
			return res, fmt.Errorf("notify: mark sent: %w", err)
		}
		res.Sent = append(res.Sent, ch)
		s.log.Info("notification sent", "type", m.Type, "channel", ch, "user", m.User)
	}
	return res, nil
}

// visible reports whether the user can still see what m is about.
func (s *Service) visible(ctx context.Context, m Message) (bool, error) {
	var n int
	if m.Account != 0 {
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM account_access WHERE account_id = ? AND user_id = ?`, m.Account, m.User).Scan(&n); err != nil {
			return false, fmt.Errorf("notify: %w", err)
		}
		if n == 0 {
			return false, nil
		}
	}
	if m.Connection != 0 {
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM provider_connections WHERE id = ? AND user_id = ?`, m.Connection, m.User).Scan(&n); err != nil {
			return false, fmt.Errorf("notify: %w", err)
		}
		if n == 0 {
			return false, nil
		}
	}
	return true, nil
}

// suppress writes the suppressed row of a channel that is off, unless the
// channel has a row for the key already. A claim older than claimTimeout (a
// crash between claim and send) becomes suppressed too: the channel is off
// now, and the key must not stay open for ever.
func (s *Service) suppress(ctx context.Context, now time.Time, m Message, ch string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO notification_log
		(user_id, type, account_id, connection_id, month, state, channel, dedupe, status, claimed_at)
		VALUES (?, ?, NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, ''), NULLIF(?, ''), ?, ?, 'suppressed', ?)
		ON CONFLICT (user_id, channel, dedupe) DO UPDATE SET status = 'suppressed', claimed_at = excluded.claimed_at
		WHERE status = 'claimed' AND claimed_at < ?`,
		m.User, m.Type, m.Account, m.Connection, m.Month, m.State, ch, m.Key, stamp(now), stamp(now.Add(-claimTimeout)))
	if err != nil {
		return fmt.Errorf("notify: log a suppressed message: %w", err)
	}
	return nil
}

// final reports whether the channel's row for the key is sent or suppressed.
func (s *Service) final(ctx context.Context, m Message, ch string) (bool, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_log
		WHERE user_id = ? AND channel = ? AND dedupe = ? AND status IN ('sent', 'suppressed')`, m.User, ch, m.Key).Scan(&n); err != nil {
		return false, fmt.Errorf("notify: %w", err)
	}
	return n > 0, nil
}

// claim inserts the claimed row of the channel. It returns false when the key
// is already handled or being handled; a claim older than claimTimeout is
// taken over (compare-and-swap on its claimed_at).
func (s *Service) claim(ctx context.Context, now time.Time, m Message, ch string) (int64, bool, error) {
	res, err := s.db.ExecContext(ctx, `INSERT INTO notification_log
		(user_id, type, account_id, connection_id, month, state, channel, dedupe, status, claimed_at)
		VALUES (?, ?, NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, ''), NULLIF(?, ''), ?, ?, 'claimed', ?)
		ON CONFLICT (user_id, channel, dedupe) DO NOTHING`,
		m.User, m.Type, m.Account, m.Connection, m.Month, m.State, ch, m.Key, stamp(now))
	if err != nil {
		return 0, false, fmt.Errorf("notify: claim: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 1 {
		id, err := res.LastInsertId()
		return id, err == nil, err
	}
	var id int64
	var status, claimedAt string
	err = s.db.QueryRowContext(ctx, `SELECT id, status, claimed_at FROM notification_log WHERE user_id = ? AND channel = ? AND dedupe = ?`,
		m.User, ch, m.Key).Scan(&id, &status, &claimedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil // released between the insert and this read: the next run
	}
	if err != nil {
		return 0, false, fmt.Errorf("notify: claim: %w", err)
	}
	if status != "claimed" || claimedAt > stamp(now.Add(-claimTimeout)) {
		return 0, false, nil
	}
	res, err = s.db.ExecContext(ctx, `UPDATE notification_log SET claimed_at = ? WHERE id = ? AND status = 'claimed' AND claimed_at = ?`,
		stamp(now), id, claimedAt)
	if err != nil {
		return 0, false, fmt.Errorf("notify: claim: %w", err)
	}
	n, _ := res.RowsAffected()
	return id, n == 1, nil
}

func (s *Service) sendEmail(ctx context.Context, m Message, address string) bool {
	msg := *m.Email
	msg.To = address
	sendCtx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	if err := s.mailer.Send(sendCtx, msg); err != nil {
		// No address, no content: the error can quote the recipient.
		s.log.Warn("notification e-mail not sent, tried again on the next run", "type", m.Type, "user", m.User)
		return false
	}
	return true
}

// sendPush sends to every subscription of the user; it counts as sent when
// any of them accepts. A subscription the push service no longer knows
// (ErrGone) is deleted; any other error is retried on the next run (the tag
// makes a duplicate on a device that did get it harmless).
func (s *Service) sendPush(ctx context.Context, m Message, subs []push.Stored) bool {
	msg := push.Message{Payload: *m.Push, Topic: topic(m.Push.Tag, m.Key), Urgency: "normal"}
	if typ, _ := TypeByKey(m.Type); typ.Security {
		msg.Urgency = "high"
	}
	accepted := false
	for _, sub := range subs {
		sendCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := s.pusher.Send(sendCtx, sub.Subscription, msg)
		cancel()
		switch {
		case err == nil:
			accepted = true
		case errors.Is(err, push.ErrGone):
			if err := s.pushes.DeleteEndpoint(context.WithoutCancel(ctx), sub.Endpoint); err != nil {
				s.log.Error("push: could not delete a subscription that is gone", "subscription", sub.ID, "error", err)
			}
		default:
			s.log.Warn("push not delivered to one device, tried again on the next run", "type", m.Type, "subscription", sub.ID, "error", err)
		}
	}
	return accepted
}

// topic is the RFC 8030 Topic of a push: a newer push with the same tag
// replaces an undelivered older one at the push service. Hashed, because a
// topic is at most 32 base64url characters.
func topic(tag, key string) string {
	if tag == "" {
		tag = key
	}
	sum := sha256.Sum256([]byte(tag))
	return base64.RawURLEncoding.EncodeToString(sum[:16])
}

// quietAt reports whether t lies in the quiet hours [22:00, 07:00) Brussels.
func quietAt(t time.Time) bool {
	h := t.In(clock.Brussels).Hour()
	return h >= quietFrom || h < quietTo
}

// stamp is the log's time format (UTC, seconds), as 0001's strftime default.
func stamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05Z") }
