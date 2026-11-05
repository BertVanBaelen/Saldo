package mail

import (
	"bytes"
	"embed"
	"fmt"
	htmltemplate "html/template"
	"text/template"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// The four sign-in mails share one layout, adapted from the designs in
// finance-mockup/emails (board option A "rustig"). They are always sent and
// cannot be turned off, so none has a "Meldingen aanpassen" link.

//go:embed templates
var files embed.FS

var (
	htmlLayout = htmltemplate.Must(htmltemplate.ParseFS(files, "templates/layout.html"))
	textLayout = template.Must(template.ParseFS(files, "templates/layout.txt"))
)

// layout holds the parts of a mail in the order the design shows them.
type layout struct {
	Subject, Preheader string
	Kicker, Heading    string
	Figure, FigureNote string // key figure box, optional
	Intro              string
	Rows               []row
	Button, ButtonURL  string // optional
	Note               string
	Why                string // footer: why you get this mail
}

type row struct{ Label, Value string }

func render(to string, l layout) (Message, error) {
	var h, t bytes.Buffer
	if err := htmlLayout.Execute(&h, l); err != nil {
		return Message{}, fmt.Errorf("mail: %w", err)
	}
	if err := textLayout.Execute(&t, l); err != nil {
		return Message{}, fmt.Errorf("mail: %w", err)
	}
	return Message{To: to, Subject: l.Subject, Text: t.String(), HTML: h.String()}, nil
}

// LoginCode is "Inlogcode": the 8-digit code, sent at requested and valid
// until requested + validFor, for the device that asked.
func LoginCode(to, code string, requested time.Time, validFor time.Duration, device string) (Message, error) {
	pretty := code
	if len(code) == 8 {
		pretty = code[:4] + " " + code[4:]
	}
	until := requested.Add(validFor).In(clock.Brussels).Format("15:04")
	return render(to, layout{
		Subject:    "Je inlogcode: " + pretty,
		Preheader:  "Geldig tot " + until + ". Deel deze code met niemand.",
		Kicker:     "Inloggen",
		Heading:    "Je inlogcode",
		Figure:     pretty,
		FigureNote: "Geldig tot " + until + " · werkt één keer",
		Intro:      "Vul deze code in op het inlogscherm van Saldo om verder te gaan.",
		Rows:       []row{{"Aangevraagd", dutchTime(requested)}, {"Toestel", device}},
		Note:       "Heb jij dit niet aangevraagd? Dan kent iemand je wachtwoord. Wijzig het meteen en laat de beheerder het weten.",
		Why:        "Je krijgt deze e-mail omdat iemand met jouw wachtwoord wil inloggen.",
	})
}

// Invitation is "Uitnodiging": invitedBy asks to to create an account with
// role ("admin" or "user") through link, valid for days.
func Invitation(to, invitedBy, role, link string, days int) (Message, error) {
	return render(to, layout{
		Subject:   invitedBy + " nodigt je uit voor Saldo",
		Preheader: fmt.Sprintf("Maak je account aan. De link is %d dagen geldig.", days),
		Kicker:    "Uitnodiging",
		Heading:   invitedBy + " nodigt je uit voor Saldo",
		Intro: "Saldo is jullie eigen huishoudboekje op de Home Assistant van " + invitedBy +
			". Jij ziet alleen je eigen rekeningen en de rekeningen die je deelt.",
		Rows:      []row{{"Uitgenodigd als", roleName(role)}, {"E-mail", to}},
		Button:    "Account aanmaken",
		ButtonURL: link,
		Note:      fmt.Sprintf("De link is %d dagen geldig en werkt één keer. Verwachtte je dit niet? Dan kan je deze e-mail negeren.", days),
		Why:       "Je krijgt deze e-mail omdat " + invitedBy + " je heeft uitgenodigd.",
	})
}

// PasswordReset is "Nieuw wachtwoord": admin made a reset link for to,
// valid until.
func PasswordReset(to, admin, link string, until time.Time) (Message, error) {
	return render(to, layout{
		Subject:   "Stel een nieuw wachtwoord in",
		Preheader: admin + " heeft een nieuwe link voor je aangemaakt. Geldig tot " + until.In(clock.Brussels).Format("15:04") + ".",
		Kicker:    "Wachtwoord",
		Heading:   "Stel een nieuw wachtwoord in",
		Intro: admin + " heeft een link aangemaakt om je wachtwoord opnieuw in te stellen. " +
			"Daarna log je in zoals altijd, met een code per e-mail.",
		Rows:      []row{{"Aangemaakt door", admin + " (beheerder)"}, {"Geldig tot", dutchTime(until)}},
		Button:    "Nieuw wachtwoord kiezen",
		ButtonURL: link,
		Note:      "Heb je hier niet om gevraagd? Neem dan contact op met " + admin + ".",
		Why:       "Je krijgt deze e-mail omdat een beheerder dit voor je heeft aangevraagd.",
	})
}

// NewDevice is "Nieuw toestel aangemeld": device became trusted at at.
// devicesURL (Instellingen → Toestellen) may be empty when Saldo has no
// public address; the mail then has no button.
func NewDevice(to, device string, at time.Time, devicesURL string) (Message, error) {
	l := layout{
		Subject:   "Nieuw toestel aangemeld: " + device,
		Preheader: dutchTime(at) + ". Was jij dit niet? Meld het toestel af en kies een nieuw wachtwoord.",
		Kicker:    "Beveiliging",
		Heading:   "Nieuw toestel aangemeld",
		Intro: device + " is nu een vertrouwd toestel voor je Saldo-account. " +
			"Het blijft aangemeld tot je het afmeldt of het 90 dagen niet gebruikt.",
		Rows: []row{{"Toestel", device}, {"Aangemeld", dutchTime(at)}, {"Ingelogd met", "Wachtwoord en e-mailcode"}},
		Note: "Was jij dit niet? Meld het toestel af in Instellingen → Toestellen en kies een nieuw wachtwoord.",
		Why:  "Je krijgt deze e-mail altijd als er een nieuw toestel bij je account aanmeldt.",
	}
	if devicesURL != "" {
		l.Button, l.ButtonURL = "Toestellen bekijken", devicesURL
	}
	return render(to, l)
}

func roleName(role string) string {
	if role == "admin" {
		return "Beheerder"
	}
	return "Gebruiker"
}

var (
	shortDays   = [...]string{"Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"}
	shortMonths = [...]string{"jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"}
)

// dutchTime is "Di 3 nov, 14:12" in Brussels.
func dutchTime(t time.Time) string {
	t = t.In(clock.Brussels)
	return fmt.Sprintf("%s %d %s, %s", shortDays[t.Weekday()], t.Day(), shortMonths[t.Month()-1], t.Format("15:04"))
}
