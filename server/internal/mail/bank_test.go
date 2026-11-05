package mail

import (
	"mime"
	"net/mail"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

var twoAccounts = []AccountRef{
	{Name: "Zichtrekening", MaskedIBAN: "BE68 •••• •••• 4821"},
	{Name: "Gedeelde rekening", Shared: true, With: "Partner", MaskedIBAN: "BE12 •••• •••• 7730"},
}

func TestConsentExpiring14Days(t *testing.T) {
	until := time.Date(2026, 11, 30, 10, 0, 0, 0, clock.Brussels)
	m, err := ConsentExpiring("bert@example.com", "Argenta", twoAccounts, until, 14, "https://saldo.example.com/bankkoppelingen")
	if err != nil {
		t.Fatal(err)
	}
	want := `Saldo · Bankkoppeling

Je Argenta-koppeling verloopt over 14 dagen

Zichtrekening (Persoonlijk · BE68 •••• •••• 4821)
Gedeelde rekening (Gedeeld met Partner · BE12 •••• •••• 7730)

30 november
Laatste dag dat Saldo je rekeningen kan lezen

Banken vragen elke 180 dagen opnieuw toestemming. Bevestig in de Argenta-app, dan loopt alles gewoon door.

Gekoppeld door: Jij
Geldig tot: 30 november

Opnieuw koppelen:
https://saldo.example.com/bankkoppelingen

Je krijgt nog een herinnering 3 dagen voor het verloopt.

--
Je krijgt dit omdat jij deze koppeling hebt gemaakt.
Saldo draait op je eigen Home Assistant.
`
	if m.Text != want {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, want)
	}
	if m.Subject != "Je Argenta-koppeling verloopt over 14 dagen (2 rekeningen)" {
		t.Errorf("subject %q", m.Subject)
	}
	for _, s := range []string{"color:#8A5A00;\">Bankkoppeling", `bgcolor="#FFF4DB"`, ">Gedeeld met Partner · BE12 •••• •••• 7730</div>",
		`href="https://saldo.example.com/bankkoppelingen"`} {
		if !strings.Contains(m.HTML, s) {
			t.Errorf("HTML part lacks %q", s)
		}
	}
	if strings.Contains(m.HTML, "ZgotmplZ") || strings.Contains(m.HTML, "Meldingen aanpassen") {
		t.Error("escaping error or a mute link without a settings screen")
	}
}

func TestConsentExpiring3Days(t *testing.T) {
	until := time.Date(2026, 11, 30, 10, 0, 0, 0, clock.Brussels)
	one := twoAccounts[:1]
	m, err := ConsentExpiring("bert@example.com", "Argenta", one, until, 3, "https://saldo.example.com/bankkoppelingen")
	if err != nil {
		t.Fatal(err)
	}
	want := `Saldo · Laatste herinnering

Nog 3 dagen, daarna stopt de synchronisatie

Zichtrekening (Persoonlijk · BE68 •••• •••• 4821)

3 dagen
Verloopt op 30 november

Daarna haalt Saldo geen nieuwe transacties meer op voor Zichtrekening.

Nu opnieuw koppelen:
https://saldo.example.com/bankkoppelingen

Opnieuw koppelen duurt een minuut: je bevestigt in de Argenta-app.

--
Je krijgt dit omdat jij deze koppeling hebt gemaakt.
Saldo draait op je eigen Home Assistant.
`
	if m.Text != want {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, want)
	}
	// One account: the subject names it.
	if m.Subject != "Laatste herinnering: Argenta verloopt over 3 dagen (Zichtrekening)" {
		t.Errorf("subject %q", m.Subject)
	}
	if !strings.Contains(m.HTML, `bgcolor="#FBE9E9"`) || !strings.Contains(m.HTML, "color:#B42323;\">3 dagen</div>") {
		t.Error("the last reminder is not in the error tone")
	}
	if strings.Contains(m.HTML, "Gekoppeld door") {
		t.Error("the 3-day mail has no details table")
	}

	m, _ = ConsentExpiring("bert@example.com", "Argenta", twoAccounts, until, 0, "")
	if m.Subject != "Laatste herinnering: Argenta verloopt vandaag (2 rekeningen)" || !strings.Contains(m.Text, "Vandaag stopt de synchronisatie") ||
		!strings.Contains(m.Text, "Heeft iemand anders de gedeelde rekening ook gekoppeld?") {
		t.Errorf("last day: %q\n%s", m.Subject, m.Text)
	}
	if strings.Contains(m.Text, "opnieuw koppelen:") || strings.Contains(m.HTML, "<a href") {
		t.Error("a button without a public address")
	}
}

func TestSyncStopped(t *testing.T) {
	last := time.Date(2026, 11, 30, 4, 2, 0, 0, clock.Brussels)
	m, err := SyncStopped("bert@example.com", "Argenta", twoAccounts, last, StopConsent, "https://saldo.example.com/bankkoppelingen")
	if err != nil {
		t.Fatal(err)
	}
	want := `Saldo · Synchronisatie gestopt

Je rekeningen worden niet meer bijgewerkt

Zichtrekening (Persoonlijk · BE68 •••• •••• 4821)
Gedeelde rekening (Gedeeld met Partner · BE12 •••• •••• 7730)

30 nov · 04:02
Laatste geslaagde synchronisatie

De toestemming bij Argenta is verlopen. De saldi in Saldo zijn dus niet meer actueel.

Bank: Argenta
Status: Niet bijgewerkt sinds 30 nov

Opnieuw koppelen:
https://saldo.example.com/bankkoppelingen

Na het koppelen haalt Saldo de gemiste transacties vanzelf op.

--
Je krijgt dit omdat jij deze koppeling hebt gemaakt.
Saldo draait op je eigen Home Assistant.
`
	if m.Text != want {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, want)
	}
	if m.Subject != "Synchronisatie gestopt bij Argenta (2 rekeningen)" {
		t.Errorf("subject %q", m.Subject)
	}

	m, _ = SyncStopped("bert@example.com", "Argenta", twoAccounts[:1], time.Time{}, StopFailing, "")
	for _, s := range []string{"Je rekening wordt niet meer bijgewerkt", "Nog nooit\nLaatste geslaagde", "Saldo krijgt al meer dan 3 dagen geen gegevens van Argenta.", "Status: Nog niet bijgewerkt"} {
		if !strings.Contains(m.Text, s) {
			t.Errorf("failing, never synced: lacks %q\n%s", s, m.Text)
		}
	}
	if m.Subject != "Synchronisatie gestopt bij Argenta (Zichtrekening)" {
		t.Errorf("subject %q", m.Subject)
	}
}

// Account names come from the bank and the user: they are escaped in HTML and
// cannot break the subject header or the text lines.
func TestBankMailsEscapeNames(t *testing.T) {
	evil := []AccountRef{{Name: "<b>Zicht</b>\r\nBcc: eve@example.com", MaskedIBAN: "BE68 •••• •••• 4821"}}
	m, err := SyncStopped("bert@example.com", "Argenta", evil, time.Time{}, StopConsent, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(m.HTML, "<b>Zicht</b>") || !strings.Contains(m.HTML, "&lt;b&gt;Zicht&lt;/b&gt;") {
		t.Error("the account name is not escaped in HTML")
	}
	if strings.ContainsAny(m.Subject, "\r\n") || strings.Contains(m.Text, "\nBcc:") {
		t.Errorf("a name adds lines: %q", m.Subject)
	}
	from, _ := mail.ParseAddress("saldo@example.com")
	to, _ := mail.ParseAddress(m.To)
	raw, err := build(from, to, m, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if msg.Header.Get("Bcc") != "" {
		t.Error("the name injected a header")
	}
	subject, _ := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if subject != m.Subject || !strings.Contains(subject, "Bcc: eve@example.com") {
		t.Errorf("subject %q", subject)
	}
}
