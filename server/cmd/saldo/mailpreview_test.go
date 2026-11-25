package main

import (
	"context"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"html"
	"net/url"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"

	saldomail "github.com/BertVanBaelen/Saldo/server/internal/mail"
)

const (
	previewTo   = "bert@example.com"
	previewBase = "https://saldo.example.com"
)

// A template that is added to package mail needs an example here: this reads the
// package's source, takes every exported builder (a function that returns a
// Message and an error) and demands an entry for it in previewMails.
func TestMailPreviewCoversEveryBuilder(t *testing.T) {
	files, err := filepath.Glob("../../internal/mail/*.go")
	if err != nil || len(files) == 0 {
		t.Fatalf("package mail not found: %v", err)
	}
	var builders []string
	fset := token.NewFileSet()
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, f, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range file.Decls {
			fn, ok := d.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || !fn.Name.IsExported() || fn.Type.Results == nil || len(fn.Type.Results.List) != 2 {
				continue
			}
			first, ok1 := fn.Type.Results.List[0].Type.(*ast.Ident)
			second, ok2 := fn.Type.Results.List[1].Type.(*ast.Ident)
			if ok1 && ok2 && first.Name == "Message" && second.Name == "error" {
				builders = append(builders, fn.Name.Name)
			}
		}
	}
	if len(builders) < 16 {
		t.Fatalf("found only %v: the scan of package mail is broken", builders)
	}
	have := previewFunctions()
	for _, b := range builders {
		if !slices.Contains(have, b) {
			t.Errorf("mail.%s has no example in previewMails (cmd/saldo/mailpreview.go): add one, so `saldo mail-preview` shows it", b)
		}
	}
	for _, h := range have {
		if !slices.Contains(builders, h) {
			t.Errorf("previewMails has an example for %q, which is no builder of package mail", h)
		}
	}
}

var (
	hrefOrSrc = regexp.MustCompile(`(?:href|src)="([^"]*)"`)
	imgPath   = regexp.MustCompile(`^/mail/(logo|person|people)\.png$`)
)

func TestMailPreviewRendersEveryExample(t *testing.T) {
	msgs, err := previewMessages(previewTo, previewBase, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != len(previewMails()) || len(msgs) < 20 {
		t.Fatalf("%d examples for %d table entries", len(msgs), len(previewMails()))
	}
	seen := map[string]bool{}
	for _, p := range msgs {
		name := p.name()
		if seen[name] {
			t.Errorf("two examples are called %q: --only could not tell them apart in the output", name)
		}
		seen[name] = true
		m := p.Message
		if m.To != previewTo || !strings.HasPrefix(m.Subject, "[voorbeeld] ") || strings.TrimPrefix(m.Subject, "[voorbeeld] ") == "" ||
			strings.Contains(m.Subject, "[voorbeeld] [voorbeeld]") {
			t.Errorf("%s: to %q, subject %q", name, m.To, m.Subject)
		}
		if strings.TrimSpace(m.Text) == "" || strings.TrimSpace(m.HTML) == "" || !strings.Contains(m.HTML, "<html") {
			t.Errorf("%s: text %d bytes, HTML %d bytes", name, len(m.Text), len(m.HTML))
		}
		if strings.Contains(m.HTML, "{{") || strings.Contains(m.Text, "{{") || strings.Contains(m.HTML, "<no value>") || strings.Contains(m.Text, "<no value>") {
			t.Errorf("%s: a template field was not filled", name)
		}
		// Every address the mail carries is under the public URL (an e-mail has no other base), or a mailto.
		for _, a := range hrefOrSrc.FindAllStringSubmatch(m.HTML, -1) {
			link := html.UnescapeString(a[1])
			if u, err := url.Parse(link); err != nil || (!strings.HasPrefix(link, previewBase+"/") && u.Scheme != "mailto") {
				t.Errorf("%s: the HTML carries %q, which is not under %s", name, link, previewBase)
			}
		}
		for _, w := range strings.Fields(m.Text) {
			if strings.HasPrefix(w, "http") && !strings.HasPrefix(w, previewBase+"/") {
				t.Errorf("%s: the text carries %q, which is not under %s", name, w, previewBase)
			}
		}
		// The notification mails show the logo and carry the settings link; the four sign-in mails and the short
		// forms of the bank mails (no Links) never do.
		plain := slices.Contains(signInFunctions, p.Function) || strings.Contains(p.Variant, "korte vorm")
		if hasLogo := strings.Contains(m.HTML, previewBase+"/mail/logo.png"); hasLogo == plain {
			t.Errorf("%s: logo image %v, without links %v", name, hasLogo, plain)
		}
		if settings := strings.Contains(m.HTML, previewBase+"/meldingen") && strings.Contains(m.Text, previewBase+"/meldingen"); settings == plain {
			t.Errorf("%s: settings link %v, without links %v", name, settings, plain)
		}
		for _, a := range hrefOrSrc.FindAllStringSubmatch(m.HTML, -1) {
			if u, _ := url.Parse(html.UnescapeString(a[1])); strings.HasPrefix(u.Path, "/mail/") && !imgPath.MatchString(u.Path) {
				t.Errorf("%s points at %s, which /mail/ does not serve", name, u.Path)
			}
		}
	}
}

func TestMailPreviewOnly(t *testing.T) {
	msgs, err := previewMessages(previewTo, previewBase, "planningred")
	if err != nil || len(msgs) != 1 || msgs[0].Function != "PlanningRed" {
		t.Fatalf("planningred: %v, %v", msgs, err)
	}
	// A function with variants gives them all.
	if msgs, err = previewMessages(previewTo, previewBase, "MemberJoined"); err != nil || len(msgs) != 2 {
		t.Fatalf("MemberJoined: %d, %v", len(msgs), err)
	}
	_, err = previewMessages(previewTo, previewBase, "Nonsense")
	if err == nil || !strings.Contains(err.Error(), "Nonsense") || !strings.Contains(err.Error(), "PlanningRed") || !strings.Contains(err.Error(), "MonthOverview") {
		t.Errorf("unknown function: %v", err)
	}
}

// fakeSMTP records what the command sends, and the SMTP it was asked to use.
type fakeSMTP struct {
	mu     sync.Mutex
	sent   []saldomail.Message
	config saldomail.SMTP
	failAt int // 1-based; 0 never
}

func (f *fakeSMTP) sender(s saldomail.SMTP) saldomail.Sender {
	f.config = s
	return f
}

func (f *fakeSMTP) Send(_ context.Context, m saldomail.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failAt > 0 && len(f.sent)+1 == f.failAt {
		return errors.New("535 authentication failed")
	}
	f.sent = append(f.sent, m)
	return nil
}

// env is a configuration as the add-on gives it: no options file is read (the state
// folder is empty), so the real ./data of a developer never matters.
func env(t *testing.T, kv ...string) func(string) string {
	t.Helper()
	m := map[string]string{"SALDO_STATE_DIR": t.TempDir()}
	for i := 0; i < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return func(k string) string { return m[k] }
}

var smtpEnv = []string{"SALDO_SMTP_HOST", "smtp.example.com", "SALDO_SMTP_USER", "saldo@example.com", "SALDO_SMTP_FROM", "Saldo <saldo@example.com>",
	"SALDO_SMTP_SECURITY", "tls", "SALDO_PUBLIC_URL", previewBase}

func TestMailPreviewSends(t *testing.T) {
	f := &fakeSMTP{}
	var out strings.Builder
	if err := runMailPreview([]string{"--to", previewTo}, env(t, smtpEnv...), f.sender, &out); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}
	if f.config.Host != "smtp.example.com" || f.config.Port != 465 || !f.config.TLS || f.config.From != "Saldo <saldo@example.com>" {
		t.Errorf("SMTP %+v", f.config)
	}
	want, _ := previewMessages(previewTo, previewBase, "")
	if len(f.sent) != len(want) {
		t.Fatalf("sent %d, want %d", len(f.sent), len(want))
	}
	for i, m := range f.sent {
		if m != want[i].Message || m.To != previewTo || !strings.HasPrefix(m.Subject, "[voorbeeld] ") {
			t.Errorf("mail %d: %q to %q", i, m.Subject, m.To)
		}
	}
	if !strings.Contains(out.String(), "PlanningRed") || !strings.Contains(out.String(), "Done.") {
		t.Errorf("output: %s", out.String())
	}

	// --only, in the "--only=x" and "-only x" forms, and the address with a display name.
	for _, args := range [][]string{{"--to", previewTo, "--only", "WeekOverview"}, {"-to=" + previewTo, "-only=weekoverview"}} {
		f = &fakeSMTP{}
		if err := runMailPreview(args, env(t, smtpEnv...), f.sender, &out); err != nil || len(f.sent) != 1 || !strings.Contains(f.sent[0].Subject, "weekoverzicht") {
			t.Errorf("%v: %d sent, %v", args, len(f.sent), err)
		}
	}
	f = &fakeSMTP{}
	if err := runMailPreview([]string{"--to", "Bert <" + previewTo + ">", "--only", "LoginCode"}, env(t, smtpEnv...), f.sender, &out); err != nil || len(f.sent) != 1 || f.sent[0].To != previewTo {
		t.Errorf("display name: %v %v", f.sent, err)
	}
}

func TestMailPreviewStopsAtTheFirstFailure(t *testing.T) {
	f := &fakeSMTP{failAt: 3}
	err := runMailPreview([]string{"--to", previewTo}, env(t, smtpEnv...), f.sender, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), "535") || !strings.Contains(err.Error(), "after 2 of") || len(f.sent) != 2 {
		t.Errorf("%d sent, %v", len(f.sent), err)
	}
}

func TestMailPreviewNeedsItsConfiguration(t *testing.T) {
	for _, c := range []struct {
		name string
		args []string
		env  []string
		want string
	}{
		{"no SMTP", []string{"--to", previewTo}, []string{"SALDO_PUBLIC_URL", previewBase}, "no SMTP server"},
		{"no SMTP, mail log", []string{"--to", previewTo}, []string{"SALDO_PUBLIC_URL", previewBase, "SALDO_MAIL_LOG", "1"}, "no SMTP server"},
		{"no public URL", []string{"--to", previewTo}, smtpEnv[:len(smtpEnv)-2], "public_url"},
		{"no address", nil, smtpEnv, "--to"},
		{"blank address", []string{"--to", " "}, smtpEnv, "--to"},
		{"bad address", []string{"--to", "bert"}, smtpEnv, "not an e-mail address"},
		{"unknown flag", []string{"--to", previewTo, "--all"}, smtpEnv, "flag provided but not defined"},
		{"stray argument", []string{"--to", previewTo, "PlanningRed"}, smtpEnv, "unexpected argument"},
		{"unknown function", []string{"--to", previewTo, "--only", "Nonsense"}, smtpEnv, "Nonsense"},
		{"bad SMTP security", []string{"--to", previewTo}, append(slices.Clone(smtpEnv), "SALDO_SMTP_SECURITY", "plain"), "smtp_security"},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := &fakeSMTP{}
			err := runMailPreview(c.args, env(t, c.env...), f.sender, &strings.Builder{})
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Errorf("error %v, want one with %q", err, c.want)
			}
			if len(f.sent) != 0 || f.config.Host != "" {
				t.Errorf("a sender was made or a mail sent: %+v, %d", f.config, len(f.sent))
			}
		})
	}
	// The messages of the missing SMTP and public URL are the user's to read: Dutch and English, naming the settings.
	err := runMailPreview([]string{"--to", previewTo}, env(t), (&fakeSMTP{}).sender, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), "smtp_host") || !strings.Contains(err.Error(), "SALDO_SMTP_HOST") || !strings.Contains(err.Error(), "Geen SMTP-server") {
		t.Errorf("no configuration: %v", err)
	}
}

func TestMailPreviewHelp(t *testing.T) {
	var out strings.Builder
	if err := runMailPreview([]string{"-h"}, env(t), (&fakeSMTP{}).sender, &out); err != nil || !strings.Contains(out.String(), "usage: saldo mail-preview --to <address>") {
		t.Errorf("-h: %v, %q", err, out.String())
	}
}
