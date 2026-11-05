package config

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	debugOpts := write("debug.json", `{"log_level":"debug","public_url":"https://saldo.example.org/"}`)
	warningOpts := write("warning.json", `{"log_level":"warning"}`)
	brokenOpts := write("broken.json", `{"log_level":`)
	emptyOpts := write("empty.json", ``)
	missing := filepath.Join(dir, "missing.json")

	tests := []struct {
		name    string
		env     map[string]string
		want    Config
		wantErr bool
	}{
		{
			name: "defaults",
			env:  map[string]string{"SALDO_OPTIONS_FILE": missing},
			want: Config{Addr: ":8080", StateDir: "./data", OptionsFile: missing, LogLevel: slog.LevelInfo},
		},
		{
			name: "options file next to the state",
			env:  map[string]string{"SALDO_STATE_DIR": dir},
			want: Config{Addr: ":8080", StateDir: dir, OptionsFile: filepath.Join(dir, "options.json"), LogLevel: slog.LevelInfo},
		},
		{
			name: "demo defaults today to the demo date",
			env:  map[string]string{"SALDO_DEMO": "1", "SALDO_OPTIONS_FILE": missing},
			want: Config{Addr: ":8080", StateDir: "./data", OptionsFile: missing, Demo: true, Today: "2026-11-18", LogLevel: slog.LevelInfo},
		},
		{
			name: "demo with a clock override",
			env:  map[string]string{"SALDO_DEMO": "true", "SALDO_TODAY": "2027-01-31", "SALDO_OPTIONS_FILE": missing},
			want: Config{Addr: ":8080", StateDir: "./data", OptionsFile: missing, Demo: true, Today: "2027-01-31", LogLevel: slog.LevelInfo},
		},
		{
			name: "everything from the environment",
			env: map[string]string{
				"SALDO_ADDR": "127.0.0.1:9000", "SALDO_STATE_DIR": "/data", "SALDO_WEB_DIR": "/app/web",
				"SALDO_OPTIONS_FILE": debugOpts, "SALDO_DEMO": "0", "SALDO_TODAY": "2026-12-01", "SALDO_LOG_LEVEL": "error",
			},
			want: Config{
				Addr: "127.0.0.1:9000", StateDir: "/data", WebDir: "/app/web", OptionsFile: debugOpts,
				Today: "2026-12-01", LogLevel: slog.LevelError, PublicURL: "https://saldo.example.org",
			},
		},
		{
			name: "log level from the options file",
			env:  map[string]string{"SALDO_OPTIONS_FILE": debugOpts},
			want: Config{Addr: ":8080", StateDir: "./data", OptionsFile: debugOpts, LogLevel: slog.LevelDebug, PublicURL: "https://saldo.example.org"},
		},
		{
			name: "Home Assistant level names",
			env:  map[string]string{"SALDO_OPTIONS_FILE": warningOpts},
			want: Config{Addr: ":8080", StateDir: "./data", OptionsFile: warningOpts, LogLevel: slog.LevelWarn},
		},
		{
			name: "empty options file",
			env:  map[string]string{"SALDO_OPTIONS_FILE": emptyOpts},
			want: Config{Addr: ":8080", StateDir: "./data", OptionsFile: emptyOpts, LogLevel: slog.LevelInfo},
		},
		{name: "broken options file", env: map[string]string{"SALDO_OPTIONS_FILE": brokenOpts}, wantErr: true},
		{name: "bad demo flag", env: map[string]string{"SALDO_DEMO": "maybe", "SALDO_OPTIONS_FILE": missing}, wantErr: true},
		{name: "bad date", env: map[string]string{"SALDO_TODAY": "18-11-2026", "SALDO_OPTIONS_FILE": missing}, wantErr: true},
		{name: "bad log level", env: map[string]string{"SALDO_LOG_LEVEL": "loud", "SALDO_OPTIONS_FILE": missing}, wantErr: true},
		{name: "address without port", env: map[string]string{"SALDO_ADDR": "localhost", "SALDO_OPTIONS_FILE": missing}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Load(func(k string) string { return tt.env[k] })
			if tt.wantErr {
				if err == nil {
					t.Fatalf("want an error, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Errorf("got  %+v\nwant %+v", got, tt.want)
			}
		})
	}
}

func TestMailAndRecovery(t *testing.T) {
	dir := t.TempDir()
	opts := filepath.Join(dir, "options.json")
	if err := os.WriteFile(opts, []byte(`{"smtp_host":"smtp.example.com","smtp_security":"tls","smtp_user":"saldo@example.com",
		"smtp_password":" s3cret ","admin_recovery":true,"public_url":"https://saldo.example.com"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := Load(func(k string) string { return map[string]string{"SALDO_OPTIONS_FILE": opts}[k] })
	if err != nil {
		t.Fatal(err)
	}
	want := SMTP{Host: "smtp.example.com", Port: 465, Security: "tls", User: "saldo@example.com", Password: " s3cret ", From: "saldo@example.com"}
	if got.SMTP != want || !got.AdminRecovery || got.MailLog {
		t.Errorf("from the options file: %+v", got)
	}
	if s := fmt.Sprintf("%+v", got); strings.Contains(s, "s3cret") {
		t.Errorf("the password shows when printed: %s", s)
	}

	env := map[string]string{
		"SALDO_OPTIONS_FILE": opts, "SALDO_SMTP_SECURITY": "starttls", "SALDO_SMTP_PORT": "2525",
		"SALDO_SMTP_FROM": "Saldo <saldo@example.com>", "SALDO_ADMIN_RECOVERY": "0", "SALDO_MAIL_LOG": "1",
		"SALDO_PUBLIC_URL": "http://localhost:5173",
	}
	got, err = Load(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	if got.SMTP.Security != "starttls" || got.SMTP.Port != 2525 || got.SMTP.From != "Saldo <saldo@example.com>" ||
		got.AdminRecovery || !got.MailLog || got.PublicURL != "http://localhost:5173" {
		t.Errorf("environment overrides: %+v", got)
	}

	for _, bad := range []map[string]string{
		{"SALDO_SMTP_HOST": "smtp.example.com", "SALDO_SMTP_SECURITY": "none", "SALDO_SMTP_FROM": "saldo@example.com"},
		{"SALDO_SMTP_HOST": "smtp.example.com"}, // no sender
		{"SALDO_SMTP_HOST": "smtp.example.com", "SALDO_SMTP_FROM": "saldo@example.com", "SALDO_SMTP_PORT": "99999"},
		{"SALDO_SMTP_PORT": "x"},
	} {
		bad["SALDO_OPTIONS_FILE"] = filepath.Join(dir, "missing.json")
		if _, err := Load(func(k string) string { return bad[k] }); err == nil {
			t.Errorf("%v: want an error", bad)
		}
	}
}

func TestPublicURL(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"", "", false},
		{"https://saldo.example.org", "https://saldo.example.org", false},
		{"http://homeassistant.local:8080/", "http://homeassistant.local:8080", false},
		{"saldo.example.org", "", true},
		{"ftp://saldo.example.org", "", true},
	}
	for _, tt := range tests {
		got, err := parsePublicURL(tt.in)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("parsePublicURL(%q) = %q, %v; want %q, error %v", tt.in, got, err, tt.want, tt.wantErr)
		}
	}
}

func TestPortAndDBPath(t *testing.T) {
	c := Config{Addr: "0.0.0.0:8099", StateDir: filepath.Join("x", "y")}
	if p, err := c.Port(); err != nil || p != "8099" {
		t.Errorf("Port() = %q, %v", p, err)
	}
	if got, want := c.DBPath(), filepath.Join("x", "y", "saldo.db"); got != want {
		t.Errorf("DBPath() = %q, want %q", got, want)
	}
}
