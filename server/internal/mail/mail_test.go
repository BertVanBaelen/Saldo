package mail

import (
	"bufio"
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// The plain-text parts match the designs in finance-mockup/emails.
func TestLoginCodeMatchesTheDesign(t *testing.T) {
	requested := time.Date(2026, 11, 3, 14, 12, 0, 0, clock.Brussels)
	m, err := LoginCode("bert@example.com", "48291736", requested, 10*time.Minute, "Chrome op Windows")
	if err != nil {
		t.Fatal(err)
	}
	want := `Saldo · Inloggen

Je inlogcode

4829 1736
Geldig tot 14:22 · werkt één keer

Vul deze code in op het inlogscherm van Saldo om verder te gaan.

Aangevraagd: Di 3 nov, 14:12
Toestel: Chrome op Windows

Heb jij dit niet aangevraagd? Dan kent iemand je wachtwoord. Wijzig het meteen en laat de beheerder het weten.

--
Je krijgt deze e-mail omdat iemand met jouw wachtwoord wil inloggen.
Saldo draait op je eigen Home Assistant.
`
	if m.Text != want {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, want)
	}
	if m.Subject != "Je inlogcode: 4829 1736" || m.To != "bert@example.com" {
		t.Errorf("subject %q, to %q", m.Subject, m.To)
	}
	for _, s := range []string{"<title>Je inlogcode: 4829 1736</title>", ">4829 1736</div>", "Geldig tot 14:22 · werkt één keer", ">Chrome op Windows</td>"} {
		if !strings.Contains(m.HTML, s) {
			t.Errorf("HTML part lacks %q", s)
		}
	}
	if strings.Contains(m.HTML, "Meldingen aanpassen") || strings.Contains(m.HTML, "ZgotmplZ") {
		t.Error("the HTML part has a mute link or an escaping error")
	}
	if !strings.Contains(m.HTML, `border-top:1px solid #E2E8E4;font-family:Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI'`) {
		t.Error("the second detail row lacks its separator")
	}
}

func TestInvitationMatchesTheDesign(t *testing.T) {
	m, err := Invitation("partner@example.com", "Bert", "user", "https://saldo.example.com/uitnodiging/7f3c9a2e5b18", 7)
	if err != nil {
		t.Fatal(err)
	}
	want := `Saldo · Uitnodiging

Bert nodigt je uit voor Saldo

Saldo is jullie eigen huishoudboekje op de Home Assistant van Bert. Jij ziet alleen je eigen rekeningen en de rekeningen die je deelt.

Uitgenodigd als: Gebruiker
E-mail: partner@example.com

Account aanmaken:
https://saldo.example.com/uitnodiging/7f3c9a2e5b18

De link is 7 dagen geldig en werkt één keer. Verwachtte je dit niet? Dan kan je deze e-mail negeren.

--
Je krijgt deze e-mail omdat Bert je heeft uitgenodigd.
Saldo draait op je eigen Home Assistant.
`
	if m.Text != want {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, want)
	}
	if !strings.Contains(m.HTML, `href="https://saldo.example.com/uitnodiging/7f3c9a2e5b18"`) {
		t.Error("HTML button lacks the link")
	}
}

func TestOtherTemplates(t *testing.T) {
	until := time.Date(2026, 11, 3, 11, 2, 0, 0, clock.Brussels)
	m, err := PasswordReset("partner@example.com", "Bert", "https://saldo.example.com/nieuw-wachtwoord/x", until)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range []string{"Aangemaakt door: Bert (beheerder)", "Geldig tot: Di 3 nov, 11:02", "Nieuw wachtwoord kiezen:\nhttps://saldo.example.com/nieuw-wachtwoord/x"} {
		if !strings.Contains(m.Text, s) {
			t.Errorf("reset text lacks %q:\n%s", s, m.Text)
		}
	}

	at := time.Date(2026, 11, 18, 21, 14, 0, 0, clock.Brussels)
	m, err = NewDevice("bert@example.com", "Chrome op Android", at, "")
	if err != nil {
		t.Fatal(err)
	}
	if m.Subject != "Nieuw toestel aangemeld: Chrome op Android" || !strings.Contains(m.Text, "Aangemeld: Wo 18 nov, 21:14") {
		t.Errorf("new device: %q\n%s", m.Subject, m.Text)
	}
	if strings.Contains(m.Text, "Toestellen bekijken") || strings.Contains(m.HTML, "Toestellen bekijken") {
		t.Error("no button without a public address")
	}

	// Names are escaped in the HTML part.
	m, _ = Invitation("x@example.com", "<b>Eve</b>", "admin", "https://saldo.example.com/u/1", 7)
	if strings.Contains(m.HTML, "<b>Eve</b>") || !strings.Contains(m.HTML, "&lt;b&gt;Eve&lt;/b&gt;") || !strings.Contains(m.Text, "Uitgenodigd als: Beheerder") {
		t.Error("the invitation does not escape the name or show the role")
	}
}

func TestBuildIsMultipartAlternative(t *testing.T) {
	from, _ := mail.ParseAddress("Saldo <saldo@example.com>")
	to, _ := mail.ParseAddress("bert@example.com")
	raw, err := build(from, to, Message{To: "bert@example.com", Subject: "Je inlogcode: 4829 1736 · één", Text: "tekst é", HTML: "<p>html é</p>"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	subject, _ := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if subject != "Je inlogcode: 4829 1736 · één" || msg.Header.Get("To") != "<bert@example.com>" {
		t.Errorf("headers %v (subject %q)", msg.Header, subject)
	}
	mt, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if mt != "multipart/alternative" {
		t.Fatalf("content type %q", mt)
	}
	r := multipart.NewReader(msg.Body, params["boundary"])
	var parts []string
	for {
		p, err := r.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(p) // NextPart decodes quoted-printable
		parts = append(parts, p.Header.Get("Content-Type")+"|"+string(b))
	}
	want := []string{"text/plain; charset=utf-8|tekst é", "text/html; charset=utf-8|<p>html é</p>"}
	if strings.Join(parts, "\n") != strings.Join(want, "\n") {
		t.Errorf("parts %q", parts)
	}
}

// A server without STARTTLS gets no mail: Saldo never sends in plain text.
func TestSMTPRefusesPlaintext(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	got := make(chan string, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			got <- ""
			return
		}
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(5 * time.Second))
		var seen []string
		r := bufio.NewReader(conn)
		io.WriteString(conn, "220 test ESMTP\r\n")
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				break
			}
			seen = append(seen, strings.TrimSpace(line))
			switch {
			case strings.HasPrefix(line, "EHLO"):
				io.WriteString(conn, "250-test\r\n250 AUTH PLAIN\r\n")
			case strings.HasPrefix(line, "QUIT"):
				io.WriteString(conn, "221 bye\r\n")
			default:
				io.WriteString(conn, "250 ok\r\n")
			}
		}
		got <- strings.Join(seen, "\n")
	}()

	s := SMTP{Host: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port, Username: "saldo", Password: "secret", From: "saldo@example.com"}
	err = s.Send(context.Background(), Message{To: "bert@example.com", Subject: "x", Text: "x", HTML: "x"})
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("want a STARTTLS error, got %v", err)
	}
	if seen := <-got; strings.Contains(seen, "MAIL") || strings.Contains(seen, "AUTH") {
		t.Errorf("the client went on without TLS:\n%s", seen)
	}
}
