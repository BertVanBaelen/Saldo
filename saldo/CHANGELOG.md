# Changelog

## Unreleased (0.4)
- Categories (server only, no screen yet): one category tree for everyone, two levels, with the Dutch default set added once on the first start of this version (Wonen, Boodschappen, Vrije tijd, Vervoer, Abonnementen, Overig with their subcategories; Salaris, Terugbetaling, Bijdrage, Overig inkomen). Add, rename, move, recolour and remove; removing asks where its transactions go (another category, which is also how two categories are merged, or uncategorised).
- Rules (server only): categorise by counterparty (contains or equals), counterparty IBAN, communication (contains or a regular expression) and amount range, per account or for your own personal accounts, with a priority. New synced and imported transactions get the category of the first matching rule; "apply" runs the rules over what is stored. A category you chose yourself or one from an import is never overwritten. The update adds two columns to the rules table and changes no existing data.

## 0.3.0
- Transacties: every synced transaction by day with the account colour and pending rows, search on name, amount and communication, filters for account, period and category, "Oudere transacties laden", and a read-only detail.
- Rekeningen: name, colour and minimum buffer per account, an account page with balance history, settings, sync status and recent transactions, manual accounts (savings, or a current account without a bank link) with a hand-updated balance and its history, "Rekening toevoegen", and removing your bank link while keeping or deleting the history. Removing a link waits at most 30 seconds for a running sync, then answers that it is busy and removes nothing.
- Start: the balance per account against its own buffer, Persoonlijk and Gedeeld sections with sync status, the sync button with progress, the alerts for an expiring consent and a stale or failed sync, and welcome steps that follow what you have done so far.
- CSV import (Importeren in Meer): upload a CSV, check the columns, choose the account, see the counts, import. A preset recognises the Argenta export; the file's own account and currency are checked, rows already in the account are skipped (also when the bank sync brings them later), and importing the same file again adds nothing. Every import is kept as a batch. There is no undo yet. The preset is built from the header only: check the first import against your real export.
- Fixes: "Onder de buffer" counts calendar days, an ambiguous amount in the search is ignored instead of guessed, "Deze maand" and "Dit jaar" show future-dated pending rows, and a link removed in another tab can no longer come back active.
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
