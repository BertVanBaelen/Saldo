package mail

import (
	"bytes"
	"embed"
	"fmt"
	htmltemplate "html/template"
	"strings"
	"text/template"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// Every mail shares one layout, adapted from the designs in
// finance-mockup/emails (board option A "rustig"). The four sign-in mails
// (login code, invitation, new password, new device) are always sent and
// cannot be turned off, so they never carry the "Meldingen aanpassen" link.
// The notification mails carry it when their builder is given a SettingsURL,
// and use the logo and account icons (PNGs served from <BaseURL>/mail/) when it
// is given a BaseURL. Without a BaseURL there is no public address: no images,
// the text brand, and the layout is the one the sign-in mails always had.

//go:embed templates
var files embed.FS

var (
	htmlLayout = htmltemplate.Must(htmltemplate.New("layout.html").Funcs(htmltemplate.FuncMap{
		"brk":  func(s string) string { return softBreak(s, 30) },
		"brkn": func(s string) string { return softBreak(s, 16) }, // narrow receipt columns
	}).ParseFS(files, "templates/layout.html", "templates/receipt.html"))
	textLayout = template.Must(template.ParseFS(files, "templates/layout.txt", "templates/receipt.txt"))
)

// Links are the absolute addresses the notification mails may carry. The
// caller builds them from the public URL; both may be empty.
type Links struct {
	// BaseURL is the app's public address ("https://saldo.example.com"). When
	// set, the brand and the account icons are images from <BaseURL>/mail/
	// (logo.png, person.png, people.png).
	BaseURL string
	// SettingsURL is the Meldingen screen. When set, the footer says
	// "Meldingen aanpassen" and links to it.
	SettingsURL string
}

// layout holds the parts of a mail in the order the design shows them.
type layout struct {
	Tone               tone
	Subject, Preheader string
	Kicker, Heading    string
	Accounts           []account // account block, optional
	Figure, FigureNote string    // key figure box, optional
	Intro              string
	Receipt            *receiptView // the overview mails' receipt block, optional
	Rows               []row
	Button, ButtonURL  string // optional
	Note               string
	Why                string // footer: why you get this mail

	BaseURL, SettingsURL string // see Links
	// LogoURL is derived from BaseURL by render.
	LogoURL string
}

type row struct{ Label, Value string }

// account is one entry of the account block. Shared picks the violet
// two-person icon over the green one-person icon; Icon and IconAlt are filled
// in by render when the mail has a BaseURL.
type account struct {
	Name, Sub     string
	Shared        bool
	Icon, IconAlt string
}

// tone is the colour of the kicker and the key figure: info (green), warn
// (ochre), error (red) or shared (violet), light and dark.
type tone struct{ Text, Soft, DarkText, DarkSoft string }

var (
	toneInfo   = tone{"#166534", "#DCFCE7", "#86EFAC", "#13321F"}
	toneWarn   = tone{"#8A5A00", "#FFF4DB", "#F5B94A", "#2E2414"}
	toneError  = tone{"#B42323", "#FBE9E9", "#FF7B7B", "#3A1A1C"}
	toneShared = tone{"#4A31C2", "#ECE8FF", "#B7A6FF", "#231D3D"}
)

func render(to string, l layout) (Message, error) {
	if l.Tone == (tone{}) {
		l.Tone = toneInfo
	}
	if base := strings.TrimRight(l.BaseURL, "/"); base != "" {
		l.BaseURL = base
		l.LogoURL = base + "/mail/logo.png"
		accounts := make([]account, len(l.Accounts))
		copy(accounts, l.Accounts)
		for i := range accounts {
			accounts[i].Icon, accounts[i].IconAlt = base+"/mail/person.png", "Persoonlijke rekening"
			if accounts[i].Shared {
				accounts[i].Icon, accounts[i].IconAlt = base+"/mail/people.png", "Gedeelde rekening"
			}
		}
		l.Accounts = accounts
	} else {
		l.BaseURL = ""
	}
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
