package mail

import (
	"html"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/clock"
)

const testBase = "https://saldo.example.com"

var (
	zichtAccount   = AccountRef{Name: "Zichtrekening", MaskedIBAN: "BE68 •••• •••• 4821"}
	sharedAccount  = AccountRef{Name: "Gedeelde rekening", Shared: true, With: "Partner", MaskedIBAN: "BE12 •••• •••• 7730"}
	hrefPattern    = regexp.MustCompile(`href="([^"]*)"`)
	srcPattern     = regexp.MustCompile(`src="([^"]*)"`)
	htmlTextNode   = regexp.MustCompile(`>([^<>]+)<`)
	hiddenOrHeader = regexp.MustCompile(`(?s)<style>.*?</style>|<title>.*?</title>|<div style="display:none[^>]*>[^<]*</div>`)
)

func dayOf(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 12, 0, 0, 0, clock.Brussels)
}

// inBoth asserts that every fact is in the plain-text part and, with the HTML
// entities decoded, in the HTML part: the two parts carry the same facts.
func inBoth(t *testing.T, name string, m Message, facts ...string) {
	t.Helper()
	h := html.UnescapeString(m.HTML)
	for _, f := range facts {
		if !strings.Contains(m.Text, f) {
			t.Errorf("%s: the text part lacks %q", name, f)
		}
		if !strings.Contains(h, f) {
			t.Errorf("%s: the HTML part lacks %q", name, f)
		}
	}
}

func mustBuild(t *testing.T, name string, m Message, err error) Message {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return m
}

// buildAll renders every notification builder (and each of its variants) with
// the given links; act is the URL of every button, "" leaves the buttons out.
func buildAll(t *testing.T, l Links, act string) map[string]Message {
	t.Helper()
	both := []AccountRef{zichtAccount, sharedAccount}
	out := map[string]Message{}
	add := func(name string, m Message, err error) { out[name] = mustBuild(t, name, m, err) }

	m, err := PlanningRed("bert@example.com", PlanningRedData{Links: l, Account: zichtAccount, Month: time.February, EndBalance: -103347,
		EndDate: dayOf(2027, 2, 28), RedFrom: dayOf(2027, 2, 10), Cause: &Expense{"Autoherstelling", -200000}, Buffer: 90000, ActionURL: act})
	add("PlanningRed", m, err)
	m, err = PlanningBuffer("bert@example.com", PlanningBufferData{Links: l, Account: zichtAccount, Month: time.January, EndBalance: 72150,
		UnderBuffer: 17850, Buffer: 90000, LowestPoint: dayOf(2027, 1, 1), LowestNote: "voor het salaris",
		Cause: &Expense{"Familiale verzekering", -68400}, ActionURL: act})
	add("PlanningBuffer", m, err)
	m, err = MemberJoined("bert@example.com", MemberJoinedData{Links: l, Account: sharedAccount, Who: "Partner", Bank: "Argenta",
		Via: JoinedByLink, Since: time.Date(2026, 11, 3, 20, 31, 0, 0, clock.Brussels), MembersURL: act})
	add("MemberJoined/link", m, err)
	m, err = MemberJoined("bert@example.com", MemberJoinedData{Links: l, Account: sharedAccount, Who: "Partner",
		Via: JoinedByInvitation, ReadOnly: true, Since: time.Date(2026, 11, 3, 20, 31, 0, 0, clock.Brussels), MembersURL: act})
	add("MemberJoined/invitation", m, err)
	m, err = SharedInvitation("partner@example.com", SharedInvitationData{Links: l, Inviter: "Bert", Account: "Gedeelde rekening", ActionURL: act})
	add("SharedInvitation", m, err)
	m, err = ContributionMissing("bert@example.com", ContributionMissingData{Links: l, Account: sharedAccount, Member: "Bert",
		Required: 43600, Month: time.December, ForSelf: true, ActionURL: act})
	add("ContributionMissing/self", m, err)
	m, err = ContributionMissing("bert@example.com", ContributionMissingData{Links: l, Account: sharedAccount, Member: "Partner",
		Required: 43600, Received: 20000, Month: time.December, ActionURL: act})
	add("ContributionMissing/manager", m, err)
	m, err = UncategorisedDigest("bert@example.com", UncategorisedDigestData{Links: l, Count: 8, ActionURL: act})
	add("UncategorisedDigest", m, err)
	for _, days := range []int{14, 3} {
		name := map[int]string{14: "14", 3: "3"}[days]
		m, err = ConsentExpiringNotice("bert@example.com", ConsentExpiringData{Links: l, Bank: "Argenta", Accounts: both,
			ValidUntil: dayOf(2026, 11, 30), DaysLeft: days, ActionURL: act})
		add("ConsentExpiringNotice/owner/"+name, m, err)
		m, err = ConsentExpiringNotice("bert@example.com", ConsentExpiringData{Links: l, Bank: "Argenta", Owner: "Partner", Accounts: both,
			ValidUntil: dayOf(2026, 11, 30), DaysLeft: days, ActionURL: act})
		add("ConsentExpiringNotice/manager/"+name, m, err)
	}
	last := time.Date(2026, 11, 30, 4, 2, 0, 0, clock.Brussels)
	m, err = SyncStoppedNotice("bert@example.com", SyncStoppedData{Links: l, Bank: "Argenta", Accounts: both, LastSuccess: last, ActionURL: act})
	add("SyncStoppedNotice/owner", m, err)
	m, err = SyncStoppedNotice("bert@example.com", SyncStoppedData{Links: l, Bank: "Argenta", Owner: "Partner", Accounts: both,
		LastSuccess: last, Reason: StopFailing, ActionURL: act})
	add("SyncStoppedNotice/manager", m, err)

	d := demoOverview(false)
	d.Links, d.ReceiptURL = l, act
	m, err = WeekOverview("bert@example.com", d)
	add("WeekOverview", m, err)
	d = demoOverview(true)
	d.Links, d.ReceiptURL = l, act
	m, err = MonthOverview("bert@example.com", d)
	add("MonthOverview", m, err)
	return out
}

func sortedNames(all map[string]Message) []string {
	names := make([]string, 0, len(all))
	for n := range all {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

func TestEveryNotificationMailRendersBothParts(t *testing.T) {
	all := buildAll(t, Links{BaseURL: testBase, SettingsURL: testBase + "/meldingen"}, testBase+"/x")
	if len(all) != 16 {
		t.Fatalf("only %d mails built", len(all))
	}
	for _, name := range sortedNames(all) {
		m := all[name]
		if m.To == "" || m.Subject == "" || strings.ContainsAny(m.Subject, "\r\n") {
			t.Errorf("%s: to %q, subject %q", name, m.To, m.Subject)
		}
		if !strings.HasPrefix(m.HTML, "<!doctype html>") || !strings.Contains(m.HTML, "<title>"+html.EscapeString(m.Subject)+"</title>") {
			t.Errorf("%s: HTML part: no doctype or no <title> with the subject", name)
		}
		if !strings.HasPrefix(m.Text, "Saldo · ") || !strings.Contains(m.Text, "\n--\n") {
			t.Errorf("%s: text part: no brand line or no signature delimiter:\n%s", name, m.Text)
		}
		for _, bad := range []string{"ZgotmplZ", "{{", "<no value>", "%!"} {
			if strings.Contains(m.HTML, bad) || strings.Contains(m.Text, bad) {
				t.Errorf("%s: contains %q", name, bad)
			}
		}
		// The subject names the account (or says how many) for the account mails.
		if strings.Contains(name, "Planning") && !strings.Contains(m.Subject, "Zichtrekening") {
			t.Errorf("%s: subject %q does not name the account", name, m.Subject)
		}
	}
}

// The footer link is on every notification mail when SettingsURL is set, and
// on none when it is not; the plain-text footer follows the "-- " delimiter.
func TestSettingsLinkOnlyWhenSet(t *testing.T) {
	settings := testBase + "/meldingen"
	for name, m := range buildAll(t, Links{SettingsURL: settings}, "") {
		if !strings.Contains(m.HTML, `<a href="`+settings+`" target="_blank" style="color:#166534;text-decoration:underline;">Meldingen aanpassen</a>`) {
			t.Errorf("%s: no footer link in the HTML part", name)
		}
		i, j := strings.Index(m.Text, "\n--\n"), strings.Index(m.Text, "Meldingen aanpassen: "+settings+"\nSaldo draait op je eigen Home Assistant.")
		if i < 0 || j < i {
			t.Errorf("%s: the text footer lacks the settings line after the delimiter:\n%s", name, m.Text)
		}
		if strings.Contains(m.HTML, "<img") {
			t.Errorf("%s: images without a BaseURL", name)
		}
	}
	for name, m := range buildAll(t, Links{BaseURL: testBase}, "") {
		if strings.Contains(m.HTML, "Meldingen aanpassen") || strings.Contains(m.Text, "Meldingen aanpassen") {
			t.Errorf("%s: a mute link without a SettingsURL", name)
		}
	}
}

// The four mails that are always sent never carry the link or images, and the
// old bank builders (no Links parameter) do not either.
func TestAlwaysSentMailsHaveNoSettingsLink(t *testing.T) {
	at := time.Date(2026, 11, 18, 21, 14, 0, 0, clock.Brussels)
	var msgs []Message
	m, err := LoginCode("bert@example.com", "48291736", at, 10*time.Minute, "Chrome op Windows")
	msgs = append(msgs, mustBuild(t, "LoginCode", m, err))
	m, err = Invitation("partner@example.com", "Bert", "user", testBase+"/uitnodiging/x", 7)
	msgs = append(msgs, mustBuild(t, "Invitation", m, err))
	m, err = PasswordReset("partner@example.com", "Bert", testBase+"/nieuw-wachtwoord/x", at)
	msgs = append(msgs, mustBuild(t, "PasswordReset", m, err))
	m, err = NewDevice("bert@example.com", "Chrome op Android", at, testBase+"/instellingen/toestellen")
	msgs = append(msgs, mustBuild(t, "NewDevice", m, err))
	m, err = ConsentExpiring("bert@example.com", "Argenta", twoAccounts, at, 14, testBase+"/bankkoppelingen")
	msgs = append(msgs, mustBuild(t, "ConsentExpiring", m, err))
	m, err = SyncStopped("bert@example.com", "Argenta", twoAccounts, at, StopConsent, testBase+"/bankkoppelingen")
	msgs = append(msgs, mustBuild(t, "SyncStopped", m, err))
	for _, m := range msgs {
		if strings.Contains(m.HTML, "Meldingen aanpassen") || strings.Contains(m.Text, "Meldingen aanpassen") || strings.Contains(m.HTML, "<img") {
			t.Errorf("%q has a mute link or an image", m.Subject)
		}
		// The text brand, as before.
		if !strings.Contains(m.HTML, `>Saldo</td></tr>`) {
			t.Errorf("%q: the text brand is gone", m.Subject)
		}
	}
}

// Without a public address there are no images and no links at all: with every
// URL empty a mail has no <img>, no /mail/ and no anchor.
func TestNoAddressNoImagesNoLinks(t *testing.T) {
	for name, m := range buildAll(t, Links{}, "") {
		page := strings.Replace(m.HTML, `xmlns="http://www.w3.org/1999/xhtml"`, "", 1) // the namespace is not a link
		for _, bad := range []string{"<img", "/mail/", "<a ", "href=", "http", "Meldingen aanpassen"} {
			if strings.Contains(page, bad) {
				t.Errorf("%s: the HTML part contains %q without a BaseURL or any URL", name, bad)
			}
		}
		if strings.Contains(m.Text, "http") || strings.Contains(m.Text, "Meldingen aanpassen") {
			t.Errorf("%s: the text part has a link without any URL:\n%s", name, m.Text)
		}
		if !strings.Contains(m.HTML, `>Saldo</td></tr>`) {
			t.Errorf("%s: no text brand", name)
		}
	}
}

func TestBaseURLGivesTheLogoAndTheIcons(t *testing.T) {
	all := buildAll(t, Links{BaseURL: testBase + "/"}, "")
	for _, name := range sortedNames(all) {
		m := all[name]
		if !strings.Contains(m.HTML, `<img src="`+testBase+`/mail/logo.png" width="28" height="28" alt=""`) {
			t.Errorf("%s: no logo image", name)
		}
		srcs := srcPattern.FindAllStringSubmatch(m.HTML, -1)
		for _, s := range srcs {
			if !strings.HasPrefix(s[1], testBase+"/mail/") || strings.Contains(s[1], "//mail") {
				t.Errorf("%s: image %q is not under <BaseURL>/mail/", name, s[1])
			}
			if !strings.HasSuffix(s[1], "/logo.png") && !strings.HasSuffix(s[1], "/person.png") && !strings.HasSuffix(s[1], "/people.png") {
				t.Errorf("%s: unknown image %q", name, s[1])
			}
		}
		if strings.Contains(m.Text, "/mail/") {
			t.Errorf("%s: an image address in the text part", name)
		}
	}
	// A personal account gets the green one-person icon, a shared one the
	// violet two-person icon.
	red := all["PlanningRed"].HTML
	if !strings.Contains(red, `src="`+testBase+`/mail/person.png"`) || strings.Contains(red, "people.png") ||
		!strings.Contains(red, `bgcolor="#15803D"`) || !strings.Contains(red, `alt="Persoonlijke rekening"`) {
		t.Error("PlanningRed: not the personal icon")
	}
	joined := all["MemberJoined/link"].HTML
	if !strings.Contains(joined, `src="`+testBase+`/mail/people.png"`) || strings.Contains(joined, "person.png") ||
		!strings.Contains(joined, `bgcolor="#5B3FD9"`) || !strings.Contains(joined, `alt="Gedeelde rekening"`) {
		t.Error("MemberJoined: not the shared icon")
	}
	both := all["ConsentExpiringNotice/owner/14"].HTML
	if !strings.Contains(both, "person.png") || !strings.Contains(both, "people.png") || strings.Count(both, "<img") != 3 {
		t.Errorf("two accounts should give the logo and both icons, got %d images", strings.Count(both, "<img"))
	}
	// Account name and masked IBAN stay as text next to the icon.
	if !strings.Contains(joined, ">Gedeeld met Partner · BE12 •••• •••• 7730</div>") {
		t.Error("the account sub line is gone")
	}
}

// Every address a mail renders is one the caller gave: the button, the footer
// link and the images; nothing is built from thin air.
func TestOnlyGivenAddressesAreRendered(t *testing.T) {
	act := testBase + "/planning?maand=2027-02&rekening=1#maanden"
	settings := testBase + "/meldingen"
	for name, m := range buildAll(t, Links{BaseURL: testBase, SettingsURL: settings}, act) {
		for _, h := range hrefPattern.FindAllStringSubmatch(m.HTML, -1) {
			if u := html.UnescapeString(h[1]); u != act && u != settings {
				t.Errorf("%s: unexpected link %q", name, u)
			}
		}
		for _, u := range regexp.MustCompile(`https?://\S+`).FindAllString(m.Text, -1) {
			if u != act && u != settings {
				t.Errorf("%s: unexpected address in the text part %q", name, u)
			}
		}
		if !strings.Contains(m.Text, act) {
			t.Errorf("%s: the button address is not in the text part", name)
		}
		if !strings.Contains(html.UnescapeString(m.HTML), `href="`+act+`"`) {
			t.Errorf("%s: the button address is not in the HTML part", name)
		}
	}
}

// With an empty base URL the layout is the one the sign-in mails always had:
// the same structure, so the legacy builders and their notice twins agree.
func TestLegacyBuildersAreTheNoticeBuildersWithoutLinks(t *testing.T) {
	until := dayOf(2026, 11, 30)
	a, _ := ConsentExpiring("bert@example.com", "Argenta", twoAccounts, until, 14, testBase+"/bankkoppelingen")
	b, _ := ConsentExpiringNotice("bert@example.com", ConsentExpiringData{Bank: "Argenta", Accounts: twoAccounts, ValidUntil: until, DaysLeft: 14, ActionURL: testBase + "/bankkoppelingen"})
	if a != b {
		t.Error("ConsentExpiring differs from ConsentExpiringNotice without links")
	}
	last := time.Date(2026, 11, 30, 4, 2, 0, 0, clock.Brussels)
	c, _ := SyncStopped("bert@example.com", "Argenta", twoAccounts, last, StopFailing, "")
	d, _ := SyncStoppedNotice("bert@example.com", SyncStoppedData{Bank: "Argenta", Accounts: twoAccounts, LastSuccess: last, Reason: StopFailing})
	if c != d {
		t.Error("SyncStopped differs from SyncStoppedNotice without links")
	}
}

// A long name is given break opportunities in the HTML part only, never in
// the plain-text part or the subject, and nothing is lost.
func TestLongNamesWrapInsteadOfBreakingTheCard(t *testing.T) {
	long := strings.Repeat("Spaarrekening", 12) // 156 characters, no space
	acct := AccountRef{Name: long, MaskedIBAN: "BE68 •••• •••• 4821"}
	m, err := PlanningRed("bert@example.com", PlanningRedData{Account: acct, Month: time.February, EndBalance: -100,
		EndDate: dayOf(2027, 2, 28)})
	mustBuild(t, "PlanningRed", m, err)
	if strings.Contains(m.Text, zwsp) || strings.Contains(m.Subject, zwsp) {
		t.Error("an invisible character in the text part or subject")
	}
	body := hiddenOrHeader.ReplaceAllString(m.HTML, "")
	var nodes []string
	for _, n := range htmlTextNode.FindAllStringSubmatch(body, -1) {
		nodes = append(nodes, html.UnescapeString(n[1]))
	}
	joined := strings.Join(nodes, "\n")
	if !strings.Contains(strings.ReplaceAll(joined, zwsp, ""), long) {
		t.Error("the long name is not in the HTML part, or was changed")
	}
	for _, tok := range strings.FieldsFunc(joined, func(r rune) bool { return r == ' ' || r == '\n' || r == ' ' || r == '​' }) {
		if n := len([]rune(tok)); n > 30 {
			t.Errorf("a run of %d characters without a break opportunity: %.40q...", n, tok)
		}
	}
	// The card stays 520 px: no fixed width larger than that anywhere.
	for _, w := range regexp.MustCompile(`width="(\d+)"`).FindAllStringSubmatch(m.HTML, -1) {
		if w[1] != "520" && len(w[1]) > 2 {
			t.Errorf("fixed width %s", w[1])
		}
	}
}
