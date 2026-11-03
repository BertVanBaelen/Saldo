package config

import (
	"log/slog"
	"os"
	"path/filepath"
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
