# Self-hosted finance app: analysis

Status: **v1.1.** Updated with the decisions from the Saldo design canvas: screens, account groups, planning, emails and notifications. Remaining **[verify]** items are small checks against the real bank, the real Bilance file and push notifications on a real Android phone (see sections 9 and 13.1). They don't block development.

## 1. Goal

A self-hosted replacement for Bilance that runs as a **Home Assistant add-on**, so all finance data stays on your own server and is covered by HA backups.

The core question the app must answer:

> *"Will I have enough money at the end of each coming month, and how much is left or short?"*

### Scope

| Version | Scope |
|---|---|
| **v1** | Automatic bank sync, categorisation, personal and shared accounts, overview of past months, planning and forecast of coming months |
| **v2** | Investments: current value and net worth per platform (Saxo, Curvo, Revolut, Trade Republic, Argenta funds) |
| **Out of scope** | Credit cards (Argenta does not expose them), multi-currency, payments or initiating transfers, business accounting |

## 2. Users and privacy model

- Two users: you and your partner, **each with their own login**.
- **Everyone sees only the accounts they added themselves** (linked through the bank, joined by IBAN, or created manually), and only figures calculated from those accounts. There are no invitations to see someone else's account and no figures shared across users.
- A **personal account** is therefore visible only to the user who added it.
- A **shared account** is grouped by IBAN. The first holder who links it is the **manager**. Another holder who links the same IBAN joins the group automatically (after confirmation) and from then on sees it too. Each member gets **read** or **edit** access, set in the account's settings.
- The **admin** role manages users only (invite, reset password). It never gives access to another user's accounts.
- Visibility is enforced **server-side in every query**, not only in the UI. Every overview, forecast, search and export is calculated from the viewer's own accounts only.
- Notifications and emails follow the same rule: you only get messages about accounts you can see.

## 3. Accounts and data sources

| Account | Owner | Source in v1 | Notes |
|---|---|---|---|
| Argenta zichtrekening (you) | you | Bank API (Enable Banking) | Fully supported |
| Argenta zichtrekening (partner) | partner | Bank API (her own Enable Banking app) | Fully supported |
| Argenta shared account | manager: you. Co-holder: your partner | Bank API, linked by you, optionally also by your partner as a fallback | One account per IBAN, no duplicates (see 6.3) |
| 2 Argenta savings accounts | you | **Manual balance** | Argenta's PSD2 API exposes only current accounts, not savings. The IBAN can be registered so transfers to it are recognised |
| Argenta beleggingsfondsen | you | v2: manual or import | Not exposed by the API |
| Saxo, Curvo, Revolut, Trade Republic | you | v2: manual or import | Saxo has an OpenAPI (v2 research, not blocking). Trade Republic has only unofficial APIs, which are fragile |

**Savings in v1:** a transfer from the zichtrekening to a savings account is recorded as a transfer *to savings* and counted as **saved**, not as an expense. You update the savings balance occasionally by hand, and the app keeps a balance history with a "last updated" date.

## 4. Functional requirements (v1)

Priority: **M** = must, **S** = should, **C** = could.

### 4.1 Bank sync (M)
- Link accounts through Enable Banking with **per-user credentials** (each user registers a free app and links their own accounts). The shared account is linked by its manager, and optionally by other holders as a fallback. The flow is in 6.2.
- First sync fetches the longest available history (`strategy=longest`). Later syncs run **nightly** (around 04:00) and fetch only new data. A **"Sync now"** button exists, rate-limited, because banks limit background calls.
- Each sync also stores the **bank-reported balance** per account (`balance_snapshot`). The forecast starts from this balance, not from a sum of transactions.
- **Pending** transactions are shown with a "pending" mark and are left out of category totals until they are booked.
- Handle pagination and expired sessions (`EXPIRED_SESSION`). A failed sync shows a clear status per account and never deletes data.
- Show consent status per account. Warn **before** the consent expires (about every 180 days) with an **in-app banner, an email and a push notification** (see 4.9), at 14 and at 3 days before expiry. When the consent has lapsed, the user gets a "sync stopped" message.
- Generic **CSV import** as fallback and for history (Argenta export, and the Bilance export, which is also a CSV file), see 4.6. M1 delivers the basic import. The category mapping wizard arrives with the Bilance import in M6.

### 4.2 Categorisation (M)
- One **category tree shared by all users** (names and types only, no amounts). Start from a sensible Dutch default set, editable. Types: income, expense. Internal transfers are not categorised, they are recognised (5.2).
- **Rules** match on counterparty name or IBAN, communication text (regex) and amount range, with priorities. Rules belong to an **account** (rules of a shared account are shared by its members with edit access) or to a **user** (applies to that user's personal accounts only).
- **Precedence:** manual choice, then the highest-priority matching rule, then the learned suggestion. Re-running rules **never overwrites a manual choice**.
- **Learning:** build rules and suggestions from historical data, mapping a counterparty to its most frequent category. Show a confidence level. Low-confidence suggestions are shown for confirmation, not applied silently.
- **Manual override**, with the option "apply to similar transactions and create a rule".
- Splitting one transaction over several categories **[S]**.

### 4.3 Shared account and transfers (M)
- Recognise **internal transfers** between accounts the *same user* can see, and exclude them from income and expenses in that user's combined views.
- Your monthly transfer to the shared account is an internal transfer in your combined view, and an **outgoing recurring item** when you look at your personal account alone.
- Contributions from another member's personal account show up in the shared account as **income** from an IBAN you can't see behind. A rule labels them as a contribution.
- Show the required monthly contribution of the shared account (see 5.3).

### 4.4 Overview of past months (M)
- Period picker with month, quarter, year and custom range. History reaches back **as far as the data goes**.
- A transaction belongs to the month of its **booking date** (Europe/Brussels). A custom "month starts on day N" (for example the salary day) is a **[C]** extra.
- Per category: totals, share of spending, trend versus previous periods, drill-down to transactions.
- Per month: **income, expenses and saved** (transfers to savings accounts). Internal transfers are excluded.
- Filter by account, or by a group of your own accounts (personal, shared, all mine).

### 4.5 Planning and forecast (M)
- Default horizon **3 months**, extendable on request (up to 24 months).
- Hybrid method:
  1. **Recurring items** (salary, rent, subscriptions, insurance, taxes) are detected from history and **confirmed by you**. Detection looks for the same counterparty, a similar amount (within about 10%) and a regular interval (monthly, quarterly or yearly) with at least 3 occurrences (2 for yearly **[verify with real data]**). A confirmed item has an expected day, an amount (fixed or average), a frequency and an optional end date.
  2. **Variable categories** use your budget or the average of past months. Amounts already covered by a recurring item are **not counted again** here.
  3. **One-off planned items** are added manually (for example a holiday or a tax bill).
- Output per coming month and **per account group** (see 5.3): expected income, expected expenses, saved, projected end balance, and **left or short** against that group's own buffer.
- **Account groups:** all personal current accounts of a user are merged into one group, "Persoonlijk". Every shared account is its own group, shown with its own name. Each group has its own buffer (the sum of the buffers of its accounts). Groups are **never added together** in a chart, a buffer check, a warning or a month budget, because they are different accounts with different buffers.
- **Scope switch** Alles · Persoonlijk · Gedeeld on every main screen (Start, Transacties, Overzicht, Planning). In Alles the groups are shown side by side: one chart, one summary and one breakdown per group. Transfers between your own accounts are left out of income and expenses.
- **Calendar** per month: what comes in and goes out on each day, and a **daily balance line per group** (5.3) with a zero line and a dashed buffer line. A day or chart zone turns **yellow** when a group is in its buffer and **red** when it is below zero. In Alles a calendar day takes the worst state of the groups. Sliding over the chart moves the selected day in the calendar.
- **Plan a one-off from the calendar:** an expected **expense or income** on a chosen day, with a description, an amount and the account it lands on (in Alles you choose, in Persoonlijk or Gedeeld it is fixed). The form previews that account's end-of-day balance before saving. Planned items show in the calendar, the Eenmalig list, the month budget and the forecast, and can be removed again.
- **Month budget** (tab "Budget"): per group, how much is still **free to spend** this month once everything still expected is subtracted (formula in 5.3), with a month switcher and the budgets per category below it. A small summary per group sits at the top of Planning and opens this tab.
- **Warnings from the forecast:** a group that goes into its buffer gives a **warning** (yellow), a group that goes below zero gives an **error** (red). They show as alerts on Start and as notifications (4.9).

### 4.6 Importing history (CSV, including the Bilance export) (M)
- Bilance exports its history as a **CSV file**. It goes through the same CSV import as any other file, with a saved "Bilance" preset for the columns and the category mapping.
- Import runs as a **wizard** with a preview before anything is written: pick the file, map the columns (date, amount, counterparty, communication, category, account), choose the target account.
- **Category mapping step:** the wizard lists every distinct category found in the file, with the number of transactions and the total amount. For each one you choose:
  - **Map to an existing category** of the app. The app suggests a match by name similarity, and you can override it.
  - **Create a new category** with that name.
  - **Merge** several source categories into one app category, for example many detailed Bilance categories into one.
  - **Leave uncategorised**, so the rules and learning (4.2) decide.
- Bilance subcategories or category paths (for example `Parent > Child`) are mapped on the **full path** by default. The wizard also offers "map by parent" to map all children of a parent at once, since the exact column layout and category format of the Bilance CSV are still unverified **[verify]**.
- **Mappings are saved** per source ("Bilance") and reused on the next import, so a later file needs no new mapping. You can edit a mapping afterwards.
- Changing a mapping can be **re-applied** to the already imported transactions of that import.
- **Overlap with synced data:** the bank API only returns recent history, so a Bilance file usually overlaps with transactions already synced. The wizard suggests an **import cutoff** (the first synced date of the target account). Rows that look like an existing transaction (booking date within one day, same amount, similar counterparty) are shown as **probable duplicates** and skipped by default. For a skipped duplicate, the Bilance category can be applied to the existing transaction if that one is still uncategorised.
- Every import is a **batch**. You can undo a whole batch, and re-importing the same file does not create duplicates (dedupe key from 6.3).
- Imported categories feed the learning in 4.2 as training data, once they are mapped.

### 4.7 Other
- Manual transactions and manual accounts **[M]**, needed for savings.
- Export of all data to CSV and JSON **[S]**. An export contains only the viewer's own accounts.
- Dutch UI **[M]**, English code and documentation. Dutch (Belgium) number, date and currency format.

### 4.8 Account and data lifecycle (M)
- **Remove a bank link:** disconnects the consent. You choose to keep or delete the stored history of that connection's account.
- **Remove an account from your login:** you lose access. A shared account stays for the other members. If the manager leaves, the **manager role passes to the longest-standing member**. An account without members is deleted after confirmation.
- **Delete a user:** the admin removes the login. That user's personal accounts and manual accounts are deleted, shared accounts stay with the remaining members.
- **Members and links:** any member can add or remove **their own** connection as a fallback source. Only the manager can change permissions or remove the account for everyone.

### 4.9 Notifications and email (M)
- Two channels: **push notifications** to the installed PWA (Web Push) and **email** (SMTP from the add-on options). Each user turns each channel on or off, and chooses per type which channels it uses.
- Types and defaults:

| Type | Sent when | Push | Email |
|---|---|---|---|
| Rekening staat rood | The forecast puts a group below € 0 within the look-ahead | on | on |
| Rekening komt in de buffer | The forecast puts a group below its buffer within the look-ahead | on | off |
| Koppeling verloopt | 14 and 3 days before a consent expires | on | on |
| Synchronisatie gestopt | A consent lapsed or the sync keeps failing | on | on |
| Iemand sluit aan | Someone joins a shared account you manage | on | on |
| Bijdrage ontbreekt **[C]** | A member's contribution to a shared account hasn't arrived by the 3rd | off | off |
| Te categoriseren | New uncategorised transactions, at most once a day at 19:00 | on | off |

- **Always by email, cannot be turned off:** login code, invitation, password reset link.
- **Look-ahead** for the planning warnings: 1, 3 (default) or 6 months. One message per group, per month and per state, sent the morning after the forecast changes, so not every day again.
- **Quiet hours** for push, default 22:00 to 07:00. A **test notification** button in the settings.
- Messages about an account always **name the account**: its name, personal or shared, and the masked IBAN (for example `BE68 •••• •••• 4821`). The email subject names it too.
- **Push content:** title, one line and the key amount (for example `−€ 1.033`). The red planning notification expands to a small chart of the coming months. On the **lock screen** no amounts or account names are shown **[verify]** (risk 14).
- **Android status-bar icon:** a one-colour silhouette of the app icon (the coin peeking from the wallet), 24 × 24 dp with 2 dp margin, delivered as a vector. The colour of the notification circle follows the type: green for info, ochre for a warning, red for an error.
- **Email style:** a white card with the Saldo logo, a short label and the key amount or code in the colour of the type, an account block (see above), a details table, one green button, and a footer that says why you get the email, with a link to the notification settings (not on login, invitation and password emails). Templates in v1: login code, planning red, planning in the buffer, link expires in 14 days, link expires in 3 days, sync stopped, invitation, member joined, new password. Dutch, with a plain-text part. Sender `saldo@<your-domain>`.

## 5. Calculation rules

### 5.1 Money
- Amounts are stored as **integer minor units (cents)** with currency EUR. Never floats.
- Dates are stored with the bank's booking and value date. "Month" means calendar month in Europe/Brussels.

### 5.2 Transfer detection
Detection is evaluated **per viewer, at query time** (volumes are small). A transaction is an internal transfer for a user when:
- the counterparty IBAN is an account **that user can see** (their personal accounts, shared accounts they joined, or their registered savings accounts), or
- a matching amount with the opposite sign exists on another account that user can see, within about 3 days.

The other user's personal accounts are never used for matching, so a counterparty IBAN is never replaced by a label that reveals them.

Special case: a transfer **to a savings account** is always shown as **saved** (not as expense, and not hidden). The user can mark any transaction as "is a transfer" or "is not a transfer" **[S]**. That choice is stored per user.

### 5.3 Forecast (per month `m`, per account group)
**Scope:** an **account group** (4.5): the user's personal current accounts together, or one shared account. Only **current accounts** (zichtrekeningen) count as available money. Savings accounts are not part of it. "Alles" shows the groups side by side and never adds their balances, buffers or warnings together for a verdict.

**Starting balance:** the latest bank-reported balance of every account in the group (manual accounts: the last manual balance). In a group with several accounts, transfers between them net to zero and are left out of the formula.

```
projected_end(m) = projected_end(m-1)
                 + confirmed_recurring_income(m)
                 - confirmed_recurring_expenses(m)
                 - variable_expenses(m)        # budget, or average of past months, minus what recurring items already cover
                 + one_off_planned(m)          # signed
                 - saved(m)                    # recurring transfers to savings
                 - transfers_out(m) + transfers_in(m)   # only transfers that leave or enter the group

left_or_short(m) = projected_end(m) - buffer(group)     # sum of the minimum buffers of the accounts in the group
```
- **Daily line (calendar):** `balance(d) = balance(d-1) + items expected on day d - variable spending of day d`. Items are recurring items on their expected day and planned one-offs. Variable spending is spread evenly over the days: for the current month the remaining budget over the remaining days. A day is **in the buffer** when `balance(d) < buffer(group)`, and **red** when `balance(d) < 0`. The lowest point of the month is shown.
- **Free to spend (month budget):**

```
free(m, group) = balance today (current month) or projected start balance (future month)
               + income still expected this month
               - fixed costs still to pay
               - one-off and planned items still to come
               - remaining budget per category      # budget minus what is already spent
               - transfers to savings still to come
               - buffer(group)
```
A negative result is shown as **Tekort**.

- **Shared account:** required contribution per month = projected shared expenses minus shared income other than member contributions. The split between members is a **fixed percentage the members agree on** (default equal). A split proportional to income is not possible, because you can't see your partner's income.
- The app shows a **per-month breakdown** so every number can be explained, and marks a month **in the buffer** (yellow, a warning) when `left_or_short` is negative, and **negative** (red, an error) when `projected_end` itself is below zero.

## 6. Bank connection (Enable Banking)

### 6.1 Provider facts
Verified in the provider's docs and Argenta's own PSD2 page:

- **Free restricted production mode:** own accounts, non-commercial use. Only accounts you link are returned.
- Auth: JWT signed RS256 with the app's private key, 24 h maximum lifetime.
- **Consent:** `valid_until` is set at authorisation, normally maximum 180 days, **no refresh**: the user re-authorises. Argenta SCA happens in the Argenta app, Digipass or itsme.
- **History:** full history is available only briefly after consent. Often only about 90 days afterwards.
- **Background fetching** is limited (about 4 per day per bank), so a nightly sync is enough.
- The API returns **data, not PDF statements**.
- Account IDs change per session, so match accounts by IBAN (Argenta provides it).

### 6.2 Linking flow
1. **One-time setup per user:** register a free Enable Banking app in restricted production mode, then enter the **application ID** and upload the **private key** (PEM) in the app's settings. The key is stored encrypted (see section 7). The redirect URL is `https://<your-domain>/api/bank/callback`.
2. **Start linking:** the user picks Argenta. The server calls `POST /auth` with the maximum `valid_until` and a random `state` bound to the user's session, valid for 15 minutes and single use. The user is sent to the bank.
3. **Consent at the bank:** strong authentication in the Argenta app, Digipass or itsme. The user selects the accounts to share.
4. **Callback:** the bank redirects to the callback with a code and the `state`. The server rejects an unknown, expired or reused `state` and any callback that doesn't match the logged-in user. It then creates the session and lists the accounts.
5. **Account matching:** for each returned IBAN, the app either creates the account (the user becomes manager) or offers to **join** an existing shared account (see 6.3).
6. **First sync** with `strategy=longest` runs immediately, then the nightly sync takes over.
7. **Re-authorisation** repeats steps 2 to 6 for the same connection. Accounts are matched by IBAN, so nothing is duplicated.

The callback is the only endpoint that must be reachable from the bank. It needs the user's session, so it is not an open endpoint.

### 6.3 Shared account: manager, members, automatic grouping
- Accounts from the bank are keyed by **IBAN** (unique among bank-linked accounts). If a user links an IBAN that already exists, the app does **not** create a second account. It offers "this account already exists, join it?", and after confirmation adds the user to the existing account's group and notifies the other members.
- Linking is proof of holder rights, because the bank only lets a holder authorise it (SCA in the Argenta app). So nobody can join an account they don't hold. Joining gives access to the stored history of that account, and the manager is notified.
- Access per member is **read** or **edit**, set in the account's settings by the manager. **Read** means view only. **Edit** also allows recategorising, splitting and annotating transactions, and managing the recurring items, budgets and rules of that account. The default for a joining co-holder is **edit**. Who may add or remove links and the account itself is in 4.8.
- Each account has one **primary sync source** (a connection). Other connections of the same IBAN are **fallback** sources: they take over automatically when the primary consent lapses, and they fill gaps. This removes the single-manager dependency without double-importing.
- Transactions from different connections are merged on the dedupe key: account IBAN + booked `entry_reference`, falling back to a hash of date, amount, counterparty and communication. The `entry_reference` may differ between connections, so the fallback hash is used when matching across them. Identical same-day transactions (two coffees) are kept by counting occurrences per hash.
- Re-authorise reminders go to every member who holds a connection. Members with read-only access also see "last synced" so they notice a stale account.
- A transfer from the partner's personal account to the shared account appears on **both** accounts (outgoing on hers, incoming on the shared one). You only see the incoming side, as income from an IBAN. That is a transfer, not a duplicate (see 5.2).
- Manual accounts (savings) are **private to the user who created them**. A manual account may have an IBAN **only to recognise transfers** to it. That IBAN is never used for grouping or joining, and several users may register the same one. Sharing manual accounts is not supported in v1.

### 6.4 Provider adapter
Bank access sits behind a small interface (`ListAccounts`, `FetchTransactions`, `FetchBalances`). Providers can then be swapped, and CSV import uses the same pipeline.

## 7. Non-functional requirements

### Security
- Public access through the **Cloudflared** add-on on your domain. Sign-in:
  - **Email and password, then a code by email** (8 digits, valid 10 minutes, single use, stored hashed, 5 attempts, send-rate limit).
  - **No self-registration.** The first admin is created through a one-time setup link in the add-on log (valid 1 hour). Others are invited by email.
  - **No "forgot password" link** on the sign-in page, because email is already the second factor. An admin sends a reset link. An **admin recovery** option in the add-on settings covers a locked-out sole admin.
  - **SMTP settings** in the add-on options, encrypted connections only (STARTTLS or TLS).
  - Optional **Log in with Home Assistant**, still followed by the email code.
  - Rate limits per IP and per account, common-password blocklist, no account enumeration.
- A compromised email account weakens the second factor. This is accepted.
- Passwords hashed with argon2id, sessions with short lifetimes, CSRF and CSP protection, audit log of logins, failures, code sends, account joins and data exports.
- Enable Banking private keys and tokens are **encrypted at rest** with a key generated on first start and stored apart from the database file. This protects against a leaked database file. It does **not** protect against a leaked full add-on backup, because the key is in `/data` too. So **HA backups must be encrypted**, and that is the real protection.
- Minimal dependencies, no third-party analytics. Outbound traffic only to the bank provider, to the SMTP server, to the browser's push service (Web Push, with VAPID keys generated on first start), and in v2 to price sources.

### Reliability
- HA cold backup (add-on stops while backing up).
- Schema migrations, health endpoint, structured logs.
- Tests for the **forecast, transfer detection and categorisation** logic, since errors there silently produce wrong numbers.

### Data volume
A few thousand transactions per year, so **SQLite** is more than enough.

## 8. Architecture

- **Go server** with a pure-Go SQLite driver (`modernc.org/sqlite`) and a **Vite + TypeScript web app** installed as a PWA (responsive, phone-friendly).
- Building blocks in this repository: add-on skeleton (`config.yaml`, Dockerfile, CI and release workflows), `accounts`, `auth`, `mail`, `ratelimit`, `config`, `db`, `backup` and `homeassistant` packages, the Home Assistant login option, Cloudflared exposure, cold backups, NL/EN translations, and a static HTML mockup folder (`finance-mockup`).
- The finance app is a **separate app** with its own repository and add-on folder, released and backed up on its own.
- A **fake bank provider** implements the same adapter as Enable Banking. It serves seeded demo data for the mockup, local development and automated tests, so no real bank data is needed during development.
- Modules:
  1. `auth` / `users`
  2. `bank` (provider adapter, Enable Banking, fake provider)
  3. `ledger` (accounts, access, transactions, dedupe, transfers)
  4. `categorise` (rules, learning)
  5. `planning` (recurring items, budgets, forecast)
  6. `importers` (CSV, with a Bilance preset)
  7. `reports`
  8. `notify` (email templates, Web Push, preferences, quiet hours, repeat protection)

### Data model sketch
Money is stored in cents. Every table that holds financial data is reached only through `account_access`.

| Table | Key fields |
|---|---|
| `user` | email, password hash, role (admin or user), language, planning look-ahead (months), quiet hours, created at |
| `session`, `login_code`, `audit_log` | session: user, token hash, expiry. Login code: user, code hash, attempts, expiry. Audit log: event, user, IP, time |
| `provider_connection` | owner user, provider, application id, encrypted private key, session id, consent valid until, status, last sync |
| `account` | type (current, savings, investment), source (api or manual), IBAN (unique among api accounts), name, **colour**, **minimum buffer** (cents, current accounts only), currency, created by |
| `account_access` | account, user, role (manager or member), permission (read or edit) |
| `account_source` | account, provider connection, priority (primary or fallback) |
| `transaction` | account, amount (cents), booking date, value date, counterparty name and IBAN, communication, status (pending or booked), external id (`entry_reference`), dedupe key, source (connection or import batch), **raw payload** (original JSON/CSV row), category |
| `balance_snapshot` | account, balance (cents), date, origin (bank or manual) |
| `category` | name, parent, type (income or expense), shared by all users |
| `category_mapping` | source, source category (full path), target category |
| `import_batch` | source, file hash, account, created by, created at, undone at |
| `rule` | owner (account or user), priority, match conditions, category |
| `recurring_item` | owner (account or user), counterparty, amount rule, frequency, expected day, end date, kind (income, expense, transfer, saving) |
| `budget` | owner (user and scope), category, monthly amount |
| `planned_item` | account, created by, date, amount (signed: an expense or an expected income), description |
| `transfer_override` | user, transaction, is transfer (yes or no) |
| `notification_pref` | user, type, push (on or off), email (on or off) |
| `push_subscription` | user, endpoint, keys, device name, created at, last used |
| `notification_log` | user, type, account group, month, state, channel, sent at (prevents repeats) |

Not stored: transfer pairing. It is computed per viewer (5.2).

## 9. Risks and checks

| # | Item | Impact | Action |
|---|---|---|---|
| 1 | **Bilance export:** Bilance exports to **CSV**. The exact columns, category format, dates and amounts are **unverified** | History import | Export a real file and inspect it (spike S2) |
| 2 | **Enable Banking terms** in restricted mode and linking each person's own accounts | Partner sync | Each of you registers an app. Verify with Argenta (spike S1) |
| 3 | History depth from the API is probably about 90 days | Long history | Rely on import for old data. Store everything from the first sync onward |
| 4 | Consent expires about every 180 days, with no refresh | Sync stops silently | Expiry reminders (in-app and email) and clear status in the UI |
| 5 | A new consent may expire the previous one (Belgian notes). Unclear for Argenta | Sync breaks | Test in spike S1. Link your personal and shared account in **one** consent |
| 5b | The shared account's sync depends on its primary connection. If that consent lapses and no fallback exists, the data goes stale | Shared forecast goes stale | If both partners link the account, the fallback source takes over. Otherwise notify the manager and show "last synced" |
| 6 | Email is the only second factor | A compromised mailbox compromises sign-in | Accepted. Use a mail account with its own 2FA |
| 7 | **Data leaking between users:** IBAN matching on join, transfer detection, search, exports | Privacy | Every query is scoped to the viewer's accounts. Add automated tests that user A never sees user B's accounts, balances, counterparties or transfers |
| 8 | Savings balances are manual | Possibly stale numbers | Show the "last updated" date |
| 9 | Learning from Bilance history needs the Bilance import, which is late in the build order | Early categorisation is weaker | Start with rules and backfill suggestions after the import (M6) |
| 10 | The category structure and column layout of the Bilance CSV are unverified | Import wizard design | Build the wizard around "distinct values in a column". Verify the real file in spike S2 |
| 11 | Bilance history overlaps with bank-synced transactions | Duplicates, double counting | Import cutoff and probable-duplicate detection (4.6) |
| 12 | The forecast is only as good as the confirmed recurring items | Wrong "left or short" | Show the per-month breakdown, mark unconfirmed items clearly, test with real history |
| 13 | A public endpoint holds banking data | Attack surface | Hardening as in section 7, security review before the first real bank link (13.4) |
| 14 | A PWA cannot set the lock-screen visibility of its notifications. Hiding amounts there depends on Android's setting for sensitive notifications | Amounts readable on a locked phone | Test on a real phone. If it can't be controlled, leave amounts out of the push text, or send through the Home Assistant companion app, which supports private notifications **[verify]** |
| 15 | Too many warnings | Warnings get ignored | One message per group, month and state, quiet hours, settings per type and channel |
| 16 | A partner who sees only the shared account may read the "Alles" totals as a household total | Wrong conclusions | Totals across groups are only shown as information. Every verdict (buffer, red, free to spend) is per group |

## 10. Roadmap (your priority order)

Each milestone ends with something you can use. Spikes are short checks, not features.

| Milestone | Content | Done when |
|---|---|---|
| **S1** (spike) | Verify Enable Banking with your real Argenta account: restricted mode, partner's own app, two consents, history depth, shared account IBAN. Read-only script, nothing stored | You know what the API returns and which assumptions in 6.1 hold |
| **S2** (spike) | Export your history from Bilance as CSV. Inspect the file: columns, category format, dates, amounts | Bilance CSV preset known, 4.6 adjusted |
| **M0** | Project skeleton: add-on, auth with email code, users, database, CI, fake bank provider | You can sign in on your domain and run it as an add-on |
| **M1** | **Bank sync** (Enable Banking per user) and **CSV import**: accounts, transactions, dedupe, balances, consent reminders | Your real Argenta transactions appear and re-sync without duplicates |
| **M2** | **Categorisation:** categories, rules, manual override | A month of transactions is categorised with few manual fixes |
| **M3** | **Shared account and transfers:** account membership, per-viewer visibility, transfer detection | Your partner links the shared account, joins the group, and sees only her accounts |
| **M4** | **Overview of past months:** period picker, categories, trends | You can answer "what did we spend per category last quarter" |
| **M5** | **Planning and forecast:** recurring items, budgets, one-offs, 3-month projection | The core question in section 1 is answered for the next 3 months |
| **M6** | **Bilance history import** (CSV) with the category mapping wizard, import batches with undo, overlap handling, learned category suggestions, backfill | Your Bilance history is in, mapped to your categories, without duplicates |
| **v2** | Investments: manual or imported values per platform, net worth, optional price lookups by ISIN | Net worth per platform is visible |

## 11. Decision log

| Topic | Decision |
|---|---|
| Users | Two logins. Everyone sees only the accounts they added and figures from those. A shared account has a manager and members, grouped automatically by IBAN when a second holder links it. Each member has read or edit access, set in settings (default edit). Admin manages users only |
| Hosting | Custom Home Assistant add-on, covered by HA backups |
| Stack | Go server + Vite/TypeScript PWA |
| Access | Public domain via Cloudflared. Sign-in with email and password plus a code by email |
| Bank provider | Enable Banking, each user with their own app |
| Forecast | Hybrid: recurring items, budgets or averages, one-offs. Default 3 months, longer on request |
| History | As long as possible, via import |
| Categories | One tree shared by all users. Rules + learning + manual override (manual wins). Bilance categories are mapped onto the app's own categories during import |
| Savings | Manual balances in v1. Transfers to savings count as "saved" |
| Shared funding | Fixed monthly transfers from each personal account. Contribution split is a fixed percentage, default equal |
| Consent reminders | In-app banner, email and push, 14 and 3 days before expiry |
| Repository | Own repository for the finance app, a separate app and add-on |
| v2 investments | Current value and net worth per platform |
| UI | Dutch, responsive PWA, Belgian number and date format |
| Name | Saldo |
| Look | Base green `#15803D`, calm layout with more colour (pastel category colours), Geist and Geist Mono, light and dark mode on every screen |
| Brand | App icon "Beurs": a coin peeking from a wallet. The Android status-bar icon is its silhouette |
| Accounts in the UI | Personal in green with a person icon, shared in violet (`#5B3FD9`) with a two-person icon, a label on every transaction and planned item. Every account has its own colour (8 to choose from) and its own buffer, set under Rekeningen |
| Account groups | Personal current accounts are merged into one group, every shared account is separate. Charts, buffers, warnings and month budgets are per group, never added together |
| States | Yellow: in the buffer (warning). Red: below zero (error). Same colours in the app, emails and notifications |
| Start | The big number is the actual balance now ("Saldo nu"), not a forecast. Planning warnings and errors show as alerts |
| Planning | Tabs Kalender · Maanden · Terugkerend · Eenmalig · Budget. A one-off can be an expense or an expected income. Summary per group at the top |
| Notifications | Push via the PWA and email, chosen per type and channel. Push shows title, one line and the amount. Email is a white card with the key figure in the colour of the type |

## 12. Screens for the mockup

**Navigation:** mobile bottom tabs **Start · Transacties · Overzicht · Planning · Meer**. On desktop the same items in a left sidebar, a "Beheer" group (Rekeningen, Bankkoppelingen, Categorieën, Importeren, Instellingen) and the user at the bottom. On the phone these live under **Meer**, together with Meldingen and Weergave.

**Look:** mobile first, Dutch labels (glossary in section 14), amounts as `€ 1.234,56`. Personal is green with a person icon, shared is violet with a two-person icon, and every account has its own colour. Yellow means in the buffer, red means below zero. Light and dark mode for every screen. Subtle loading and transition animations that respect "reduce motion". The design canvas **Saldo – ontwerp** holds the style sheet, the app icon, clickable phone and desktop screens, the emails and the notifications. The mockup follows it.

| # | Screen | Content | Design |
|---|---|---|---|
| 1 | **Inloggen** and **Code** | Email and password, then the 8-digit email code. Also the first-admin setup link, accepting an invitation and choosing a new password | To do |
| 2 | **Start** | Scope switch. **Saldo nu**: in Alles the total plus one tile per group with its distance to its own buffer, in one group a bar against its buffer. Alerts: planning error (red) and warning (yellow) per group, consent expiring, transactions to categorise. "Komende maanden": a bar chart per group with zero line and buffer line, red bars below zero. Spending this month per category. Accounts split into Persoonlijk and Gedeeld, with members and contributions. Sync button with progress | Phone and desktop |
| 3 | **Transacties** | List grouped by day with an account label on every row. Search and filter chips (account, category, period, uncategorised). Detail sheet: category picker, "apply to similar and create a rule", split, mark as transfer, note. Edit controls hidden for read-only members | List, labels and category sheet done. Split, transfer, note and rule to do |
| 4 | **Overzicht** (past) | Period picker. Income, expenses and saved per month as bars. Category breakdown with share and trend. Drill-down to transactions. In Persoonlijk your contribution shows as "Naar gedeelde rekening" | Phone and desktop |
| 5 | **Planning** | Summary per group at the top. Tabs **Kalender** (month calendar, daily balance chart per group with buffer and zero zones, day card with items and the end-of-day balance per account, plan an expense or income) **· Maanden** (horizon 3, 6, 12 or 24 months, yellow and red month cards, breakdown per month) **· Terugkerend** (detected items to confirm, confirmed items) **· Eenmalig** (planned expenses and incomes) **· Budget** (free to spend per group, budgets per category). The buffer links to Rekeningen | Phone and desktop |
| 6 | **Rekeningen** and detail | Accounts grouped Persoonlijk and Gedeeld with balance. Per account: name, colour and minimum buffer (savings accounts have none), with the total buffer. Detail: balance history, transactions, **Synchronisatie** (sources, last sync, consent expiry, re-authorise), **Leden** (members with Lezen or Bewerken), manual balance update for savings | List and settings on phone and desktop. Detail to do |
| 7 | **Bank koppelen** (wizard) | Choose Argenta, explanation and redirect, return and choose accounts, prompt "this account already exists, join it?", first sync progress | To do |
| 8 | **Categorieën en regels** | Category tree, rules list with priority, suggestions to confirm | To do |
| 9 | **Importeren** (wizard) | File (CSV, for example the Bilance export), column mapping, **category mapping table** (source category, transactions, total, target), preview with probable duplicates, result with undo | To do |
| 10 | **Instellingen** | Profile, language, Enable Banking application id and key. For admins: user management (invite, role, reset link) | To do |
| 11 | **Meldingen** | Push and email on or off, per type push and email (4.9), planning look-ahead, quiet hours, test notification | Phone. Desktop to do |
| 12 | **Meer** (phone) | Profile, Rekeningen, Bankkoppelingen, Categorieën en regels, Importeren, Instellingen, Meldingen, Weergave, Afmelden | Phone |
| 13 | **E-mails** | The nine templates from 4.9 | Done |
| 14 | **Pushmeldingen** | Lock screen without amounts, notification shade in light and dark, status-bar icon | Done |

**States to mock:** done: first sync running, consent expiring, a month in the buffer, a month with a negative end balance, a day below zero before the salary arrives. To do: empty (no accounts yet), stale sync warning, an error on sync, a read-only member.

**Demo data for the mockup:** two users, Bert (admin) and Partner. Demo date 18 November 2026. Personal zichtrekening € 1.968,82 (buffer € 900), Gedeelde rekening € 946,08 (buffer € 600), Spaarrekening € 12.500 and Reserve € 4.200 (no buffer). Salary € 2.850 on the 2nd, rent € 1.005 and the contribution of € 450 each on the 1st, so the personal account dips below zero on the 1st until the salary arrives. January ends € 179 under the personal buffer because of the yearly family insurance (€ 684). February goes negative (−€ 1.033) because of a planned car repair of € 2.000. An expected tax refund of € 680 in August 2027. A default category set and about 12 months of transactions.

## 13. Development plan

### 13.1 Checks before building (spikes S1 and S2)
- **S1, Enable Banking:** register your own app in restricted mode, link your Argenta zichtrekening and the shared account in one consent, and fetch accounts, balances and transactions with a throwaway read-only script. Record: history depth, whether the shared account IBAN is returned, `entry_reference` stability, what a second consent does to the first. Ask your partner to repeat it with her own app.
- **S2, Bilance:** export your history from Bilance as a CSV file and note the columns, category format, date and amount formats. Remove real names before anything is shared or committed.

### 13.2 Proposed repository layout
```
finance/
  server/cmd/finance/            main
  server/internal/               auth, users, access, bank, ledger, categorise,
                                 planning, importers, reports, mail, ratelimit,
                                 config, db, backup, homeassistant, server
  web/src/                       pages, components, i18n, api.ts, router.ts, format.ts
  finance/                       add-on folder: config.yaml, translations, DOCS.md
  finance-mockup/                static HTML mockup with demo data
  docs/                          analysis.md, architecture.md, security.md
  .github/workflows/             ci.yml, release.yml
  Dockerfile, repository.yaml
```

### 13.3 Technical defaults (decide differently only with a reason)
- Go server, `modernc.org/sqlite`, numbered SQL migrations embedded in the binary. React and Vite for the web app.
- Money is `int64` cents everywhere, also in JSON.
- Tests: Go table tests for forecast, transfer detection, categorisation and dedupe. **Privacy tests** that user A never sees user B's data. Integration tests against the fake bank provider. Web component tests for the import wizard and planning screens.
- CI on every push: `go vet`, `go test`, web typecheck, lint, build, migration check.

### 13.4 Quality gates
- Security review (written up in `docs/security-review-v1.md`) **before the first real bank link** on the public domain.
- Run the first real sync on a copy of the database and keep a backup before every migration.

### 13.5 Development environment
- Develop against the **fake bank provider** with the demo data from section 12.
- The development machine is behind the organisation proxy. Set the proxy for Go modules and npm when installing dependencies. The add-on at home does not need a proxy.

### 13.6 Order of work
1. Mockup (section 12). The main screens, emails and notifications are designed. Still to design: sign-in and first run, bank linking, account detail, categories and rules, import, settings and user management, the remaining states, and desktop versions of the settings screens. Review with your partner.
2. Spikes S1 and S2, in parallel with the mockup.
3. M0, then M1 to M6 as in section 10.

## 14. Glossary (Dutch UI terms)

| English | Dutch label |
|---|---|
| Account, current account, savings account, shared account | Rekening, zichtrekening, spaarrekening, gedeelde rekening |
| Transaction, category, rule | Transactie, categorie, regel |
| Recurring item, one-off item, budget, buffer | Terugkerende post, eenmalige post, budget, buffer |
| Internal transfer, saved | Overschrijving tussen eigen rekeningen, gespaard |
| Left, short | Over, tekort |
| Bank link, consent, re-authorise | Bankkoppeling, toestemming, opnieuw autoriseren |
| Manager, member, read, edit | Beheerder, lid, lezen, bewerken |
| Sync, import | Synchroniseren, importeren |
| Balance now, free to spend, buffer zone, below zero | Saldo nu, vrij te besteden, bufferzone, rood |
| All, personal, shared (scope switch) | Alles, persoonlijk, gedeeld |
| Planned, expected income, one-off expense | Gepland, verwachte inkomst, eenmalige uitgave |
| Notifications, push notification, quiet hours, test notification | Meldingen, pushmelding, stille uren, testmelding |
| Warning, error | Waarschuwing, fout |
