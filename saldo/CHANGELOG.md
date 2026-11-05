# Changelog

## Unreleased (0.3)
- Sync engine: a nightly sync around 04:00 that catches up after a restart or a Home Assistant backup, retries a failed night with backoff, and syncs every account on its own. "Nu synchroniseren" and the first sync after linking run in the background; the web app follows them. A pending transaction is replaced when the bank books it, and a failed sync deletes nothing. The database copy kept before this update protects the one data change: older duplicate balances of the same day are merged.
- Reminders: e-mails "Koppeling verloopt" at 14 and 3 days and "Synchronisatie gestopt" (consent lapsed, or no good sync for 3 days), each sent once; a red alert on Start for a stopped sync.

## 0.2.2
- Fix: Bankkoppelingen and Meer failed with an error as soon as the Enable Banking key was saved. A link that is not finished yet has no consent dates, and the pages tried to show them. They now show "Niet afgerond".

## 0.2.1
- Fix: Rekeningen failed with an error for a user without accounts (for example before the first bank link), because the accounts list answered `null` instead of an empty list. It now shows "Nog geen rekeningen".

## 0.2.0
- First add-on build: the Go server with its database, health check and the web app shell.
- Sign-in: e-mail and password plus an 8-digit e-mail code, trusted devices (90 days), first-admin setup link in the log, invitations, admin reset links and admin recovery. New options for the mail server (`smtp_*`, STARTTLS or TLS only) and `admin_recovery`.
- Bank link: Enable Banking application id and key under Instellingen (stored sealed with a key file in `/data`), Bankkoppelingen with the linking wizard and re-authorisation, the first sync of transactions and balances, "Nu synchroniseren". Redirect URL to register at Enable Banking: `<public_url>/bankkoppelingen/terug`.
- Security: `Secure` cookie behind Cloudflared, HSTS with an https `public_url`, sign-in links kept out of the log, Go 1.27.3 toolchain. See `docs/security-baseline.md`.
- Not yet checked against a real bank: the Enable Banking client is built from the public docs (spike S1 comes next), so link a bank only after that check and the security checklist in the add-on documentation.
