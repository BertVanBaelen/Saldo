# Bank connection, consent and sync

Analysis: 4.1, 6.1, 6.2, 6.4, risks 2–5b · Data: `provider_connection`, `account_source`, `balance_snapshot` · Screens: [bank-koppelen](../screens/bank-koppelen.md), [rekeningen](../screens/rekeningen.md), [start](../screens/start.md), [meer](../screens/meer.md) · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-5](../../plan/v0.1-mockup/05-emails-and-push.md), [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.2-1](../../plan/v0.2-foundation/01-spike-enable-banking.md), [0.2-5](../../plan/v0.2-foundation/05-web-app-and-fake-bank.md), [0.3-1](../../plan/v0.3-bank-sync/01-provider-adapter.md), [0.3-2](../../plan/v0.3-bank-sync/02-linking-flow.md), [0.3-3](../../plan/v0.3-bank-sync/03-sync-engine.md), [0.3-4](../../plan/v0.3-bank-sync/04-consent-reminders.md), [0.5-1](../../plan/v0.5-shared-accounts/01-membership-and-lifecycle.md), [0.8-3](../../plan/v0.8-notifications/03-triggers-and-scheduler.md), [1.0-2](../../plan/v1.0-release/02-security-review.md), [1.0-3](../../plan/v1.0-release/03-first-real-sync.md)

## Provider facts (Enable Banking)
- Free restricted production mode, own accounts, non-commercial. Each user registers **their own** app (application id + private key PEM, stored encrypted).
- JWT RS256, max 24 h. Consent `valid_until` max ~180 days, **no refresh**: the user re-authorises (SCA in the Argenta app, Digipass or itsme).
- Full history only shortly after consent, later ~90 days. Background fetches ~4 per day per bank.
- Account ids change per session: match by IBAN. Argenta exposes current accounts only (no savings, no credit cards).

## Linking flow (6.2)
1. One-time setup per user: application id + PEM key in settings. Redirect `https://<domain>/api/bank/callback`.
2. Start: `POST /auth` with max `valid_until` and a random single-use `state` bound to the session (15 min).
3. Consent at the bank, the user picks accounts.
4. Callback: reject unknown, expired or reused `state` or a session mismatch. Create the session, list accounts.
5. Match each IBAN: create (user becomes manager) or offer to join ([shared-account](shared-account.md)).
6. First sync with `strategy=longest`, then nightly.
7. Re-authorise repeats 2–6 on the same connection.

## Sync
- Nightly around 04:00, incremental. "Sync now" button, rate limited.
- Stores the bank balance per account. Pending transactions are marked and left out of category totals.
- Handles pagination and `EXPIRED_SESSION`. A failed sync shows a status per account and never deletes data.
- Provider adapter: `ListAccounts`, `FetchTransactions`, `FetchBalances`. A **fake provider** serves demo data for development and tests.

## Consent reminders
In-app banner, email and push at **14 and 3 days** before expiry, and "Synchronisatie gestopt" when lapsed or failing. Reminders go to every member who holds a connection.

## In the design
- Start alert (warn): clock icon, "Toestemming verloopt over 12 dagen" / "Argenta · opnieuw autoriseren".
- Sync button (44 px, refresh icon) spins while syncing; a 3 px green progress bar runs over the top; toast "Bijgewerkt · 2 nieuwe transacties". Account subtitle "Argenta · vandaag 04:02", "Synchroniseren…", "Argenta · zojuist".
- Meer: "Bankkoppelingen" subtitle in warn colour "Argenta · toestemming nog 12 dagen". Desktop sidebar shows a warn dot.
- Label style: "Laatst gesynchroniseerd vandaag 04:02".

Email copy (0.1-5): consent lasts 180 days ("Sinds 3 juni 2026", last day 30 november). After a stop, Saldo fetches the missed transactions once you reconnect. If Partner also linked the shared account, that link takes over (fallback source).

## Data
`provider_connection`: owner, provider, application id, encrypted key, session id, consent valid until, status, last sync.
