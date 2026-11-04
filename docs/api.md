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
`200 {"status": "ok", "version": "0.2.0-dev", "demo": true}`. Also served as `GET /healthz` for the Home Assistant watchdog.

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
Starts a sync of the viewer's connections (in demo mode: the fake provider). Answers `202 {"started": true}`; a second call within 15 minutes answers `429` with a Dutch message and a `Retry-After` header (seconds).

## Sign-in (phase 0.2-4)

The viewer is resolved from the **device cookie** `saldo_device`: a random 32-byte token (base64url), stored only as a SHA-256 hash in `devices.token_hash`; `HttpOnly`, `SameSite=Strict`, `Secure` when the public URL is https, `Path=/`, 90 days, renewed while used. A device unused for 90 days or revoked answers `401`. Demo mode (`SALDO_DEMO=1`) keeps acting as Bert without a cookie. Every unsafe request (anything but `GET`/`HEAD`) must come from the same origin (`http.CrossOriginProtection`, with the public URL as trusted origin); otherwise `403 forbidden`.

Extra error code: `invalid_code` (401). Rate-limited answers are `429` with `Retry-After`. The sign-in endpoints never reveal whether an e-mail address has an account.

Links in e-mails and in the add-on log use the public URL: `/setup/<token>` (first admin, 1 hour), `/uitnodiging/<token>` (invitation, 7 days), `/nieuw-wachtwoord/<token>` (reset, 1 hour). Tokens are random, stored hashed, single use.

### `POST /api/auth/login` (public)
Body `{"email": "…", "password": "…"}`. Always `200 {"challenge": "<opaque>", "email": "b•••@jouw-domein.be"}` (the typed address, masked), also for an unknown address or a wrong password; then no e-mail is sent and step 2 fails. Only when the password is right is an 8-digit code (valid 10 minutes, single use, hashed, 5 attempts) e-mailed. Limits: per IP and per address, and at most 3 codes per user per 10 minutes. `503 unavailable` when no mail can be sent (SMTP not configured).

### `POST /api/auth/verify` (public)
Body `{"challenge": "…", "code": "12345678"}`. `200 {"user": {…as in /api/me…}}` and `Set-Cookie: saldo_device`. This creates a new trusted device (name from the User-Agent, for example "Safari op iPhone") and e-mails "Nieuw toestel aangemeld". Wrong, expired, used or unknown: `401 invalid_code`.

### `POST /api/auth/logout`
`204`; revokes the current device and clears the cookie.

### `GET /api/auth/token/{token}` (public)
`200 {"kind": "setup" | "invitation" | "password_reset", "email": "…" | null, "name": "…" | null}` for a live token, else `404 not_found`. Rate limited per IP.

### `POST /api/auth/redeem` (public)
Body `{"token": "…", "password": "…", "name": "…", "email": "…"}`. `setup` needs `name`, `email` and `password` and creates the first admin (only while no user exists); `invitation` needs `name` and `password` (the e-mail is the invited one); `password_reset` needs `password`. `204`, the token is spent, and the user then signs in normally. Password: at least 12 characters, not on a short blocklist of common passwords, not the e-mail address; otherwise `400 invalid` with a Dutch message.

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
Body `{"email": "…", "role": "user" | "admin"}`. `201` with the invitation; e-mails the link. An address that already has an account answers `400 invalid`.

### `DELETE /api/users/invitations/{id}` (admin)
`204`; the link stops working.

### `POST /api/users/{id}/password-reset` (admin)
`204`; e-mails that user a reset link (1 hour) and signs out none of their devices until it is used.

Audit log (`audit_log`): code sent, sign-in ok or failed, new device, device signed out, password changed, invitation and reset sent, setup done, rate limit hit. IP from `CF-Connecting-IP` only when the connection comes from a private or loopback address (the Cloudflared add-on), else the remote address.

## Planned changes
- A count for `uncategorised=1` (or a `total`), so the sidebar badge does not need a page of rows.
- A sync status to poll once real syncs run in the background (0.3-1); in demo mode `POST /api/sync` finishes before it answers.
- Alerts about one account carry its `accountId` (planning alerts, 0.8).
- Transfers to a savings account are shown as "Gespaard" (analysis 5.2), not only as "Overschrijving" (0.6-3).
