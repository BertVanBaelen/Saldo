// Command saldo is the Saldo server: a self-hosted personal finance app that
// runs as a Home Assistant add-on.
//
// Usage:
//
//	saldo [serve]     run the server (default)
//	saldo healthcheck exit 0 when the local server answers /healthz
//	saldo version     print the version
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/BertVanBaelen/Saldo/server/internal/auth"
	"github.com/BertVanBaelen/Saldo/server/internal/bank/fake"
	"github.com/BertVanBaelen/Saldo/server/internal/banklink"
	"github.com/BertVanBaelen/Saldo/server/internal/clock"
	"github.com/BertVanBaelen/Saldo/server/internal/config"
	"github.com/BertVanBaelen/Saldo/server/internal/db"
	"github.com/BertVanBaelen/Saldo/server/internal/demo"
	"github.com/BertVanBaelen/Saldo/server/internal/ledger"
	"github.com/BertVanBaelen/Saldo/server/internal/mail"
	"github.com/BertVanBaelen/Saldo/server/internal/secrets"
	"github.com/BertVanBaelen/Saldo/server/internal/server"
)

// version is set at build time: -ldflags "-X main.version=0.2.0".
var version = "0.2.0"

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve()
	case "healthcheck":
		err = healthcheck()
	case "version", "--version", "-v":
		fmt.Println(version)
	default:
		fmt.Fprintf(os.Stderr, "usage: saldo [serve|healthcheck|version]\n")
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "saldo:", err)
		os.Exit(1)
	}
}

func serve() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(log)
	log.Info("saldo starting", "version", version, "addr", cfg.Addr, "state_dir", cfg.StateDir,
		"web_dir", cfg.WebDir, "demo", cfg.Demo, "today", cfg.Today)

	clk, err := clock.New(cfg.Today)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	database, err := db.Open(cfg.DBPath())
	if err != nil {
		return err
	}
	defer database.Close()
	if _, err := db.Migrate(ctx, database, db.Migrations(), filepath.Join(cfg.StateDir, "backups"), log); err != nil {
		return err
	}

	// The key that seals the bank credentials lives next to the database, not
	// in it (analysis 7).
	box, err := secrets.Load(filepath.Join(cfg.StateDir, "secret.key"))
	if err != nil {
		return err
	}
	open := banklink.EnableBanking
	if cfg.Demo {
		open = demo.Bank
	}
	links := banklink.New(database, box, open, nil, log)

	opts := server.Options{DB: database, Version: version, Demo: cfg.Demo, Clock: clk, WebDir: cfg.WebDir, Logger: log,
		PublicURL: cfg.PublicURL, Bank: links, Syncer: links}
	switch {
	case cfg.MailLog:
		opts.Mailer = mail.Log{Logger: log}
		log.Warn("SALDO_MAIL_LOG: e-mails, including sign-in codes and links, are written to this log instead of sent")
	case cfg.SMTP.Host != "":
		opts.Mailer = mail.SMTP{Host: cfg.SMTP.Host, Port: cfg.SMTP.Port, TLS: cfg.SMTP.Security == "tls",
			Username: cfg.SMTP.User, Password: cfg.SMTP.Password, From: cfg.SMTP.From}
		log.Info("mail through SMTP", "host", cfg.SMTP.Host, "port", cfg.SMTP.Port, "security", cfg.SMTP.Security)
	default:
		log.Warn("no SMTP server configured: signing in and inviting answer 503 until smtp_host is set")
	}
	if cfg.PublicURL == "" {
		log.Warn("public_url is not set: e-mails cannot link to Saldo")
	}
	if cfg.Demo {
		if _, err := demo.Seed(ctx, database, fake.Provider{}, log); err != nil {
			return err
		}
		// The seeded demo connections hold no session to fetch with, and the
		// story has nothing after the demo date anyway.
		opts.Syncer = demo.Syncer{Store: ledger.New(database)}
		log.Warn("demo mode: every request acts as the demo user Bert, without signing in")
	} else if err := auth.New(database, nil).Bootstrap(ctx, cfg.PublicURL, cfg.AdminRecovery, log); err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(opts),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.Addr)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errc; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	log.Info("stopped")
	return nil
}

// healthcheck is for the Docker HEALTHCHECK: it calls the local /healthz.
func healthcheck() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	port, err := cfg.Port()
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthz answered %s", resp.Status)
	}
	return nil
}
