# Saldo API (version 0.2)

The web app talks to the Go server over JSON under `/api`. This file is the contract between `server/` and `web/`; change both together.

## Conventions
- **Money** is an integer number of **cents** (`int64` in Go, `number` in TypeScript), never a float. `amount < 0` is money going out.
- **Dates** are `YYYY-MM-DD` strings in Europe/Brussels; timestamps are RFC 3339 with offset.
- **IBANs** are always masked in responses: `BE68 •••• •••• 4821`; `null` when an account has no IBAN.
- Errors: HTTP status plus `{"error": {"code": "not_found", "message": "Dutch text for the user"}}`. Codes: `invalid` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `method_not_allowed` (405), `too_large` (413), `unsupported_media_type` (415), `rate_limited` (429), `internal` (500), `unavailable` (503).
- Request bodies are JSON objects sent with `Content-Type: application/json` (anything else answers `415`); unknown fields answer `400`. The one exception is the CSV upload: `POST /api/imports/preview` and `POST /api/imports` take `multipart/form-data` (see "CSV import").
- Every financial query is scoped to the **viewer** through `account_access` (analysis 2, 8). A resource the viewer cannot see answers `404`, never `403`, so nothing leaks.
- The viewer is the signed-in user of the device cookie (see "Sign-in" below). In **demo mode** (`SALDO_DEMO=1`) the server seeds the demo story and acts as Bert without signing in. Every `/api` route except health and the public sign-in routes answers `401` without a viewer.

## Endpoints

### `GET /api/health`
`200 {"status": "ok", "version": "0.2.2", "demo": true}`. Also served as `GET /healthz` for the Home Assistant watchdog.

### `GET /api/me`
```json
{
  "user": { "id": 1, "name": "Bert", "email": "bert@jouw-domein.be", "role": "admin", "initial": "B" },
  "preferences": { "scope": "alles", "theme": "system" },
  "today": "2026-11-18"
}
```
`role` is `admin` or `user`. `today` is the server's date (in demo mode the demo date, 18 November 2026).

### `PUT /api/me/preferences`
Body `{"scope": "alles" | "persoonlijk" | "gedeeld"}` and/or `{"theme": "system" | "light" | "dark"}`. Answers the new preferences.

### `GET /api/accounts`
Every account the viewer can see.
```json
[
  {
    "id": 1,
    "name": "Zichtrekening",
    "type": "current",
    "source": "bank",
    "kind": "personal",
    "iban": "BE68 •••• •••• 4821",
    "colour": "green",
    "buffer": 90000,
    "balance": 196882,
    "balanceDate": "2026-11-18",
    "state": "ok",
    "bank": "Argenta",
    "lastSync": "2026-11-18T04:02:00+01:00",
    "syncStatus": "ok",
    "permission": "edit",
    "role": "manager",
    "members": []
  }
]
```
- `type`: `current` | `savings`. `source`: `bank` | `manual`. `kind`: `personal` (one member) | `shared` (more than one member).
- `colour`: one of `green`, `violet`, `blue`, `teal`, `orange`, `pink`, `yellow`, `gray`.
- `buffer`: cents, current accounts only (`0` for savings).
- `state` (current accounts only, else `null`): `ok` (balance ≥ buffer), `buffer` (0 ≤ balance < buffer), `neg` (balance < 0).
- `lastSync`, `syncStatus` (`ok` | `stale` | `failed` | `unlinked`) and `bank` only for `source: bank`, else `null`; `balanceDate` is the date of the latest balance (for manual accounts the last manual update; `null` while there is none, with `balance: 0`). `unlinked`: a bank account whose link was removed with "keep history" (no source, nothing syncs it, `lastSync: null`, no bank alerts); linking the IBAN again re-attaches it.
- `permission`: `read` | `edit`; `role`: `manager` | `member` (the viewer's own).
- `members` (shared accounts): `[{"name": "Partner", "initial": "P", "role": "member", "permission": "edit", "me": false}]`, including the viewer with `"me": true`; `[]` for personal accounts.

### `PATCH /api/accounts/{id}`
Body with any of `name` (1–40 characters), `colour`, `buffer` (cents, ≥ 0, multiple of 100, current accounts only), `iban` (manual accounts only, `""` removes it; a bank account answers `400`). Needs `permission: edit` (a read-only member gets `403`). Answers the updated account. Validation errors answer `400` with a Dutch message.

### `POST /api/accounts` (0.3-4)
Creates a **manual account**: a savings account or a current account without a bank link. Body `{"name": "Spaarpot", "type": "savings" | "current", "colour": "orange", "buffer": 50000, "iban": "BE83 3630 1234 5615", "balance": 1250000}`; only `name` and `type` are required (`colour` defaults to `green`, `buffer` to 0 and is for `current` only, a multiple of 100). `iban` is optional and checked (shape and check digits); it only recognises transfers to this account (the `transfer` flag of transactions), it never matches, groups or joins a bank account, and several users may register the same one. `balance` (cents) is stored as today's manual balance. The account is private to its creator (`role: manager`, `permission: edit`; never shared in v1). Answers `201` with the account as in `GET /api/accounts`, IBAN masked.

### `PUT /api/accounts/{id}/balance` (0.3-4)
Body `{"balance": 1275000, "date": "2026-11-18"}`; `date` is optional (default today, never in the future). Manual accounts only (a bank account answers `400`); needs `permission: edit` (`403`). One balance per account and day: a second update of the same day replaces it. Answers the account.

### `GET /api/accounts/{id}/balances` (0.3-4)
The balance history, oldest first, one point per date: `[{"date": "2026-10-02", "balance": 1200000, "origin": "manual"}]` (`origin`: `bank` | `manual`; a manual balance wins over the bank's on the same date). `[]` without history. An account the viewer cannot see answers `404`.

### `DELETE /api/accounts/{id}` (0.3-4)
Deletes a **manual** account and its balance history; `204`. Only its manager (`403` for a member); a bank account answers `400` (it goes with its link, below). Audit-logged (`account_deleted`).

### `GET /api/transactions`
Query: `account` (id, optional), `scope` (`alles` | `persoonlijk` | `gedeeld`, optional, default `alles`), `q` (search in counterparty, communication and amount), `uncategorised=1`, `from` and `to` (booking dates `YYYY-MM-DD`, both inclusive, each optional), `before` (opaque cursor from `next`), `limit` (default 50, max 200).
```json
{
  "items": [
    {
      "id": 101,
      "accountId": 1,
      "bookingDate": "2026-11-18",
      "amount": -2499,
      "counterparty": "Bol.com",
      "communication": "Bestelling 4471-2210",
      "status": "pending",
      "category": null,
      "transfer": false
    }
  ],
  "next": null,
  "total": 1
}
```
Newest first (booking date, then id). `status`: `pending` | `booked`. `category`: `{"id": 3, "name": "Boodschappen", "colour": "c2"}` or `null` (`colour` is a category pastel token `c1` … `c6`, or `soft` for income). `transfer`: true for a transfer between the viewer's own accounts (shown in text colour, not as an expense). `next` is a cursor string or `null`. `total` is the number of rows that match the filters (all pages; the cursor and `limit` do not change it), so `uncategorised=1&limit=1` gives the count for the badge. The amount search reads `12,50`, `12.50`, `€ 12,50` and `-12,5` as € 12,50 (the sign is ignored), whole euros as every amount of that euro (`12` is € 12,00 to € 12,99, never € 120). A search that does not parse as one clear amount (for example `1.50.0`) adds no amount match; the text still searches counterparty and communication. `uncategorised=1` lists the rows without a category that are not a transfer for the viewer (the count of the categorise alert). Invalid parameters answer `400`; a `limit` above 200 is capped at 200.

### `GET /api/alerts`
The alerts for Start, already scoped to the viewer.
```json
[
  { "kind": "warn", "type": "sync", "title": "Gedeelde rekening niet bijgewerkt sinds zondag 04:02", "note": "Argenta stuurde geen nieuwe gegevens · bekijk de koppeling", "href": "/bankkoppelingen", "accountId": 4 },
  { "kind": "warn", "type": "consent", "title": "Toestemming verloopt over 12 dagen", "note": "Argenta · opnieuw autoriseren", "href": "/bankkoppelingen" },
  { "kind": "ok", "type": "categorise", "title": "4 transacties te categoriseren", "note": "", "href": "/transacties?filter=niet-gecategoriseerd" }
]
```
`kind`: `neg` | `warn` | `ok`; `type`: `consent` | `sync` | `categorise`. Planning alerts (`type: planning`) arrive with the forecast in version 0.8.

`accountId` (optional) is on the alerts about one account (`sync`: an account that is no longer synced, or not updated for 36 hours) and left out of the others, so a client can hide an alert about an account outside the scope. Order: red (`neg`) first, then the stale-account warnings, then the consent-expiring warnings, then "te categoriseren".

Bank alerts (0.3-2), per connection of the viewer; a pending connection never raises one:
- `consent`, `warn`: the consent ends within 14 days ("Toestemming verloopt over N dagen"). `consent`, `neg`: the consent has lapsed ("Toestemming voor <bank> is verlopen", note "Synchronisatie gestopt · opnieuw autoriseren").
- `sync`, `neg`: **"Synchronisatie gestopt · <bank>"**, when a connection that is not expired has had no successful sync for more than 72 hours (note "Niet bijgewerkt sinds <when>", or "Nog nooit gesynchroniseerd"). "Last good" is `last_sync_at`, or, for a connection that never synced, the later of the consent start and its creation. It replaces "Synchronisatie mislukt" for that connection.
- `sync`, `warn`: an account that was not updated for 36 hours ("niet bijgewerkt sinds ..."); left out when its connection already raises one of the red alerts above.

The same moments send e-mails (`notification_log` keeps them from repeating): "Koppeling verloopt" at 14 and at 3 days (only the 3-day one when first seen at 3 days or less), "Synchronisatie gestopt" once per lapse and once per failing episode. Only the connection owner gets them; `notification_prefs` with `email = 0` for type `consent` or `stop` turns them off.

### `GET /api/connections`
The viewer's own bank connections.
```json
[
  { "id": 1, "bank": "Argenta", "since": "2026-06-03", "validUntil": "2026-11-30", "daysLeft": 12, "lastSync": "2026-11-18T04:02:00+01:00", "status": "ok", "accounts": [1, 4] }
]
```
`status`: `ok` | `stale` (no successful sync for 36 hours) | `failed` (the last sync failed) | `expired` (the consent lapsed) | `pending` (linking not finished).

### `DELETE /api/connections/{id}?history=keep|delete` (0.3-4)
Removes the viewer's own bank link (analysis 4.8); `history` is required (`400` without it), another user's connection answers `404`. It waits for a sync of the link that is running; when that sync is still running after 30 seconds it answers `503 unavailable` ("Er loopt nog een synchronisatie. Probeer het over een minuut opnieuw.") and nothing is removed: the link can be removed again afterwards. When it goes ahead, always: the connection becomes `revoked` (it leaves `GET /api/connections`, is never synced and sends no reminders), its sealed session and the sealed Enable Banking key and application id on it are wiped (link again: store the key in Instellingen and link; the IBAN match re-attaches the kept accounts, without duplicates), and the accounts it fed lose it as a source.
- `keep`: every account and all its transactions and balances stay; the accounts show `syncStatus: unlinked`.
- `delete`: additionally deletes, in one database transaction, the accounts that only this link feeds **and** of which the viewer is the only member, with their transactions, splits, balances and everything else of theirs. An account another member still sees is kept (as with `keep`): leaving a shared account arrives in 0.6.

Answers `200 {"deleted": [1], "kept": [4]}` (account ids). Audit-logged (`bank_link_removed`, with the choice and the counts).

### `POST /api/sync`
Starts a sync of the viewer's connections in the background (in demo mode: only records a sync, at once) and answers `202 {"started": true}` immediately; poll `GET /api/sync` for the outcome. The 15-minute cooldown starts when a sync starts: another call within 15 minutes answers `429` with a Dutch message and a `Retry-After` header (seconds). While a sync of the viewer is still running (also the first sync of a link), a call answers `202 {"started": false, "running": true}` and does not use the cooldown.

### `GET /api/sync`
The viewer's sync state, to poll (the web app polls every 2 seconds) after `POST /api/sync` or the link callback:
```json
{ "running": false, "startedAt": "2026-11-18T20:00:00+01:00", "finishedAt": "2026-11-18T20:00:12+01:00",
  "connections": [{ "id": 1, "status": "ok", "lastSync": "2026-11-18T20:00:12+01:00", "error": null }] }
```
`running` covers the syncs the viewer started ("Sync now", a link callback), not the nightly job; `startedAt`/`finishedAt` are of the viewer's latest run since the server started (`null` before the first one; `finishedAt` is `null` while running). `connections` are the viewer's own, as in `GET /api/connections`: `status` `ok` | `stale` | `failed` | `expired` | `pending`, and `error` the last sync's error code (`null` after a good sync), never more.

## Sign-in (phase 0.2-4)

The viewer is resolved from the **device cookie** `saldo_device`: a random 32-byte token (base64url), stored only as a SHA-256 hash in `devices.token_hash`; `HttpOnly`, `SameSite=Strict`, `Secure` when the public URL is https or the request was https at the edge (`X-Forwarded-Proto` or `CF-Visitor`, believed only from a private or loopback peer such as the Cloudflared add-on), `Path=/`, 90 days, renewed while used. With an https public URL every answer carries `Strict-Transport-Security: max-age=31536000`. One-time tokens in paths are left out of the log. A device unused for 90 days or revoked answers `401`. Demo mode (`SALDO_DEMO=1`) keeps acting as Bert without a cookie. Every unsafe request (anything but `GET`/`HEAD`) must come from the same origin (`http.CrossOriginProtection`, with the public URL as trusted origin); otherwise `403 forbidden`.

Extra error code: `invalid_code` (401). Rate-limited answers are `429` with `Retry-After`. The sign-in endpoints never reveal whether an e-mail address has an account. Limits per 10 minutes: login 20 per IP and 5 per typed address; verify 20 per IP; token and redeem together 20 per IP; 5 wrong current passwords per user.

Links in e-mails and in the add-on log use the public URL: `/setup/<token>` (first admin, 1 hour), `/uitnodiging/<token>` (invitation, 7 days), `/nieuw-wachtwoord/<token>` (reset, 1 hour). Tokens are random, stored hashed, single use.

### `POST /api/auth/login` (public)
Body `{"email": "…", "password": "…"}`. Always `200 {"challenge": "<opaque>", "email": "b•••@jouw-domein.be"}` (the typed address, masked), also for an unknown address or a wrong password; then no e-mail is sent and step 2 fails. Only when the password is right is an 8-digit code (valid 10 minutes, single use, hashed, 5 attempts) e-mailed; it replaces the user's earlier codes. Limits: per IP and per address, and at most 3 codes per user per 10 minutes: a fourth request answers `200` as above but sends no code (a `429` there would confirm the password). `400 invalid` for something that is not an e-mail address or an empty password. `503 unavailable` when no mail can be sent (SMTP not configured).

### `POST /api/auth/verify` (public)
Body `{"challenge": "…", "code": "12345678"}`. `200 {"user": {…as in /api/me…}}` and `Set-Cookie: saldo_device`. This creates a new trusted device (name from the User-Agent, for example "Safari op iPhone") and e-mails "Nieuw toestel aangemeld". Wrong, expired, used or unknown: `401 invalid_code`.

### `POST /api/auth/logout`
`204`; revokes the current device and clears the cookie.

### `GET /api/auth/token/{token}` (public)
`200 {"kind": "setup" | "invitation" | "password_reset", "email": "…" | null, "name": "…" | null}` for a live token, else `404 not_found`. Rate limited per IP.

### `POST /api/auth/redeem` (public)
Body `{"token": "…", "password": "…", "name": "…", "email": "…"}`. `setup` needs `name`, `email` and `password` and creates the first admin (only while no user exists); `invitation` needs `name` and `password` (the e-mail is the invited one); `password_reset` needs `password` and signs out every device of that user. `204`, the token is spent, and the user then signs in normally. A token that is not live answers `404 not_found`. Password: at least 12 characters, not on a short blocklist of common passwords, not the e-mail address; otherwise `400 invalid` with a Dutch message (also for a missing name, 1–40 characters).

### `GET /api/devices`
`[{"id": 3, "name": "Safari op iPhone", "createdAt": "…", "lastUsedAt": "…", "current": true}]` of the viewer's active devices.

### `DELETE /api/devices/{id}`
`204`; signs a device of the viewer out (a device of someone else answers `404`). Deleting the current device is the same as logout.

### `POST /api/devices/sign-out-others`
`204`; revokes every device of the viewer except the current one.

### `PATCH /api/me`
Body `{"name": "…"}` (1–40 characters). Answers the user.

### `PUT /api/me/password`
Body `{"current": "…", "new": "…"}`. `204`; revokes every other device. A wrong `current` answers `400 invalid` and counts against the rate limit.

### `GET /api/users` (admin)
`{"users": [{"id": 1, "name": "Bert", "email": "…", "role": "admin", "initial": "B"}], "invitations": [{"id": 2, "email": "…", "role": "user", "expiresAt": "…"}]}`. A non-admin answers `403 forbidden`.

### `POST /api/users/invitations` (admin)
Body `{"email": "…", "role": "user" | "admin"}`. `201` with the invitation; e-mails the link and replaces an earlier pending invitation for the same address. An address that already has an account, or another role, answers `400 invalid`. `503 unavailable` without mail or without `public_url` (the link needs it), or when the mail could not be sent (the invitation is then withdrawn).

### `DELETE /api/users/invitations/{id}` (admin)
`204`; the link stops working. An unknown id answers `404`.

### `POST /api/users/{id}/password-reset` (admin)
`204`; e-mails that user a reset link (1 hour, replacing an earlier unused one) and signs out none of their devices until it is used. An unknown user answers `404`; `503` as for invitations.

Audit log (`audit_log`): code sent, sign-in ok or failed, new device, device signed out, password changed or a wrong current password, invitation sent and accepted, reset sent, setup done, rate limit hit (once per window), a bank link removed, a manual account deleted, a CSV import done (`import_done`: account, batch and counts, never file content). IP from `CF-Connecting-IP` only when the connection comes from a private or loopback address (the Cloudflared add-on), else the remote address.

## Bank link (phase 0.2-6)

Real bank data comes from Enable Banking (`server/internal/bank/enablebanking`); demo mode and tests use the fake provider. Secrets (the application's private key, the bank session id) are stored sealed with `internal/secrets`, never returned by the API and never logged.

**Redirect URL.** The user comes back from the bank to the web page `<public_url>/bankkoppelingen/terug?code=…&state=…`, not to an API route: that navigation starts on the bank's site, so the `SameSite=Strict` device cookie is not sent with it. The page then calls `POST /api/bank/callback` from within the app (same site, cookie sent). The same URL is what the user registers as redirect URL in their Enable Banking application.

**One connection per bank.** A user has one Argenta connection: saving the credentials the first time creates it with status `pending` (it shows in `GET /api/connections`), and every later link of that user is a (re-)authorisation of it.

**Demo mode** runs the same code against the fake bank: the "consent page" is the redirect page itself with `code=demo`, and the callback re-matches the demo accounts by IBAN (no duplicates) and runs its first sync against the fake bank. Without `public_url`, demo mode builds the redirect URL from the request's own origin. `POST /api/sync` in demo mode still only records a sync. There is no nightly job in demo mode.

The callback runs detached from the request, so a browser or tunnel that gives up does not lose a consent the bank has already confirmed. Syncs run in the background for up to 5 minutes each, never in a request: behind Cloudflare a request over 100 seconds answers `524`.

### `GET /api/bank/enablebanking`
`{"configured": true, "applicationId": "…", "redirectUrl": "https://…/bankkoppelingen/terug"}`. `configured` is false until a key is stored; `applicationId` is then null. `redirectUrl` is null when no `public_url` is set (linking then answers `503`). Never returns the key. Demo mode: `configured: true`, `applicationId: "demo"`.

### `PUT /api/bank/enablebanking`
Body `{"applicationId": "…", "privateKey": "-----BEGIN … PEM"}`. The key must parse as an RSA PEM key, and a connection test (Enable Banking `GET /application`) must succeed; otherwise `400 invalid` (Dutch message saying what is wrong) or `503 unavailable` when the provider cannot be reached. Stores both for the viewer (sealed key) and answers like `GET`. Replacing the key keeps existing links. Demo mode: `400 invalid` "Niet beschikbaar in de demo.".

### `POST /api/bank/link`
Body `{"connectionId": 1}` (optional, the body may be left out; present = re-authorise that connection, absent = the viewer's Argenta connection). Answers `200 {"url": "https://…"}`: the bank's consent page. The server makes a random `state`, kept in memory with the viewer, the connection and an expiry of 15 minutes, single use. The consent asks for the maximum `valid_until` (180 days). Not configured: `400 invalid`; no `public_url`: `503`; a connection id that is not the viewer's: `404`; Enable Banking refuses (for example a redirect URL not registered in the app): `400 invalid`; Enable Banking unreachable: `503`. Limit: 10 per user per hour.

### `POST /api/bank/callback`
Body `{"code": "…", "state": "…"}`. The `state` must be known, unexpired, unused and bound to the signed-in viewer, else `400 invalid` with one generic Dutch message (nothing about which check failed); a state is spent by any attempt, also by someone else's. Then: create the session at the bank (a code the bank refuses: `400 invalid`; unreachable: `503`), store the sealed session id, the consent start and `valid_until`, mark the connection active, match every returned IBAN, and start the first sync in the background (also while a "Sync now" of the viewer runs; it does not use the cooldown). Answers `200 {"connection": <as in GET /api/connections>, "accounts": [<as in GET /api/accounts>], "skipped": [{"iban": "BE68 •••• •••• 4821", "reason": "exists"}]}` at once; `accounts` are the accounts this consent feeds, as they are before that sync (a new account: no balance, no transactions, `syncStatus: stale`), and `connection.status` is that of before the sync too. Poll `GET /api/sync` until `running` is false for the outcome.
- Matching is by IBAN. A new IBAN creates a bank account with the viewer as manager (type `current`, the bank's product name as name, default colour, buffer 0). An IBAN the viewer already has for this connection is updated, never duplicated (re-authorisation). An IBAN that is already a bank account fed by another connection (another user's) is skipped with reason `exists` (joining arrives in 0.6-1). An account the bank returns without an IBAN is left out. An account the new consent no longer covers is kept but not fetched any more.
- The first sync does not undo the link when it fails: the connection is kept and its `status` shows `failed`.

### Sync with a real connection
A sync of a connection (from `POST /api/sync`, the link callback or the nightly job) unseals the credentials and, per account, fetches transactions (all pages) and balances, then stores them in one database transaction: new transactions (dedupe by `ledger.Keyed`/`ledger.StoreFetch`; a pending row without booking date uses its value date), the bank balance as a `balance_snapshot` (origin `bank`; at most one per account, date and origin: a later sync of the same day updates it) and the account's `last_sync`. An account without stored transactions is fetched without a `from` date (`strategy=longest`): that is the first sync of a new link. Otherwise the sync starts 14 days before the account's newest stored transaction, also after re-authorising, which fetches what was missed while the consent had lapsed.
- **Pending follows the bank.** After a complete fetch of an account, its pending rows of that connection dated inside the fetched window that the bank no longer reports as pending are deleted (booked now: the booked row arrives in the same fetch; or gone). Booked rows are never deleted. A failed fetch changes nothing.
- **Dedupe.** Booked rows with an entry reference: IBAN + reference; other rows: a hash of date, amount, counterparty and communication, with an occurrence number for identical rows in one fetch (two coffees on one day). A reference the bank reuses for a transaction with another date or amount is stored as another transaction; a booked row whose reference changed (same content, while the old reference is no longer reported) is not stored twice.
- **Status per account.** Each account's `account_sources` row holds its status, last sync, last attempt and last error code; one failing account does not stop the others. The connection is `ok` only when every account synced, else `failed` with the first error code. A lapsed session (`bank.ErrSessionExpired`) marks the connection `expired` (it is then left alone until it is re-authorised). Only an error code is stored, logged or returned: the provider's code (`ASPSP_ERROR`), `http_<status>`, `timeout`, `canceled`, `credentials` (the key or session cannot be unsealed), `session_expired` or `provider_error`.
- **One at a time.** A connection never syncs twice at once: "Sync now" during another sync of it waits for that one; the callback waits and then syncs; the nightly job skips it until its next check.
- **Nightly.** Outside demo mode a job checks every 10 minutes and syncs, one connection after another, every active connection that had no attempt since 04:00 (Brussels) today, once it is past 04:00, so a restart or the Home Assistant backup window only delays it. A failed attempt is retried after 30 minutes, then 1 hour, with at most 3 background attempts per connection per day (kept in the database, so restarts do not reset them). "Sync now" is not capped by this and a good manual sync after 04:00 counts as the day's sync.

**Which balance.** The snapshot is the booked balance, because pending rows stay out of the totals (4.1) and an "available" balance can include a credit line: of `ITBD` (interim booked) and `CLBD` (closing booked) the one with the newer date, `ITBD` on the same date; without a booked balance `XPCD` (expected), else the first one reported (verify in S1 which types Argenta sends).

## CSV import (phase 0.3-6)

A CSV file goes into one account the viewer may edit: the fallback when the bank API fails, and a way to bring in older Argenta history. The server parses the file and stores its rows through the sync's own key path (`ledger.Keyed`, `ledger.InsertTransactions`); the web app only sends the file and the column mapping. Every import is a batch.

**Upload.** The two `POST` routes take `multipart/form-data`, not JSON (anything else answers `415`), read as a stream. Parts: `file` (required), `accountId` and `mapping` (a JSON object of at most 2 KiB). Each part may come once; an unknown part answers `400`. An upload has a read deadline of 2 minutes instead of the server's usual 30 seconds, so a 5 MiB file from a phone on a slow connection arrives. A file over 5 MiB answers `413`.

**Mapping.** An object with the keys `date` (the booking date), `valueDate`, `amount`, `counterparty`, `counterpartyIban`, `communication`, `account` (the file's own account) and `currency`. Each value is the 0-based index of a column of the file, or `null` (or left out) when the file has no such column. `date` and `amount` are required. A column serves one field only. A missing required field, an index outside the file's columns, a column used twice or an unknown key answers `400`. `account` and `currency` are checks, not stored (see "Checks"); the other fields are stored.

**Who.** `permission: edit` on the target account, whatever its kind (bank account fed by a sync, manual, savings). An import never touches balances, sync status or connections. It is audit-logged (`import_done`).

### `POST /api/imports/preview` (0.3-6)
Reads the file for the mapping step of the wizard and stores nothing. With only `file` it answers what it found and a suggested mapping (the values are made up; the sample holds up to three rows):
```json
{
  "fileName": "argenta-2026.csv",
  "delimiter": ";",
  "headers": ["Rekening", "Boekdatum", "Valutadatum", "Referentie", "Beschrijving", "Bedrag", "Munt", "Verrichtingsdatum", "Rekening tegenpartij", "Naam tegenpartij", "Mededeling"],
  "mapping": { "date": 1, "valueDate": 2, "amount": 5, "counterparty": 9, "counterpartyIban": 8, "communication": 10, "account": 0, "currency": 6 },
  "preset": "argenta",
  "totalRows": 412,
  "sample": [["BE68 •••• •••• 4821", "17/11/2026", "17/11/2026", "20261117-0042", "Betaling Delhaize", "-24,99", "EUR", "16/11/2026", "BE83 •••• •••• 5615", "Delhaize", "Kaart 4471"]],
  "counts": null,
  "errors": []
}
```
- `fileName` is the base name of the uploaded file (control and format characters such as bidi overrides dropped, at most 100 characters, `bestand.csv` when nothing is left). `delimiter` is `;`, `,` or a tab (`"\t"`). `headers` is the header row as cleaned (an empty header becomes "Kolom N", a repeated one gets "(2)"). `mapping` is the one sent, else a suggestion from the header names. `preset` is `argenta` when the headers match the Argenta export (see "Argenta"), else `null`. `totalRows` counts the data rows, readable or not. `sample` is the first three rows that have as many fields as the header, cells in header order, with every IBAN-shaped cell masked like any IBAN of the API (a text of that shape that is no IBAN is masked as well).
- With **both** `accountId` and `mapping` it also checks the file against that account and fills `counts` and `errors` (one of the two alone answers `400`); `mapping` then echoes the one sent. The web app previews once for the file and again after every change of the mapping or the account. The other fields are as above; these two change:
```json
{
  "counts": { "rows": 412, "new": 380, "present": 29, "invalid": 3, "overlap": 41 },
  "errors": [{ "line": 57, "message": "Datum is ongeldig. Gebruik dd/mm/jjjj, dd-mm-jjjj, dd.mm.jjjj of jjjj-mm-dd." }]
}
```
- `counts` are those of a real import (the same code, rolled back), so this needs edit access to the account: hidden `404`, read-only `403`. `rows` is the number of data rows, `new` what an import would store, `present` what the account already holds, `invalid` the rows that cannot be read or are refused; `rows = new + present + invalid`. `overlap` is how many of the `new` rows are dated in the period the account already syncs: from the booking date of its earliest booked row that a sync brought (a row with a bank connection; imported rows do not count) up to today. `0` for an account without such a row. It counts the very rows `new` counts, so it never exceeds `new`, and it changes none of the other counts; the web app warns with it that these rows may duplicate synced ones (see "Duplicates"). Only the preview carries it, not the import's `batch` nor `GET /api/imports`. `errors` lists at most 20 of the invalid rows by line in the file, in line order; `counts.invalid` is the total. A file without a readable row gives `new: 0` here; the import itself refuses it.

### `POST /api/imports` (0.3-6)
Parts `file`, `accountId` and `mapping`, all required (`400` otherwise). Stores the readable rows in one database transaction, as one batch, and answers `201`:
```json
{
  "batch": { "id": 3, "source": "argenta", "fileName": "argenta-2026.csv", "accountId": 1, "createdAt": "2026-11-09T14:12:05+01:00", "imported": 380, "present": 29, "invalid": 3 },
  "errors": [{ "line": 57, "message": "Datum is ongeldig. Gebruik dd/mm/jjjj, dd-mm-jjjj, dd.mm.jjjj of jjjj-mm-dd." }]
}
```
- `source`: `argenta` when the header set matches the Argenta export, else `csv`. `imported`: rows stored. `present`: rows the account already held. `invalid`: rows skipped as unreadable or refused. `errors`: at most 20, as in the preview.
- The same file twice makes a second batch with `imported: 0` and every readable row counted as `present`.
- A file without a readable row stores nothing and answers `400` ("Geen enkele regel van het bestand kon gelezen worden. Er is niets geïmporteerd."); so does a file whose readable rows all belong to another account ("Dit bestand hoort bij een andere rekening dan de gekozen rekening."), and a file of several accounts into an account without an IBAN ("Dit bestand bevat meer dan één rekening. Kies een rekening met een IBAN of splits het bestand."). Neither makes a batch.

### `GET /api/imports` (0.3-6)
The import history: the batches of every account the viewer holds (read-only ones too), newest first, each in the `batch` shape above; `[]` without any.

### Errors
`400 invalid` (a Dutch message that never repeats cell text): a bad file (empty, not text, no delimiter, only a header line, UTF-16, more than 20 000 rows, more than 64 columns in the header or more than 64 delimiters in any row, a quote error in the header line), a bad mapping (above), a bad upload (no `file`, a part twice, an unknown part, one of `accountId` and `mapping` alone in the preview, either one missing in the import). `403 forbidden`: the account is read-only for the viewer. `404 not_found`: the account is hidden from the viewer, or `accountId` is not a positive number. `413 too_large`: the file is over 5 MiB. `415`: not multipart. `429` with `Retry-After`: more than 60 previews or 20 imports per user per hour. `503 unavailable`: two uploads (previews and imports together, any user) are already running ("Er loopt al een import. Probeer het over een minuut opnieuw."); it does not count towards the hourly limits.

### Checks per row
A row that fails is skipped and reported by its line in the file; the rest goes on. Nothing is stored before the whole body is read and parsed, and the batch and its rows are written in one database transaction, so an import is atomic.
- **Currency:** only EUR. A currency cell that is not `EUR` makes the row unreadable; without a `currency` column every row counts as EUR.
- **Account:** the `account` cell must be a valid IBAN. When the target account has an IBAN, a row whose own account is another IBAN is refused and counted as unreadable; its error shows that IBAN masked ("Rekening BE68 •••• •••• 4821 in het bestand is niet de gekozen rekening."). An empty cell is not checked. When the target account has **no** IBAN and the `account` cells name more than one distinct account (whatever the row order, unreadable rows in between or not), no row can be told apart: every readable row is refused and counted as unreadable, each with the error "Het bestand bevat rijen van meer dan één rekening, en de gekozen rekening heeft geen IBAN om ze uit elkaar te houden." (no IBAN in it); the preview answers `200` with `new: 0`, `present: 0`, `overlap: 0` and these errors, the import `400` (above). A file of one account (or without account cells) into an account without an IBAN imports as usual: there is nothing to check it against.

### What the parser reads
- Limits: 5 MiB, 20 000 data rows (blank lines do not count), 64 columns, 1 000 characters per cell (a longer cell makes its row unreadable).
- Encoding: UTF-8 (a BOM is dropped), else Windows-1252. A UTF-16 file (a UTF-16 byte order mark, or a NUL in one of the first two bytes) is refused with "Dit bestand is opgeslagen als UTF-16. Sla het op als CSV (UTF-8) en probeer opnieuw."; any other file with a NUL byte or more than 2% control characters is refused as not text.
- Delimiter: `;`, tab or `,`: the most frequent one on the header line (the first non-blank line; `;` wins a tie). Excel's first line `sep=;` (or `sep=,`, `sep=` and a tab), exactly, sets the delimiter and is skipped; line numbers stay those of the file. Standard CSV quoting. A row with another number of fields than the header is unreadable (empty trailing cells are tolerated), and so is a row with a quote error.
- Cell text is cleaned (control characters dropped, line breaks and runs of spaces become one space). Counterparty is cut at 140 characters, communication at 500. Cells are stored as data and never evaluated.
- Dates: `dd/mm/yyyy`, `dd-mm-yyyy`, `dd.mm.yyyy` (day and month with one or two digits) or `yyyy-mm-dd`; no two-digit years; from 1990-01-01 up to today (Brussels), so a future date makes the row unreadable. A value date or counterparty IBAN that cannot be read is left out, not an error.
- Amounts become integer cents, never floats. One sign (`+`, `-` or `−`) in front or behind; `€` or `EUR` in front or behind; digits with `.` and `,`; thousands groups of exactly three digits. A number that shows its decimal separator is read as shown (`1.234,56`, `1,234.56`, `12,5`). A single separator followed by exactly three digits (`1.234`) is decided per file, by the separator the other amounts of that column agree on; when they show none, or both, the row is rejected as ambiguous. More than two decimals are accepted only when the extra ones are zeros. Rejected: two signs, other characters, an empty cell, more than 9 007 199 254 740 991 cents in absolute value (JavaScript's largest safe integer, so the web shows it exactly).

### Argenta
`preset: "argenta"` (and `source: "argenta"`) when the headers include Boekdatum, Valutadatum, Referentie, Bedrag, Munt, Naam tegenpartij and Mededeling (case, accents and punctuation ignored). The header layout of the export is Rekening, Boekdatum, Valutadatum, Referentie, Beschrijving, Bedrag, Munt, Verrichtingsdatum, Rekening tegenpartij, Naam tegenpartij, Mededeling, known from a spreadsheet view of an export. **The delimiter, date format and amount format of the real file are not verified.**

The preset only names the source; the mapping is the generic suggestion: Boekdatum is `date`, Valutadatum `valueDate`, Bedrag `amount`, Naam tegenpartij `counterparty`, Rekening tegenpartij `counterpartyIban`, Mededeling `communication`, Rekening `account`, Munt `currency`. Referentie, Beschrijving and Verrichtingsdatum are not mapped: they are kept only in the stored raw row (`raw_payload`, every cell of the row by header name).

### Duplicates
Imported rows are stored as booked rows through the sync's key path, with the batch id and no entry reference.
- **At import**, a row counts as `present` and is not stored when the account already holds a booked row of the same content: booking date, amount, counterparty and communication all equal (the texts compared without regard to case or spacing), from any source, the sync or an earlier import. It is count-aware: k equal rows in the file against m stored rows make the first min(k, m) present and import the rest, so a second purchase of the same amount on one day is not lost. Pending rows are not compared: a pending row of the same content does not block the booked one, which is stored next to it; the sync removes the pending row once the bank no longer reports it as pending. Fuzzy matching (a day apart, similar names) and an import cutoff are not part of 0.3 (0.5-4).
- **In the sync**, for an account that has an import batch which brought rows, a booked bank row with the same content as a stored row is not stored again, also when its entry reference is new. Per content group of a fetch, only as many rows with a new key go in as the fetch holds more than the account stores of that content: repeating a fetch adds nothing, and a fetch with one more stores exactly that one. Accounts without imports, and pending rows, sync as before.

## Planned changes
- The planning alerts about one account (0.8) carry its `accountId` too, as the account-level sync alerts do since 0.3-5.
- Transfers to a savings account are shown as "Gespaard" (analysis 5.2), not only as "Overschrijving" (0.6-3).
