# Saldo API (version 0.2)

The web app talks to the Go server over JSON under `/api`. This file is the contract between `server/` and `web/`; change both together.

## Conventions
- **Money** is an integer number of **cents** (`int64` in Go, `number` in TypeScript), never a float. `amount < 0` is money going out.
- **Dates** are `YYYY-MM-DD` strings in Europe/Brussels; timestamps are RFC 3339 with offset.
- **IBANs** are always masked in responses: `BE68 •••• •••• 4821`; `null` when an account has no IBAN.
- Errors: HTTP status plus `{"error": {"code": "not_found", "message": "Dutch text for the user"}}`. Codes: `invalid` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `method_not_allowed` (405), `too_large` (413), `unsupported_media_type` (415), `rate_limited` (429), `internal` (500), `unavailable` (503).
- Request bodies are JSON objects sent with `Content-Type: application/json` (anything else answers `415`); unknown fields answer `400`.
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
- `lastSync`, `syncStatus` (`ok` | `stale` | `failed`) and `bank` only for `source: bank`, else `null`; `balanceDate` is the date of the latest balance (for manual accounts the last manual update).
- `permission`: `read` | `edit`; `role`: `manager` | `member` (the viewer's own).
- `members` (shared accounts): `[{"name": "Partner", "initial": "P", "role": "member", "permission": "edit", "me": false}]`, including the viewer with `"me": true`; `[]` for personal accounts.

### `PATCH /api/accounts/{id}`
Body with any of `name` (1–40 characters), `colour`, `buffer` (cents, ≥ 0, multiple of 100, current accounts only). Needs `permission: edit` (a read-only member gets `403`). Answers the updated account. Validation errors answer `400` with a Dutch message.

### `GET /api/transactions`
Query: `account` (id, optional), `scope` (`alles` | `persoonlijk` | `gedeeld`, optional, default `alles`), `q` (search in counterparty, communication and amount), `uncategorised=1`, `before` (opaque cursor from `next`), `limit` (default 50, max 200).
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
  "next": null
}
```
Newest first (booking date, then id). `status`: `pending` | `booked`. `category`: `{"id": 3, "name": "Boodschappen", "colour": "c2"}` or `null` (`colour` is a category pastel token `c1` … `c6`, or `soft` for income). `transfer`: true for a transfer between the viewer's own accounts (shown in text colour, not as an expense). `next` is a cursor string or `null`. `uncategorised=1` lists the rows without a category that are not a transfer for the viewer (the count of the categorise alert). Invalid parameters answer `400`; a `limit` above 200 is capped at 200.

### `GET /api/alerts`
The alerts for Start, already scoped to the viewer.
```json
[
  { "kind": "warn", "type": "consent", "title": "Toestemming verloopt over 12 dagen", "note": "Argenta · opnieuw autoriseren", "href": "/bankkoppelingen" },
  { "kind": "ok", "type": "categorise", "title": "4 transacties te categoriseren", "note": "", "href": "/transacties?filter=niet-gecategoriseerd" }
]
```
`kind`: `neg` | `warn` | `ok`; `type`: `consent` | `sync` | `categorise`. Planning alerts (`type: planning`) arrive with the forecast in version 0.8.

### `GET /api/connections`
The viewer's own bank connections.
```json
[
  { "id": 1, "bank": "Argenta", "since": "2026-06-03", "validUntil": "2026-11-30", "daysLeft": 12, "lastSync": "2026-11-18T04:02:00+01:00", "status": "ok", "accounts": [1, 4] }
]
```
`status`: `ok` | `stale` (no successful sync for 36 hours) | `failed` (the last sync failed) | `expired` (the consent lapsed) | `pending` (linking not finished).

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

Audit log (`audit_log`): code sent, sign-in ok or failed, new device, device signed out, password changed or a wrong current password, invitation sent and accepted, reset sent, setup done, rate limit hit (once per window). IP from `CF-Connecting-IP` only when the connection comes from a private or loopback address (the Cloudflared add-on), else the remote address.

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

## Planned changes
- A count for `uncategorised=1` (or a `total`), so the sidebar badge does not need a page of rows.
- Alerts about one account carry its `accountId` (planning alerts, 0.8).
- Transfers to a savings account are shown as "Gespaard" (analysis 5.2), not only as "Overschrijving" (0.6-3).
