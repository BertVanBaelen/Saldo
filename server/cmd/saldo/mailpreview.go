package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/mail"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/config"
	saldomail "github.com/BertVanBaelen/Saldo/server/internal/mail"
)

// saldo mail-preview --to <address> [--only <function>] (plan 0.9-1, step 5):
// every e-mail Saldo can send, built with demo values and sent through the
// configured SMTP server, to look at in the real mail clients (the client
// check of step 6). It reads the configuration (the add-on options or the
// SALDO_* environment) and nothing else: no database, no bank, no user data.
// The subject starts with "[voorbeeld]" so a preview is never taken for a
// real message, and the links and images use the configured public_url so
// they work. A template that is added to package mail without an entry in
// previewMails fails the test (TestMailPreviewCoversEveryBuilder).

const previewSubject = "[voorbeeld] "

// mailPreview runs the subcommand with the real environment and SMTP.
func mailPreview(args []string) error {
	return runMailPreview(args, os.Getenv, func(s saldomail.SMTP) saldomail.Sender { return s }, os.Stdout)
}

// runMailPreview is mailPreview with its environment, SMTP and output injected.
func runMailPreview(args []string, getenv func(string) string, newSender func(saldomail.SMTP) saldomail.Sender, out io.Writer) error {
	fs := flag.NewFlagSet("mail-preview", flag.ContinueOnError)
	fs.SetOutput(out)
	to := fs.String("to", "", "the address to send the examples to (required)")
	only := fs.String("only", "", "send only the examples of this function of package mail, for instance PlanningRed")
	fs.Usage = func() {
		fmt.Fprintln(out, "usage: saldo mail-preview --to <address> [--only <function>]")
		fmt.Fprintln(out, "Sends every e-mail Saldo can send, with demo values, through the configured SMTP server.")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("mail-preview: %w", err)
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("mail-preview: unexpected argument %q (usage: saldo mail-preview --to <address> [--only <function>])", fs.Arg(0))
	}
	if strings.TrimSpace(*to) == "" {
		return errors.New("mail-preview: --to <address> is required (usage: saldo mail-preview --to <address> [--only <function>])")
	}
	addr, err := mail.ParseAddress(*to)
	if err != nil || !strings.Contains(addr.Address, "@") {
		return fmt.Errorf("mail-preview: --to %q is not an e-mail address", *to)
	}

	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	if cfg.SMTP.Host == "" {
		return errors.New("mail-preview: no SMTP server is configured, so nothing was sent. " +
			"Geen SMTP-server ingesteld: zet smtp_host (add-on opties) of SALDO_SMTP_HOST, met smtp_port, smtp_security, smtp_user, smtp_password en smtp_from")
	}
	if cfg.PublicURL == "" {
		return errors.New("mail-preview: public_url is not set, so the links and images of the examples cannot work. " +
			"Geen public_url ingesteld: zet public_url (add-on opties) of SALDO_PUBLIC_URL")
	}

	msgs, err := previewMessages(addr.Address, cfg.PublicURL, *only)
	if err != nil {
		return err
	}
	smtp := saldomail.SMTP{Host: cfg.SMTP.Host, Port: cfg.SMTP.Port, TLS: cfg.SMTP.Security == "tls",
		Username: cfg.SMTP.User, Password: cfg.SMTP.Password, From: cfg.SMTP.From}
	sender := newSender(smtp)
	fmt.Fprintf(out, "Sending %d example mails to %s through %s:%d (links and images: %s)\n", len(msgs), addr.Address, smtp.Host, smtp.Port, cfg.PublicURL)
	for i, p := range msgs {
		if err := sender.Send(context.Background(), p.Message); err != nil {
			return fmt.Errorf("mail-preview: %s failed after %d of %d: %w", p.name(), i, len(msgs), err)
		}
		fmt.Fprintf(out, "  %2d/%d  %s\n", i+1, len(msgs), p.name())
	}
	fmt.Fprintln(out, "Done. Check each mail in Gmail, Outlook and Apple Mail, light and dark (plan 0.9-1, step 6).")
	return nil
}

// previewed is one example mail, built.
type previewed struct {
	Function, Variant string
	Message           saldomail.Message
}

func (p previewed) name() string {
	if p.Variant == "" {
		return p.Function
	}
	return p.Function + " (" + p.Variant + ")"
}

// previewMessages builds the examples for to with base as the public URL. only
// is a function name of package mail (any case) or empty for all of them.
func previewMessages(to, base, only string) ([]previewed, error) {
	table := previewMails()
	if only != "" {
		table = slices.DeleteFunc(table, func(e previewMail) bool { return !strings.EqualFold(e.Function, strings.TrimSpace(only)) })
		if len(table) == 0 {
			return nil, fmt.Errorf("mail-preview: --only %q is not a function with an example; choose one of: %s", only, strings.Join(previewFunctions(), ", "))
		}
	}
	links := saldomail.Links{BaseURL: base, SettingsURL: base + "/meldingen"}
	out := make([]previewed, 0, len(table))
	for _, e := range table {
		m, err := e.Build(to, links)
		if err != nil {
			return nil, fmt.Errorf("mail-preview: %s: %w", previewed{Function: e.Function, Variant: e.Variant}.name(), err)
		}
		m.Subject = previewSubject + m.Subject
		out = append(out, previewed{Function: e.Function, Variant: e.Variant, Message: m})
	}
	return out, nil
}

// previewFunctions are the function names with an example, in table order.
func previewFunctions() []string {
	var names []string
	for _, e := range previewMails() {
		if !slices.Contains(names, e.Function) {
			names = append(names, e.Function)
		}
	}
	return names
}

// previewMail is one example: a builder of package mail (Function) with the
// demo values of one of its variants. Build gets the address and the links
// (base URL and settings link) of the configured public URL.
type previewMail struct {
	Function, Variant string
	Build             func(to string, l saldomail.Links) (saldomail.Message, error)
}

// signInFunctions are the four mails that are always sent and carry no settings
// link and no images: their builders take the links they need as arguments.
var signInFunctions = []string{"LoginCode", "Invitation", "PasswordReset", "NewDevice"}

// Demo values: names, banks and amounts of the mockup (finance-mockup/emails),
// on the reserved example domain, at the demo date of the app. Nothing here is
// real data.
var (
	previewNow    = time.Date(2026, 11, 18, 20, 0, 0, 0, clock.Brussels)
	previewZicht  = saldomail.AccountRef{Name: "Zichtrekening", MaskedIBAN: "BE68 •••• •••• 4821"}
	previewShared = saldomail.AccountRef{Name: "Gedeelde rekening", Shared: true, With: "Partner", MaskedIBAN: "BE12 •••• •••• 7730"}
)

func previewDay(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 12, 0, 0, 0, clock.Brussels)
}

// previewMails is every example, in the order of the plan's list (0.9-1).
func previewMails() []previewMail {
	both := []saldomail.AccountRef{previewZicht, previewShared}
	joined := time.Date(2026, 11, 3, 20, 31, 0, 0, clock.Brussels)
	until := previewDay(2026, time.November, 30)
	lastSync := time.Date(2026, 11, 30, 4, 2, 0, 0, clock.Brussels)

	consent := func(variant, owner string, days int) previewMail {
		return previewMail{"ConsentExpiringNotice", variant, func(to string, l saldomail.Links) (saldomail.Message, error) {
			action := l.BaseURL + "/bankkoppelingen"
			if owner != "" {
				action = l.BaseURL + "/rekeningen/2"
			}
			return saldomail.ConsentExpiringNotice(to, saldomail.ConsentExpiringData{Links: l, Bank: "Argenta", Owner: owner,
				Accounts: both, ValidUntil: until, DaysLeft: days, ActionURL: action})
		}}
	}
	stopped := func(variant, owner string, reason saldomail.StopReason) previewMail {
		return previewMail{"SyncStoppedNotice", variant, func(to string, l saldomail.Links) (saldomail.Message, error) {
			action := l.BaseURL + "/bankkoppelingen"
			if owner != "" {
				action = l.BaseURL + "/rekeningen/2"
			}
			return saldomail.SyncStoppedNotice(to, saldomail.SyncStoppedData{Links: l, Bank: "Argenta", Owner: owner, Accounts: both,
				LastSuccess: lastSync, Reason: reason, ActionURL: action})
		}}
	}
	contribution := func(variant string, forSelf bool, received int64) previewMail {
		return previewMail{"ContributionMissing", variant, func(to string, l saldomail.Links) (saldomail.Message, error) {
			member := "Partner"
			if forSelf {
				member = "Bert"
			}
			return saldomail.ContributionMissing(to, saldomail.ContributionMissingData{Links: l, Account: previewShared, Member: member,
				Required: 43600, Received: received, Month: time.December, ForSelf: forSelf, ActionURL: l.BaseURL + "/rekeningen/2"})
		}}
	}

	return []previewMail{
		{"LoginCode", "", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.LoginCode(to, "48291736", previewNow, 15*time.Minute, "Chrome op Windows")
		}},
		{"Invitation", "", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.Invitation(to, "Bert", "user", l.BaseURL+"/uitnodiging/voorbeeld", 7)
		}},
		{"PasswordReset", "", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.PasswordReset(to, "Bert", l.BaseURL+"/nieuw-wachtwoord/voorbeeld", previewNow.Add(24*time.Hour))
		}},
		{"NewDevice", "", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.NewDevice(to, "Chrome op Android", previewNow, l.BaseURL+"/instellingen/toestellen")
		}},
		{"PlanningRed", "", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.PlanningRed(to, saldomail.PlanningRedData{Links: l, Account: previewZicht, Month: time.February, EndBalance: -103347,
				EndDate: previewDay(2027, time.February, 28), RedFrom: previewDay(2027, time.February, 10),
				Cause: &saldomail.Expense{Name: "Autoherstelling", Amount: -200000}, Buffer: 90000,
				ActionURL: l.BaseURL + "/planning?maand=2027-02&rekening=1#maanden"})
		}},
		{"PlanningBuffer", "", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.PlanningBuffer(to, saldomail.PlanningBufferData{Links: l, Account: previewZicht, Month: time.January, EndBalance: 72150,
				UnderBuffer: 17850, Buffer: 90000, LowestPoint: previewDay(2027, time.January, 1), LowestNote: "voor het salaris",
				Cause: &saldomail.Expense{Name: "Familiale verzekering", Amount: -68400}, ActionURL: l.BaseURL + "/planning?maand=2027-01&rekening=1#maanden"})
		}},
		{"ConsentExpiring", "14 dagen, de korte vorm zonder instellingenlink", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.ConsentExpiring(to, "Argenta", both, until, 14, l.BaseURL+"/bankkoppelingen")
		}},
		consent("eigenaar, 14 dagen", "", 14),
		consent("eigenaar, 3 dagen", "", 3),
		consent("beheerder, 14 dagen", "Partner", 14),
		consent("beheerder, 3 dagen", "Partner", 3),
		{"SyncStopped", "toestemming verlopen, de korte vorm zonder instellingenlink", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.SyncStopped(to, "Argenta", both, lastSync, saldomail.StopConsent, l.BaseURL+"/bankkoppelingen")
		}},
		stopped("eigenaar, toestemming verlopen", "", saldomail.StopConsent),
		stopped("eigenaar, synchronisatie mislukt", "", saldomail.StopFailing),
		stopped("beheerder, toestemming verlopen", "Partner", saldomail.StopConsent),
		{"MemberJoined", "via een bankkoppeling", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.MemberJoined(to, saldomail.MemberJoinedData{Links: l, Account: previewShared, Who: "Partner", Bank: "Argenta",
				Via: saldomail.JoinedByLink, Since: joined, MembersURL: l.BaseURL + "/rekeningen/2"})
		}},
		{"MemberJoined", "via een uitnodiging, alleen lezen", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.MemberJoined(to, saldomail.MemberJoinedData{Links: l, Account: previewShared, Who: "Partner",
				Via: saldomail.JoinedByInvitation, ReadOnly: true, Since: joined, MembersURL: l.BaseURL + "/rekeningen/2"})
		}},
		{"SharedInvitation", "", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.SharedInvitation(to, saldomail.SharedInvitationData{Links: l, Inviter: "Bert", Account: "Gedeelde rekening",
				ActionURL: l.BaseURL + "/start"})
		}},
		contribution("lid, niets binnen", true, 0),
		contribution("lid, gedeeltelijk binnen", true, 20000),
		contribution("beheerder, niets binnen", false, 0),
		contribution("beheerder, gedeeltelijk binnen", false, 20000),
		{"UncategorisedDigest", "8 transacties", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.UncategorisedDigest(to, saldomail.UncategorisedDigestData{Links: l, Count: 8,
				ActionURL: l.BaseURL + "/transacties?filter=niet-gecategoriseerd"})
		}},
		{"UncategorisedDigest", "1 transactie", func(to string, l saldomail.Links) (saldomail.Message, error) {
			return saldomail.UncategorisedDigest(to, saldomail.UncategorisedDigestData{Links: l, Count: 1,
				ActionURL: l.BaseURL + "/transacties?filter=niet-gecategoriseerd"})
		}},
		{"WeekOverview", "", func(to string, l saldomail.Links) (saldomail.Message, error) {
			d := previewOverview(false)
			d.Links, d.ReceiptURL = l, l.BaseURL+"/overzicht/bon/week/2026-11-16?scope=alles"
			return saldomail.WeekOverview(to, d)
		}},
		{"MonthOverview", "", func(to string, l saldomail.Links) (saldomail.Message, error) {
			d := previewOverview(true)
			d.Links, d.ReceiptURL = l, l.BaseURL+"/overzicht/bon/maand/2026-10-01?scope=alles"
			return saldomail.MonthOverview(to, d)
		}},
	}
}

// previewOverview is the receipt of 0.9-3c, a week or (with budgets) a month:
// income, expense categories with subcategories, saved rows, the result and
// the previous period's.
func previewOverview(month bool) saldomail.OverviewData {
	prev := int64(40000)
	d := saldomail.OverviewData{
		Label:      "Week 47 · 16–22 nov 2026",
		ScopeLabel: "Alle rekeningen samen · ter info",
		Income: saldomail.OverviewSection{Total: 335000, Trend: saldomail.OverviewTrend{Kind: "up", Pct: 2}, Rows: []saldomail.OverviewLine{
			{Name: "Salaris", Amount: 330000},
			{Name: "Terugbetaling", Amount: 5000},
		}},
		Expenses: saldomail.OverviewSection{Total: 275997, Trend: saldomail.OverviewTrend{Kind: "up", Pct: 8}, Rows: []saldomail.OverviewLine{
			{Name: "Wonen", Amount: 120000, Trend: saldomail.OverviewTrend{Kind: "flat"}, Children: []saldomail.OverviewChild{{Name: "Huur", Amount: 110000}, {Name: "Energie", Amount: 10000}}},
			{Name: "Boodschappen", Amount: 64200, Trend: saldomail.OverviewTrend{Kind: "down", Pct: -7}, Children: []saldomail.OverviewChild{{Name: "Supermarkt", Amount: 52000}, {Name: "Boodschappen zelf", Amount: 12200}}},
			{Name: "Vrije tijd", Amount: 9800, Trend: saldomail.OverviewTrend{Kind: "new"}},
			{Name: "Niet gecategoriseerd", Amount: 1200},
			{Name: "Naar gedeelde rekening", Amount: 43600},
		}},
		Saved:      saldomail.OverviewSection{Total: 20000, Rows: []saldomail.OverviewLine{{Name: "Sparen", Amount: 15000}, {Name: "Spaarrekening", Amount: 5000}}},
		Result:     39003,
		PrevResult: &prev,
		Notes: []string{
			"Loopt nog, tot zo 22 nov: de bank geeft de transacties van vandaag pas morgen door.",
			"Niet volledig: Zichtrekening is niet bijgewerkt sinds ma 16 nov.",
		},
		Stand: saldomail.StandLine(time.Date(2026, 11, 22, 19, 0, 0, 0, clock.Brussels)),
	}
	if month {
		d.Label = "Oktober 2026"
		d.Notes = []string{"Loopt nog, tot za 31 okt: de bank geeft de transacties van vandaag pas morgen door."}
		d.Stand = saldomail.StandLine(time.Date(2026, 10, 31, 19, 0, 0, 0, clock.Brussels))
		d.Expenses.Rows[1].Budget = &saldomail.OverviewBudget{Kind: "budget", Amount: 55000, Pct: 117}
		d.Expenses.Rows[2].Budget = &saldomail.OverviewBudget{Kind: "average", Amount: 18000, Pct: 54}
	}
	return d
}
