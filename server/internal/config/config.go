// Package config reads the server configuration from the environment and the
// optional add-on options file (the Home Assistant add-on writes the user's
// options to /data/options.json).
//
// Precedence for settings that exist in both places: environment, then the
// options file, then the default.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/mail"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// DemoToday is the demo story's date (analysis section 12).
const DemoToday = "2026-11-18"

// Config is the resolved server configuration.
type Config struct {
	Addr        string     // listen address, for example ":8080"
	StateDir    string     // directory for the database and other state
	WebDir      string     // built web app; empty when not configured
	OptionsFile string     // add-on options file (may not exist)
	Demo        bool       // demo mode: seed the demo story and act as Bert
	Today       string     // clock override as YYYY-MM-DD; empty = real clock
	LogLevel    slog.Level // minimum log level
	PublicURL   string     // public base URL without trailing slash; may be empty
	SMTP        SMTP       // mail server; Host empty = not configured
	MailLog     bool       // development: write mails to the log instead of sending
	// AdminRecovery logs a password-reset link for the first admin at every
	// start, for a locked-out sole admin.
	AdminRecovery bool
}

// SMTP is the mail server. Security is "starttls" or "tls"; Saldo never
// sends unencrypted.
type SMTP struct {
	Host     string
	Port     int
	Security string
	User     string
	Password string
	From     string
}

// String hides the password, so the settings can be printed or logged.
func (s SMTP) String() string {
	pw := ""
	if s.Password != "" {
		pw = "***"
	}
	return fmt.Sprintf("{Host:%s Port:%d Security:%s User:%s Password:%s From:%s}", s.Host, s.Port, s.Security, s.User, pw, s.From)
}

// DBPath is the SQLite database file.
func (c Config) DBPath() string { return filepath.Join(c.StateDir, "saldo.db") }

// Port is the TCP port of Addr, used by the healthcheck subcommand.
func (c Config) Port() (string, error) {
	_, port, err := net.SplitHostPort(c.Addr)
	if err != nil {
		return "", fmt.Errorf("SALDO_ADDR %q: %w", c.Addr, err)
	}
	if port == "" {
		return "", fmt.Errorf("SALDO_ADDR %q has no port", c.Addr)
	}
	return port, nil
}

// options is the subset of the add-on options file the server reads.
type options struct {
	LogLevel      string `json:"log_level"`
	PublicURL     string `json:"public_url"`
	SMTPHost      string `json:"smtp_host"`
	SMTPPort      int    `json:"smtp_port"`
	SMTPSecurity  string `json:"smtp_security"`
	SMTPUser      string `json:"smtp_user"`
	SMTPPassword  string `json:"smtp_password"`
	SMTPFrom      string `json:"smtp_from"`
	AdminRecovery bool   `json:"admin_recovery"`
}

// Load builds the configuration. getenv is os.Getenv in production.
func Load(getenv func(string) string) (Config, error) {
	env := func(key string) string { return strings.TrimSpace(getenv(key)) }

	c := Config{
		Addr:     env("SALDO_ADDR"),
		StateDir: env("SALDO_STATE_DIR"),
		WebDir:   env("SALDO_WEB_DIR"),
	}
	if c.Addr == "" {
		c.Addr = ":8080"
	}
	if c.StateDir == "" {
		c.StateDir = "./data"
	}
	if _, err := c.Port(); err != nil {
		return Config{}, err
	}

	c.OptionsFile = env("SALDO_OPTIONS_FILE")
	if c.OptionsFile == "" {
		c.OptionsFile = filepath.Join(c.StateDir, "options.json")
	}
	opts, err := readOptions(c.OptionsFile)
	if err != nil {
		return Config{}, err
	}

	demo, err := parseBool(env("SALDO_DEMO"))
	if err != nil {
		return Config{}, fmt.Errorf("SALDO_DEMO: %w", err)
	}
	c.Demo = demo

	c.Today = env("SALDO_TODAY")
	if c.Today == "" && c.Demo {
		c.Today = DemoToday
	}
	if c.Today != "" {
		if _, err := time.Parse(time.DateOnly, c.Today); err != nil {
			return Config{}, fmt.Errorf("SALDO_TODAY %q: expected YYYY-MM-DD", c.Today)
		}
	}

	level := env("SALDO_LOG_LEVEL")
	if level == "" {
		level = strings.TrimSpace(opts.LogLevel)
	}
	if c.LogLevel, err = ParseLogLevel(level); err != nil {
		return Config{}, err
	}

	if c.PublicURL, err = parsePublicURL(or(env("SALDO_PUBLIC_URL"), opts.PublicURL)); err != nil {
		return Config{}, err
	}

	if c.MailLog, err = parseBool(env("SALDO_MAIL_LOG")); err != nil {
		return Config{}, fmt.Errorf("SALDO_MAIL_LOG: %w", err)
	}
	c.AdminRecovery = opts.AdminRecovery
	if raw := env("SALDO_ADMIN_RECOVERY"); raw != "" {
		if c.AdminRecovery, err = parseBool(raw); err != nil {
			return Config{}, fmt.Errorf("SALDO_ADMIN_RECOVERY: %w", err)
		}
	}
	if c.SMTP, err = parseSMTP(env, opts); err != nil {
		return Config{}, err
	}
	return c, nil
}

func or(a, b string) string {
	if a != "" {
		return a
	}
	return strings.TrimSpace(b)
}

func parseSMTP(env func(string) string, o options) (SMTP, error) {
	s := SMTP{
		Host:     or(env("SALDO_SMTP_HOST"), o.SMTPHost),
		Security: strings.ToLower(or(env("SALDO_SMTP_SECURITY"), o.SMTPSecurity)),
		User:     or(env("SALDO_SMTP_USER"), o.SMTPUser),
		Password: o.SMTPPassword, // not trimmed: spaces may belong to it
		From:     or(env("SALDO_SMTP_FROM"), o.SMTPFrom),
		Port:     o.SMTPPort,
	}
	if p := env("SALDO_SMTP_PASSWORD"); p != "" {
		s.Password = p
	}
	if raw := env("SALDO_SMTP_PORT"); raw != "" {
		p, err := strconv.Atoi(raw)
		if err != nil {
			return SMTP{}, fmt.Errorf("SALDO_SMTP_PORT %q: not a number", raw)
		}
		s.Port = p
	}
	if s.Host == "" {
		return SMTP{}, nil
	}
	switch s.Security {
	case "", "starttls":
		s.Security = "starttls"
		if s.Port == 0 {
			s.Port = 587
		}
	case "tls":
		if s.Port == 0 {
			s.Port = 465
		}
	default:
		return SMTP{}, fmt.Errorf("smtp_security %q: use starttls or tls (Saldo never sends unencrypted)", s.Security)
	}
	if s.Port < 1 || s.Port > 65535 {
		return SMTP{}, fmt.Errorf("smtp_port %d: not a port", s.Port)
	}
	if s.From == "" {
		s.From = s.User
	}
	if a, err := mail.ParseAddress(s.From); err != nil || !strings.Contains(a.Address, "@") {
		return SMTP{}, fmt.Errorf("smtp_from %q: expected an address such as Saldo <saldo@example.com>", s.From)
	}
	return s, nil
}

func readOptions(path string) (options, error) {
	var o options
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return o, nil
	}
	if err != nil {
		return o, fmt.Errorf("options file: %w", err)
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		return o, nil
	}
	if err := json.Unmarshal(b, &o); err != nil {
		return o, fmt.Errorf("options file %s: %w", path, err)
	}
	return o, nil
}

func parseBool(s string) (bool, error) {
	switch strings.ToLower(s) {
	case "", "0", "false", "no", "off":
		return false, nil
	case "1", "true", "yes", "on":
		return true, nil
	}
	return false, fmt.Errorf("%q is not a boolean (use 1 or 0)", s)
}

// ParseLogLevel accepts the Home Assistant add-on levels as well as slog's.
func ParseLogLevel(s string) (slog.Level, error) {
	switch strings.ToLower(s) {
	case "", "info", "notice":
		return slog.LevelInfo, nil
	case "trace", "debug":
		return slog.LevelDebug, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error", "fatal":
		return slog.LevelError, nil
	}
	return slog.LevelInfo, fmt.Errorf("log level %q: use debug, info, warning or error", s)
}

func parsePublicURL(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", nil
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", fmt.Errorf("public_url %q: expected an absolute http(s) URL", s)
	}
	return strings.TrimRight(s, "/"), nil
}
