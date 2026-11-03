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
	"net/url"
	"os"
	"path/filepath"
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
	LogLevel  string `json:"log_level"`
	PublicURL string `json:"public_url"`
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

	if c.PublicURL, err = parsePublicURL(opts.PublicURL); err != nil {
		return Config{}, err
	}
	return c, nil
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
