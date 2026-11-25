package mail

import (
	"html"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

var noticeLinks = Links{BaseURL: testBase, SettingsURL: testBase + "/meldingen"}

const footer = `
--
%s
Meldingen aanpassen: https://saldo.example.com/meldingen
Saldo draait op je eigen Home Assistant.
`

func withFooter(body, why string) string {
	return body + strings.Replace(footer, "%s", why, 1)
}

func TestPlanningRedMatchesTheDesign(t *testing.T) {
	m, err := PlanningRed("bert@example.com", PlanningRedData{Links: noticeLinks, Account: zichtAccount, Month: time.February,
		EndBalance: -103347, EndDate: dayOf(2027, 2, 28), RedFrom: dayOf(2027, 2, 10),
		Cause: &Expense{"Autoherstelling", -200000}, Buffer: 90000, ActionURL: testBase + "/planning?maand=2027-02&rekening=1#maanden"})
	if err != nil {
		t.Fatal(err)
	}
	want := withFooter(`Saldo · Planning · rood

Zichtrekening staat rood in februari

Zichtrekening (Persoonlijk · BE68 •••• •••• 4821)

−€~1.033,47
Verwacht saldo op 28 februari

Volgens je planning zakt deze rekening vanaf 10 februari onder nul. De grootste oorzaak is een geplande uitgave.

Grootste uitgave: Autoherstelling −€~2.000,00
Rood vanaf: 10 februari
Buffer: €~900,00

Bekijk de planning:
https://saldo.example.com/planning?maand=2027-02&rekening=1#maanden

Je kan de uitgave verschuiven, een budget verlagen of geld overzetten van je spaarrekening.
`, `Je krijgt dit omdat "Rekening staat rood" aanstaat.`)
	if m.Text != nb(want) {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, nb(want))
	}
	if m.Subject != "Zichtrekening staat rood in februari" {
		t.Errorf("subject %q", m.Subject)
	}
	inBoth(t, "red", m, nb("−€~1.033,47"), "Verwacht saldo op 28 februari", nb("Autoherstelling −€~2.000,00"), "10 februari",
		nb("€~900,00"), "Bekijk de planning", "Grootste uitgave", "Rood vanaf", "BE68 •••• •••• 4821")
	if !strings.Contains(m.HTML, `color:#B42323;">Planning · rood`) || !strings.Contains(m.HTML, `bgcolor="#FBE9E9"`) {
		t.Error("not in the error tone")
	}
	// Without the optional parts the rows and sentences go away.
	m, _ = PlanningRed("bert@example.com", PlanningRedData{Account: zichtAccount, Month: time.February, EndBalance: -5, EndDate: dayOf(2027, 2, 28)})
	if strings.Contains(m.Text, "Grootste uitgave") || strings.Contains(m.Text, "Rood vanaf") || strings.Contains(m.Text, "Buffer:") ||
		!strings.Contains(m.Text, "zakt deze rekening in februari onder nul.") || !strings.Contains(m.Text, "Je kan een uitgave verschuiven") ||
		strings.Contains(m.Text, "de uitgave") {
		t.Errorf("optional rows:\n%s", m.Text)
	}
}

func TestPlanningBufferMatchesTheDesign(t *testing.T) {
	m, err := PlanningBuffer("bert@example.com", PlanningBufferData{Links: noticeLinks, Account: zichtAccount, Month: time.January,
		EndBalance: 72150, UnderBuffer: 17850, Buffer: 90000, LowestPoint: dayOf(2027, 1, 1), LowestNote: "voor het salaris",
		Cause: &Expense{"Familiale verzekering", -68400}, ActionURL: testBase + "/planning?maand=2027-01&rekening=1#maanden"})
	if err != nil {
		t.Fatal(err)
	}
	want := withFooter(`Saldo · Planning · buffer

Zichtrekening zakt in januari in de buffer

Zichtrekening (Persoonlijk · BE68 •••• •••• 4821)

€~721,50
€~178,50 onder je buffer van €~900,00

Je komt niet in het rood, maar je houdt minder over dan je buffer. Dat komt vooral door een geplande uitgave in januari.

Grootste uitgave: Familiale verzekering −€~684,00
Laagste punt: 1 januari, voor het salaris

Bekijk januari:
https://saldo.example.com/planning?maand=2027-01&rekening=1#maanden

Je krijgt één e-mail per maand die in de buffer komt, niet elke dag opnieuw.
`, `Je krijgt dit omdat "Rekening komt in de buffer" aanstaat voor e-mail.`)
	if m.Text != nb(want) {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, nb(want))
	}
	if m.Subject != "Zichtrekening zakt in januari in de buffer" {
		t.Errorf("subject %q", m.Subject)
	}
	inBoth(t, "buffer", m, nb("€~721,50"), nb("€~178,50 onder je buffer van €~900,00"), "Laagste punt", "1 januari, voor het salaris",
		"Bekijk januari", nb("Familiale verzekering −€~684,00"))
	if !strings.Contains(m.HTML, `bgcolor="#FFF4DB"`) {
		t.Error("not in the warn tone")
	}
}

func TestMemberJoinedHasTwoVariants(t *testing.T) {
	since := time.Date(2026, 11, 3, 20, 31, 0, 0, clock.Brussels)
	m, err := MemberJoined("bert@example.com", MemberJoinedData{Links: noticeLinks, Account: sharedAccount, Who: "Partner", Bank: "Argenta",
		Via: JoinedByLink, Since: since, MembersURL: testBase + "/rekeningen/2"})
	if err != nil {
		t.Fatal(err)
	}
	want := withFooter(`Saldo · Gedeelde rekening

Partner is erbij

Gedeelde rekening (Gedeeld met Partner · BE12 •••• •••• 7730)

Partner heeft de Gedeelde rekening ook bij Argenta gekoppeld. Jullie zien nu dezelfde transacties en dezelfde planning voor deze rekening.

Rol: Lid · mag bewerken
Sinds: Di 3 nov, 20:31

Bekijk leden:
https://saldo.example.com/rekeningen/2

Partner ziet de geschiedenis van deze rekening, maar niet je persoonlijke rekeningen.
`, "Je krijgt dit omdat je beheerder bent van deze rekening.")
	if m.Text != want {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, want)
	}
	if m.Subject != "Partner is erbij op de Gedeelde rekening" {
		t.Errorf("subject %q", m.Subject)
	}
	if !strings.Contains(m.HTML, `color:#4A31C2;">Gedeelde rekening`) {
		t.Error("not in the shared (violet) tone")
	}
	inBoth(t, "joined/link", m, "Lid · mag bewerken", "Di 3 nov, 20:31", "Bekijk leden", "ook bij Argenta gekoppeld")

	m, _ = MemberJoined("bert@example.com", MemberJoinedData{Account: sharedAccount, Who: "Partner", Via: JoinedByInvitation, ReadOnly: true, Since: since})
	inBoth(t, "joined/invitation", m, "Partner heeft je uitnodiging voor de Gedeelde rekening aangenomen.", "Lid · alleen lezen")
	if strings.Contains(m.Text, "gekoppeld") || strings.Contains(m.Text, "Bekijk leden") {
		t.Errorf("the invitation variant talks about a link or has a button:\n%s", m.Text)
	}
	// A link without a named bank still reads well.
	m, _ = MemberJoined("bert@example.com", MemberJoinedData{Account: sharedAccount, Who: "Partner", Via: JoinedByLink})
	if !strings.Contains(m.Text, "Partner heeft de Gedeelde rekening ook gekoppeld.") || strings.Contains(m.Text, "Sinds:") {
		t.Errorf("link without bank or date:\n%s", m.Text)
	}
}

func TestSharedInvitationNamesOnlyTheAccount(t *testing.T) {
	m, err := SharedInvitation("partner@example.com", SharedInvitationData{Links: noticeLinks, Inviter: "Bert", Account: "Gedeelde rekening", ActionURL: testBase + "/start"})
	if err != nil {
		t.Fatal(err)
	}
	want := withFooter(`Saldo · Gedeelde rekening

Bert nodigt je uit

Gedeelde rekening (Gedeeld met Bert)

Bert heeft je uitgenodigd voor een gedeelde rekening. Tot je ze toevoegt zie je alleen de naam van de rekening, geen saldo en geen transacties.

Bekijk de uitnodiging:
https://saldo.example.com/start

Verwachtte je dit niet? Dan kan je de uitnodiging negeren.
`, "Je krijgt dit omdat Bert je heeft uitgenodigd voor een gedeelde rekening.")
	if m.Text != want {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, want)
	}
	if m.Subject != "Bert nodigt je uit voor de Gedeelde rekening" {
		t.Errorf("subject %q", m.Subject)
	}
	inBoth(t, "invitation", m, "Bert nodigt je uit", "Gedeeld met Bert", "Bekijk de uitnodiging", "alleen de naam van de rekening")
	if strings.Contains(m.Text, "BE") || strings.Contains(m.HTML, "••••") {
		t.Error("an IBAN in the invitation")
	}
}

func TestContributionMissingMemberAndManager(t *testing.T) {
	self, err := ContributionMissing("bert@example.com", ContributionMissingData{Links: noticeLinks, Account: sharedAccount, Member: "Bert",
		Required: 43600, Month: time.December, ForSelf: true, ActionURL: testBase + "/rekeningen/2"})
	if err != nil {
		t.Fatal(err)
	}
	want := withFooter(`Saldo · Bijdrage

Je bijdrage van €~436 is er nog niet

Gedeelde rekening (Gedeeld met Partner · BE12 •••• •••• 7730)

Voor december is jouw deel van de rekening nog niet binnen.

Maand: december
Jouw deel: €~436,00
Binnen: €~0,00
Nog te storten: €~436,00

Bekijk de rekening:
https://saldo.example.com/rekeningen/2

Saldo ziet een bijdrage zodra de bank ze doorgeeft.
`, `Je krijgt dit omdat "Bijdrage ontbreekt" aanstaat.`)
	if self.Text != nb(want) {
		t.Errorf("text part:\n%s\nwant:\n%s", self.Text, nb(want))
	}
	if self.Subject != "Je bijdrage voor de Gedeelde rekening is er nog niet" {
		t.Errorf("subject %q", self.Subject)
	}
	inBoth(t, "contrib/self", self, nb("Je bijdrage van €~436 is er nog niet"), "december", "Gedeelde rekening", nb("€~436,00"))

	// Partial: "€ 200 van € 436 is binnen".
	part, _ := ContributionMissing("bert@example.com", ContributionMissingData{Account: sharedAccount, Member: "Bert",
		Required: 43600, Received: 20000, Month: time.December, ForSelf: true})
	if part.Subject != "Je bijdrage voor de Gedeelde rekening is nog niet volledig" {
		t.Errorf("partial subject %q", part.Subject)
	}
	inBoth(t, "contrib/partial", part, nb("€~200 van €~436 is binnen"), "Nog te storten", nb("€~236,00"))

	// Manager variant: "Partners bijdrage is er nog niet".
	mgr, _ := ContributionMissing("bert@example.com", ContributionMissingData{Links: noticeLinks, Account: sharedAccount, Member: "Partner",
		Required: 43600, Month: time.December, ActionURL: testBase + "/rekeningen/2"})
	if mgr.Subject != "Partners bijdrage voor de Gedeelde rekening is er nog niet" {
		t.Errorf("manager subject %q", mgr.Subject)
	}
	inBoth(t, "contrib/manager", mgr, "Partners bijdrage is er nog niet", "Deel van Partner", "december", "Gedeelde rekening",
		"omdat je beheerder bent van deze rekening")
	if strings.Contains(mgr.Text, "Je bijdrage") || strings.Contains(self.Text, "Partners bijdrage") {
		t.Error("the variants are mixed up")
	}
	// A contributor without Saldo (0.8.1) is named too; a name ending in s gets an apostrophe.
	c, _ := ContributionMissing("bert@example.com", ContributionMissingData{Account: sharedAccount, Member: "Thomas", Required: 10050, Month: time.March})
	inBoth(t, "contrib/s", c, "Thomas' bijdrage is er nog niet", nb("€~100,50"))
	// Neither variant names a personal account.
	for _, m := range []Message{self, mgr, part, c} {
		if strings.Contains(m.HTML, "Zichtrekening") || strings.Contains(m.Text, "BE68") {
			t.Error("a personal account in a contribution mail")
		}
	}
}

func TestUncategorisedDigestIsCountOnly(t *testing.T) {
	m, err := UncategorisedDigest("bert@example.com", UncategorisedDigestData{Links: noticeLinks, Count: 8, ActionURL: testBase + "/transacties?filter=niet-gecategoriseerd"})
	if err != nil {
		t.Fatal(err)
	}
	want := withFooter(`Saldo · Te categoriseren

8 transacties te categoriseren

8
nieuwe banktransacties zonder categorie

Er zijn nieuwe banktransacties zonder categorie. Met een categorie kloppen je overzicht en je budgetten.

Categoriseren:
https://saldo.example.com/transacties?filter=niet-gecategoriseerd

Je krijgt hooguit één e-mail per dag, en alleen als er iets nieuws is.
`, `Je krijgt dit omdat "Te categoriseren" aanstaat voor e-mail.`)
	if m.Text != want {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, want)
	}
	if m.Subject != "8 transacties te categoriseren" {
		t.Errorf("subject %q", m.Subject)
	}
	inBoth(t, "digest", m, "8 transacties te categoriseren", "Categoriseren", "niet-gecategoriseerd")
	one, _ := UncategorisedDigest("bert@example.com", UncategorisedDigestData{Count: 1})
	if one.Subject != "1 transactie te categoriseren" || !strings.Contains(one.Text, "Er is een nieuwe banktransactie zonder categorie.") {
		t.Errorf("singular: %q\n%s", one.Subject, one.Text)
	}
	if _, err := UncategorisedDigest("bert@example.com", UncategorisedDigestData{}); err == nil {
		t.Error("a digest without transactions must not render")
	}
}

func TestManagerBankMails(t *testing.T) {
	until := dayOf(2026, 11, 30)
	both := []AccountRef{zichtAccount, sharedAccount}
	m, err := ConsentExpiringNotice("bert@example.com", ConsentExpiringData{Links: noticeLinks, Bank: "Argenta", Owner: "Partner",
		Accounts: both, ValidUntil: until, DaysLeft: 14, ActionURL: testBase + "/rekeningen/2"})
	if err != nil {
		t.Fatal(err)
	}
	want := withFooter(`Saldo · Bankkoppeling

Partners Argenta-koppeling verloopt over 14 dagen

Gedeelde rekening (Gedeeld met Partner · BE12 •••• •••• 7730)

30 november
Laatste dag dat Saldo de rekening via deze koppeling kan lezen

Banken vragen elke 180 dagen opnieuw toestemming, en alleen Partner kan die geven in de Argenta-app. Daarna haalt Saldo geen nieuwe transacties meer op voor Gedeelde rekening via deze koppeling.

Gekoppeld door: Partner
Geldig tot: 30 november

Bekijk de rekening:
https://saldo.example.com/rekeningen/2

Wil je niet afhankelijk zijn van Partners koppeling? Koppel de rekening dan ook zelf bij Argenta: die koppeling neemt het over als deze verloopt.
`, "Je krijgt dit omdat je beheerder bent van de rekening die deze koppeling bijwerkt.")
	if m.Text != want {
		t.Errorf("text part:\n%s\nwant:\n%s", m.Text, want)
	}
	if m.Subject != "Partners Argenta-koppeling verloopt over 14 dagen (Gedeelde rekening)" {
		t.Errorf("subject %q", m.Subject)
	}
	if strings.Contains(m.Text, "Opnieuw koppelen") || strings.Contains(m.HTML, "Opnieuw koppelen") {
		t.Error("a manager cannot re-link someone else's consent")
	}

	last, _ := ConsentExpiringNotice("bert@example.com", ConsentExpiringData{Links: noticeLinks, Bank: "Argenta", Owner: "Partner",
		Accounts: both, ValidUntil: until, DaysLeft: 3, ActionURL: testBase + "/rekeningen/2"})
	if last.Subject != "Laatste herinnering: Partners Argenta-koppeling verloopt over 3 dagen (Gedeelde rekening)" {
		t.Errorf("last reminder subject %q", last.Subject)
	}
	inBoth(t, "consent/3", last, "Nog 3 dagen, daarna stopt de synchronisatie", "Bekijk de rekening", "Koppel de rekening dan ook zelf bij Argenta")

	at := time.Date(2026, 11, 30, 4, 2, 0, 0, clock.Brussels)
	stop, err := SyncStoppedNotice("bert@example.com", SyncStoppedData{Links: noticeLinks, Bank: "Argenta", Owner: "Partner", Accounts: both,
		LastSuccess: at, ActionURL: testBase + "/rekeningen/2"})
	if err != nil {
		t.Fatal(err)
	}
	if stop.Subject != "Partners Argenta-koppeling is verlopen (Gedeelde rekening)" {
		t.Errorf("sync subject %q", stop.Subject)
	}
	inBoth(t, "sync", stop, "De rekening wordt niet meer bijgewerkt", "Gekoppeld door", "Partner", "Niet bijgewerkt sinds 30 nov", "30 nov · 04:02",
		"Bekijk de rekening", "Koppel de rekening dan ook zelf bij Argenta")
	fail, _ := SyncStoppedNotice("bert@example.com", SyncStoppedData{Bank: "Argenta", Owner: "Partner", Accounts: both, Reason: StopFailing})
	if fail.Subject != "Partners Argenta-koppeling werkt niet meer (Gedeelde rekening)" || !strings.Contains(fail.Text, "al meer dan 3 dagen geen gegevens meer via de Argenta-koppeling van Partner") {
		t.Errorf("failing: %q\n%s", fail.Subject, fail.Text)
	}

	// A manager is never told about the owner's personal accounts or IBANs,
	// whatever the caller passes.
	for name, mm := range map[string]Message{"consent14": m, "consent3": last, "stopped": stop, "failing": fail} {
		for _, s := range []string{"Zichtrekening", "BE68", "4821", "Persoonlijk"} {
			if strings.Contains(mm.HTML, s) || strings.Contains(mm.Text, s) || strings.Contains(mm.Subject, s) {
				t.Errorf("%s: the personal account leaks (%q)", name, s)
			}
		}
	}
	// Two shared accounts fed by one link are one mail.
	second := AccountRef{Name: "Vakantiepot", Shared: true, With: "Partner", MaskedIBAN: "BE55 •••• •••• 0001"}
	two, _ := ConsentExpiringNotice("bert@example.com", ConsentExpiringData{Bank: "Argenta", Owner: "Partner",
		Accounts: []AccountRef{zichtAccount, sharedAccount, second}, ValidUntil: until, DaysLeft: 14})
	if two.Subject != "Partners Argenta-koppeling verloopt over 14 dagen (2 rekeningen)" || !strings.Contains(two.Text, "voor Gedeelde rekening en Vakantiepot via deze koppeling") ||
		!strings.Contains(two.Text, "de rekeningen die deze koppeling bijwerken") {
		t.Errorf("two shared accounts: %q\n%s", two.Subject, two.Text)
	}
	if strings.Contains(two.Text, "Zichtrekening") {
		t.Error("the personal account is named")
	}
	// Only personal accounts: nothing to say to a manager.
	if _, err := ConsentExpiringNotice("bert@example.com", ConsentExpiringData{Bank: "Argenta", Owner: "Partner", Accounts: []AccountRef{zichtAccount}, ValidUntil: until, DaysLeft: 14}); err == nil {
		t.Error("a manager mail without a shared account was rendered")
	}
	if _, err := SyncStoppedNotice("bert@example.com", SyncStoppedData{Bank: "Argenta", Owner: "Partner", Accounts: []AccountRef{zichtAccount}}); err == nil {
		t.Error("a manager sync mail without a shared account was rendered")
	}
	// The owner's own mail keeps every account and the re-link button.
	own, _ := ConsentExpiringNotice("partner@example.com", ConsentExpiringData{Links: noticeLinks, Bank: "Argenta", Accounts: both,
		ValidUntil: until, DaysLeft: 14, ActionURL: testBase + "/bankkoppelingen"})
	inBoth(t, "owner", own, "Zichtrekening", "Gedeelde rekening", "Opnieuw koppelen", "Gekoppeld door")
	if !strings.Contains(own.Text, "Meldingen aanpassen: ") {
		t.Error("the owner's notice has no settings link")
	}
}

// Every name that reaches a notification mail is escaped in the HTML part and
// cannot add a line to the subject or the text part.
func TestNotificationMailsEscapeNames(t *testing.T) {
	evil := `<b>Eve</b> & "Co" 'x'`
	inject := evil + "\r\nBcc: eve@example.com"
	acct := AccountRef{Name: inject, Shared: true, With: evil, MaskedIBAN: "BE68 •••• •••• 4821"}
	at := dayOf(2027, 2, 10)
	var msgs = map[string]Message{}
	add := func(name string, m Message, err error) { msgs[name] = mustBuild(t, name, m, err) }

	m, err := PlanningRed("bert@example.com", PlanningRedData{Account: acct, Month: time.February, EndBalance: -1, EndDate: at, RedFrom: at,
		Cause: &Expense{inject, -100}, Buffer: 1})
	add("red", m, err)
	m, err = PlanningBuffer("bert@example.com", PlanningBufferData{Account: acct, Month: time.January, EndBalance: 1, UnderBuffer: 1, Buffer: 2,
		LowestPoint: at, LowestNote: inject, Cause: &Expense{inject, -100}})
	add("buffer", m, err)
	m, err = MemberJoined("bert@example.com", MemberJoinedData{Account: acct, Who: inject, Bank: inject, Via: JoinedByLink, Since: at})
	add("joined", m, err)
	m, err = SharedInvitation("bert@example.com", SharedInvitationData{Inviter: inject, Account: inject})
	add("invitation", m, err)
	m, err = ContributionMissing("bert@example.com", ContributionMissingData{Account: acct, Member: inject, Required: 100, Month: time.May})
	add("contrib", m, err)
	m, err = ConsentExpiringNotice("bert@example.com", ConsentExpiringData{Bank: inject, Owner: inject, Accounts: []AccountRef{acct}, ValidUntil: at, DaysLeft: 14})
	add("consent", m, err)
	m, err = SyncStoppedNotice("bert@example.com", SyncStoppedData{Bank: inject, Owner: inject, Accounts: []AccountRef{acct}})
	add("sync", m, err)

	for name, m := range msgs {
		if strings.Contains(m.HTML, "<b>Eve</b>") || !strings.Contains(m.HTML, "&lt;b&gt;Eve&lt;/b&gt;") {
			t.Errorf("%s: a name is not escaped in the HTML part", name)
		}
		if !strings.Contains(m.HTML, "&amp; &#34;Co&#34; &#39;x&#39;") {
			t.Errorf("%s: the ampersand and the quotes are not escaped", name)
		}
		if strings.ContainsAny(m.Subject, "\r\n") || strings.Contains(m.Text, "\nBcc:") || strings.Contains(m.HTML, "\nBcc:") {
			t.Errorf("%s: a name adds a line", name)
		}
		if !strings.Contains(m.Text, "<b>Eve</b>") {
			t.Errorf("%s: the text part should carry the name as it is", name)
		}
	}
}

// Dates and amounts are Dutch in every notification mail: "10 februari",
// "Di 3 nov, 20:31", "€ 1.033,47" with a no-break space, U+2212 for a minus.
func TestNotificationMailsAreDutch(t *testing.T) {
	all := buildAll(t, noticeLinks, testBase+"/x")
	if m := all["PlanningRed"]; !strings.Contains(m.Text, nb("−€~1.033,47")) || !strings.Contains(m.Text, "10 februari") || !strings.Contains(m.Text, "28 februari") {
		t.Error("PlanningRed: amounts or dates are not Dutch")
	}
	if m := all["MemberJoined/link"]; !strings.Contains(m.Text, "Di 3 nov, 20:31") {
		t.Error("MemberJoined: date")
	}
	if m := all["ConsentExpiringNotice/owner/14"]; !strings.Contains(m.Text, "30 november") {
		t.Error("ConsentExpiring: date")
	}
	for name, m := range all {
		for _, bad := range []string{"€ ", "-€", "Nov ", "February", "January", "December", "Monday", "Sunday"} {
			if strings.Contains(m.Text, bad) || strings.Contains(html.UnescapeString(m.HTML), bad) {
				t.Errorf("%s: contains %q (an English or non-Dutch format)", name, bad)
			}
		}
	}
}
