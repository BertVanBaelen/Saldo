package mail

import (
	"fmt"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

// AccountRef names an account in the account block (analysis 4.9): its name,
// personal or shared and the IBAN, already masked ("BE68 •••• •••• 4821").
// The mail never sees the full IBAN.
type AccountRef struct {
	Name       string
	Shared     bool
	With       string // the other members of a shared account, "Partner"
	MaskedIBAN string
}

func (a AccountRef) sub() string {
	kind := "Persoonlijk"
	if a.Shared {
		kind = "Gedeeld"
		if a.With != "" {
			kind = "Gedeeld met " + a.With
		}
	}
	if a.MaskedIBAN == "" {
		return kind
	}
	return kind + " · " + a.MaskedIBAN
}

func accountBlock(list []AccountRef) []account {
	out := make([]account, 0, len(list))
	for _, a := range list {
		out = append(out, account{Name: oneLine(a.Name), Sub: oneLine(a.sub())})
	}
	return out
}

// subjectAccounts is what the subject says about the accounts: the name when
// there is one, else how many.
func subjectAccounts(list []AccountRef) string {
	if len(list) == 1 {
		return oneLine(list[0].Name)
	}
	return fmt.Sprintf("%d rekeningen", len(list))
}

// namesList is "Zichtrekening", "Zichtrekening en Spaarrekening" or
// "A, B en C".
func namesList(list []AccountRef) string {
	names := make([]string, 0, len(list))
	for _, a := range list {
		names = append(names, oneLine(a.Name))
	}
	if len(names) < 2 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " en " + names[len(names)-1]
}

func anyShared(list []AccountRef) bool {
	for _, a := range list {
		if a.Shared {
			return true
		}
	}
	return false
}

// oneLine keeps names that come from a bank on one line, so they cannot add
// lines to the plain-text part or the subject.
func oneLine(s string) string {
	return strings.Join(strings.FieldsFunc(s, func(r rune) bool { return r < ' ' || r == 0x7f }), " ")
}

const whyConnection = "Je krijgt dit omdat jij deze koppeling hebt gemaakt."

// ConsentExpiring is "Koppeling verloopt": the consent at bank for accounts
// ends at validUntil, daysLeft days from today. From 3 days left it is the
// last reminder, in the error tone; before that the 14-day one, in the warn
// tone. relinkURL (Bankkoppelingen) may be empty when Saldo has no public
// address; the mail then has no button.
func ConsentExpiring(to, bank string, accounts []AccountRef, validUntil time.Time, daysLeft int, relinkURL string) (Message, error) {
	bank = oneLine(bank)
	day := longDate(validUntil)
	inDays := "over " + dayCount(daysLeft)
	if daysLeft <= 0 {
		inDays = "vandaag"
	}
	var l layout
	if daysLeft > 3 {
		l = layout{
			Tone:       toneWarn,
			Subject:    "Je " + bank + "-koppeling verloopt " + inDays + " (" + subjectAccounts(accounts) + ")",
			Preheader:  "Koppel opnieuw om te blijven synchroniseren. Het duurt een minuut.",
			Kicker:     "Bankkoppeling",
			Heading:    "Je " + bank + "-koppeling verloopt " + inDays,
			Figure:     day,
			FigureNote: "Laatste dag dat Saldo je rekeningen kan lezen",
			Intro:      "Banken vragen elke 180 dagen opnieuw toestemming. Bevestig in de " + bank + "-app, dan loopt alles gewoon door.",
			Rows:       []row{{"Gekoppeld door", "Jij"}, {"Geldig tot", day}},
			Button:     "Opnieuw koppelen",
			Note:       "Je krijgt nog een herinnering 3 dagen voor het verloopt.",
		}
	} else {
		heading := "Nog " + dayCount(daysLeft) + ", daarna stopt de synchronisatie"
		figure := dayCount(daysLeft)
		if daysLeft <= 0 {
			heading, figure = "Vandaag stopt de synchronisatie", "Vandaag"
		}
		intro := "Daarna haalt Saldo geen nieuwe transacties meer op voor " + namesList(accounts) + "."
		note := "Opnieuw koppelen duurt een minuut: je bevestigt in de " + bank + "-app."
		if anyShared(accounts) {
			intro += " Wie een gedeelde rekening met je deelt, ziet dan ook geen nieuwe gegevens."
			note = "Heeft iemand anders de gedeelde rekening ook gekoppeld? Dan neemt die koppeling het over voor de gedeelde rekening."
		}
		l = layout{
			Tone:       toneError,
			Subject:    "Laatste herinnering: " + bank + " verloopt " + inDays + " (" + subjectAccounts(accounts) + ")",
			Preheader:  "Na " + day + " stopt de synchronisatie van " + subjectAccounts(accounts) + ".",
			Kicker:     "Laatste herinnering",
			Heading:    heading,
			Figure:     figure,
			FigureNote: "Verloopt op " + day,
			Intro:      intro,
			Button:     "Nu opnieuw koppelen",
			Note:       note,
		}
	}
	l.Accounts = accountBlock(accounts)
	l.Why = whyConnection
	if relinkURL == "" {
		l.Button = ""
	}
	l.ButtonURL = relinkURL
	return render(to, l)
}

// StopReason says why the sync stopped.
type StopReason int

const (
	// StopConsent: the consent lapsed; only a new consent helps.
	StopConsent StopReason = iota
	// StopFailing: the consent is valid but the sync keeps failing.
	StopFailing
)

// SyncStopped is "Synchronisatie gestopt": accounts at bank are no longer
// updated since lastSuccess (zero: never). relinkURL as for ConsentExpiring.
func SyncStopped(to, bank string, accounts []AccountRef, lastSuccess time.Time, reason StopReason, relinkURL string) (Message, error) {
	bank = oneLine(bank)
	figure, status, last := "Nog nooit", "Nog niet bijgewerkt", "nog nooit gelukt"
	if !lastSuccess.IsZero() {
		t := lastSuccess.In(clock.Brussels)
		short := fmt.Sprintf("%d %s", t.Day(), shortMonths[t.Month()-1])
		figure, status, last = short+" · "+t.Format("15:04"), "Niet bijgewerkt sinds "+short, short+" om "+t.Format("15:04")
	}
	why := "De toestemming is verlopen."
	intro := "De toestemming bij " + bank + " is verlopen."
	if reason == StopFailing {
		why = "De synchronisatie mislukt al meer dan 3 dagen."
		intro = "Saldo krijgt al meer dan 3 dagen geen gegevens van " + bank + "."
	}
	heading := "Je rekeningen worden niet meer bijgewerkt"
	if len(accounts) == 1 {
		heading = "Je rekening wordt niet meer bijgewerkt"
	}
	l := layout{
		Tone:       toneError,
		Subject:    "Synchronisatie gestopt bij " + bank + " (" + subjectAccounts(accounts) + ")",
		Preheader:  why + " Laatste synchronisatie " + last + ".",
		Kicker:     "Synchronisatie gestopt",
		Heading:    heading,
		Accounts:   accountBlock(accounts),
		Figure:     figure,
		FigureNote: "Laatste geslaagde synchronisatie",
		Intro:      intro + " De saldi in Saldo zijn dus niet meer actueel.",
		Rows:       []row{{"Bank", bank}, {"Status", status}},
		Note:       "Na het koppelen haalt Saldo de gemiste transacties vanzelf op.",
		Why:        whyConnection,
	}
	if relinkURL != "" {
		l.Button, l.ButtonURL = "Opnieuw koppelen", relinkURL
	}
	return render(to, l)
}

func dayCount(n int) string {
	if n == 1 {
		return "1 dag"
	}
	return fmt.Sprintf("%d dagen", n)
}

var longMonths = [...]string{"januari", "februari", "maart", "april", "mei", "juni", "juli",
	"augustus", "september", "oktober", "november", "december"}

// longDate is "30 november" in Brussels.
func longDate(t time.Time) string {
	t = t.In(clock.Brussels)
	return fmt.Sprintf("%d %s", t.Day(), longMonths[t.Month()-1])
}
