# Saldo API (version 0.2)

The web app talks to the Go server over JSON under `/api`. This file is the contract between `server/` and `web/`; change both together.

## Conventions
- **Money** is an integer number of **cents** (`int64` in Go, `number` in TypeScript), never a float. `amount < 0` is money going out.
- **Dates** are `YYYY-MM-DD` strings in Europe/Brussels; timestamps are RFC 3339 with offset.
- **IBANs** are always masked in responses: `BE68 •••• •••• 4821`; `null` when an account has no IBAN.
- Errors: HTTP status plus `{"error": {"code": "not_found", "message": "Dutch text for the user"}}`. Codes: `invalid` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `method_not_allowed` (405), `too_large` (413), `unsupported_media_type` (415), `rate_limited` (429), `internal` (500), `unavailable` (503).
- Request bodies are JSON objects sent with `Content-Type: application/json` (anything else answers `415`); unknown fields answer `400`.
- Every financial query is scoped to the **viewer** through `account_access` (analysis 2, 8). A resource the viewer cannot see answers `404`, never `403`, so nothing leaks.
- Until sign-in exists (phase 0.2-4) the viewer only exists in **demo mode** (`SALDO_DEMO=1`): the server then seeds the demo story and acts as Bert. Outside demo mode every `/api` route except health answers `401`.

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

## Planned changes
- A count for `uncategorised=1` (or a `total`), so the sidebar badge does not need a page of rows.
- A sync status to poll once real syncs run in the background (0.3-1); in demo mode `POST /api/sync` finishes before it answers.
- Alerts about one account carry its `accountId` (planning alerts, 0.8).
- Transfers to a savings account are shown as "Gespaard" (analysis 5.2), not only as "Overschrijving" (0.6-3).
