# Changelog

## 0.2.0-dev
- First add-on build: the Go server with its database, health check and the web app shell. Sign-in and the first bank link follow in the next 0.2 phases.
- Sign-in: e-mail and password plus an 8-digit e-mail code, trusted devices (90 days), first-admin setup link in the log, invitations, admin reset links and admin recovery. New options for the mail server (`smtp_*`, STARTTLS or TLS only) and `admin_recovery`.