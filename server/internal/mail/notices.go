package mail

import (
	"errors"
	"strconv"
	"time"
)

// The notification mails of phase 0.9-1 (planning, shared accounts, the
// digest). Each builder takes a plain struct: this package imports neither
// ledger, planning, receipt nor notify, so the caller maps its own data onto
// the fields. Money is integer cents, dates are time.Time or time.Month, URLs
// are absolute (the caller builds them from the public URL). A button is left
// out when its URL is empty, as for the bank mails. Every struct embeds Links:
// SettingsURL adds the footer link "Meldingen aanpassen" and BaseURL turns the
// brand and the account icons into the PNGs under <BaseURL>/mail/.

// Expense is a planned amount with its name ("Autoherstelling"). Amount is
// signed: negative for an expense, as the mail prints it ("−€ 2.000,00").
type Expense struct {
	Name   string
	Amount int64
}

func (e Expense) value() string { return oneLine(e.Name) + " " + euro(e.Amount) }

// sharedBlock is the account block of a mail that is always about a shared
// account: the violet icon whatever the caller put in Shared.
func sharedBlock(a AccountRef) []account {
	a.Shared = true
	return accountBlock([]AccountRef{a})
}

// PlanningRedData is the input of PlanningRed.
type PlanningRedData struct {
	Links
	Account AccountRef
	// Month is the red month; EndBalance (negative) its expected end balance
	// on EndDate (the month's last day).
	Month      time.Month
	EndBalance int64
	EndDate    time.Time
	// RedFrom is the first day below zero; zero leaves the row and the date
	// out.
	RedFrom time.Time
	// Cause is the largest planned expense; nil leaves it out.
	Cause *Expense
	// Buffer is the account's own buffer; 0 leaves the row out.
	Buffer    int64
	ActionURL string // "Bekijk de planning", the planning of that month
}

// PlanningRed is "Planning · rood": the forecast ends month below zero.
func PlanningRed(to string, d PlanningRedData) (Message, error) {
	name, month := oneLine(d.Account.Name), monthName(d.Month)
	subject := name + " staat rood in " + month
	intro := "Volgens je planning zakt deze rekening in " + month + " onder nul."
	if !d.RedFrom.IsZero() {
		intro = "Volgens je planning zakt deze rekening vanaf " + longDate(d.RedFrom) + " onder nul."
	}
	var rows []row
	note := "Je kan een uitgave verschuiven, een budget verlagen of geld overzetten van je spaarrekening."
	if d.Cause != nil {
		intro += " De grootste oorzaak is een geplande uitgave."
		note = "Je kan de uitgave verschuiven, een budget verlagen of geld overzetten van je spaarrekening."
		rows = append(rows, row{"Grootste uitgave", d.Cause.value()})
	}
	if !d.RedFrom.IsZero() {
		rows = append(rows, row{"Rood vanaf", longDate(d.RedFrom)})
	}
	if d.Buffer != 0 {
		rows = append(rows, row{"Buffer", euro(d.Buffer)})
	}
	l := layout{
		Tone:        toneError,
		Subject:     subject,
		Preheader:   "Verwacht eindsaldo " + euro(d.EndBalance) + ". Bekijk wat je kan schuiven.",
		Kicker:      "Planning · rood",
		Heading:     subject,
		Accounts:    accountBlock([]AccountRef{d.Account}),
		Figure:      euro(d.EndBalance),
		FigureNote:  "Verwacht saldo op " + longDate(d.EndDate),
		Intro:       intro,
		Rows:        rows,
		Note:        note,
		Why:         `Je krijgt dit omdat "Rekening staat rood" aanstaat.`,
		BaseURL:     d.BaseURL,
		SettingsURL: d.SettingsURL,
	}
	if d.ActionURL != "" {
		l.Button, l.ButtonURL = "Bekijk de planning", d.ActionURL
	}
	return render(to, l)
}

// PlanningBufferData is the input of PlanningBuffer.
type PlanningBufferData struct {
	Links
	Account AccountRef
	// Month is the month that ends below the buffer; EndBalance its expected
	// end balance, UnderBuffer how far that is under Buffer.
	Month       time.Month
	EndBalance  int64
	UnderBuffer int64
	Buffer      int64
	// LowestPoint is the day of the lowest balance, with LowestNote saying why
	// ("voor het salaris"); a zero date leaves the row out.
	LowestPoint time.Time
	LowestNote  string
	// Cause is the largest planned expense; nil leaves it out.
	Cause     *Expense
	ActionURL string // "Bekijk <maand>"
}

// PlanningBuffer is "Planning · buffer": the month ends under the account's
// buffer but not below zero.
func PlanningBuffer(to string, d PlanningBufferData) (Message, error) {
	name, month := oneLine(d.Account.Name), monthName(d.Month)
	subject := name + " zakt in " + month + " in de buffer"
	intro := "Je komt niet in het rood, maar je houdt minder over dan je buffer."
	var rows []row
	if d.Cause != nil {
		intro += " Dat komt vooral door een geplande uitgave in " + month + "."
		rows = append(rows, row{"Grootste uitgave", d.Cause.value()})
	}
	if !d.LowestPoint.IsZero() {
		lowest := longDate(d.LowestPoint)
		if note := oneLine(d.LowestNote); note != "" {
			lowest += ", " + note
		}
		rows = append(rows, row{"Laagste punt", lowest})
	}
	l := layout{
		Tone:        toneWarn,
		Subject:     subject,
		Preheader:   "Verwacht " + euro(d.EndBalance) + ", dat is " + euro(d.UnderBuffer) + " onder je buffer.",
		Kicker:      "Planning · buffer",
		Heading:     subject,
		Accounts:    accountBlock([]AccountRef{d.Account}),
		Figure:      euro(d.EndBalance),
		FigureNote:  euro(d.UnderBuffer) + " onder je buffer van " + euro(d.Buffer),
		Intro:       intro,
		Rows:        rows,
		Note:        "Je krijgt één e-mail per maand die in de buffer komt, niet elke dag opnieuw.",
		Why:         `Je krijgt dit omdat "Rekening komt in de buffer" aanstaat voor e-mail.`,
		BaseURL:     d.BaseURL,
		SettingsURL: d.SettingsURL,
	}
	if d.ActionURL != "" {
		l.Button, l.ButtonURL = "Bekijk "+month, d.ActionURL
	}
	return render(to, l)
}

// JoinVia is how someone got onto a shared account.
type JoinVia int

const (
	// JoinedByLink: they linked the account at their own bank.
	JoinedByLink JoinVia = iota
	// JoinedByInvitation: they accepted the manager's invitation.
	JoinedByInvitation
)

// MemberJoinedData is the input of MemberJoined.
type MemberJoinedData struct {
	Links
	Account AccountRef
	Who     string
	// Bank names the bank of the joiner's own link, for JoinedByLink; empty
	// leaves it out.
	Bank string
	Via  JoinVia
	// ReadOnly says "Lid · alleen lezen"; the default is "Lid · mag
	// bewerken", which every joiner has today.
	ReadOnly bool
	// Since is when they joined; zero leaves the row out.
	Since      time.Time
	MembersURL string // "Bekijk leden"
}

// MemberJoined is "Gedeelde rekening": sent to the manager when someone joins.
func MemberJoined(to string, d MemberJoinedData) (Message, error) {
	who, name := oneLine(d.Who), oneLine(d.Account.Name)
	same := " Jullie zien nu dezelfde transacties en dezelfde planning voor deze rekening."
	intro := who + " heeft je uitnodiging voor de " + name + " aangenomen." + same
	preheader := who + " heeft je uitnodiging aangenomen en ziet nu dezelfde transacties."
	if d.Via == JoinedByLink {
		linked := "ook gekoppeld"
		if bank := oneLine(d.Bank); bank != "" {
			linked = "ook bij " + bank + " gekoppeld"
		}
		intro = who + " heeft de " + name + " " + linked + "." + same
		preheader = who + " heeft de rekening gekoppeld en ziet nu dezelfde transacties."
	}
	role := "Lid · mag bewerken"
	if d.ReadOnly {
		role = "Lid · alleen lezen"
	}
	rows := []row{{"Rol", role}}
	if !d.Since.IsZero() {
		rows = append(rows, row{"Sinds", dutchTime(d.Since)})
	}
	l := layout{
		Tone:        toneShared,
		Subject:     who + " is erbij op de " + name,
		Preheader:   preheader,
		Kicker:      "Gedeelde rekening",
		Heading:     who + " is erbij",
		Accounts:    sharedBlock(d.Account),
		Intro:       intro,
		Rows:        rows,
		Note:        who + " ziet de geschiedenis van deze rekening, maar niet je persoonlijke rekeningen.",
		Why:         "Je krijgt dit omdat je beheerder bent van deze rekening.",
		BaseURL:     d.BaseURL,
		SettingsURL: d.SettingsURL,
	}
	if d.MembersURL != "" {
		l.Button, l.ButtonURL = "Bekijk leden", d.MembersURL
	}
	return render(to, l)
}

// SharedInvitationData is the input of SharedInvitation. It takes the
// account's name only: until the invitation is accepted the recipient sees
// nothing else of the account, so no IBAN can leak through the mail.
type SharedInvitationData struct {
	Links
	Inviter   string
	Account   string
	ActionURL string // "Bekijk de uitnodiging"
}

// SharedInvitation is "Gedeelde rekening": a manager invites the recipient
// onto a shared account.
func SharedInvitation(to string, d SharedInvitationData) (Message, error) {
	inviter, name := oneLine(d.Inviter), oneLine(d.Account)
	l := layout{
		Tone:      toneShared,
		Subject:   inviter + " nodigt je uit voor de " + name,
		Preheader: "Je ziet alleen de naam van de rekening tot je ze toevoegt.",
		Kicker:    "Gedeelde rekening",
		Heading:   inviter + " nodigt je uit",
		Accounts:  sharedBlock(AccountRef{Name: name, With: inviter}),
		Intro: inviter + " heeft je uitgenodigd voor een gedeelde rekening. " +
			"Tot je ze toevoegt zie je alleen de naam van de rekening, geen saldo en geen transacties.",
		Note:        "Verwachtte je dit niet? Dan kan je de uitnodiging negeren.",
		Why:         "Je krijgt dit omdat " + inviter + " je heeft uitgenodigd voor een gedeelde rekening.",
		BaseURL:     d.BaseURL,
		SettingsURL: d.SettingsURL,
	}
	if d.ActionURL != "" {
		l.Button, l.ButtonURL = "Bekijk de uitnodiging", d.ActionURL
	}
	return render(to, l)
}

// ContributionMissingData is the input of ContributionMissing.
type ContributionMissingData struct {
	Links
	Account AccountRef
	// Member is the member (or contributor without Saldo) whose part is
	// missing; the member variant does not print it, the manager variant does.
	Member string
	// Required is that member's part of the month, Received what arrived.
	Required, Received int64
	Month              time.Month
	// ForSelf is the member variant ("Je bijdrage van € 436 is er nog niet");
	// false is the manager variant ("Partners bijdrage is er nog niet").
	ForSelf   bool
	ActionURL string // "Bekijk de rekening"
}

// ContributionMissing is "Bijdrage": a member's part of the month has not
// arrived on the shared account. Both variants name the account and the month
// and neither names a personal account.
func ContributionMissing(to string, d ContributionMissingData) (Message, error) {
	name, month, member := oneLine(d.Account.Name), monthName(d.Month), oneLine(d.Member)
	open := d.Required - d.Received
	if open < 0 {
		open = 0
	}
	partial := d.Received > 0
	var subject, heading, intro, why string
	rows := []row{{"Maand", month}}
	if d.ForSelf {
		subject = "Je bijdrage voor de " + name + " is er nog niet"
		heading = "Je bijdrage van " + euroAuto(d.Required) + " is er nog niet"
		intro = "Voor " + month + " is jouw deel van de rekening nog niet binnen."
		rows = append(rows, row{"Jouw deel", euro(d.Required)})
		why = `Je krijgt dit omdat "Bijdrage ontbreekt" aanstaat.`
		if partial {
			subject = "Je bijdrage voor de " + name + " is nog niet volledig"
			heading = euroAuto(d.Received) + " van " + euroAuto(d.Required) + " is binnen"
			intro = "Voor " + month + " is jouw deel van de rekening nog niet helemaal binnen."
		}
	} else {
		subject = possessive(member) + " bijdrage voor de " + name + " is er nog niet"
		heading = possessive(member) + " bijdrage is er nog niet"
		intro = "Voor " + month + " is het deel van " + member + " op de " + name + " nog niet binnen."
		rows = append(rows, row{"Deel van " + member, euro(d.Required)})
		why = `Je krijgt dit omdat je beheerder bent van deze rekening en "Bijdrage ontbreekt" aanstaat.`
		if partial {
			subject = possessive(member) + " bijdrage voor de " + name + " is nog niet volledig"
			heading = euroAuto(d.Received) + " van " + euroAuto(d.Required) + " van " + member + " is binnen"
			intro = "Voor " + month + " is het deel van " + member + " op de " + name + " nog niet helemaal binnen."
		}
	}
	rows = append(rows, row{"Binnen", euro(d.Received)}, row{"Nog te storten", euro(open)})
	l := layout{
		Tone:        toneShared,
		Subject:     subject,
		Preheader:   "Voor " + month + " staat er nog " + euro(open) + " open op de " + name + ".",
		Kicker:      "Bijdrage",
		Heading:     heading,
		Accounts:    sharedBlock(d.Account),
		Intro:       intro,
		Rows:        rows,
		Note:        "Saldo ziet een bijdrage zodra de bank ze doorgeeft.",
		Why:         why,
		BaseURL:     d.BaseURL,
		SettingsURL: d.SettingsURL,
	}
	if d.ActionURL != "" {
		l.Button, l.ButtonURL = "Bekijk de rekening", d.ActionURL
	}
	return render(to, l)
}

// UncategorisedDigestData is the input of UncategorisedDigest. It carries the
// count only: no merchant names, as decided for the digest.
type UncategorisedDigestData struct {
	Links
	Count     int
	ActionURL string // "Categoriseren", the list of uncategorised transactions
}

// UncategorisedDigest is "Te categoriseren": the daily digest of new bank
// transactions without a category.
func UncategorisedDigest(to string, d UncategorisedDigestData) (Message, error) {
	if d.Count < 1 {
		return Message{}, errors.New("mail: the digest needs at least one transaction")
	}
	subject := strconv.Itoa(d.Count) + plural(d.Count, " transactie", " transacties") + " te categoriseren"
	intro := "Er zijn nieuwe banktransacties zonder categorie. Met een categorie kloppen je overzicht en je budgetten."
	figureNote := "nieuwe banktransacties zonder categorie"
	if d.Count == 1 {
		intro = "Er is een nieuwe banktransactie zonder categorie. Met een categorie kloppen je overzicht en je budgetten."
		figureNote = "nieuwe banktransactie zonder categorie"
	}
	l := layout{
		Subject:     subject,
		Preheader:   "Geef ze een categorie, dan kloppen je overzicht en je budgetten.",
		Kicker:      "Te categoriseren",
		Heading:     subject,
		Figure:      strconv.Itoa(d.Count),
		FigureNote:  figureNote,
		Intro:       intro,
		Note:        "Je krijgt hooguit één e-mail per dag, en alleen als er iets nieuws is.",
		Why:         `Je krijgt dit omdat "Te categoriseren" aanstaat voor e-mail.`,
		BaseURL:     d.BaseURL,
		SettingsURL: d.SettingsURL,
	}
	if d.ActionURL != "" {
		l.Button, l.ButtonURL = "Categoriseren", d.ActionURL
	}
	return render(to, l)
}
