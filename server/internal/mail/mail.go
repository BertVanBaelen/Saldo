// Package mail sends Saldo's e-mails: the always-on sign-in messages of
// phase 0.2-4 (login code, invitation, new password, new device) and the bank
// reminders of phase 0.3-2, each as HTML with a plain-text part. SMTP runs
// over STARTTLS or TLS only.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

// Message is one e-mail to one recipient.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Sender delivers a message.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// SMTP sends through a mail server. TLS selects implicit TLS (usually port
// 465); otherwise the connection must upgrade with STARTTLS (usually 587).
// It never sends over an unencrypted connection.
type SMTP struct {
	Host     string
	Port     int
	TLS      bool
	Username string
	Password string
	From     string // "Saldo <saldo@example.com>"
}

// Send delivers m.
func (s SMTP) Send(ctx context.Context, m Message) error {
	from, err := mail.ParseAddress(s.From)
	if err != nil {
		return fmt.Errorf("mail: sender %q: %w", s.From, err)
	}
	to, err := mail.ParseAddress(m.To)
	if err != nil {
		return fmt.Errorf("mail: recipient: %w", err)
	}
	body, err := build(from, to, m, time.Now())
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	addr := net.JoinHostPort(s.Host, strconv.Itoa(s.Port))
	cfg := &tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12}
	var conn net.Conn
	if s.TLS {
		conn, err = (&tls.Dialer{Config: cfg}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = (&net.Dialer{}).DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("mail: connect %s: %w", addr, err)
	}
	deadline, _ := ctx.Deadline()
	conn.SetDeadline(deadline)
	c, err := smtp.NewClient(conn, s.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("mail: %w", err)
	}
	defer c.Close()
	if !s.TLS {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("mail: the server does not offer STARTTLS; Saldo never sends unencrypted")
		}
		if err := c.StartTLS(cfg); err != nil {
			return fmt.Errorf("mail: STARTTLS: %w", err)
		}
	}
	if s.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", s.Username, s.Password, s.Host)); err != nil {
			return fmt.Errorf("mail: sign in at the server: %w", err)
		}
	}
	if err := c.Mail(from.Address); err != nil {
		return fmt.Errorf("mail: MAIL FROM: %w", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return fmt.Errorf("mail: RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("mail: DATA: %w", err)
	}
	if _, err := w.Write(body); err != nil {
		return fmt.Errorf("mail: write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mail: send: %w", err)
	}
	return c.Quit()
}

// build writes m as a multipart/alternative message (plain text first).
func build(from, to *mail.Address, m Message, now time.Time) ([]byte, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	id := make([]byte, 12)
	rand.Read(id)
	domain := from.Address[strings.LastIndexByte(from.Address, '@')+1:]
	fmt.Fprintf(&buf, "From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMessage-ID: <%s@%s>\r\n",
		from, to, mime.QEncoding.Encode("utf-8", m.Subject), now.Format(time.RFC1123Z), hex.EncodeToString(id), domain)
	fmt.Fprintf(&buf, "MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=%q\r\n\r\n", mw.Boundary())
	for _, p := range []struct{ kind, body string }{{"text/plain", m.Text}, {"text/html", m.HTML}} {
		w, err := mw.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {p.kind + "; charset=utf-8"},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, err
		}
		qp := quotedprintable.NewWriter(w)
		if _, err := io.WriteString(qp, p.body); err != nil {
			return nil, err
		}
		if err := qp.Close(); err != nil {
			return nil, err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Log writes messages to the log instead of sending them. For development
// only (SALDO_MAIL_LOG=1): the log then holds sign-in codes and links.
type Log struct {
	Logger *slog.Logger
}

// Send logs m.
func (l Log) Send(ctx context.Context, m Message) error {
	l.Logger.InfoContext(ctx, "mail not sent (SALDO_MAIL_LOG)", "to", m.To, "subject", m.Subject, "text", m.Text)
	return nil
}
