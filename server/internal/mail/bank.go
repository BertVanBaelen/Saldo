package mail

import (
	"errors"
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
		out = append(out, account{Name: oneLine(a.Name), Sub: oneLine(a.sub()), Shared: a.Shared})
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

// ConsentExpiringData is the input of ConsentExpiringNotice.
type ConsentExpiringData struct {
	Links
	Bank string
	// Owner names the user who made the link. Empty: the recipient made it
	// and gets the owner mail with the "Opnieuw koppelen" button. Set (for
	// instance "Partner"): the manager variant for the manager of a shared
	// account the link feeds, which names only the shared accounts of
	// Accounts (personal ones are dropped here, whatever the caller passes).
	Owner      string
	Accounts   []AccountRef
	ValidUntil time.Time
	DaysLeft   int
	// ActionURL is the Bankkoppelingen page for the owner and the account's
	// page ("Bekijk de rekening") for a manager, who cannot re-link someone
	// else's consent. Empty: no button.
	ActionURL string
}

// ConsentExpiring is "Koppeling verloopt": the consent at bank for accounts
// ends at validUntil, daysLeft days from today. From 3 days left it is the
// last reminder, in the error tone; before that the 14-day one, in the warn
// tone. relinkURL (Bankkoppelingen) may be empty when Saldo has no public
// address; the mail then has no button. It carries no "Meldingen aanpassen"
// link and no images: use ConsentExpiringNotice for those and for the
// manager variant.
func ConsentExpiring(to, bank string, accounts []AccountRef, validUntil time.Time, daysLeft int, relinkURL string) (Message, error) {
	return ConsentExpiringNotice(to, ConsentExpiringData{
		Bank: bank, Accounts: accounts, ValidUntil: validUntil, DaysLeft: daysLeft, ActionURL: relinkURL,
	})
}

// ConsentExpiringNotice is ConsentExpiring with the settings link, the logo
// and the manager variant.
func ConsentExpiringNotice(to string, d ConsentExpiringData) (Message, error) {
	bank := oneLine(d.Bank)
	owner := oneLine(d.Owner)
	manager := owner != ""
	accounts := d.Accounts
	if manager {
		if accounts = sharedOnly(accounts); len(accounts) == 0 {
			return Message{}, errNoSharedAccount
		}
	}
	day := longDate(d.ValidUntil)
	inDays := "over " + dayCount(d.DaysLeft)
	if d.DaysLeft <= 0 {
		inDays = "vandaag"
	}
	var l layout
	if d.DaysLeft > 3 {
		subject := "Je " + bank + "-koppeling verloopt " + inDays
		l = layout{
			Tone:       toneWarn,
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
		if manager {
			subject = possessive(owner) + " " + bank + "-koppeling verloopt " + inDays
			l.Preheader = "Alleen " + owner + " kan opnieuw koppelen. Je kan de " + plural(len(accounts), "rekening", "rekeningen") + " zelf ook koppelen."
			l.Heading = subject
			l.FigureNote = "Laatste dag dat Saldo " + plural(len(accounts), "de rekening", "de rekeningen") + " via deze koppeling kan lezen"
			l.Intro = "Banken vragen elke 180 dagen opnieuw toestemming, en alleen " + owner + " kan die geven in de " + bank + "-app. " +
				"Daarna haalt Saldo geen nieuwe transacties meer op voor " + namesList(accounts) + " via deze koppeling."
			l.Rows = []row{{"Gekoppeld door", owner}, {"Geldig tot", day}}
			l.Button = "Bekijk de rekening"
			l.Note = managerFallback(owner, bank)
		}
		l.Subject = subject + " (" + subjectAccounts(accounts) + ")"
	} else {
		heading := "Nog " + dayCount(d.DaysLeft) + ", daarna stopt de synchronisatie"
		figure := dayCount(d.DaysLeft)
		if d.DaysLeft <= 0 {
			heading, figure = "Vandaag stopt de synchronisatie", "Vandaag"
		}
		intro := "Daarna haalt Saldo geen nieuwe transacties meer op voor " + namesList(accounts) + "."
		note := "Opnieuw koppelen duurt een minuut: je bevestigt in de " + bank + "-app."
		if anyShared(accounts) {
			intro += " Wie een gedeelde rekening met je deelt, ziet dan ook geen nieuwe gegevens."
			note = "Heeft iemand anders de gedeelde rekening ook gekoppeld? Dan neemt die koppeling het over voor de gedeelde rekening."
		}
		button := "Nu opnieuw koppelen"
		subject := "Laatste herinnering: " + bank + " verloopt " + inDays + " (" + subjectAccounts(accounts) + ")"
		if manager {
			intro = "Daarna haalt Saldo via " + possessive(owner) + " koppeling geen nieuwe transacties meer op voor " +
				namesList(accounts) + ", en er is geen andere koppeling die dat overneemt."
			note = managerFallback(owner, bank)
			button = "Bekijk de rekening"
			subject = "Laatste herinnering: " + possessive(owner) + " " + bank + "-koppeling verloopt " + inDays + " (" + subjectAccounts(accounts) + ")"
		}
		l = layout{
			Tone:       toneError,
			Subject:    subject,
			Preheader:  "Na " + day + " stopt de synchronisatie van " + subjectAccounts(accounts) + ".",
			Kicker:     "Laatste herinnering",
			Heading:    heading,
			Figure:     figure,
			FigureNote: "Verloopt op " + day,
			Intro:      intro,
			Button:     button,
			Note:       note,
		}
	}
	l.Accounts = accountBlock(accounts)
	l.Why = whyConnection
	if manager {
		l.Why = whyManager(len(accounts))
	}
	if d.ActionURL == "" {
		l.Button = ""
	}
	l.ButtonURL = d.ActionURL
	l.BaseURL, l.SettingsURL = d.BaseURL, d.SettingsURL
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

// SyncStoppedData is the input of SyncStoppedNotice.
type SyncStoppedData struct {
	Links
	Bank string
	// Owner as in ConsentExpiringData: set for the manager variant, which
	// names only the shared accounts of Accounts.
	Owner    string
	Accounts []AccountRef
	// LastSuccess is the last good sync; zero: never.
	LastSuccess time.Time
	Reason      StopReason
	// ActionURL: Bankkoppelingen for the owner, the account's page for a
	// manager. Empty: no button.
	ActionURL string
}

// SyncStopped is "Synchronisatie gestopt": accounts at bank are no longer
// updated since lastSuccess (zero: never). relinkURL as for ConsentExpiring;
// like ConsentExpiring it has no settings link: use SyncStoppedNotice.
func SyncStopped(to, bank string, accounts []AccountRef, lastSuccess time.Time, reason StopReason, relinkURL string) (Message, error) {
	return SyncStoppedNotice(to, SyncStoppedData{
		Bank: bank, Accounts: accounts, LastSuccess: lastSuccess, Reason: reason, ActionURL: relinkURL,
	})
}

// SyncStoppedNotice is SyncStopped with the settings link, the logo and the
// manager variant.
func SyncStoppedNotice(to string, d SyncStoppedData) (Message, error) {
	bank := oneLine(d.Bank)
	owner := oneLine(d.Owner)
	manager := owner != ""
	accounts := d.Accounts
	if manager {
		if accounts = sharedOnly(accounts); len(accounts) == 0 {
			return Message{}, errNoSharedAccount
		}
	}
	figure, status, last := "Nog nooit", "Nog niet bijgewerkt", "nog nooit gelukt"
	if !d.LastSuccess.IsZero() {
		t := d.LastSuccess.In(clock.Brussels)
		short := fmt.Sprintf("%d %s", t.Day(), shortMonths[t.Month()-1])
		figure, status, last = short+" · "+t.Format("15:04"), "Niet bijgewerkt sinds "+short, short+" om "+t.Format("15:04")
	}
	why := "De toestemming is verlopen."
	intro := "De toestemming bij " + bank + " is verlopen."
	if d.Reason == StopFailing {
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
	if manager {
		l.Subject = possessive(owner) + " " + bank + "-koppeling is verlopen (" + subjectAccounts(accounts) + ")"
		l.Intro = "De toestemming bij " + bank + " van " + owner + " is verlopen."
		if d.Reason == StopFailing {
			l.Subject = possessive(owner) + " " + bank + "-koppeling werkt niet meer (" + subjectAccounts(accounts) + ")"
			l.Intro = "Saldo krijgt al meer dan 3 dagen geen gegevens meer via de " + bank + "-koppeling van " + owner + "."
		}
		l.Intro += " De saldi in Saldo zijn dus niet meer actueel."
		l.Heading = "De " + plural(len(accounts), "rekening wordt", "rekeningen worden") + " niet meer bijgewerkt"
		l.Rows = []row{{"Bank", bank}, {"Gekoppeld door", owner}, {"Status", status}}
		l.Note = managerFallback(owner, bank)
		l.Why = whyManager(len(accounts))
	}
	if d.ActionURL != "" {
		l.Button, l.ButtonURL = "Opnieuw koppelen", d.ActionURL
		if manager {
			l.Button = "Bekijk de rekening"
		}
	}
	l.BaseURL, l.SettingsURL = d.BaseURL, d.SettingsURL
	return render(to, l)
}

// errNoSharedAccount: the manager variants say only which shared accounts a
// link feeds, never the owner's personal ones; with no shared account left
// there is nothing to say.
var errNoSharedAccount = errors.New("mail: the manager variant needs at least one shared account")

// sharedOnly keeps the shared accounts: a manager is never told about the
// owner's personal accounts or IBANs.
func sharedOnly(list []AccountRef) []AccountRef {
	out := make([]AccountRef, 0, len(list))
	for _, a := range list {
		if a.Shared {
			out = append(out, a)
		}
	}
	return out
}

// whyManager is the footer reason of the manager variants.
func whyManager(accounts int) string {
	return "Je krijgt dit omdat je beheerder bent van " + plural(accounts, "de rekening die deze koppeling bijwerkt.", "de rekeningen die deze koppeling bijwerken.")
}

// managerFallback is the note of the manager variants: the manager cannot
// re-link someone else's consent, but can add their own link as a fallback.
func managerFallback(owner, bank string) string {
	return "Wil je niet afhankelijk zijn van " + possessive(owner) + " koppeling? Koppel de rekening dan ook zelf bij " +
		bank + ": die koppeling neemt het over als deze verloopt."
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
