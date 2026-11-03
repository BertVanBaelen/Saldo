# Self-hosted finance app: analysis

Status: **v1.2** (3 Nov 2026). v1.1 added the decisions from the Saldo design canvas. v1.2 adds the review of 3 Nov 2026: every account is independent and the scope switch is a filter, sums across accounts are information only, real bank links come first on the public domain, the Bilance import moves before planning, trusted devices, iPhone support, a public repository, and a completed data model (all in the decision log, section 11). Remaining **[verify]** items are checks against the real bank, the real Bilance file and push notifications on real phones (sections 9 and 13.1). They don't block development.

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

- Two users: you and your partner, **each with their own login**. The app supports more users, and any mix of accounts per user: several personal accounts, several shared accounts, or none of one kind.
- **Everyone sees only the accounts they added themselves** (linked through the bank, joined by IBAN, or created manually), and only figures calculated from those accounts. There are no invitations to see someone else's account and no figures shared across users.
- A **personal account** is an account with one member, so it is visible only to the user who added it. A **shared account** is the same kind of account with more than one member: the only differences are its label ("Gedeeld") and the sharing options (members, permissions, contributions).
- A shared account is grouped by IBAN. The first holder who links it is the **manager**. Another holder who links the same IBAN joins the account automatically (after confirmation) and from then on sees it too. Each member gets **read** or **edit** access, set in the account's settings.
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
- Generic **CSV import** as fallback and for history (Argenta export, and the Bilance export, which is also a CSV file), see 4.6. Version 0.3 delivers the basic import. The category mapping wizard arrives with the Bilance import in version 0.5.

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
- Contributions from another member's personal account show up in the shared account as **income** from an IBAN you can't see behind. A rule on the shared account labels them as a contribution. Saldo never uses the other member's personal accounts to recognise them (5.2): each member confirms "this is my contribution" from their own side, which creates the rule on the shared account.
- Show the required monthly contribution of the shared account (see 5.3).

### 4.4 Overview of past months (M)
- Period picker with month, quarter, year and custom range. History reaches back **as far as the data goes**.
- A transaction belongs to the month of its **booking date** (Europe/Brussels). A custom "month starts on day N" (for example the salary day) is a **[C]** extra.
- Per category: totals, share of spending, trend versus previous periods, drill-down to transactions.
- Per month: **income, expenses and saved** (transfers to savings accounts). Internal transfers are excluded.
- Filter by account, or by scope (Alles, Persoonlijk, Gedeeld). In a scope with several accounts the totals are sums **for information**, with a breakdown per account (see 4.5).

### 4.5 Planning and forecast (M)
- Default horizon **3 months**, extendable on request (up to 24 months).
- Hybrid method:
  1. **Recurring items** (salary, rent, subscriptions, insurance, taxes) are detected from history and **confirmed by you**. Detection looks for the same counterparty, a similar amount (within about 10%) and a regular interval (monthly, quarterly or yearly) with at least 3 occurrences (2 for yearly **[verify with real data]**). A confirmed item has an account, an expected day (and month for yearly items), an amount (fixed or average), a frequency and an optional end date. You can also **add and edit recurring items by hand**, for costs that are not in the history yet.
  2. **Variable categories** use your budget or the average of past months. Amounts already covered by a recurring item are **not counted again** here. A budget belongs to one account.
  3. **One-off planned items** are added manually (for example a holiday or a tax bill), and can be edited and removed.
- Output per coming month and **per current account** (see 5.3): expected income, expected expenses, saved, projected end balance, and **left or short** against that account's own buffer.
- **Accounts are independent.** Every current account has its own buffer, forecast, warnings and month budget. One account's buffer never affects another. Accounts are **never added together** in a buffer check, a state (yellow or red), a warning or a free-to-spend amount.
- **Scope switch** Alles · Persoonlijk · Gedeeld on every main screen (Start, Transacties, Overzicht, Planning). It is a **filter**: Persoonlijk shows your accounts with one member, Gedeeld your accounts with more than one member, Alles every account in one place. Each account is shown with its own name, chart, summary and breakdown. A screen may also show a **sum across the accounts in view** (for example "Saldo nu · alle rekeningen" or the income of all accounts together), but only as **information**: a sum never gets a state colour, a buffer or a verdict. Transfers between your own accounts are left out of income and expenses in such sums.
- **Calendar** per month: what comes in and goes out on each day, and a **daily balance line per account** (5.3) with a zero line and a dashed buffer line. A day or chart zone turns **yellow** when an account is in its buffer and **red** when it is below zero. When several accounts are in view, a calendar day takes the worst state of those accounts and names them. Sliding over the chart moves the selected day in the calendar.
- **Plan a one-off from the calendar:** an expected **expense or income** on a chosen day, with a description, an amount and the account it lands on (you choose when several accounts are in view, otherwise it is fixed). The form previews that account's end-of-day balance before saving. Planned items show in the calendar, the Eenmalig list, the month budget and the forecast, and can be edited and removed again.
- **Month budget** (tab "Budget"): per account, how much is still **free to spend** this month once everything still expected is subtracted (formula in 5.3), with a month switcher and the budgets per category below it. A small summary per account sits at the top of Planning and opens this tab.
- **Warnings from the forecast:** an account that goes into its buffer gives a **warning** (yellow), an account that goes below zero gives an **error** (red). They show as alerts on Start and as notifications (4.9), and always name the account.

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
- Manual transactions and manual accounts **[M]**, needed for savings. A manual account is a savings account, or a current account without a bank link; a manual current account has a buffer and a forecast from its last manual balance.
- Export of all data to CSV and JSON **[S]**. An export contains only the viewer's own accounts.
- Dutch UI **[M]**, English code and documentation. Dutch (Belgium) number, date and currency format.

### 4.8 Account and data lifecycle (M)
- **Remove a bank link:** disconnects the consent. You choose to keep or delete the stored history of that connection's account.
- **Remove an account from your login:** you lose access. A shared account stays for the other members. If the manager leaves, the **manager role passes to the longest-standing member**. An account without members is deleted after confirmation.
- **Delete a user:** the admin removes the login. That user's personal accounts and manual accounts are deleted, shared accounts stay with the remaining members.
- **Members and links:** any member can add or remove **their own** connection as a fallback source. Only the manager can change permissions or remove the account for everyone.

### 4.9 Notifications and email (M)
- Two channels: **push notifications** to the installed PWA (Web Push, on **Android and iPhone**) and **email** (SMTP from the add-on options). Each user turns each channel on or off, and chooses per type which channels it uses.
- Types and defaults:

| Type | Sent when | Push | Email |
|---|---|---|---|
| Rekening staat rood | The forecast puts an account below € 0 within the look-ahead | on | on |
| Rekening komt in de buffer | The forecast puts an account below its own buffer within the look-ahead | on | off |
| Koppeling verloopt | 14 and 3 days before a consent expires | on | on |
| Synchronisatie gestopt | A consent lapsed or the sync keeps failing | on | on |
| Iemand sluit aan | Someone joins a shared account you manage | on | on |
| Bijdrage ontbreekt **[C]** | A member's contribution to a shared account hasn't arrived by the 3rd | off | off |
| Te categoriseren | New uncategorised transactions, at most once a day at 19:00 | on | off |
| Nieuw toestel aangemeld | Someone signed in to your login on a new device, which is now trusted (7) | on | always |

- **Always by email, cannot be turned off:** login code, invitation, password reset link, new device signed in.
- **Look-ahead** for the planning warnings: 1, 3 (default) or 6 months. One message per account, per month and per state, sent the morning after the forecast changes, so not every day again.
- **Quiet hours** for push, default 22:00 to 07:00. A **test notification** button in the settings. Security messages (new device) ignore quiet hours.
- Messages about an account always **name the account**: its name, personal or shared, and the masked IBAN (for example `BE68 •••• •••• 4821`). The email subject names it too.
- **Push content:** title, one line and the key amount (for example `−€ 1.033`). On Android the red planning notification expands to a small chart of the coming months; iPhone shows only the title and the line (no image), with the app icon. On the **lock screen** no amounts or account names are shown **[verify]** (risk 14). On Android this depends on the "sensitive notifications" setting, on iPhone on "Show previews: when unlocked".
- **iPhone:** Web Push works only for Saldo added to the home screen (iOS 16.4 or later); the user allows notifications from inside the installed app.
- **Android status-bar icon:** a one-colour silhouette of the app icon (the coin peeking from the wallet), 24 × 24 dp with 2 dp margin, delivered as a vector. The colour of the notification circle follows the type: green for info, ochre for a warning, red for an error. iPhone always shows the app icon.
- **Email style:** a white card with the Saldo logo, a short label and the key amount or code in the colour of the type, an account block (see above), a details table, one green button, and a footer that says why you get the email, with a link to the notification settings (not on login, invitation, password and new-device emails). Templates in v1 (10): login code, planning red, planning in the buffer, link expires in 14 days, link expires in 3 days, sync stopped, invitation, member joined, new password, new device signed in. Dutch, with a plain-text part. Sender `saldo@<your-domain>`.

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

### 5.3 Forecast (per month `m`, per current account `a`)
**Scope:** one **current account** (zichtrekening), personal or shared, bank-linked or manual. Only current accounts count as available money. Savings accounts are not part of it. Every account is calculated on its own: when several accounts are in view, they are shown side by side, and their balances may be summed **for information only**. Buffers, states, warnings and free-to-spend amounts are never added together (4.5).

**Starting balance:** the latest bank-reported balance of the account (manual accounts: the last manual balance).

```
projected_end(m, a) = projected_end(m-1, a)
                    + confirmed_recurring_income(m, a)
                    - confirmed_recurring_expenses(m, a)
                    - variable_expenses(m, a)        # budget of the account, or average of past months, minus what recurring items already cover
                    + one_off_planned(m, a)          # signed
                    - saved(m, a)                    # recurring transfers to savings
                    - transfers_out(m, a) + transfers_in(m, a)   # recurring transfers to and from your other accounts, for example the contribution to the shared account

left_or_short(m, a) = projected_end(m, a) - buffer(a)     # the account's own minimum buffer
```
- **Daily line (calendar):** `balance(d) = balance(d-1) + items expected on day d - variable spending of day d`. Items are recurring items on their expected day and planned one-offs. Variable spending is spread evenly over the days: for the current month the remaining budget over the remaining days. A day is **in the buffer** when `balance(d) < buffer(a)`, and **red** when `balance(d) < 0`. The lowest point of the month is shown.
- **Free to spend (month budget):**

```
free(m, a) = balance today (current month) or projected start balance (future month)
           + income still expected this month
           - fixed costs still to pay
           - one-off and planned items still to come
           - remaining budget per category      # budget minus what is already spent
           - transfers to savings and to your other accounts still to come
           - buffer(a)
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
- **Background fetching** is limited (about 4 per day per bank), so a nightly sync is enough. Whether a "Sync now" by a user who is present (PSU headers) is exempt from that limit is **[verify]** in spike S1.
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

The callback is reached by the user's **browser** (a redirect after the consent at the bank); the bank never calls Saldo's server. It needs the user's session, so it is not an open endpoint. Saldo runs on the public domain from the first development version (section 10), so the callback URL there is the real one from the start.

### 6.3 Shared account: manager, members, automatic grouping
- Accounts from the bank are keyed by **IBAN** (unique among bank-linked accounts). If a user links an IBAN that already exists, the app does **not** create a second account. It offers "this account already exists, join it?", and after confirmation adds the user as a member of the existing account and notifies the other members. From then on the account has more than one member and shows as **Gedeeld** for all of them.
- Linking is proof of holder rights, because the bank only lets a holder authorise it (SCA in the Argenta app). So nobody can join an account they don't hold. Joining gives access to the stored history of that account, and the manager is notified.
- Access per member is **read** or **edit**, set in the account's settings by the manager. **Read** means view only. **Edit** also allows recategorising, splitting and annotating transactions, changing the account's name, colour and buffer, and managing the recurring items, budgets, planned items and rules of that account. The default for a joining co-holder is **edit**. Who may add or remove links and the account itself is in 4.8.
- Each account has one **primary sync source** (a connection). Other connections of the same IBAN are **fallback** sources: they take over automatically when the primary consent lapses, and they fill gaps. This removes the single-manager dependency without double-importing.
- Transactions from different connections are merged on the dedupe key: account IBAN + booked `entry_reference`, falling back to a hash of date, amount, counterparty and communication. The `entry_reference` may differ between connections, so the fallback hash is used when matching across them. Identical same-day transactions (two coffees) are kept by counting occurrences per hash.
- Re-authorise reminders go to every member who holds a connection. Members with read-only access also see "last synced" so they notice a stale account.
- A transfer from the partner's personal account to the shared account appears on **both** accounts (outgoing on hers, incoming on the shared one). You only see the incoming side, as income from an IBAN. That is a transfer, not a duplicate (see 5.2).
- Manual accounts (savings) are **private to the user who created them**. A manual account may have an IBAN **only to recognise transfers** to it. That IBAN is never used for grouping or joining, and several users may register the same one. Sharing manual accounts is not supported in v1.

### 6.4 Provider adapter
Bank access sits behind a small interface (`ListAccounts`, `FetchTransactions`, `FetchBalances`). Providers can then be swapped, and CSV import uses the same pipeline.

## 7. Non-functional requirements

### Security
- Public access through the **Cloudflared** add-on on your domain, **from the first development version** (real bank data from the start, section 10). Sign-in, hardening and a written security baseline check therefore come before the first real bank link, in the same version. Sign-in:
  - **Email and password, then a code by email** (8 digits, valid 10 minutes, single use, stored hashed, 5 attempts, send-rate limit).
  - **Trusted devices:** after a successful sign-in (password and code) the device or browser stays signed in. Its session is a long-lived, revocable device session (a random token stored hashed, `HttpOnly`, `Secure`, `SameSite=Strict` cookie) that is renewed while used and ends after **90 days without use**. Each user sees their devices (name, added, last used) under Instellingen → Toestellen and can sign one or all others out. Changing the password signs out all other devices. Every **new trusted device** sends the user a push and an email ("Nieuw toestel aangemeld"), which cannot be turned off.
  - **No self-registration.** The first admin is created through a one-time setup link in the add-on log (valid 1 hour). Others are invited by email (link valid 7 days, single use).
  - **No "forgot password" link** on the sign-in page, because email is already the second factor. An admin sends a reset link (valid 1 hour). An **admin recovery** option in the add-on settings covers a locked-out sole admin.
  - **SMTP settings** in the add-on options, encrypted connections only (STARTTLS or TLS).
  - Optional **Log in with Home Assistant**, still followed by the email code.
  - Rate limits per IP and per account, common-password blocklist, no account enumeration.
- A compromised email account weakens the second factor. This is accepted. A stolen unlocked phone with a trusted Saldo session gives access until the device is signed out; the new-device email and the device list are the mitigation (risk 18).
- Passwords hashed with argon2id, CSRF and CSP protection, audit log of logins, failures, code sends, new devices, device sign-outs, account joins and data exports.
- Enable Banking private keys and tokens are **encrypted at rest** with a key generated on first start and stored apart from the database file. This protects against a leaked database file. It does **not** protect against a leaked full add-on backup, because the key is in `/data` too. So **HA backups must be encrypted**, and that is the real protection.
- Minimal dependencies, no third-party analytics. Outbound traffic only to the bank provider, to the SMTP server, to the browser's push service (Web Push, with VAPID keys generated on first start), and in v2 to price sources.
- The source code is in a **public repository** (section 8). No secrets, real bank data, real Bilance exports or real names are ever committed; test data is anonymised (risk 17).

### Reliability
- HA cold backup (add-on stops while backing up). The nightly sync retries later when it runs into the backup window.
- Schema migrations, health endpoint, structured logs.
- Tests for the **forecast, transfer detection and categorisation** logic, since errors there silently produce wrong numbers.

### Data volume
A few thousand transactions per year, so **SQLite** is more than enough.

## 8. Architecture

- **Go server** with a pure-Go SQLite driver (`modernc.org/sqlite`) and a **React + Vite + TypeScript web app** installed as a PWA (responsive, phone-friendly, installable on Android and iPhone).
- Saldo builds its own packages; it does not depend on another application's code: add-on skeleton (`config.yaml`, Dockerfile, CI and release workflows), `auth`, `users`, `mail`, `ratelimit`, `config`, `db`, `backup` and `homeassistant` packages, the Home Assistant login option, Cloudflared exposure and cold backups.
- **Repository and distribution:** a **public GitHub repository** (`github.com/BertVanBaelen/Saldo`). CI builds multi-architecture images (amd64 and aarch64) and publishes them to the GitHub Container Registry. Home Assistant installs Saldo from the repository URL as an add-on store repository. Saldo is a separate app with its own add-on, released and backed up on its own.
- A **fake bank provider** implements the same adapter as Enable Banking. It serves seeded demo data for local development and automated tests (CI never touches a real bank). Real bank data is used from the first development version, on the live add-on only.
- Modules:
  1. `auth` / `users` (sign-in, codes, trusted devices, invitations)
  2. `bank` (provider adapter, Enable Banking, fake provider)
  3. `ledger` (accounts, access, transactions, dedupe, transfers)
  4. `categorise` (rules, learning)
  5. `planning` (recurring items, budgets, forecast)
  6. `importers` (CSV, with a Bilance preset)
  7. `reports`
  8. `notify` (email templates, Web Push, preferences, quiet hours, repeat protection)

### Data model sketch
Money is stored in cents. Every table that holds financial data is reached only through `account_access`. Fields marked *(v1.2)* were added in the review of 3 Nov 2026 to cover features that had no storage yet.

| Table | Key fields |
|---|---|
| `user` | email, password hash, display name, role (admin or user), language, theme *(v1.2)*, last scope *(v1.2)*, planning look-ahead (months), quiet hours, created at |
| `device` *(v1.2)* | user, name (browser and OS), token hash, created at, last used, revoked at. A trusted device (7); replaces short sessions |
| `user_token` *(v1.2)* | kind (setup, invitation, password reset, email change), token hash, user or invited email, role, created by, expires at, used at |
| `login_code`, `audit_log` | login code: user, code hash, attempts, expiry, requesting device. Audit log: event, user, IP, device, time |
| `provider_connection` | owner user, provider, application id, encrypted private key, session id, consent valid until, status, last sync |
| `account` | type (current, savings, investment), source (api or manual), IBAN (unique among api accounts), name, **colour**, **minimum buffer** (cents, current accounts only), currency, created by. Personal or shared follows from the number of members |
| `account_access` | account, user, role (manager or member), permission (read or edit), joined at *(v1.2, decides the manager hand-over)*, contribution share in % *(v1.2, 5.3)* |
| `account_source` | account, provider connection, priority (primary or fallback), last sync, status and last error *(v1.2, status per account)* |
| `transaction` | account, amount (cents), booking date, value date, counterparty name and IBAN, communication, status (pending or booked), external id (`entry_reference`), dedupe key, occurrence *(v1.2, two identical coffees)*, source (connection or import batch), **raw payload** (original JSON/CSV row), category, category origin (manual, rule, suggestion, import) and rule *(v1.2, so a manual choice is never overwritten)*, note *(v1.2)* |
| `transaction_split` *(v1.2)* | transaction, category, amount (cents). The parts add up to the transaction amount [S] |
| `balance_snapshot` | account, balance (cents), date, origin (bank or manual) |
| `category` | name, parent, type (income or expense), colour *(v1.2)*, shared by all users |
| `category_mapping` | source, source category (full path), target category or "leave uncategorised" |
| `category_suggestion` *(v1.2)* | owner (account or user), counterparty key, category, confidence, times seen, state (open, confirmed, dismissed) |
| `import_batch` | source, file name, file hash, account, created by, created at, undone at, row counts (imported, skipped, duplicates) |
| `rule` | owner (account or user), priority, match conditions, category |
| `recurring_item` | owner (account or user), account *(v1.2)*, counterparty, description, amount rule (fixed or average), frequency, expected day and month, end date, kind (income, expense, transfer, saving), state (suggested, confirmed, ignored) *(v1.2, so an ignored suggestion stays ignored)* |
| `budget` | account *(v1.2, was "user and scope")*, category, monthly amount, from month |
| `planned_item` | account, created by, date, amount (signed: an expense or an expected income), description |
| `transfer_override` | user, transaction, is transfer (yes or no) |
| `notification_pref` | user, type, push (on or off), email (on or off) |
| `push_subscription` | user, device *(v1.2)*, endpoint, keys, platform (Android or iOS) *(v1.2)*, created at, last used |
| `notification_log` | user, type, account *(v1.2, was account group)*, month, state, channel, sent at (prevents repeats) |

Not stored: transfer pairing and forecasts. They are computed per viewer (5.2, 5.3).

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
| 9 | Learning from Bilance history needs the Bilance import | Early categorisation is weaker | Start with rules; the Bilance import now comes right after categorisation (version 0.5), with backfill of suggestions |
| 10 | The category structure and column layout of the Bilance CSV are unverified | Import wizard design | Build the wizard around "distinct values in a column". Verify the real file in spike S2 |
| 11 | Bilance history overlaps with bank-synced transactions | Duplicates, double counting | Import cutoff and probable-duplicate detection (4.6) |
| 12 | The forecast is only as good as the confirmed recurring items. Quarterly and yearly items need 12+ months of history, and the bank API gives about 90 days | Wrong "left or short" | The Bilance import (12+ months) comes before planning. Recurring items can also be added by hand. Show the per-month breakdown, mark unconfirmed items clearly, test with real history |
| 13 | A public endpoint holds banking data, from the first development version on | Attack surface | Hardening as in section 7 and a written security baseline check **before the first real bank link** (version 0.2); the full security review before 1.0 (13.4) |
| 14 | A PWA cannot set the lock-screen visibility of its notifications. Hiding amounts there depends on Android's setting for sensitive notifications and the iPhone's "show previews" setting | Amounts readable on a locked phone | Test on both real phones. If it can't be controlled, leave amounts out of the push text, or send through the Home Assistant companion app, which supports private notifications **[verify]** |
| 15 | Too many warnings | Warnings get ignored | One message per account, month and state, quiet hours, settings per type and channel |
| 16 | A partner who sees only the shared account may read the "Alles" totals as a household total | Wrong conclusions | Sums across accounts are labelled as information and never carry a state. Every verdict (buffer, red, free to spend) is per account |
| 17 | The repository is public | Leaked secrets or personal data | `.gitignore` for databases, keys and real files; only anonymised samples (Bilance spike S2); secrets only in the add-on options and `/data`; review every commit in the security review |
| 18 | Trusted devices stay signed in | A stolen unlocked phone or laptop gives access | New-device push and email, device list with sign-out, sign-out after 90 days without use, password change signs out other devices. Accepted |
| 19 | Web Push on iPhone needs the app on the home screen (iOS 16.4+), shows no images and may be throttled | Partner misses warnings | Explain the install step in the app, test on the real iPhone (0.9-5); email stays the fallback channel |
| 20 | Real bank data from the first development version, before the full security review | Early exposure | Security baseline before the first real link, scoped queries and privacy tests from the start, encrypted HA backups |

## 10. Roadmap (your priority order)

Each milestone ends with something you can use. Spikes are short checks, not features. Order since the review of 3 Nov 2026: the **real bank connection comes first** (it is the base of the app), on the public domain with sign-in and hardening from day one, and the **Bilance import comes before planning** so the forecast has 12+ months of history. The versions and phases are in [`plan/`](plan/README.md).

| Milestone | Version | Content | Done when |
|---|---|---|---|
| **Design** | 0.1 | Mockup of every screen and state, reviewed with your partner | The design is frozen |
| **S1** (spike) | 0.2 | Verify Enable Banking with your real Argenta account: restricted mode, partner's own app, two consents, history depth, shared account IBAN, "Sync now" limits. Read-only script, nothing stored | You know what the API returns and which assumptions in 6.1 hold |
| **M0 + first link** | 0.2 | Add-on, CI and images, database, web app shell, sign-in with email code and trusted devices, security baseline, then the first real bank link and first sync | You sign in on your domain and see your real Argenta accounts and transactions |
| **M1** | 0.3 | **Bank sync** for daily use: nightly sync, dedupe, pending, consent reminders, Transacties, Rekeningen and account detail, manual accounts, Start with balances, basic **CSV import** | Your transactions re-sync every night without duplicates and you are warned before a consent expires |
| **M2** | 0.4 | **Categorisation:** categories, rules, manual override, split | A month of transactions is categorised with few manual fixes |
| **S2 + M6** | 0.5 | Spike S2 (inspect the Bilance CSV), then the **Bilance history import** with the category mapping wizard, import batches with undo, overlap handling, learned category suggestions, backfill | Your Bilance history is in, mapped to your categories, without duplicates |
| **M3** | 0.6 | **Shared account and transfers:** account membership, privacy tests for every endpoint, transfer detection, scope filter, contributions | Your partner links the shared account, joins it, and sees only her accounts |
| **M4** | 0.7 | **Overview of past months:** period picker, categories, trends | You can answer "what did we spend per category last quarter" |
| **M5** | 0.8 | **Planning and forecast:** recurring items, budgets, one-offs, projection per account | The core question in section 1 is answered for the next 3 months, per account |
| **Notifications** | 0.9 | Remaining emails, Web Push on Android and iPhone, warnings, Meldingen settings | A forecast that turns red sends one push and one email the next morning |
| **Release** | 1.0 | Export, full security review, backup and restore test, documentation, 1.0.0 | Both of you use Saldo daily and a restore has been tested |
| **v2** | 2.0 | Investments: manual or imported values per platform, net worth, optional price lookups by ISIN | Net worth per platform is visible |

## 11. Decision log

| Topic | Decision |
|---|---|
| Users | Two logins, more possible. Everyone sees only the accounts they added and figures from those. A shared account has a manager and members, grouped automatically by IBAN when a second holder links it. Each member has read or edit access, set in settings (default edit). Admin manages users only |
| Hosting | Custom Home Assistant add-on, covered by HA backups |
| Stack | Go server + React/Vite/TypeScript PWA |
| Access | Public domain via Cloudflared. Sign-in with email and password plus a code by email |
| Bank provider | Enable Banking, each user with their own app |
| Forecast | Hybrid: recurring items, budgets or averages, one-offs. Default 3 months, longer on request |
| History | As long as possible, via import |
| Categories | One tree shared by all users. Rules + learning + manual override (manual wins). Bilance categories are mapped onto the app's own categories during import |
| Savings | Manual balances in v1. Transfers to savings count as "saved" |
| Shared funding | Fixed monthly transfers from each personal account. Contribution split is a fixed percentage, default equal |
| Consent reminders | In-app banner, email and push, 14 and 3 days before expiry |
| Repository | Own **public** GitHub repository for Saldo (`BertVanBaelen/Saldo`), a separate app and add-on. Images on the GitHub Container Registry (amd64, aarch64), installed from the repository URL. Saldo writes its own packages and does not depend on or refer to other projects *(3 Nov 2026)* |
| v2 investments | Current value and net worth per platform |
| UI | Dutch, responsive PWA, Belgian number and date format |
| Name | Saldo |
| Look | Base green `#15803D`, calm layout with more colour (pastel category colours), Geist and Geist Mono, light and dark mode on every screen |
| Brand | App icon "Beurs": a coin peeking from a wallet. The Android status-bar icon is its silhouette |
| Accounts in the UI | Personal in green with a person icon, shared in violet (`#5B3FD9`) with a two-person icon, a label on every transaction and planned item. Every account has its own colour (8 to choose from), **used wherever the account itself is shown** *(3 Nov 2026)*, and its own buffer, set under Rekeningen |
| Accounts are independent *(3 Nov 2026, replaces "Account groups")* | Every current account has its own buffer, forecast, warnings and month budget; one buffer never affects another. A shared account is an ordinary account with more than one member. Any mix of personal and shared accounts is possible, including none of one kind |
| Scope switch *(3 Nov 2026)* | Alles · Persoonlijk · Gedeeld is a filter on accounts. Alles shows every account in one place, side by side |
| Sums *(3 Nov 2026)* | Sums across accounts (balance now, income, expenses, spending) may be shown as information, labelled as such, with the per-account figures next to them. Never a verdict on a sum: no combined buffer, state, warning or free-to-spend |
| States | Yellow: in the buffer (warning). Red: below zero (error). Same colours in the app, emails and notifications |
| Start | The big number is the actual balance now ("Saldo nu"), not a forecast. Planning warnings and errors show as alerts, per account |
| Planning | Tabs Kalender · Maanden · Terugkerend · Eenmalig · Budget. A one-off can be an expense or an expected income. Summary per account at the top. Budgets, recurring items and planned items can be added and edited by hand |
| Notifications | Push via the PWA and email, chosen per type and channel. Push shows title, one line and the amount. Email is a white card with the key figure in the colour of the type |
| Phones *(3 Nov 2026)* | One Android phone and one iPhone. Push, installation and the lock-screen check are designed and tested for both |
| Sign-in sessions *(3 Nov 2026)* | Devices and browsers are trusted after the email code and stay signed in (until 90 days unused or signed out). A new trusted device triggers a push and an email that cannot be turned off. Devices are listed under Instellingen → Toestellen |
| Navigation *(3 Nov 2026)* | Meldingen is an item of the Beheer group in the desktop sidebar |
| Build order *(3 Nov 2026)* | The real bank connection comes first, on the public domain from day one with sign-in, hardening and a security baseline before the first real link. The Bilance import comes before planning. The roadmap has size estimates (S, M, L) and no dates |
| Demo story *(3 Nov 2026)* | The consent expires on 30 November: the app says 12 days on 18 November, the 14-day reminder email and push went out on 16 November. 4 transactions to categorise (the 4 uncategorised demo rows) |
| Mockup states *(3 Nov 2026)* | The mockup has a demo-state picker (Meer → Mockup · toestand, or `?demo=`): normal, no accounts yet, stale sync, failed sync, read-only member, offline |
| Build the real app *(3 Nov 2026, evening)* | Stop building screens in plain HTML/JS. The mockup (`finance-mockup/`) is **frozen** as a design reference, as it is. Every further screen, including the ones still to design, is built directly in the **React** web app (Vite, TypeScript) against the **Go** server with SQLite, starting with version 0.2 |

## 12. Screens for the mockup

**Navigation:** mobile bottom tabs **Start · Transacties · Overzicht · Planning · Meer**. On desktop the same items in a left sidebar, a "Beheer" group (Rekeningen, Bankkoppelingen, Categorieën, Importeren, Meldingen, Instellingen) and the user at the bottom. On the phone these live under **Meer**, together with Weergave. Sign-in screens have no navigation.

**Look:** mobile first, Dutch labels (glossary in section 14), amounts as `€ 1.234,56`. Personal is green with a person icon, shared is violet with a two-person icon, and every account has its own colour. Yellow means in the buffer, red means below zero. Light and dark mode for every screen. Subtle loading and transition animations that respect "reduce motion". The design canvas **Saldo – ontwerp** holds the style sheet, the app icon, clickable phone and desktop screens, the emails and the notifications. The screens that the canvas does not have were designed directly in the mockup (`finance-mockup/`) in the same style, on 3 Nov 2026. The mockup is the reference for every screen.

| # | Screen | Content | Design |
|---|---|---|---|
| 1 | **Inloggen** and **Code** | Email and password, then the 8-digit email code; this device stays trusted. Also the first-admin setup link, accepting an invitation, choosing a new password, expired links and too many attempts | Mockup (`inloggen.html`) |
| 2 | **Start** | Scope switch. **Saldo nu**: with several accounts in view the sum (information) plus one tile per current account with its distance to its own buffer, with one account a bar against its buffer. Alerts: planning error (red) and warning (yellow) per account, consent expiring, transactions to categorise, sync problems. "Komende maanden": a bar chart per account with zero line and buffer line, red bars below zero. Spending this month per category. Accounts split into Persoonlijk and Gedeeld, with members and contributions. Sync button with progress. Welcome steps when there are no accounts yet | Canvas (phone and desktop) and mockup |
| 3 | **Transacties** | List grouped by day with an account label on every row. Search and filter chips (account, category, period, uncategorised). Detail sheet: category picker, "apply to similar and create a rule", split, mark as transfer, note, rule link. Edit controls hidden for read-only members | Canvas (list, category sheet) and mockup (filters, split, transfer, rules, states) |
| 4 | **Overzicht** (past) | Period picker including a custom range. Income, expenses and saved per month as bars, as sums with a per-account breakdown. Category breakdown with share and trend. Drill-down to transactions. In Persoonlijk your contribution shows as "Naar gedeelde rekening". Account filter, empty state | Canvas and mockup |
| 5 | **Planning** | Summary per account at the top. Tabs **Kalender** (month calendar, daily balance chart per account with buffer and zero zones, day card with items and the end-of-day balance per account, plan an expense or income) **· Maanden** (horizon 3, 6, 12 or 24 months, yellow and red month cards per account, breakdown per month) **· Terugkerend** (detected items to confirm, confirmed items, add and edit) **· Eenmalig** (planned expenses and incomes, edit) **· Budget** (free to spend per account, budgets per category, edit). The buffer links to Rekeningen | Canvas and mockup (per account, edit forms, states) |
| 6 | **Rekeningen** and detail | Accounts grouped Persoonlijk and Gedeeld with balance. Per account: name, colour and minimum buffer (savings accounts have none). Add a bank account or a manual account. Detail: balance history, transactions, **Synchronisatie** (sources, last sync, consent expiry, re-authorise, remove your link), **Leden** (members with Lezen or Bewerken, contribution split, leave), manual balance update for savings | Canvas (list and settings) and mockup (`rekening.html`, add account, states) |
| 7 | **Bankkoppelingen** and **Bank koppelen** (wizard) | Your connections with consent and sync status, re-authorise, remove; other members' fallback links. Wizard: Enable Banking ready?, choose Argenta, explanation and redirect, return and choose accounts, prompt "this account already exists, join it?", first sync progress, errors | Mockup (`bankkoppelingen.html`) |
| 8 | **Categorieën en regels** | Category tree, rules list with priority and editor, suggestions to confirm | Mockup (`categorieen.html`) |
| 9 | **Importeren** (wizard) | File (CSV, for example the Bilance export), column mapping, **category mapping table** (source category, transactions, total, target), preview with import cutoff and probable duplicates, result with undo, import history | Mockup (`importeren.html`) |
| 10 | **Instellingen** | Profile, password, language, trusted devices, Enable Banking application id and key, export. For admins: user management (invite, role, reset link, remove) | Mockup (`instellingen.html`) |
| 11 | **Meldingen** | Push and email on or off, per type push and email (4.9), planning look-ahead, quiet hours, test notification | Canvas (phone), mockup (desktop, new-device type) |
| 12 | **Meer** (phone) | Profile, Rekeningen, Bankkoppelingen, Categorieën en regels, Importeren, Instellingen, Meldingen, Weergave, Afmelden (and in the mockup the demo-state picker) | Canvas (phone), mockup (desktop) |
| 13 | **E-mails** | The ten templates from 4.9 | Canvas (nine), mockup (new device) |
| 14 | **Pushmeldingen** | Lock screen without amounts, notification shade in light and dark, status-bar icon, iPhone | Canvas, mockup (new device, iPhone) |

**States to mock:** first sync running, consent expiring, a month in the buffer, a month with a negative end balance, a day below zero before the salary arrives, empty (no accounts yet), stale sync warning, an error on sync, a read-only member, offline. All are in the mockup; the last five through the demo-state picker.

**Demo data for the mockup:** two users, Bert (admin) and Partner. Demo date 18 November 2026. Zichtrekening (personal) € 1.968,82 (buffer € 900), Gedeelde rekening € 946,08 (buffer € 600), Spaarrekening € 12.500 and Reserve € 4.200 (no buffer). Salary € 2.850 on the 2nd, rent € 1.005 and the contribution of € 450 each on the 1st, so the Zichtrekening dips below zero on the 1st until the salary arrives. January ends € 179 under the Zichtrekening's buffer because of the yearly family insurance (€ 684). February goes negative (−€ 1.033) because of a planned car repair of € 2.000. An expected tax refund of € 680 in August 2027. The consent expires on 30 November (12 days left). 4 transactions to categorise, 3 suggestions. A default category set and about 12 months of transactions.

## 13. Development plan

### 13.1 Checks before building (spikes S1 and S2)
- **S1, Enable Banking** (first phase of version 0.2): register your own app in restricted mode, link your Argenta zichtrekening and the shared account in one consent, and fetch accounts, balances and transactions with a throwaway read-only script. Record: history depth, whether the shared account IBAN is returned, `entry_reference` stability, what a second consent does to the first, whether redirect URLs must be HTTPS, and how often a user-present "Sync now" may call the API. Ask your partner to repeat it with her own app. Nothing from the script is committed.
- **S2, Bilance** (first phase of version 0.5, can be done any time before): export your history from Bilance as a CSV file and note the columns, category format, date and amount formats. Only an anonymised sample (no real names, IBANs or amounts that identify you) is ever committed.

### 13.2 Repository layout
This folder is the repository (`github.com/BertVanBaelen/Saldo`, public). The preparation stays where it is; the code is added next to it in version 0.2:
```
Saldo/
  analysis.md, analysis/         requirements and knowledge base
  plan/                          roadmap, one file per phase
  design/                        read-only copy of the design canvas
  finance-mockup/                static HTML mockup with demo data (the design reference)
  server/cmd/saldo/              main
  server/internal/               auth, users, access, bank, ledger, categorise,
                                 planning, importers, reports, notify, mail, ratelimit,
                                 config, db, backup, homeassistant, server
  web/src/                       pages, components, i18n, api.ts, router.ts, format.ts
  saldo/                         add-on folder: config.yaml, translations, DOCS.md, icon.png
  docs/                          architecture.md, security-baseline.md, security-review-v1.md
  .github/workflows/             ci.yml, release.yml (images to ghcr.io)
  Dockerfile, repository.yaml
```

### 13.3 Technical defaults (decide differently only with a reason)
- Go server, `modernc.org/sqlite`, numbered SQL migrations embedded in the binary. React and Vite for the web app.
- Money is `int64` cents everywhere, also in JSON.
- Tests: Go table tests for forecast, transfer detection, categorisation and dedupe. **Privacy tests** that user A never sees user B's data, from the first bank link on. Integration tests against the fake bank provider. Web component tests for the import wizard and planning screens.
- CI on every push: `go vet`, `go test`, web typecheck, lint, build, migration check, a secret scan. Release builds multi-arch images (amd64, aarch64) to `ghcr.io`.

### 13.4 Quality gates
- **Security baseline** (written up in `docs/security-baseline.md`) **before the first real bank link** on the public domain, in version 0.2: sign-in, trusted devices, rate limits, CSRF, CSP, secret encryption, the bank callback, scoped queries, Cloudflared, encrypted HA backups.
- **Full security review** (written up in `docs/security-review-v1.md`) before release 1.0.
- A backup before every migration; HA backups are encrypted.

### 13.5 Development environment
- Develop and test against the **fake bank provider** with the demo data from section 12. Real bank data lives only on the add-on at home, never on the development machine or in CI.
- The development machine is behind the organisation proxy. Set the proxy for Go modules and npm when installing dependencies. The add-on at home does not need a proxy.

### 13.6 Order of work
1. Mockup (section 12): frozen on 3 Nov 2026 as a design reference. The screens it has guide the React app; the screens and states it does not finish (Planning's edit forms and per-account months, some design notes) are designed directly in the React app, in the same style, in the phase that builds them.
2. Spike S1 can start right away. Spike S2 can be done any time before the Bilance import.
3. Version 0.2 (foundation and the first real bank link), then 0.3 to 1.0 as in section 10 and [`plan/`](plan/README.md). Each screen phase ends with a short review with your partner on the real app.

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
| Trusted device, sign out, new device signed in | Toestel, afmelden, nieuw toestel aangemeld |
| Sum (information only) | Samen, ter info |
