# Changelog

## 0.2.0
- First add-on build: the Go server with its database, health check and the web app shell.
- Sign-in: e-mail and password plus an 8-digit e-mail code, trusted devices (90 days), first-admin setup link in the log, invitations, admin reset links and admin recovery. New options for the mail server (`smtp_*`, STARTTLS or TLS only) and `admin_recovery`.
- Bank link: Enable Banking application id and key under Instellingen (stored sealed with a key file in `/data`), Bankkoppelingen with the linking wizard and re-authorisation, the first sync of transactions and balances, "Nu synchroniseren". Redirect URL to register at Enable Banking: `<public_url>/bankkoppelingen/terug`.
- Security: `Secure` cookie behind Cloudflared, HSTS with an https `public_url`, sign-in links kept out of the log, Go 1.27.3 toolchain. See `docs/security-baseline.md`.
- Not yet checked against a real bank: the Enable Banking client is built from the public docs (spike S1 comes next), so link a bank only after that check and the security checklist in the add-on documentation.
