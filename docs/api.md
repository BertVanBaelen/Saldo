# Saldo API (version 0.2)

The web app talks to the Go server over JSON under `/api`. This file is the contract between `server/` and `web/`; change both together.

## Conventions
- **Money** is an integer number of **cents** (`int64` in Go, `number` in TypeScript), never a float. `amount < 0` is money going out.
- **Dates** are `YYYY-MM-DD` strings in Europe/Brussels; timestamps are RFC 3339 with offset.
- **IBANs** are always masked in responses: `BE68 •••• •••• 4821`; `null` when an account has no IBAN.
- Errors: HTTP status plus `{"error": {"code": "not_found", "message": "Dutch text for the user"}}`. Codes: `invalid` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409, 0.6-5: a contribution sender already claimed), `method_not_allowed` (405), `too_large` (413), `unsupported_media_type` (415), `rate_limited` (429), `internal` (500), `unavailable` (503).
- Request bodies are JSON objects sent with `Content-Type: application/json` (anything else answers `415`); unknown fields answer `400`. The one exception is the CSV upload: `POST /api/imports/preview` and `POST /api/imports` take `multipart/form-data` (see "CSV import").
- Every financial query is scoped to the **viewer** through `account_access` (analysis 2, 8). A resource the viewer cannot see answers `404`, never `403`, so nothing leaks.
- The viewer is the signed-in user of the device cookie (see "Sign-in" below). In **demo mode** (`SALDO_DEMO=1`) the server seeds the demo story and acts as Bert without signing in. Every `/api` route except health and the public sign-in routes answers `401` without a viewer.

## Endpoints

### `GET /api/health`
`200 {"status": "ok", "version": "0.6.0", "demo": true}`. Also served as `GET /healthz` for the Home Assistant watchdog.

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
    "syncError": null,
    "lastAttempt": "2026-11-18T04:02:00+01:00",
    "syncReport": {
      "at": "2026-11-18T04:02:00+01:00",
      "from": "2026-11-02",
      "fetched": 12,
      "added": 0,
      "newest": "2026-11-18",
      "balanceDate": "2026-11-18",
      "idTail": "a3f9"
    },
    "permission": "edit",
    "role": "manager",
    "members": [],
    "convertibleRules": 0,
    "sourceRole": "primary",
    "carriedBy": {"name": "Bert", "me": true},
    "viaReserve": false
  }
]
```
- `type`: `current` | `savings`. `source`: `bank` | `manual`. `kind`: `personal` (one member) | `shared` (more than one member).
- `colour`: one of `green`, `violet`, `blue`, `teal`, `orange`, `pink`, `yellow`, `gray`.
- `buffer`: cents, current accounts only (`0` for savings).
- `state` (current accounts only, else `null`): `ok` (balance ≥ buffer), `buffer` (0 ≤ balance < buffer), `neg` (balance < 0).
- `lastSync`, `syncStatus` (`ok` | `stale` | `failed` | `unlinked`) and `bank` only for `source: bank`, else `null`; `balanceDate` is the date of the latest balance (for manual accounts the last manual update; `null` while there is none, with `balance: 0`). `unlinked`: a bank account whose link was removed with "keep history" (no source, nothing syncs it, `lastSync: null`, no bank alerts); linking the IBAN again re-attaches it.
- `syncError` (only while `syncStatus` is `failed`, else `null`) is the code of the last failed sync of this account, never an error text: `not_shared` (the last consent did not include the account: authorise again and tick it), `store_failed` (the fetch worked but storing it failed; the cause is in the server log), `session_expired`, `timeout`, `http_<status>` or the provider's own code in capitals (`ASPSP_ERROR`). `lastAttempt` is when the bank was last asked for the account through any of its links (ISO time, `null` for manual accounts). Every member sees `syncStatus` and `lastAttempt`; `syncError` only when the failing link is the viewer's own (0.6-1d): another member's error code is never shown, that member sees `null` with `syncStatus: failed`.
- `syncReport` (0.6-0, bank accounts only; `null` for manual and unlinked accounts and before the first successful sync after the upgrade) says what the last **successful** sync of the account asked the bank for and what Saldo kept, so a silent sync can be told from a broken one without logs. `at` is that sync's time; `from` the first date asked (`null` = the longest history the bank gives); `fetched` the transactions the bank returned; `added` those that were new to Saldo (`fetched: 0` is the bank's side, `fetched: 20, added: 0` is storing or dedupe); `newest` the newest booking date returned (`null` without rows; a pending row counts on its value date); `balanceDate` the date of the balance stored (`null` when the bank gave none); `idTail` the last 4 characters of the provider's account id that was fetched (two accounts of one link must differ). A failed sync leaves the old report in place. When an account has several sources, the report is its carrier's (see `carriedBy`). Every member of a shared account sees it. The server also logs one INFO line `bank sync account` per account per sync (`connection`, `account`, `from`, `fetched`, `added`, `newest`).
- `permission`: `read` | `edit`; `role`: `manager` | `member` (the viewer's own).
- `members` (shared accounts): `[{"userId": 2, "name": "Partner", "initial": "P", "role": "member", "permission": "edit", "me": false, "joinedAt": "2026-06-05T21:00:00+02:00"}]`, including the viewer with `"me": true`, oldest member first; `[]` for personal accounts. `joinedAt` is an ISO time in Brussels (0.6-1b, with `userId`). A member sees this of the co-holders of that account only, nothing else about them.
- `sourceRole`, `carriedBy`, `viaReserve` (0.6-1d, always present). `sourceRole` is the role of the viewer's own link on this account: `"primary"`, `"reserve"` (a fallback) or `null` (no link of the viewer feeds it, and for manual and unlinked accounts). `carriedBy` is whose link fetches the account now, `{"name": "<display name>", "me": <the viewer's own link>}`, or `null` (manual, unlinked, or no link can). `viaReserve` is `true` while a fallback carries it, else `false`. For an account with more than one link, `syncStatus`, `lastSync`, `syncError` and `syncReport` are the carrier's: an idle fallback, or a fallback whose own row failed (`not_shared`, a broken consent), never makes the account `stale` or `failed` and raises no account alert; its owner sees that failure only on their own connection (`GET /api/connections`, `GET /api/sync`, connection alerts and mails, which go to the owner only), other members never. See "Primary and fallback sources" for which link carries.
- `convertibleRules` (0.6-1a, always present): for the manager of a shared account, the number of the manager's user rules that have no equal rule of this account yet (equal: the same conditions and category, priority aside). A user rule only applies to an account with one member, so these no longer categorise this account; `POST /api/accounts/{id}/convert-rules` copies them. `0` for everyone else and for personal accounts.

### `POST /api/accounts/{id}/convert-rules` (0.6-1a)
Manager of a shared account only. Copies the viewer's user rules counted in `convertibleRules` as rules of this account (same conditions, category and priority, in one database transaction) and answers `200 {"converted": 3}`; running it again converts `0`. The user rules stay, for the viewer's personal accounts. It does not apply them: `POST /api/rules/apply` does. A hidden account `404`, a member `403 forbidden`, a personal account (one member) `400 invalid`, more than 200 rules on the account `400 invalid`.

### `PATCH /api/accounts/{id}`
Body with any of `name` (1–40 characters), `colour`, `buffer` (cents, ≥ 0, multiple of 100, current accounts only), `iban` (manual accounts only, `""` removes it; a bank account answers `400`). The account's **manager** only (0.6-1b; the single member of a personal account is its manager): a read-only member gets `403` "Je mag deze rekening alleen bekijken.", a member with `edit` `403` "Alleen de beheerder kan dit wijzigen.". Answers the updated account. Validation errors answer `400` with a Dutch message.

### `PATCH /api/accounts/{id}/members/{userId}` (0.6-1b)
Body `{"permission": "read" | "edit"}`. The account's manager sets a member's permission; answers `200` with the account as one item of `GET /api/accounts`. Checked in this order: an account the viewer cannot see `404`; a viewer who is not its manager `403 forbidden` "Alleen de beheerder kan dit wijzigen."; a user who is not a member of it (or a bad `userId`) `404`; the manager's own row `400 invalid` "De beheerder kan niet op Alleen lezen gezet worden." (the manager always edits); another permission `400 invalid` "Kies Lezen of Bewerken.". Audit-logged (`member_permission`: account, user and the new permission).

### Who may write (0.6-1b)
Every write needs `permission: edit` on the account it changes, checked by one helper (`ledger.access.edit`; the manager always has `edit`): a transaction's category and note, apply to similar, split and unsplit, the rules of an account (create, change, delete, apply one), imports into an account, their undo and reapply-categories, a manual account's balance, claiming and removing a contribution sender (0.6-5). A read-only member gets `403 forbidden` "Je mag deze rekening alleen bekijken.", someone without access `404`, and nothing is written. The account itself (name, colour, buffer, IBAN), its members' permissions, the contribution shares, converting rules and deleting it are the manager's (`403` "Alleen de beheerder kan dit wijzigen." for a member; convert-rules keeps its own message). Routes without an account (`POST /api/rules/apply`, `PUT /api/rules/order`, the suggestions and the backfill) only act on the accounts the viewer may edit, so on a read-only account they change nothing and answer as usual. Reads stay open to every member. A user rule stays its user's.

### `POST /api/accounts` (0.3-4)
Creates a **manual account**: a savings account or a current account without a bank link. Body `{"name": "Spaarpot", "type": "savings" | "current", "colour": "orange", "buffer": 50000, "iban": "BE83 3630 1234 5615", "balance": 1250000}`; only `name` and `type` are required (`colour` defaults to `green`, `buffer` to 0 and is for `current` only, a multiple of 100). `iban` is optional and checked (shape and check digits); it only recognises transfers to this account (the `transfer` flag of transactions), it never matches, groups or joins a bank account, and several users may register the same one. `balance` (cents) is stored as today's manual balance. The account is private to its creator (`role: manager`, `permission: edit`; never shared in v1). Answers `201` with the account as in `GET /api/accounts`, IBAN masked.

### `PUT /api/accounts/{id}/balance` (0.3-4)
Body `{"balance": 1275000, "date": "2026-11-18"}`; `date` is optional (default today, never in the future). Manual accounts only (a bank account answers `400`); needs `permission: edit` (`403`). One balance per account and day: a second update of the same day replaces it. Answers the account.

### `GET /api/accounts/{id}/balances` (0.3-4)
The balance history, oldest first, one point per date: `[{"date": "2026-10-02", "balance": 1200000, "origin": "manual"}]` (`origin`: `bank` | `manual`; a manual balance wins over the bank's on the same date). `[]` without history. An account the viewer cannot see answers `404`.

### `DELETE /api/accounts/{id}[?confirm=<account name>]` (0.3-4, 0.6-1c)
Deletes an account for everyone, with its transactions, splits, balances, sources, join offers and notices; `204`. The members' connections keep their other accounts. Only its manager: a member gets `403` "Alleen de beheerder kan dit wijzigen.", someone without access `404`.
- **One member**: a manual account goes without confirmation (as in 0.3-4); a bank account answers `400 invalid` "Een bankrekening verwijder je door haar koppeling te verwijderen." (it goes with its link, below).
- **More than one member** (bank or manual, 0.6-1c): `confirm` must be the account's name (trimmed, any case), else `400 invalid` "Typ de naam van de rekening om te bevestigen." and nothing changes. The other members get a `deleted` notice that outlives the account (see `GET /api/alerts`).

Audit-logged (`account_deleted`, `account=<id>`).

### `POST /api/accounts/{id}/leave` (0.6-1c)
The viewer leaves an account (manager or not). Answers `200 {"handedOverTo": null}`, or, when the viewer was the manager, `200 {"handedOverTo": {"userId": 2, "name": "Partner"}}`. In one transaction:
- the viewer's `account_access` row and the viewer's own source of this account go (with the viewer's notices about it, their join offers for it, their recurring items on it, their transfer overrides on its transactions and their contribution senders on it; every contribution share of the account is reset to equal); the viewer's connection stays and keeps its other accounts. The other members' `member` notices about the viewer joining go too.
- **Hand-over**: when the viewer was the manager, the role passes to the longest-standing remaining member (`joined_at` ascending, then user id), who also gets permission `edit`.
- **Primary promotion** (shared with `DELETE /api/connections/{id}` and `DELETE /api/users/{id}`): when the account has sources left but no primary any more, the oldest fallback becomes primary: the fallback whose owner joined the account first, then the lowest connection id (sources have no timestamp of their own). The account's pending rows then belong to the new primary (only the source of a pending row replaces it).
- Notices: every remaining member gets `left`; the new manager also gets `manager`.

The last member cannot leave: `400 invalid` "Je bent het laatste lid. Verwijder de rekening of haal je koppeling weg." No access: `404`. Audit-logged (`account_left`, `account=<id>`, plus ` manager=<userId>` on a hand-over).

### Contributions (0.6-5)
The members of a shared account each pay into it from their own accounts. Each member declares, from their own side, which **sender** (IBAN) pays their contribution. The figure per member and month is the sum of the shared account's **own** booked incoming rows from that member's senders: no rule is created and nothing depends on categories, rules or transfer flags, and another member's personal accounts are never used. A claim is stored in `contribution_senders` (migration 0014: `account_id`, `user_id`, normalised `iban`, one member per sender and account). Nobody ever sees another member's sender IBAN, masked or not: only a count.

**`GET /api/accounts/{id}/contributions[?month=YYYY-MM]`**: any member, read-only included. `month` defaults to the current month in Brussels; anything but `YYYY-MM` is `400 invalid` "Kies een maand als JJJJ-MM.". A hidden or unknown account `404`.
```json
{"month": "2026-11",
 "members": [{"userId": 1, "name": "Bert", "me": true, "share": null, "senders": 1, "received": 45000, "confirmed": true},
             {"userId": 2, "name": "Partner", "me": false, "share": null, "senders": 0, "received": 0, "confirmed": false}],
 "mySenders": [{"id": 3, "iban": "BE68 •••• •••• 4821"}]}
```
`members` in member order (oldest first), `[]` for a personal account (one member), which answers `200` with `"mySenders": []` too. `share` is the agreed percentage or `null` (equal); **it has no effect yet** (the required monthly contribution comes with the forecast, 0.8-4). `senders` is the member's number of claimed senders. `received` (cents) is `SUM(amount)` of the shared account's rows with `status = 'booked'`, `amount > 0`, `booking_date` in the month, whose `counterparty_iban` equals one of that member's claimed senders: identical for every viewer. `confirmed` is `received > 0`: something was received this month, not "paid their part" (there is no target until 0.8). `mySenders` are the viewer's own claims only, IBAN masked.

**`POST /api/accounts/{id}/contribution-senders`**: claim a sender. The server takes the IBAN from something the viewer holds, never from the body. Body exactly one of:
- `{"fromAccountId": 1}`: an account the viewer holds, with an IBAN, that is not this account;
- `{"transactionId": 314}`: an incoming row (`amount > 0`) of this shared account whose sender IBAN is no account in Saldo (anyone's): for a paying account that is not in Saldo.

Answers `201 {"id": 3, "iban": "BE68 •••• •••• 4821"}`. Checked in this order: hidden account `404`; read-only member `403` "Je mag deze rekening alleen bekijken."; a personal account `400 invalid` "Een persoonlijke rekening heeft geen bijdragen."; neither or both fields `400` "Kies je eigen rekening of een ontvangen betaling."; every unusable proof (an account the viewer does not hold or that does not exist, one without IBAN, the shared account itself; a row that does not exist, of another account, outgoing, without sender IBAN, or whose sender is an account in Saldo) `400 invalid` with the one message "Dit is geen afzender die je zelf kunt kiezen. Kies je eigen rekening.", so the answer never tells whether another user holds an IBAN; a sender already claimed on this account `409 conflict` "Deze afzender is al ingesteld als bijdrage van Partner." (or "... als jouw bijdrage." for the viewer's own).

**`DELETE /api/accounts/{id}/contribution-senders/{senderId}`**: `204`. The claimant (with edit permission) or the manager. Hidden account, unknown sender or a sender of another account `404` "Afzender niet gevonden."; read-only member `403` "Je mag deze rekening alleen bekijken."; another member's sender, by a member who is not the manager, `403` "Alleen de beheerder kan dit wijzigen.".

**`PUT /api/accounts/{id}/contribution-shares`**: the manager only (their own row included). Body `{"shares": {"1": 50, "2": 50}}` naming every member (user id as a string) exactly once with an integer 0..100 summing to exactly 100, or `{"shares": null}` (back to equal: every share `NULL`). Answers `200` with the contributions of the current month. Hidden account `404`; a member `403` "Alleen de beheerder kan dit wijzigen."; a personal account `400` "Een persoonlijke rekening heeft geen bijdragen."; a missing, unknown or repeated member (or no `shares`) `400` "Geef elk lid precies één aandeel."; a value that is no integer 0..100 `400` "Elk aandeel is een geheel getal van 0 tot 100."; another sum `400` "De aandelen moeten samen 100 % zijn.". The shares have no effect yet (0.8-4).

**Membership changes reset them.** When a member leaves or is removed (leave, delete user), their claims on that account are deleted and every share of the account is set back to `NULL` (equal); when a member joins, every share is reset too (shares stop adding up when the members change). Deleting the account or the user cascades their claims. A remaining member's claims stay, but an account with one member has no contributions and no `contribution` labels.

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
      "categoryOrigin": null,
      "ruleId": null,
      "note": null,
      "splits": null,
      "transfer": false,
      "transferKind": null,
      "transferOverride": null,
      "contribution": null
    }
  ],
  "next": null,
  "total": 1
}
```
Newest first (booking date, then id). `status`: `pending` | `booked`. `category`: `{"id": 3, "name": "Boodschappen", "colour": "c2"}` or `null` (`colour` is the effective category colour: a pastel token `c1` … `c16`, `soft`, or a custom `#rrggbb`, see "Categories"). `categoryOrigin` (0.4-3): `manual` | `rule` | `suggestion` | `import`, `null` without a category. `ruleId`: the rule that set the category, only when the viewer can see that rule (the viewer's own user rule, or a rule of an account the viewer holds); otherwise `null`, also when the origin is `rule` (a user rule of another member, or a deleted rule): another user's rule id is never shown. `note`: text or `null`, seen by every member of the account (read-only ones too). `splits`: `null`, or the parts of a split transaction in stored order, `[{"category": {"id": 3, "name": "Vrije tijd", "colour": "c3"}, "amount": -6492}]`, signed cents like `amount`; a split row shows `category`, `categoryOrigin` and `ruleId` as `null` (see "Categorise a transaction"). `transfer`: true for a transfer between the viewer's own accounts (shown in text colour, not as an expense); see "Transfers" for the rules. `transferKind` (0.6-3): `saved` | `shared` | `internal`, `null` when `transfer` is false. `transferOverride` (0.6-3): the viewer's own "Is een overschrijving" (`true`) / "Is geen overschrijving" (`false`), `null` without one. `contribution` (0.6-5): `{"name": "Partner", "me": false}` on an incoming (`amount > 0`) booked row of a shared account whose sender IBAN is a member's claimed contribution sender of that account ("Bijdrage van Partner"; `me`: the viewer's own claim), else `null` (personal accounts, pending and outgoing rows, unclaimed senders); computed from that account's `contribution_senders` only, see "Contributions". `next` is a cursor string or `null`. `total` is the number of rows that match the filters (all pages; the cursor and `limit` do not change it), so `uncategorised=1&limit=1` gives the count for the badge. The amount search reads `12,50`, `12.50`, `€ 12,50` and `-12,5` as € 12,50 (the sign is ignored), whole euros as every amount of that euro (`12` is € 12,00 to € 12,99, never € 120). A search that does not parse as one clear amount (for example `1.50.0`) adds no amount match; the text still searches counterparty and communication. `uncategorised=1` lists the rows without a category and without split parts that are not a transfer for the viewer (the count of the categorise alert). The search does not look in notes. Invalid parameters answer `400`; a `limit` above 200 is capped at 200.

### `GET /api/alerts`
The alerts for Start, already scoped to the viewer.

Query: `scope` (`alles` | `persoonlijk` | `gedeeld`, optional, default `alles`, also when missing or empty; anything else answers `400 invalid`). It narrows only the "te categoriseren" alert (0.6-4): it counts the uncategorised transactions of the accounts in the scope, the same rows as `GET /api/transactions?scope=...&uncategorised=1`, and is left out when that is 0. The other alerts do not change; the ones about one account carry its `accountId`, so the client hides them when that account is outside the scope.
```json
[
  { "kind": "warn", "type": "sync", "title": "Gedeelde rekening niet bijgewerkt sinds zondag 04:02", "note": "Argenta stuurde geen nieuwe gegevens · bekijk de koppeling", "href": "/bankkoppelingen", "accountId": 4 },
  { "kind": "warn", "type": "consent", "title": "Toestemming verloopt over 12 dagen", "note": "Argenta · opnieuw autoriseren", "href": "/bankkoppelingen" },
  { "kind": "ok", "type": "categorise", "title": "4 transacties te categoriseren", "note": "", "href": "/transacties?filter=niet-gecategoriseerd" }
]
```
`kind`: `neg` | `warn` | `ok`; `type`: `consent` | `sync` | `categorise` | `member` | `rules` | `left` | `manager` | `deleted`. Planning alerts (`type: planning`) arrive with the forecast in version 0.8.

`accountId` (optional) is on the alerts about one account (`sync`: an account that is no longer synced, or not updated for 36 hours; `member`, `rules`, `left`, `manager`) and left out of the others (also of `deleted`: the account is gone), so a client can hide an alert about an account outside the scope. `noticeId` (optional, 0.6-1a) is on the alerts that come from a stored notice (`member`, `rules`, `left`, `manager`, `deleted`); `POST /api/notices/{id}/read` dismisses them. Order: red (`neg`) first, then the stale-account warnings, then the consent-expiring warnings, then the `rules` notices, then the `member` notices, then "te categoriseren".

Notices (0.6-1a), stored when someone joins an account (see "Join"), one per addressee, shown until that addressee reads it and only while the addressee still holds the account; no e-mail or push (0.9):
- `member`, `ok`, for every other member: `{"kind": "ok", "type": "member", "title": "Partner sluit aan bij Gezinsrekening", "note": "Partner mag bewerken · ziet de geschiedenis van deze rekening, nooit je persoonlijke rekeningen", "href": "/rekeningen/2", "accountId": 2, "noticeId": 1}`. The note follows the member's permission when the alerts are read (0.6-1b): "Partner mag alleen lezen · …" once the manager made Partner read-only. Dropped when Partner leaves the account.
- `rules`, `warn`, for the manager only, when the account went from one to two members and the manager has user rules: `{"kind": "warn", "type": "rules", "title": "Je regels voor Gezinsrekening gelden niet meer", "note": "Een regel van jezelf geldt alleen op een rekening met één lid · zet ze om naar regels van de rekening", "href": "/rekeningen/2", "accountId": 2, "noticeId": 2}`.

Lifecycle notices (0.6-1c), in the same lists as the `member` notices (information) and the `rules` notices (warnings). The actor's name is stored with the notice and shown as it was at the event (a later rename never shows: the actor may share no account with the reader any more), so it also reads right after the actor's user is deleted.
- `left`, `ok`, for every remaining member when someone leaves (also through a deleted user): `{"kind": "ok", "type": "left", "title": "Partner heeft Gezinsrekening verlaten", "note": "Partner ziet deze rekening niet meer", "href": "/rekeningen/2", "accountId": 2, "noticeId": 3}`.
- `manager`, `ok`, for the new manager after a hand-over (the actor is the new manager): `{"kind": "ok", "type": "manager", "title": "Je bent nu beheerder van Gezinsrekening", "note": "De beheerder beslist wie de rekening mag bewerken", "href": "/rekeningen/2", "accountId": 2, "noticeId": 4}`.
- `deleted`, `warn`, for every other member when the manager deletes a shared account; it outlives the account (the account name is stored on it) and has no `accountId`: `{"kind": "warn", "type": "deleted", "title": "Bert heeft Gezinsrekening verwijderd", "note": "De rekening en haar geschiedenis zijn voor alle leden weg · je koppeling en je andere rekeningen blijven", "href": "/rekeningen", "noticeId": 5}`.

### `POST /api/notices/{id}/read` (0.6-1a)
Marks the notice read for the viewer only and answers `204` (again `204` when it was read). A notice addressed to someone else, or unknown: `404`.

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
Removes the viewer's own bank link (analysis 4.8); `history` is required (`400` without it), another user's connection answers `404` at once, exactly as one that does not exist (0.6-2: it is checked before waiting for a sync, so the wait never tells that someone else's link exists). It waits for a sync of the viewer's link that is running; when that sync is still running after 30 seconds it answers `503 unavailable` ("Er loopt nog een synchronisatie. Probeer het over een minuut opnieuw.") and nothing is removed: the link can be removed again afterwards. When it goes ahead, always: the connection becomes `revoked` (it leaves `GET /api/connections`, is never synced and sends no reminders), its sealed session and the sealed Enable Banking key and application id on it are wiped (link again: store the key in Instellingen and link; the IBAN match re-attaches the kept accounts, without duplicates), and the accounts it fed lose it as a source.
- `keep`: every account and all its transactions and balances stay; the accounts show `syncStatus: unlinked`.
- `delete`: additionally deletes, in one database transaction, the accounts that only this link feeds **and** of which the viewer is the only member, with their transactions, splits, balances and everything else of theirs. An account another member still sees is kept (as with `keep`), never deleted by one member's link removal.

In both cases (0.6-1c), when this link was the primary source of a kept account that has a fallback, the oldest fallback becomes primary (see "Primary promotion" under `POST /api/accounts/{id}/leave`). The manager linking again afterwards is attached to such an account as a fallback instead of being skipped.

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

### `GET /api/users/{id}/removal-preview` (admin, 0.6-1c)
What `DELETE /api/users/{id}` would do, in counts only (an admin learns no names or ids of accounts they do not hold): `200 {"deletedAccounts": 2, "leftAccounts": 1, "connections": 1}`. `deletedAccounts`: the accounts where the user is the only member (personal accounts, and shared accounts the others already left), deleted with their history; `leftAccounts`: the shared accounts that stay for the other members, with the hand-over; `connections`: the user's links that are not revoked yet. It runs the delete in a transaction that is rolled back, so it equals what the delete then does. Changes nothing. Errors as for the delete.

### `DELETE /api/users/{id}` (admin, 0.6-1c)
Deletes a user; `204`. A caller who is not an admin gets `403` "Alleen een beheerder kan gebruikers beheren.", yourself `400 invalid` "Je kunt jezelf niet verwijderen.", the last admin `400 invalid` "Je kunt de laatste beheerder niet verwijderen." (over HTTP the caller is another admin, so this only guards the store), an unknown user `404` "Gebruiker niet gevonden.". In one database transaction:
- every account where the user is the only member is deleted with its history;
- every other account the user holds is left as with `POST /api/accounts/{id}/leave` (hand-over, primary promotion, `left` and `manager` notices);
- the user's connections are revoked and their sealed session, key and application id wiped; their join offers go;
- the user row goes. Devices, sign-in codes, tokens, preferences, connections (and so their remaining sources), user rules, mappings, suggestions, notification rows, transfer overrides and notices addressed to the user cascade; `audit_log.user_id`, `created_by` columns and notice actors become `NULL`.

Audit-logged (`user_deleted`, by the admin, `user=<id> deleted=<n> left=<n> connections=<n>`); that line survives the user.

Audit log (`audit_log`): code sent, sign-in ok or failed, new device, device signed out, password changed or a wrong current password, invitation sent and accepted, reset sent, setup done, rate limit hit (once per window), a bank link removed, an account deleted, an account joined (`account_joined`), an account left (`account_left`), a user deleted (`user_deleted`), a member's permission changed (`member_permission`), a CSV import done (`import_done`: account, batch and counts, never file content), an import undone (`import_undone`: batch id and counts), a category removed (`category_removed`: the category's id and `moveTo`, never counts). Rules, categories set by hand, notes and splits are not audit-logged. IP from `CF-Connecting-IP` only when the connection comes from a private or loopback address (the Cloudflared add-on), else the remote address.

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
Body `{"code": "…", "state": "…"}`. The `state` must be known, unexpired, unused and bound to the signed-in viewer, else `400 invalid` with one generic Dutch message (nothing about which check failed); a state is spent by any attempt, also by someone else's. Then: create the session at the bank (a code the bank refuses: `400 invalid`; unreachable: `503`), store the sealed session id, the consent start and `valid_until`, mark the connection active, match every returned IBAN, and start the first sync in the background (also while a "Sync now" of the viewer runs; it does not use the cooldown). Answers `200 {"connection": <as in GET /api/connections>, "accounts": [<as in GET /api/accounts>], "offers": [{"id": 12, "iban": "BE68 •••• •••• 4821", "bank": "Argenta"}], "skipped": [{"iban": "BE68 •••• •••• 4821", "reason": "exists"}], "missing": [{"iban": "BE68 •••• •••• 4821", "name": "Zichtrekening"}]}` at once (`offers`, `skipped` and `missing` always arrays); `accounts` are the accounts this consent feeds, as they are before that sync (a new account: no balance, no transactions, `syncStatus: stale`), and `connection.status` is that of before the sync too. Poll `GET /api/sync` until `running` is false for the outcome.
- Matching is by IBAN. A new IBAN creates a bank account with the viewer as manager (type `current`, the bank's product name as name, default colour, buffer 0). An IBAN the viewer already has for this connection is updated, never duplicated (re-authorisation). An IBAN that is already a bank account the viewer does not hold becomes a join **offer** (see "Join"): nothing is linked and nothing about the account is shown but its masked IBAN and the bank of the viewer's own connection. An IBAN of an account the viewer holds that this connection does not feed (and cannot take over) is skipped with reason `exists`. An account the bank returns without an IBAN is left out. An account the new consent no longer covers is kept but not fetched any more: it is marked at once as the next sync would (its source `failed` with `not_shared`, shown on the account as "Niet gedeeld bij de laatste toestemming") and listed in `missing` (masked IBAN and name; only accounts this connection fed before and the viewer holds, never anyone else's; empty on a first link). A later consent that lists it again takes the mark away with its first sync.
- The first sync does not undo the link when it fails: the connection is kept and its `status` shows `failed`.

### Join (phase 0.6-1a)
Joining is bound to a consent: the callback that listed an existing IBAN records an offer for that connection (one per connection and account; a re-link refreshes the same offer, with the new provider account id and a new 24 hours, and drops the offers the new consent no longer lists). The join call names the offer, never an account id. An offer belongs to the user whose connection it is; another user's offer answers `404`, as an unknown one does.
- `GET /api/join-offers`: `[{"id": 12, "iban": "BE68 •••• •••• 4821", "bank": "Argenta", "createdAt": "2026-11-18T20:00:00+01:00"}]`, the viewer's own offers younger than 24 hours (`createdAt` is when the consent last listed the IBAN).
- `POST /api/join-offers/{id}/accept`: `200 {"account": <as one item of GET /api/accounts>}`. In one database transaction: the viewer becomes a member with permission `edit`, the offer's connection becomes a `fallback` source of the account (fetched only while the primary is stopped, see "Primary and fallback sources"), the other members get a `member` notice (the manager also a `rules` notice, see `GET /api/alerts`) and the offer is used up; the account is then `shared` for everyone, with still exactly one manager. An offer that is not the viewer's, unknown, or already used: `404` (nothing changes). Older than 24 hours, or its connection is no longer active (expired, revoked, consent lapsed): `400 invalid` "Koppel de rekening opnieuw om aan te sluiten." (nothing changes). Audit event `account_joined`.
- `DELETE /api/join-offers/{id}`: declines ("Niet nu"), `204`; not the viewer's or unknown: `404`.

### Sync with a real connection
A sync of a connection (from `POST /api/sync`, the link callback or the nightly job) unseals the credentials and, per account, fetches transactions (all pages) and balances, then stores them in one database transaction: new transactions (dedupe by `ledger.Keyed`/`ledger.StoreFetch`; a pending row without booking date uses its value date), the bank balance as a `balance_snapshot` (origin `bank`; at most one per account, date and origin: a later sync of the same day updates it) and the account's `last_sync`. An account without stored transactions is fetched without a `from` date (`strategy=longest`): that is the first sync of a new link. Otherwise the sync starts 14 days before the account's newest stored transaction, also after re-authorising, which fetches what was missed while the consent had lapsed.
- **Pending follows the bank.** After a complete fetch of an account, its pending rows of that connection dated inside the fetched window that the bank no longer reports as pending are deleted (booked now: the booked row arrives in the same fetch; or gone). Booked rows are never deleted. A failed fetch changes nothing.
- **Dedupe.** Booked rows with an entry reference: IBAN + reference; other rows: a hash of date, amount, counterparty and communication, with an occurrence number for identical rows in one fetch (two coffees on one day). A reference the bank reuses for a transaction with another date or amount is stored as another transaction; a booked row whose reference changed (same content, while the old reference is no longer reported) is not stored twice.
- **Status per account.** Each account's `account_sources` row holds its status, last sync, last attempt and last error code; one failing account does not stop the others. The connection is `ok` only when every account synced, else `failed` with the first error code. A lapsed session (`bank.ErrSessionExpired`) marks the connection `expired` (it is then left alone until it is re-authorised). Only an error code is stored, logged or returned: the provider's code (`ASPSP_ERROR`), `http_<status>`, `timeout`, `canceled`, `credentials` (the key or session cannot be unsealed), `session_expired` or `provider_error`.
- **One at a time.** A connection never syncs twice at once: "Sync now" during another sync of it waits for that one; the callback waits and then syncs; the nightly job skips it until its next check.
- **Nightly.** Outside demo mode a job checks every 10 minutes and syncs, one connection after another, every active connection that had no attempt since 04:00 (Brussels) today, once it is past 04:00, so a restart or the Home Assistant backup window only delays it. A failed attempt is retried after 30 minutes, then 1 hour, with at most 3 background attempts per connection per day (kept in the database, so restarts do not reset them). "Sync now" is not capped by this and a good manual sync after 04:00 counts as the day's sync.

### Primary and fallback sources (0.6-1d)
An account's first link is its `primary` source, a joiner's link a `fallback`. Every sync (nightly, "Sync now", the link callback) fetches an account through exactly one link, its **carrier**: the primary, unless the primary is **stopped** and a fallback can take over; then the oldest such fallback (its owner joined the account first, then the lowest connection id). A fallback can take over when its connection is `active`, its consent has not lapsed and the consent lists the account. Without one the primary carries even when stopped, so an account with one link syncs exactly as before.
- **Stopped** is decided per account from what was stored before this sync, never from tonight's outcome and never from the order in which connections sync: the primary's connection is not `active` (expired), its consent lapsed, the current consent does not list the account (`not_shared`), or its row has been failing for longer than 36 hours (the threshold at which an account reads `stale`): status `failed` with a last good sync more than 36 hours ago (or none). A row failed with `not_shared` or `session_expired` does not count once the connection is active again with a consent that lists the account (a new consent). A primary that was not tried (Saldo was off) is not failing. A primary attempted earlier in the same sync counts as that sync's carrier. Before 0.6-1d a fallback was meant to take over as soon as the primary's sync failed; it now waits until it has been failing for 36 hours.
- **Coming back.** A primary stopped by failures is tried again once its last attempt is more than 36 hours old (that night the fallback does not fetch; data can then be up to two nights late); one stopped by its consent carries again after re-authorising.
- **A stopped primary that a fallback carries is not fetched**, its row is left as it is (also when its connection then fails as a whole, on a lapsed session or unreadable credentials), and its connection ends `failed` with the row's error code (`session_expired` for a lapsed consent without one), so its owner still gets the "Synchronisatie mislukt/gestopt" alert and mail. A connection whose only accounts are idle fallbacks makes no bank call and ends `ok`.
- **Takeover fills the gap.** The carrier fetches from 14 days before the account's newest stored booking (any source), with the usual dedupe; nothing new is matched. Before storing, the account's pending rows of its other sources are moved to the carrier (in the same database transaction), so the carrier's fetch replaces them as usual and their note and manual category go to the booked row; the same happens when the primary carries again.
- **Two syncs of one account at once** (a carrier change while a fetch runs) store one after the other (immediate transactions): no duplicates and no `store_failed`.
- **"Sync now"** syncs the viewer's own links only: an account another member's link carries is updated by that link's next sync.
- **Entry references** (tested with the fake bank, to verify with real data): a booking that two consents list under different references is stored once (a new reference on a stored booking with the same content whose own reference this fetch does not list counts as the same booking). Two identical bookings on one day (same amount, counterparty and communication) with references: when the stored one came through the other link and the carrier lists both under its own references, the second collapses into the first and is missing while that link carries; it arrives once the link that stored the first carries again, if it is still inside that fetch window. Without references both are kept (content key and occurrence).

**Which balance.** The snapshot is the booked balance, because pending rows stay out of the totals (4.1) and an "available" balance can include a credit line: of `ITBD` (interim booked) and `CLBD` (closing booked) the one with the newer date, `ITBD` on the same date; without a booked balance `XPCD` (expected), else the first one reported (verify in S1 which types Argenta sends).

## CSV import (phases 0.3-6 and 0.5-2)

A CSV file goes into one account the viewer may edit, or, for a file with an account column (Bilance), into several: the fallback when the bank API fails, a way to bring in older Argenta history, and the Bilance history. The server parses the file and stores its rows through the sync's own key path (`ledger.Keyed`, `ledger.InsertTransactions`); the web app only sends the file, the column mapping and the settings. Every import is a batch, one per account the rows go to.

**Upload.** The two `POST` routes take `multipart/form-data`, not JSON (anything else answers `415`), read as a stream. Parts: `file` (required), `mapping` (a JSON object of at most 2 KiB), `accountId` or `accountMap` (see "Where the rows go"), `settings` (a JSON object of at most 256 bytes), `categories` (see "Category mapping") and, for a Bilance file only, `duplicates` and `cutoffs` (see "Overlap and duplicates"). Each part may come once; an unknown part answers `400`. An upload has a read deadline of 5 minutes instead of the server's usual 30 seconds, so a 20 MiB file from a phone on a slow connection arrives. A file over 20 MiB answers `413`; the file is read up to that size and no further.

**Settings.** Optional overrides of what the parser detects, an object with the keys `delimiter` (`;`, `,` or a tab), `encoding` (`utf-8` or `windows-1252`), `dateFormat` (`dmy`, `mdy` or `ymd`) and `decimal` (`,` or `.`); a missing or empty key means "as detected". Any other value or key answers `400` ("De instellingen van het bestand kloppen niet."). They apply to every route: the wizard sends the same settings with the preview and with the import.

**Mapping.** An object with the keys `date` (the booking date), `valueDate`, `amount`, `counterparty`, `counterpartyFallback` (used when the `counterparty` cell is empty), `counterpartyIban`, `communication`, `note` (stored as the transaction's note, at most 200 characters), `category` and `subcategory` (the two parts of a source category; listed in the preview, stored with the row and mapped onto Saldo's categories, see "Category mapping"), `account` (the file's own account, an IBAN), `accountName` (the name of the file's account: "accounts from a column") and `currency`. Each value is the 0-based index of a column of the file, or `null` (or left out) when the file has no such column. `date` and `amount` are required. A column serves one field only. A missing required field, an index outside the file's columns, a column used twice or an unknown key answers `400`. `account` and `currency` are checks, not stored (see "Checks"); `category` and `subcategory` are stored as the two parts of the row's source category (columns `import_category` and `import_subcategory`, only when one of them is mapped) and decide its category through the mapping; the other fields are stored.

**Where the rows go.** Without `accountName` in the mapping: `accountId`, one account. With it: `accountMap`, a JSON object (at most 8 KiB, at most 50 names) of the file's account name to the id of one of the viewer's accounts, for example `{"Zichtrekening": 1, "Contant": 3}`; every name of a readable row needs an entry, else `400` ("Koppel elke rekeningnaam in het bestand aan een rekening.", without the name), and an unmapped name is never skipped silently. Both together, or neither in an import, answer `400`. Each name's rows become one batch on its account, all in one database transaction.

**Who.** `permission: edit` on every target account, whatever its kind (bank account fed by a sync, manual, savings). An import never touches balances, sync status or connections. It is audit-logged (`import_done`, once per batch).

### `POST /api/imports/preview` (0.3-6, 0.5-2)
Reads the file for the mapping step of the wizard and stores nothing. With only `file` (and perhaps `settings`) it answers what it found and a suggested mapping (the values are made up; the sample holds up to three rows):
```json
{
  "fileName": "argenta-2026.csv",
  "delimiter": ";",
  "encoding": "utf-8",
  "headers": ["Rekening", "Boekdatum", "Valutadatum", "Referentie", "Beschrijving", "Bedrag", "Munt", "Verrichtingsdatum", "Rekening tegenpartij", "Naam tegenpartij", "Mededeling"],
  "mapping": { "date": 1, "valueDate": 2, "amount": 5, "counterparty": 9, "counterpartyFallback": null, "counterpartyIban": 8, "communication": 10, "note": null,
               "category": null, "subcategory": null, "account": 0, "accountName": null, "currency": 6 },
  "preset": "argenta",
  "totalRows": 412,
  "sample": [["BE68 •••• •••• 4821", "17/11/2026", "17/11/2026", "20261117-0042", "Betaling Delhaize", "-24,99", "EUR", "16/11/2026", "BE83 •••• •••• 5615", "Delhaize", "Kaart 4471"]],
  "accounts": [],
  "categories": [],
  "counts": null,
  "errors": []
}
```
- `fileName` is the base name of the uploaded file (control and format characters such as bidi overrides dropped, at most 100 characters, `bestand.csv` when nothing is left). `delimiter` is `;`, `,` or a tab (`"\t"`). `headers` is the header row as cleaned (an empty header becomes "Kolom N", a repeated one gets "(2)"). `mapping` is the one sent, else a suggestion from the header names. `encoding` is the one read (`utf-8` or `windows-1252`), detected or as set. `preset` is `argenta` or `bilance` when the headers match that export (see "Argenta" and "Bilance"), else `null`. `totalRows` counts the data rows, readable or not. `sample` is the first three rows that have as many fields as the header, cells in header order, with every IBAN-shaped cell masked like any IBAN of the API (a text of that shape that is no IBAN is masked as well) and any card payment string reduced as described under "Bilance" (the card holder and card number never leave the server).
- With `mapping` it parses every row with it (nothing is stored, no account is needed) and also answers `accounts` and `categories`, and `errors` with the unreadable rows; `mapping` echoes the one sent. `accounts` lists, when `accountName` is mapped, each distinct account name of the readable rows with its row count, sorted by name: `[{"name": "Zichtrekening", "rows": 21}]`. `categories` lists, when `category` or `subcategory` is mapped, each distinct pair as two separate parts, never one joined string, with its readable rows and their total in cents, sorted by category then subcategory, and two hints (0.5-3): `[{"category": "Wonen", "subcategory": "Energie, nutsvoorzieningen", "rows": 3, "total": -14500, "saved": null, "suggestion": 12}]` (both parts empty is "no category"). `saved` is the viewer's own saved target of the pair for this source, `{"categoryId": 12}` or `{"categoryId": null}` for "leave uncategorised", `null` when none; `suggestion` is the id of a category guessed by name, `null` when nothing resembles the pair. Neither is applied by the server; the wizard shows them (as Opgeslagen and Voorstel) and sends the choice. More than 50 account names or 500 category pairs answers `400` (a wrong column). Both lists are `[]` otherwise. The web app asks once when it needs them and again after a change of the mapping or the settings.
- With **both** `mapping` and `accountId` (or `accountMap`) it also checks the file against the account(s) and fills `counts` and `errors` (an account without the mapping answers `400`). The web app asks again after every change of the mapping, the settings or the account. The other fields are as above; these two change:
```json
{
  "counts": { "rows": 412, "new": 380, "present": 29, "invalid": 3, "overlap": 41 },
  "errors": [{ "line": 57, "message": "Datum is ongeldig. Gebruik dd/mm/jjjj, dd-mm-jjjj, dd.mm.jjjj of jjjj-mm-dd." }]
}
```
- `counts` are those of a real import (the same code, rolled back, all accounts of an `accountMap` in one transaction, the numbers added up; with the part `categories`, as for the import, the choices are checked and applied in that rolled-back transaction), so this needs edit access to every account: hidden `404`, read-only `403`. `rows` is the number of data rows, `new` what an import would store, `present` what the account(s) already hold, `invalid` the rows that cannot be read or are refused; `rows = new + present + invalid`. `categorised` is how many of the `new` rows have a category after the import (from the choices, or from a rule of the account; the rest stay without). `overlap` is how many of the `new` rows are dated in the period the account already syncs: from the booking date of its earliest booked row that a sync brought (a row with a bank connection; imported rows do not count) up to today. `0` for an account without such a row. It counts the very rows `new` counts, so it never exceeds `new`, and it changes none of the other counts; the web app warns with it that these rows may duplicate synced ones (see "Duplicates"). Only the preview carries it, not the import's `batch` nor `GET /api/imports`. For a Bilance file the wizard shows the probable duplicates and the cutoff instead of this warning. `afterCutoff`, `probable` and `categoryTaken` (0.5-4, `0` for any other file) are described under "Overlap and duplicates"; with them `rows = new + present + invalid + afterCutoff + probable`. A Bilance file also answers `duplicates` and `cutoffs` next to `counts` (left out for any other file, and without `counts`). `errors` lists at most 20 of the invalid rows by line in the file, in line order; `counts.invalid` is the total. A file without a readable row gives `new: 0` here; the import itself refuses it.

### `POST /api/imports` (0.3-6, 0.5-2)
Parts `file`, `mapping` and `accountId` or `accountMap` (`400` otherwise), perhaps `settings` and `categories` (see "Category mapping"). Stores the readable rows in one database transaction, as one batch per account, and answers `201`:
```json
{
  "batches": [{ "id": 3, "source": "argenta", "fileName": "argenta-2026.csv", "accountId": 1, "createdAt": "2026-11-09T14:12:05+01:00", "imported": 380, "present": 29, "invalid": 3, "undoneAt": null }],
  "errors": [{ "line": 57, "message": "Datum is ongeldig. Gebruik dd/mm/jjjj, dd-mm-jjjj, dd.mm.jjjj of jjjj-mm-dd." }],
  "categorised": 0
}
```
- `afterCutoff`, `probable` and `categoryTaken` (0.5-4) sit next to `categorised`, added up over the batches: see "Overlap and duplicates". They are not part of the batches (nothing stores them; `GET /api/imports` has no such counts).
- `categorised` is how many of the imported rows have a category (from the choices or a rule; `0` for a file without category columns, unless a rule matched). `batches` has one batch with `accountId`, or one per account name of the file, in the order of each name's first row (before 0.5-2 the answer had a single `batch`). `source`: `argenta` or `bilance` when the header set matches that export, else `csv`. `imported`: rows stored. `present`: rows the account already held. `invalid`: rows skipped as unreadable or refused; the unreadable rows of the file count on the first batch. `errors`: at most 20, as in the preview.
- The same file twice makes second batches with `imported: 0` and every readable row counted as `present`.
- A file without a readable row stores nothing and answers `400` ("Geen enkele regel van het bestand kon gelezen worden. Er is niets geïmporteerd."); so does a file whose readable rows all belong to another account ("Dit bestand hoort bij een andere rekening dan de gekozen rekening."), and a file of several accounts into an account without an IBAN ("Dit bestand bevat meer dan één rekening. Kies een rekening met een IBAN of splits het bestand."). Neither makes a batch.

### `GET /api/imports` (0.3-6)
The import history: the batches of every account the viewer holds (read-only ones too), newest first, each in the `batch` shape above plus `undoneAt` (the time it was undone, `null` while it stands; also in the `POST` answer, always `null` there) and `run` (the lowest batch id of its file import among the batches the viewer can see, see "Undo"; only here); `[]` without any. An undone batch stays in the list, and so does a batch that brought nothing (`imported: 0`, e.g. the same file again): the history is honest, the web app shows the one muted as "Niets nieuws toegevoegd" without an undo. There is no paging: the list is as long as the imports are many.

### Errors
`400 invalid` (a Dutch message that never repeats cell text): a bad file (empty, not text, no delimiter, only a header line, UTF-16, more than 100 000 rows, more than 64 columns in the header or more than 64 delimiters in any row, a quote error in the header line, more than 50 account names or 500 category pairs), a bad mapping or settings (above), a bad account map (a name of the file without an account, `accountId` and `accountMap` together, an account without the mapping), a bad upload (no `file`, a part twice, an unknown part, either the mapping or the account missing in the import). `403 forbidden`: the account is read-only for the viewer. `404 not_found`: the account is hidden from the viewer, or `accountId` is not a positive number. `413 too_large`: the file is over 20 MiB. `415`: not multipart. `429` with `Retry-After`: more than 60 previews or 20 imports per user per hour. `503 unavailable`: two uploads (previews and imports together, any user) are already running ("Er loopt al een import. Probeer het over een minuut opnieuw."); it does not count towards the hourly limits.

### Checks per row
A row that fails is skipped and reported by its line in the file; the rest goes on. Nothing is stored before the whole body is read and parsed, and the batch and its rows are written in one database transaction, so an import is atomic.
- **Currency:** only EUR. A currency cell that is not `EUR` makes the row unreadable; without a `currency` column every row counts as EUR.
- **Account:** the `account` cell must be a valid IBAN. When the target account has an IBAN, a row whose own account is another IBAN is refused and counted as unreadable; its error shows that IBAN masked ("Rekening BE68 •••• •••• 4821 in het bestand is niet de gekozen rekening."). An empty cell is not checked. When the target account has **no** IBAN and the `account` cells name more than one distinct account (whatever the row order, unreadable rows in between or not), no row can be told apart: every readable row is refused and counted as unreadable, each with the error "Het bestand bevat rijen van meer dan één rekening, en de gekozen rekening heeft geen IBAN om ze uit elkaar te houden." (no IBAN in it); the preview answers `200` with `new: 0`, `present: 0`, `overlap: 0` and these errors, the import `400` (above). A file of one account (or without account cells) into an account without an IBAN imports as usual: there is nothing to check it against. With `accountName` mapped (Bilance has no IBAN) the IBAN guard does not apply: each row goes to the account its name is mapped to, and the other checks stay (access to every account, currency).

### What the parser reads
- Limits: 20 MiB, 100 000 data rows (blank lines do not count), 64 columns, 1 000 characters per cell (a longer cell makes its row unreadable). Before 0.5-2 they were 5 MiB and 20 000 rows. The file is read in one piece, up to the limit and never further (a larger upload is refused unread), and parsed in memory (several times the file size at its peak), and at most two imports run at the same time (a third answers `503`).
- Encoding: UTF-8 (a BOM is dropped), else Windows-1252; the `encoding` setting forces one of the two (invalid UTF-8 then shows as U+FFFD). A UTF-16 file (a UTF-16 byte order mark, or a NUL in one of the first two bytes) is refused with "Dit bestand is opgeslagen als UTF-16. Sla het op als CSV (UTF-8) en probeer opnieuw."; any other file with a NUL byte or more than 2% control characters is refused as not text.
- Delimiter: `;`, tab or `,`: the most frequent one on the header line (the first non-blank line; `;` wins a tie), or the `delimiter` setting. Excel's first line `sep=;` (or `sep=,`, `sep=` and a tab), exactly, sets the delimiter and is skipped; line numbers stay those of the file. Standard CSV quoting; white space before a field is dropped (so `, "text"`, as Bilance writes it, is a quoted field), except with a tab as delimiter. A row with another number of fields than the header is unreadable (empty trailing cells are tolerated), and so is a row with a quote error.
- Cell text is cleaned (control characters dropped, line breaks and runs of spaces become one space). Counterparty is cut at 140 characters, communication at 500. Cells are stored as data and never evaluated.
- Dates: `dd/mm/yyyy`, `dd-mm-yyyy`, `dd.mm.yyyy` (day and month with one or two digits) or `yyyy-mm-dd`, each optionally followed by a time of day (`00:00:00.000`, `14:30`) which is ignored; no two-digit years; from 1990-01-01 up to today (Brussels), so a future date makes the row unreadable. The `dateFormat` setting fixes the order of the three parts (`dmy`, `mdy` or `ymd`, any of the separators) instead of the two orders above. A value date or counterparty IBAN that cannot be read is left out, not an error.
- Amounts become integer cents, never floats. One sign (`+`, `-` or `−`) in front or behind; `€` or `EUR` in front or behind; digits with `.` and `,`; thousands groups of exactly three digits. A number that shows its decimal separator is read as shown (`1.234,56`, `1,234.56`, `12,5`). A single separator followed by exactly three digits (`1.234`) is decided per file, by the separator the other amounts of that column agree on, or by the `decimal` setting; when they show none, or both, the row is rejected as ambiguous. More than two decimals are accepted only when the extra ones are zeros. Rejected: two signs, other characters, an empty cell, more than 9 007 199 254 740 991 cents in absolute value (JavaScript's largest safe integer, so the web shows it exactly).

### Bilance
`preset: "bilance"` (and `source: "bilance"`) when the headers include Titel, Datum, Bedrag, Categorie, Subcategorie, Betalingskenmerk, Handelaar and Rekening(en) (Tag(s) and Notitie may be missing). The layout is read from one real export (spike S2, [0.5-1](../plan/v0.5-bilance-import/01-spike-bilance-csv.md)): UTF-8 without BOM, LF, `, ` (comma and space) between fields, text fields in quotes, dates `2026-11-02 00:00:00.000`, amounts `-170.00€` (minus in front, dot decimal, `€` behind; a leading `+` is read too), two category columns, the account as a name in `Rekening(en)` and no counterparty IBAN. Incomes, amounts of 1 000 or more, transfers, splits and a cell with several accounts were not in that sample: a cell with a comma or semicolon in `Rekening(en)`, a bad amount or a bad date is an unreadable row, never a guess. The suggested mapping is the generic one through the header names, with `Handelaar` as the counterparty, `Titel` as `counterpartyFallback`, `Betalingskenmerk` as the communication, `Notitie` as the note and `Rekening(en)` as `accountName`.
- **Counterparty:** `Handelaar` with every run of white space collapsed to one space (the export pads it), `Titel` when `Handelaar` is empty. Every column stays in the stored raw row (`raw_payload`), which no route returns.
- **Communication:** `Betalingskenmerk` as it is when it holds a structured `+++123/4567/89012+++`. A card payment string (it contains `|.|`: merchant, date `dd-mm-yyyy`, time, place, country, masked card number, merchant code and the card holder's name) is reduced to merchant, date and place, for example `Winkel Voorbeeld 02-11-2026 Antwerpen`. A string of another shape (not eight parts, or no `dd-mm-yyyy` second part) keeps its first part only. The card holder's name and the masked card number are never stored outside the raw row and never appear in a preview sample, a row error or the log. This holds for any file: a cell with `|.|` in the communication or the sample is reduced the same way.
- **Note and tags:** `Notitie` becomes the note of the transaction; `Tag(s)` only stays in the raw row.
- **Categories:** `Categorie` and `Subcategorie` are read as two parts per row, listed in the preview (`categories`) and mapped onto Saldo's category tree, see "Category mapping".

### Category mapping (0.5-3)
A source category is the pair (`category`, `subcategory`), two separate strings, never joined (names hold commas, `&` and ` / `). The mapping says where each pair goes in the shared category tree. It is **per user and per source** (`argenta`, `bilance`, `csv`; table `category_mappings`, unique per user, source and pair); another member never reads or changes it. A pair with an empty `subcategory` is the mapping of that main category alone. The target is a category id, or `null` for "leave uncategorised" (also what removing the target category without `moveTo` leaves; a merge with `moveTo` moves the mappings along, see "Categories").

**The choices of an import.** `POST /api/imports` and `POST /api/imports/preview` take an optional part `categories`, a JSON array with one choice per pair of the file (a pair without a choice stays uncategorised and is not saved):
```json
[
  { "category": "Wonen", "subcategory": "Huur, hypotheek", "action": "map", "categoryId": 12 },
  { "category": "Winkelen", "subcategory": "Overig", "action": "create", "new": { "name": "Webwinkels", "parentId": null, "type": "expense", "icon": "👜" } },
  { "category": "Inkomen", "subcategory": "Loon", "action": "skip" }
]
```
- `action` is `map` (to the existing `categoryId`), `create` (a new category, `new.name`, with `new.parentId` for a subcategory, which takes its parent's type and colour and needs no `type`, or without it a main category of `new.type`, `expense` when empty, with `new.colour` optional, and an optional `new.icon`, one emoji) or `skip` (leave uncategorised). **Merge** is several pairs mapped to the same `categoryId`; several `create` choices with the same name, parent and type share one new category (what "per hoofdcategorie" needs).
- New categories are made by the same code and rules as `POST /api/categories` (names, uniqueness, icon), inside the database transaction of the import: a failed import, and every preview, leaves no category behind. Rows of a mapped pair get that `category_id` with origin `import` (never overwritten by rules, suggestions or "apply to similar"; only an explicit manual pick on that row replaces it). Rows of a skipped or unchosen pair stay without category and origin (account rules still apply to them, as for any new row). A row the account already held is not stored, so it gets nothing here.
- After a real import the choices are saved as the viewer's mapping for the source: an upsert per pair; saved pairs this file does not have are kept. A `skip` is saved too (`categoryId: null`), so the next preview shows it as saved.
- `400` for: an unknown `action`, a `categoryId` that does not exist or is missing for `map`, a name or icon the category rules refuse, a pair twice, more than 500 choices, unknown fields, and choices for a file whose mapping has no category column. A part over 256 KiB is `400` as well.
- Imported rows keep the two parts of their source category (`import_category`, `import_subcategory`; no route returns them) so a changed mapping can be re-applied. Rows of an import before 0.5-3 have none and are never touched by a re-apply.

### `GET /api/imports/mappings?source=bilance` (0.5-3)
The viewer's saved mapping for the source, `[{"category": "Wonen", "subcategory": "Huur, hypotheek", "categoryId": 12}]` (`categoryId` null: leave uncategorised), sorted by pair; `[]` when none. An unknown `source` is `400`.

### `PUT /api/imports/mappings?source=bilance` (0.5-3)
JSON body: an array like the answer above. Saves each entry as the viewer's own mapping (upsert per pair; pairs the body does not name stay) and answers `200` with the whole mapping. `400` for an unknown source, a `categoryId` that does not exist, a pair twice or more than 500 entries. It only changes the mapping; rows already imported change on a re-apply.

### `POST /api/imports/{id}/reapply-categories` (0.5-3)
Rewrites the category of the rows of one batch from the viewer's saved mapping for the batch's source, in one database transaction, and answers `200 {"changed": 4}`. It touches only rows the import categorised (origin `import`) and rows still without category and origin that came from a pair now mapped (a skipped pair), never a category set by hand, by a rule or by a suggestion, and never a split row. A pair now mapped to `null` clears the category and origin of its rows; a pair the mapping lacks leaves its rows as they are. Needs edit access to the batch's account: hidden or unknown batch `404`, read-only `403`. The mapping used is the viewer's own, whoever imported the batch.

### Undo (0.5-5)
An import can be reversed whole. Two routes, both on a batch id of the viewer; `?run=1` (`run` is `1` or absent, anything else is `400`) takes the whole **file import** the batch belongs to instead of the batch alone. A file that went to several accounts (0.5-2) makes one batch per account; those batches share the file hash, the creator and the creation second, and that is what a **run** is (no column: `GET /api/imports` answers `run`, the lowest batch id of the run). A run is always the viewer's part of it (0.6-2): its batches on accounts the viewer holds, and the batch named must be one of them; a member of a shared account who did not import the file sees, previews and undoes only the shared account's batch, never learns the id of a batch on someone else's account, and a hidden batch id answers `404` with or without `run`. The web app always uses `run=1`, so it undoes a file as one entry; per-account undo is the API without `run`.

#### `GET /api/imports/{id}/undo-preview[?run=1]` (0.5-5)
Counts what an undo would remove, changing nothing: `200 {"batches": 2, "rows": 28, "changed": 3, "categorised": 25}`. `rows` is every transaction of the batches that still stand; `categorised` those with a category; `changed` those the user changed after the import, defined as: a category set by hand (origin `manual`) or by confirming a suggestion (origin `suggestion`), or a split. A rule's category is not counted (rules also fire during the import itself) and neither is a note (an imported note cannot be told from a typed one). So `changed` is a floor, never an overcount.

#### `POST /api/imports/{id}/undo[?run=1]` (0.5-5)
Deletes the transactions of the batch (with `run`, of every batch of the run that still stands) and sets `undone_at`, in **one** database transaction, all or nothing; answers `200 {"batches": 2, "removed": 28}`. The batch rows stay for the history. Only rows with the batch's id are deleted: manual rows, synced rows and the rows of other batches are never touched. The splits and the "is a transfer" overrides of a deleted row go with it (`ON DELETE CASCADE`; those are the only tables that point at a transaction), and so do the notes and categories set on it. Audit-logged (`import_undone`: the ids and counts, nothing else).
- **Stays:** categories the import created; categories the import handed to **existing** transactions (0.5-4, `categoryTaken`: writes outside the batch, origin `import`); the saved category mapping of the viewer. An undo removes a user's own edits on the batch's rows too: that is the reason for the preview, which the web app shows before it asks.
- **Access:** edit access to the account of every batch involved. A batch that is unknown or on an account the viewer does not hold, `404`; a read-only account, `403` (for a run, one such account refuses the whole run). A batch that is undone already (`400` "Deze import is al ongedaan gemaakt."), or one that brought nothing (`imported: 0`, `400` "Deze import heeft niets toegevoegd, dus er valt niets ongedaan te maken."), `400`. With `run`, batches of the run that are undone or empty are left out; `400` only when none is left. The same errors apply to the preview.
- **After an undo** the same file imports again with all its rows: the exact rule compares with the rows the account holds, and the undone rows are gone. The sync's import rule only counts batches with `undone_at` empty, so it stops treating the account as one with imports once its last batch is undone.

### Overlap and duplicates (0.5-4)
The Bilance history overlaps what the bank already synced. Two things apply to a **Bilance file only** (`source: "bilance"`): a **cutoff** and the matching of **probable duplicates**. A generic or Argenta file keeps the exact rule of "Duplicates" and nothing else, because the generic import is also the fallback after a failed sync, which a cutoff at the first synced date would block. Sending `duplicates` or `cutoffs` with such a file answers `400` ("Een afkapdatum en de keuze voor dubbels gelden alleen voor een Bilance-bestand.").

**Order, per account part of the file.** (1) Rows booked on or after the account's cutoff are skipped and counted in `afterCutoff`; they are not matched at all, so a duplicate on or after the cutoff is never listed. (2) The rows left are matched with the booked rows the account holds, once per stored row: a row that equals one exactly (booking date, amount, counterparty and communication, counted per occurrence: the rule of "Duplicates") is `present`; then each row left that matches a stored row *not yet matched* fuzzily is a **probable duplicate**. (3) Probable duplicates are skipped (`probable`) unless their line is included; the rest is stored.

**Fuzzy rule.** Same account, same amount (exactly, so the same sign), booking dates at most one day apart, and a similar counterparty: equal after normalising (lower case, accents folded, punctuation as a space, words that are only digits and the words `be`, `bv`, `bvba`, `nv`, `sa`, `sprl`, `vzw` and `ab` dropped), or one contains the other as whole words (the shorter at least 4 characters), or at least half of the larger name's words are shared words of 3 letters or more. A name without words matches nothing. Only booked stored rows count, from any source. A stored row is matched at most once, by the exact or the fuzzy rule, so one stored row never swallows several rows of the file: rows go in file order, the closest date then the oldest stored row wins. The sync does not use the fuzzy rule (it keeps the exact one): two real payments of one amount a day apart would be merged.

**Cutoff.** The part `cutoffs`, a JSON object (at most 8 KiB) of an account id (a decimal string, one of the import's target accounts) to a date `yyyy-mm-dd` or `null`: `{"1": "2025-11-01", "3": null}`. Rows of that account with a booking date **on or after** the date are skipped; an account without an entry, or with `null`, has no cutoff. A bad date or key, or an account that is not in the import, answers `400` ("De afkapdatums kloppen niet. Geef per rekening een datum als jjjj-mm-dd, of null voor geen."). The preview suggests the date: `cutoffs: [{"accountId": 1, "suggested": "2025-11-01"}]`, per target account, the booking date of the account's earliest booked row that a sync brought (a row with a bank connection; imported rows never count), `null` for an account without one. The server never applies the suggestion by itself; the wizard sends it as the default and lets the user change or clear it.

**Probable duplicates.** A preview with counts answers `duplicates: {"total": 2, "items": [...]}`: `total` is how many were found (included or not), `items` the first 200 in file order, each:
```json
{ "line": 26, "accountId": 1, "date": "2026-10-18", "amount": -1199, "counterparty": "SPOTIFY AB", "note": "",
  "source": ["Winkelen", "Overig"], "category": { "name": "Streaming", "icon": "📺", "colour": "c5" }, "takes": false,
  "existing": { "id": 412, "date": "2026-10-17", "amount": -1199, "counterparty": "Spotify", "communication": "Spotify Premium",
                "category": { "name": "Abonnementen", "icon": "🔁", "colour": "c5" }, "imported": false } }
```
`line` is the line of the file (the header is line 1; stable within one file) and identifies the row; `counterparty` and `note` are the stored forms (the card holder and card number never appear; no raw row is returned); `source` the file's category and subcategory; `category` the Saldo category the row gets through the `categories` choices, `null` for none; `takes` is true when the stored row has no category and no split parts, so it takes `category` if the row is skipped; `existing.imported` tells a row of an earlier import from a bank row. Only for a Bilance preview of a file with `counts`; left out otherwise.

The part `duplicates`, `{"include": [26, 31]}` (at most 5000 line numbers, each 1 to 16 777 216), names probable duplicates to import anyway, as normal rows with their mapped category. A line that is not a probable duplicate is ignored; a non-integer, a number out of range, an unknown key or too many answers `400` ("De keuze voor de dubbels klopt niet."). The preview accepts it too (the counts then treat those rows as `new`), but the wizard asks the preview without it and works the effect out from the listed rows, so a click asks the server nothing.

**Category taken over.** A skipped probable duplicate whose stored row has no category and no split parts gives that row the category its own row would have got (through the `categories` choices), with origin `import`, in the import's database transaction: one guarded write, `categorise.Assign` with origin `import`, which only fills a row with no category and never touches a manual, rule, suggestion or earlier import category or a split row. The count is `categoryTaken`. A preview does the writes and rolls them back. These writes are on existing transactions, outside the new batch.

**Counts** (preview `counts` and import answer; `0` for any other file): `afterCutoff` rows skipped by the cutoff, `probable` probable duplicates found and skipped (not the included ones, which are in `new`), `categoryTaken` stored rows that took the file's category. `present` stays the exact matches.

### Argenta
`preset: "argenta"` (and `source: "argenta"`) when the headers include Boekdatum, Valutadatum, Referentie, Bedrag, Munt, Naam tegenpartij and Mededeling (case, accents and punctuation ignored). The header layout of the export is Rekening, Boekdatum, Valutadatum, Referentie, Beschrijving, Bedrag, Munt, Verrichtingsdatum, Rekening tegenpartij, Naam tegenpartij, Mededeling, known from a spreadsheet view of an export. **The delimiter, date format and amount format of the real file are not verified.**

The preset only names the source; the mapping is the generic suggestion: Boekdatum is `date`, Valutadatum `valueDate`, Bedrag `amount`, Naam tegenpartij `counterparty`, Rekening tegenpartij `counterpartyIban`, Mededeling `communication`, Rekening `account`, Munt `currency`. Referentie, Beschrijving and Verrichtingsdatum are not mapped: they are kept only in the stored raw row (`raw_payload`, every cell of the row by header name).

### Duplicates
Imported rows are stored as booked rows through the sync's key path, with the batch id and no entry reference.
- **At import**, a row counts as `present` and is not stored when the account already holds a booked row of the same content: booking date, amount, counterparty and communication all equal (the texts compared without regard to case or spacing), from any source, the sync or an earlier import. It is count-aware: k equal rows in the file against m stored rows make the first min(k, m) present and import the rest, so a second purchase of the same amount on one day is not lost. Pending rows are not compared: a pending row of the same content does not block the booked one, which is stored next to it; the sync removes the pending row once the bank no longer reports it as pending. Fuzzy matching (a day apart, similar names) and the import cutoff are for Bilance files only (0.5-4, "Overlap and duplicates"); they do not apply here.
- **In the sync**, for an account that has an import batch which brought rows, a booked bank row with the same content as a stored row is not stored again, also when its entry reference is new. Per content group of a fetch, only as many rows with a new key go in as the fetch holds more than the account stores of that content: repeating a fetch adds nothing, and a fetch with one more stores exactly that one. Accounts without imports, and pending rows, sync as before.

## Categories (phase 0.4-1)

One category tree shared by every user (analysis 4.2): names, types, colours and icons, never amounts. Anyone signed in may add, rename, move, recolour and remove a category, for everyone. Counts only ever cover the viewer's own transactions.

**Default tree.** On the first start of a database without categories the server adds the Dutch default set of the design (`categorise.Defaults`): expense tops Wonen (`c1`: Huur, Energie, Internet en tv, Verzekeringen), Boodschappen (`c2`: Supermarkt, Bakker), Vrije tijd (`c3`: Uitgaan, Sport, Cultuur, Vakantie), Vervoer (`c4`: Brandstof, Openbaar vervoer, Onderhoud), Abonnementen (`c5`: Streaming, Telefoon), Overig (`c6`); income tops Salaris, Terugbetaling, Bijdrage, Overig inkomen (`soft`). Ids: the expense tops 1–6, the income tops 7–10, then the subcategories in that order. It happens once (`app_settings.categories_seeded`): a database that already has categories only gets the marker, and removing every category never brings the defaults back. Demo mode uses the same tree.

**Shape.** Two levels: a top category and its subcategories. A subcategory has the `type` and `colour` of its parent. **Colours (0.5.1).** `colour` is one string, the *effective* colour in every payload that shows a category (the tree, transactions and split parts, the backfill preview, the import duplicate list): one of `c1` … `c16` (16 pastels; a colour may repeat), `soft` (the income green) or a custom `#rrggbb` (the server lowercases it; `#fff`, `red`, 8-digit hex and anything else answer `400`). Any top category, expense or income, may take a pastel or a hex; `soft` is only for income (the default of income tops, `c6` is the default of expense tops). Storage: migration `0010_category_tint.sql` only adds the nullable column `categories.tint`, because the `CHECK` on `colour` (`c1` … `c6`, `soft`) cannot be widened without a table rebuild, which with foreign keys on would cascade-delete rules, splits, budgets and mappings. A legacy key is stored in `colour` with `tint` NULL; `c7` … `c16` and a hex are stored in `tint` with `colour = 'c6'`; reads return `COALESCE(tint, colour)`. Existing rows keep their colour. Every colour write sets both columns through one helper; a subcategory always has its parent's effective colour.

**Icons (CAT-6, emoji since 0.5.1).** Every category, top or sub, may carry an `icon`: one emoji, such as `"🏠"`, `"👨‍👩‍👧"`, `"🇧🇪"` or `"1️⃣"`, chosen in the web's picker or typed or pasted from the phone's emoji keyboard. `categorise.ValidIcon` (`server/internal/categorise/icons.go`) accepts a string that is trimmed, 1 to 64 bytes of valid UTF-8 (a skin-toned ZWJ family such as 👨🏽‍👩🏽‍👧🏽‍👦🏽 is 41 bytes), without ASCII letters, spaces or control characters, with ASCII digits, `#` and `*` only as a keycap (followed by U+FE0F or U+20E3) and at least one rune of U+00A9 or higher; it does not count graphemes (the web enforces one with `Intl.Segmenter`, which is enough while only the web writes icons). The icon is chosen per category (a subcategory does not inherit it); the colour is never chosen per subcategory, it stays that of the main category. `null` means none: the client shows `🏷️`. Migration `0007_category_icons.sql` added the nullable column; `0009_category_emoji.sql` turned the 49 line-icon names of 0.5.0 and earlier (home, cart, car, ...) into their emoji and cleared any other plain-ASCII value (a renamed category without a known icon stays `null`). A new database gets its icons from `categorise.Defaults`.

### `GET /api/categories` (0.4-1)
The whole tree, flat, in tree order: the expense tops by `sort_order`, each followed by its subcategories, then the income tops likewise.
```json
[
  { "id": 1, "name": "Wonen", "type": "expense", "colour": "c1", "parentId": null, "icon": "🏠", "count": 0 },
  { "id": 11, "name": "Huur", "type": "expense", "colour": "c1", "parentId": 1, "icon": "🏠", "count": 12 }
]
```
`type`: `expense` | `income`. `icon`: one emoji or `null`. `count` is the number of the **viewer's own** transactions (on accounts the viewer holds) in this category, not including its subcategories; another user's transactions never count. Since 0.4-3 a split transaction counts once under each category it has a part in (two parts in one category count once) and no longer under its own hidden category.

### `POST /api/categories` (0.4-1)
A top category `{"name": "Huisdieren", "type": "expense", "colour": "c3", "icon": "🐾"}` (`colour` optional: `c1` … `c16`, a `#rrggbb` or, for income, `soft`; default `c6` for expense, `soft` for income) or a subcategory `{"name": "Dierenarts", "parentId": 3, "icon": "💊"}` (`type` or `colour` with `parentId` answers `400`). `icon` is optional on both (absent, `null` or `""` = none). Answers `201` with the category as in the list (`count` 0). It goes last among its siblings; there is no reorder API.

### `PATCH /api/categories/{id}` (0.4-1)
Any of `name`, `parentId` (a top category's id, or `null` to become a top category), `type` (only for a category that is, or with `parentId: null` becomes, a top category without subcategories; a new type takes its default colour unless `colour` is sent too) `colour` (top categories only, expense or income; `c1` … `c16`, `soft` for income, or `#rrggbb`) and `icon` (any category; one emoji, or `null` or `""` to clear it; leaving it out keeps it). Moving under a parent adopts its type and colour (a moved subcategory may change type, as the design's "Plaats" select allows). Recolouring a top category recolours its subcategories. Answers the category; an unknown id `404`.

**Names** are trimmed with runs of white space collapsed, 1–60 characters, no control characters. Commas, ampersands, slashes, quotes and any other punctuation are plain data (Bilance's names look like `Energie, nutsvoorzieningen` and `Eten & Drinken`): never split, stripped or refused. A name is unique per parent, case-insensitively (two top categories share the parent "none", whatever their type).

**Errors** (`400 invalid`, Dutch): an empty, too long or control-character name; a name its parent already has; a parent that does not exist, is itself a subcategory or is the category itself; moving a category that has subcategories under another one ("Verplaats eerst de subcategorieën. Saldo heeft twee niveaus."); a type change of a subcategory or of a top with subcategories; a colour for a subcategory, a colour that is not `c1` … `c16`, `soft` (income only) or `#rrggbb` ("Kies een kleur uit het palet of een eigen kleur (#rrggbb)."); an icon that is not one emoji ("Kies een icoon uit de lijst.", for example a word such as `home`); an unknown field.

### `DELETE /api/categories/{id}?moveTo=<categoryId>|none` (0.4-1)
Removes a category for everyone and says where everything that used it goes; `moveTo` is required (`400` without it, like `history=` of a bank link). One database transaction, then `204`; audit-logged (`category_removed`, ids only). A category with subcategories answers `400` ("Verwijderen kan pas als er geen subcategorieën meer onder hangen."); an unknown one `404`.
- `moveTo=<id>`: a category that exists, differs and has the same type (`400` otherwise). The transactions of **every user** move to it, keeping their origin (a manual choice stays manual, a rule's stays the rule's with its `rule_id`); split parts, rules, budgets (one per account, category and month: on a clash the target's budget stays and the other is dropped), Bilance category mappings and suggestions move with them. The viewer is never told how many transactions of others moved.
- `moveTo=none`: the transactions become uncategorised (category, origin and rule cleared), the category's rules, budgets and suggestions are deleted and its mappings become "leave uncategorised". Refused (`400`) while a split part uses the category: a split part cannot be uncategorised.

This is also the **merge** of two categories (phase 0.5-3 maps Bilance categories onto app categories with it, see "Category mapping").

## Rules (phase 0.4-2)

A rule gives transactions a category without the user doing anything (analysis 4.2). Conditions, all optional and ANDed, at least one required:
- `counterparty` (at most 140 characters): `counterpartyExact: false` means "contains", `true` "equals". Compared on normalised text: lower case, Latin diacritics folded (`é` is `e`), runs of white space collapsed and trimmed, so `Winkel Voorbeeld   Antwerpen` contains `winkel voorbeeld`.
- `counterpartyIban`: equal to the transaction's counterparty IBAN. Stored normalised (upper case, letters and digits); any value of 8–34 letters and digits starting with two letters is accepted, without a check-digit test. Shown masked like every IBAN (`"••••"` for a value shorter than an IBAN).
- `communication` (at most 200 characters): with `communicationRegex: false` "contains" (normalised as the counterparty), with `true` a Go RE2 regular expression, matched case-insensitively against the communication with its white space collapsed (not diacritic-folded). A pattern that does not compile answers `400` ("Deze reguliere expressie klopt niet."). RE2 runs in time linear in the input (no catastrophic backtracking); a rule reads at most the first 1 000 characters of a communication.
- `amountMin` / `amountMax`: cents, compared with the **absolute** amount (as the design: amounts without sign), inclusive, both ≥ 0 and `amountMin ≤ amountMax`.

**Owner.** `accountId`: an account rule, seen by every member of the account and changed by those with `permission: edit`; `accountId: null` (or left out): a user rule of the viewer, seen and changed only by the viewer. At most 200 rules per owner.

**Which rules apply to a transaction**: the rules of its account, plus the user rules of the account's member when the account has exactly one member (a personal account). A user rule never applies to an account with more than one member, and the rules of another user never apply to, nor show in, the viewer's data.

**Priority** `priority`: an integer 0–1000, default 0. A **higher** priority wins; on a tie the newest rule (highest id). The evaluation order is `priority` DESC, `id` DESC everywhere.

**Precedence** (analysis 4.2): a manual choice > the highest-priority matching rule > a learned suggestion. A transaction holds one category, the same for every member of its account, with its origin (`manual` | `rule` | `suggestion` | `import`) and the rule that set it. Rules only ever change a transaction without split parts that has no category or one set by a rule or a suggestion: a manual choice, a category from a Bilance import (`import`) and a split are never touched.

**When rules run**
- On every **new** transaction, before it is stored: in a sync (the nightly job, "Sync now", the link callback, also pending rows) and in a CSV import (also in the preview, which stores nothing). Stored transactions are not re-evaluated by a sync or an import.
- On demand: `POST /api/rules/apply` (all rules), one rule with `POST /api/rules/{id}/apply` (0.4-4), and one rule through "apply to similar" (`POST /api/transactions/{id}/similar`, 0.4-3).
- Creating, changing or deleting a rule does not run it. Deleting a rule keeps the categories it set (origin stays `rule`, `rule_id` becomes `null`).

### `GET /api/rules` (0.4-2)
The rules the viewer can see, in evaluation order:
```json
[
  { "id": 3, "accountId": 4, "priority": 5, "counterparty": "Colruyt", "counterpartyExact": false,
    "counterpartyIban": null, "communication": null, "communicationRegex": false,
    "amountMin": 2000, "amountMax": 20000, "categoryId": 2, "permission": "edit" }
]
```
`permission` is the viewer's on the account (`read` for a read-only member, who sees the rule but cannot change it); a user rule is always `edit`.

### `POST /api/rules` (0.4-2)
Body with the fields above (except `id` and `permission`); `categoryId` is required and must exist. Answers `201` with the rule. Another user's account (or an unknown one) answers `404`, a read-only account `403`.

### `PATCH /api/rules/{id}` (0.4-2)
Any of the fields; a field left out stays, `null` (or `""` for a text) clears that condition, and at least one condition must remain. The owner (`accountId`) cannot change (`400`). A rule the viewer cannot see answers `404`, one of a read-only account `403`. Answers the rule.

### `DELETE /api/rules/{id}` (0.4-2)
`204`; `404` and `403` as for `PATCH`.

### `POST /api/rules/apply` (0.4-2)
No body. Runs the rules over the stored transactions of every account the viewer holds with `permission: edit` and answers `200 {"updated": 3}`: the number of the viewer's transactions whose category changed. A transaction no rule matches keeps what it has (it is never cleared). Running it again answers `{"updated": 0}`.

### `POST /api/rules/preview` (0.4-4)
The live preview of the rule editor ("Past op N transacties"); it writes nothing. Body: a draft as for `POST /api/rules`, plus an optional `ruleId` (the rule being edited). `categoryId` may be left out (or `null`): then nothing changes and `changes` is 0.
```json
{ "matches": 14, "changes": 3, "skipped": { "manual": 0, "import": 0, "split": 0, "rule": 0 } }
```
- The scope is the draft's owner, as for a stored rule: an account rule covers its account, a user rule every account where the viewer is the only member and has edit. Only those rows of the viewer count (pending rows too); another user's rows, and a shared account's rows for a user rule, never do.
- `matches`: the rows that match the conditions, whatever their category, split or not. `changes`: the rows whose category applying the rule would change. `skipped`: as for "apply to similar" (`manual`, `import`, `split`, `rule`: open to rules but another rule outranks the draft); a row that already has the draft's category counts in none of them.
- The draft competes with the owner's other rules as if it were stored: without `ruleId` it wins priority ties (like a rule created now); with `ruleId` it takes that rule's place (that rule leaves the competition, the draft keeps its id).
- With `ruleId` and no `counterpartyIban` key, the draft uses the stored rule's IBAN, because the editor only has it masked and cannot send it back; `counterpartyIban` as a value replaces it, `null` or `""` clears it. Without `ruleId` a missing key means no IBAN condition, as for `POST /api/rules`.
- Checks as `POST /api/rules` (`400` for a missing condition, a pattern that does not compile, an unknown category and so on), except that the category may be missing. `accountId` of an account the viewer cannot see answers `404`, of a read-only one `403`. `ruleId` must be a rule the viewer can see (`404`) and edit (`403`) with the draft's owner (`400` "De eigenaar van een regel verandert niet. Maak een nieuwe regel.").
- The preview runs the same engine as "apply to similar" and `POST /api/rules/{id}/apply` (`categorise.Plan`), so applying the stored rule afterwards changes exactly `changes` rows when nothing changed meanwhile.

### `POST /api/rules/{id}/apply` (0.4-4)
No body. Runs only this rule over its scope (see the preview) in one database transaction, through `categorise.Assign`: manual, imported and split rows are never changed, and a row where another rule outranks this one keeps what it has. Answers `200 {"updated": 3, "skipped": {"manual": 0, "import": 1, "split": 0, "rule": 0}}`; `updated` counts the rows whose category changed, `skipped` as in the preview. Running it again answers `updated: 0`. `404` and `403` as for `PATCH`.

### `PUT /api/rules/order` (0.4-4)
Body `{"ids": [5, 3, 9]}`: every rule the viewer can **edit**, top first (the order of `GET /api/rules` without the read-only rules). Answers `200` with the full `GET /api/rules` list, in which the editable rules now stand in this order.
- Exactly that set: a rule missing, added, unknown, someone else's, read-only or listed twice answers `400` "De lijst met regels is veranderd. Laad ze opnieuw." and changes nothing (the list changed meanwhile: load it again).
- New priorities: the current priorities of those rules sorted from high to low, v0 ≥ v1 ≥ … (n rules), become p0 = max(v0, n−1) and p_i = max(n−1−i, min(v_i, p_(i−1) − 1)). So distinct priorities stay the same set of values (a pure permutation), ties (such as the default 0) are broken, down to 0 at the bottom, and nothing goes below 0 or above 1000 (more than 1001 editable rules answers `400`).
- Rules the viewer cannot edit (a read-only account's) keep their priority, so they may end up in another place among the reordered ones; another user's rules are never touched.
- One database transaction; the same order again changes nothing.

**Errors** (`400 invalid`, Dutch): no condition, a text or pattern too long or with control characters, a pattern that does not compile, an IBAN that is not 8–34 letters and digits starting with two letters, a negative amount or `amountMin > amountMax`, a priority outside 0–1000, a missing or unknown category, the 201st rule of an owner, an unknown field.

## Transfers (phase 0.6-3)
Computed **per viewer at query time** (analysis 5.2); only the override is stored. A transaction is a transfer for the viewer when it has an **other side** among the accounts the viewer can see (`account_access`), unless the viewer's override says otherwise:
- (a) its counterparty IBAN is the IBAN of another account the viewer can see (a bank account or a manual account with a registered IBAN); else
- (b) a **booked** row on another account the viewer can see has the opposite amount (not 0) in the same currency, booked at most 3 days before or after it (the row itself may be pending). A pair whose IBANs contradict it does not count: when the row names a counterparty IBAN and the other account has a different registered IBAN, or the other row names a counterparty IBAN and this row's account has a different one (Partner's contribution from her own IBAN never pairs with Bert's contribution of the same amount). Of several candidates the closest date wins, then the lowest id.

Another user's personal accounts are never looked at, so no flag or kind reveals them; the same row on the family account can be a transfer for one member and not for the other.

`transferKind`, from the other side (the IBAN match, else the matched row's account): `saved` when this row is money leaving a non-savings account (amount below 0) for a `savings` account; else `shared` when it is money leaving a personal account (one member) for a shared account (more than one member): "Naar gedeelde rekening" in Persoonlijk; else `internal` (incoming sides, savings back to current, shared to personal, and an override `true` without an other side).

### `PUT /api/transactions/{id}/transfer` (0.6-3)
Body `{"transfer": true | false | null}`: `true` / `false` store the viewer's override ("Is een overschrijving" / "Is geen overschrijving"), `null` removes it. Answers `200` with the transaction as in `GET /api/transactions`. Any member who can see the transaction may set it, read-only members too: it is the viewer's own data and nothing shared changes; another user's override is never touched. A transaction the viewer cannot see answers the same `404` as a missing one; a body without `transfer`, with another type or with other fields answers `400`. It changes the `uncategorised` filter and count like the computed flag.

### `GET /api/accounts/{id}/transfers` (0.6-3)
The recognised transfers into an account ("Overschrijvingen naar deze rekening" on a manual account with an IBAN): the rows on the viewer's **other** accounts whose counterparty IBAN is this account's registered IBAN, newest first (booking date, then id), at most 50.
```json
[{"id": 41, "bookingDate": "2026-11-05", "amount": -20000, "from": {"id": 1, "name": "Zichtrekening"}, "counterparty": "Spaarrekening"}]
```
`from` is the account the row is on, `counterparty` its counterparty name. An account without IBAN answers `[]`; an account the viewer cannot see answers `404` like a missing one. Overrides do not filter this list.

## Categorise a transaction (phase 0.4-3)

A category by hand, "apply to similar and create a rule", a note and a split, per transaction. Every route needs `permission: edit` on the transaction's account: a transaction the viewer cannot see (another user's, an unknown or a malformed id) answers `404 not_found` ("Transactie niet gevonden."), one of a read-only account `403 forbidden`. Each change is one database transaction and answers the transaction as in `GET /api/transactions`. Error messages never repeat a note, a counterparty or an amount, and none of them is logged.

**One write path each.** A category by hand goes through `categorise.SetManual` (category set, origin `manual`, `rule_id` NULL; it refuses a split row); every automatic change goes through `categorise.Assign`, which only changes a row without split parts that has no category or one of origin `rule` or `suggestion`, and repeats that guard in its SQL. So a manual category, an imported one (`import`) and a split are never changed by rules, "apply to similar", a sync, a CSV import or the pending-to-booked carry-over; only an explicit pick on that single row replaces them.

### `PATCH /api/transactions/{id}` (0.4-3)
Body `{"categoryId": 2}` and/or `{"note": "verjaardagscadeau"}`, at least one field (`400` otherwise).
- `categoryId`: an existing category (`400` "Die categorie bestaat niet."; `null` answers `400`: a category is changed, not removed). Pending rows may be categorised. The row becomes origin `manual` without a rule; a category set by a rule, a suggestion or an import that is picked again by hand becomes `manual` too, and the same manual category again changes nothing. A split row answers `400` ("Deze transactie is gesplitst. Pas de splitsing aan of maak ze ongedaan.").
- `note`: trimmed, runs of white space (line breaks too) collapsed into one space, no control characters, at most 200 characters (`400` "De notitie heeft hoogstens 200 tekens."); `""` or `null` clears it. A note is plain data, visible to every member of the account and not searched.

### `GET /api/transactions/{id}/similar` (0.4-3)
The preview of "Toepassen op vergelijkbare en regel maken" for the row's **current** category; it writes nothing.
```json
{ "counterparty": "Colruyt Laagste Prijzen", "scope": "user", "count": 14,
  "skipped": { "manual": 2, "import": 0, "split": 0, "rule": 1 } }
```
- `counterparty`: the rule's text, the row's counterparty name cleaned as rule input (control characters dropped, white space collapsed, at most 140 characters). `""` when the row has no counterparty name: there is no basis, `count` and every `skipped` are 0 (the web app hides the checkbox).
- `scope`: `user` when the row's account has exactly one member: the rule is a user rule of the viewer and covers every account where the viewer is the only member and has edit. `account` otherwise: an account rule of the row's account, covering that account only.
- `count`: the stored rows **other than this one** (pending rows too) whose category the rule would change. `skipped`: the other rows that match the rule but stay as they are: `manual` (a manual category), `import` (an imported category, or one of unknown origin), `split` (split parts), `rule` (open to rules, but another rule outranks this one). A row that already has the category counts in none of them.
- `400` "Kies eerst een categorie." for a row without a category; `400` for a split row. Needs edit permission like the `POST` (a read-only member gets `403`).

### `POST /api/transactions/{id}/similar` (0.4-3)
No body (`{}` is allowed). In one database transaction: the checks of the preview (no counterparty name: `400` "Deze transactie heeft geen tegenpartij om op te vergelijken."), the row's current category made manual (`SetManual`), the rule created or reused, and that rule applied with the same engine as the preview (`categorise.Plan`, written through `categorise.Assign`). Answers `200`:
```json
{ "transaction": { "id": 101, "categoryOrigin": "manual" },
  "rule": { "id": 9, "accountId": null, "priority": 0, "counterparty": "Colruyt Laagste Prijzen", "counterpartyExact": false,
            "counterpartyIban": null, "communication": null, "communicationRegex": false,
            "amountMin": null, "amountMax": null, "categoryId": 2, "permission": "edit" },
  "ruleCreated": true, "updated": 14,
  "skipped": { "manual": 2, "import": 0, "split": 0, "rule": 1 } }
```
(`transaction` in full as in `GET /api/transactions`, shortened here.)
- The rule: `counterparty` as in the preview, "contains", no other condition, priority 0, the row's category; owner per `scope` (a user rule of the viewer, or an account rule of the row's account).
- **Reuse.** When the owner already has a rule whose only condition is this counterparty ("contains", equal after normalising: case, diacritics and white space do not matter), that rule gets the row's category and `ruleCreated` is `false`; no second rule is made. This is the repair after a wrong pick and the undo of a bulk apply: pick the right category with the checkbox on again, the same rule is reused and the rows it set follow. There is no history of rows to restore.
- `updated`: the rows other than the clicked one whose category changed; it equals the preview's `count`, and `skipped` the preview's `skipped`. Idempotent: a second call answers `updated: 0` and `ruleCreated: false`.
- The 201st rule of an owner answers `400` and changes nothing (reuse is not capped).

### `PUT /api/transactions/{id}/split` (0.4-3)
Body `{"parts": [{"categoryId": 3, "amount": -6492}, {"categoryId": 1, "amount": -2150}]}`. Booked rows only (a pending row's amount may still change: `400` "Splitsen kan pas als de bank de transactie boekt."); 2 to 10 parts; every part has the sign of the transaction's amount and is not 0; the parts add up to the amount exactly (`400` "De delen tellen samen niet op tot het bedrag."); every category exists. It replaces earlier parts. The row's own category, origin and rule stay stored but hidden, to come back on undo. Answers the transaction (`category` `null`, `splits` set).

### `DELETE /api/transactions/{id}/split` (0.4-3)
Removes the parts and answers the transaction with its earlier category back (or none). A row without parts answers `200` too.

**A split row** is never changed by a rule or a suggestion, cannot get a category by hand (`PATCH` answers `400`), is not "uncategorised", and counts under its parts' categories in `GET /api/categories`. A category a split part uses cannot be removed with `moveTo=none` (see "Categories").

### Pending to booked (0.4-3)
When a sync deletes a pending row that the bank books now (see "Sync with a real connection"), a booked row of the same fetch that is being **stored now** (never one that was stored before) inherits from it: its note, and its category with origin `manual` when the pending row's category was manual. Nothing else is carried: a rule's category comes back through the rules on the new row, there is no rule link and no split (pending rows cannot be split). Pairs: same account, same signed amount, the same counterparty after normalising (case, diacritics and white space do not matter), booking dates at most 7 days apart; one to one, the closest dates first (then the lower pending id, then the earlier booked row). The same fetch again changes nothing.

### Decisions (0.4-3)
- Splits only on booked rows; the row's own category is kept under a split for undo.
- Notes: at most 200 characters, visible to all members of the account, changed with edit permission, not searched.
- An imported category is protected from automatic writers and from "apply to similar"; only a pick by hand on that single row replaces it.
- "Apply to similar" changes only rows without a category or with a rule's or a suggestion's; never a manual or imported category or a split.
- Transfers between own accounts may carry a category: nothing skips them.

## Suggestions (phase 0.4-4)

A suggestion (CAT-5) proposes, for a counterparty the viewer has categorised before, the category they chose most often, for the rows of that counterparty that still wait for a category. It is computed on every read from the viewer's own data; nothing of another user is used and `GET` writes nothing. Learning on the Bilance history (confidence, level, backfill) is 0.5-6, below.

**Model** (`categorise.Suggest`):
- Training rows: the transactions on accounts the viewer holds (read-only too) without split parts, with a category of origin `manual` or `import` (human decisions; categories set by a rule or a suggestion are echoes and do not count) and a counterparty name. They are grouped per counterparty key: the name normalised like rule text (lower case, diacritics folded, white space collapsed), so `Bakkerij De Graankorrel` and `BAKKERIJ  DE GRAANKORREL` are one key.
- Per key: `seen` = its training rows; the category with most rows wins (a tie: the category of the newest row, by booking date then id); `confidence` (0.5-6, smoothed) = round(100 × the winner's rows / (`seen` + `categorise.Smoothing`)) with `Smoothing` 2. A share earned on few rows counts for less: 2 of 2 is 50, 3 of 3 is 60, 8 of 8 is 80, 10 of 10 is 83, 8 of 10 is 67, a 1:1 split is 25 (not offered).
- `level` (0.5-6): `high` when `confidence` ≥ 80 (`categorise.HighConfidence`) and `seen` ≥ 5 (`categorise.HighSeen`), else `low`. `high` is offered as a rule (the web app's "Maak regel" is its primary action); `low` is only for confirmation. At Smoothing 2 a confidence of 80 already needs 8 rows, so `HighSeen` only guards a later change of the formula.
- The training data is computed on every read, with nothing stored: rows of origin `manual` or `import`, so an undone import batch (its rows are gone) stops training at once, and a category set by a rule or a suggestion never trains.
- Offered when `seen` ≥ 2 (`categorise.MinSeen`), `confidence` ≥ 40 (`categorise.MinConfidence`), `open` ≥ 1, the category exists, and the viewer has not confirmed or dismissed that key and category before. `open` = the rows of the key without a category and without split parts (pending rows and transfers too) on accounts the viewer may **edit**. Only the winning category is offered: a dismissed winner does not make way for the second.
- Every suggestion waits for confirmation; nothing is applied automatically.

### `GET /api/suggestions` (0.4-4)
```json
[ { "counterpartyKey": "bakkerij de graankorrel", "counterparty": "Bakkerij De Graankorrel",
    "categoryId": 2, "confidence": 92, "level": "high", "seen": 11, "open": 1 } ]
```
`counterparty` is the spelling of the newest open row. `level` is `high` or `low`. Order: `confidence` desc, `open` desc, `counterpartyKey`. "N suggesties om te bevestigen" in Meer is the length of this list.

### `POST /api/suggestions/confirm` (0.4-4)
Body `{"counterpartyKey": "bakkerij de graankorrel", "categoryId": 2}`. In one database transaction: the suggestion is derived again; every open row of the key on the accounts the viewer may edit gets the category through `categorise.Assign` with origin `suggestion` and no rule (a row with any category, and a split row, stays as it is, so a manual, imported or rule category is never replaced); the viewer gets a rule for new rows (below); the decision `confirmed` is stored. Answers `200 {"updated": 3, "rule": {"id": 12, "created": true, "conflict": false}}`. A suggestion that is not offered answers `404` "Deze suggestie bestaat niet meer."; one the viewer confirmed already answers `200 {"updated": 0, "rule": null}` (a repeated request: nothing changes). A confirmed suggestion never comes back for that key and category: it categorised the rows that waited then. Rows that arrive later get the category from that rule when they land on one of the viewer's personal accounts.

**The rule.** Confirming also makes sure the viewer has a user rule (no account, as "apply to similar" makes for a personal account) with the condition "counterparty is equal to" the suggestion's counterparty (the newest spelling, cleaned like rule text) and the suggestion's category, in the same transaction. The rule is not run: the confirm just categorised the rows that waited. `rule` says what happened:
- `created: true`: a new rule, `rule.id` is its id.
- `created: false, conflict: false`: an equivalent rule existed and is reused, nothing is written: the first, in evaluation order, of the viewer's user rules whose only condition is that counterparty (normalised), "is equal to" or "contains", with the suggestion's category.
- `conflict: true` (`created: false`): the viewer's rule for that counterparty has another category; `rule.id` is that rule and it stays as it is. No rule is created and the rows that waited are still categorised.
- `rule: null`: there is no rule to report: a repeated confirm, or a counterparty name that rule text cannot hold (cleaning it, for example cutting it to the length rule text may have, changes its normalised form).
- A user rule only applies to accounts where the viewer is the only member (as in the preview above): a suggestion built from the rows of an account with more than one member categorises those rows, but its rule will not reach that account.
- The limit of 200 rules per owner applies: at the limit the creation fails with its usual `400` "Er zijn al 200 regels voor deze eigenaar. Verwijder er eerst een." and the whole confirm fails with nothing stored (no row categorised, no decision).

### `POST /api/suggestions/dismiss` (0.4-4)
Same body. Stores `dismissed` and answers `204`; the suggestion never comes back for that key and category. Not offered: `404` as for confirm; dismissed already: `204` again (a repeated request).

### `GET /api/suggestions/backfill` (0.5-6)
What "Geschiedenis toepassen" would do, written nowhere: the offered suggestions (the same `categorise.Suggest`, the same training, thresholds and decisions) as one list with a preview, for the rows without a category and without split parts on the accounts the viewer may edit.
```json
{ "groups": [ { "counterpartyKey": "bakkerij de graankorrel", "counterparty": "Bakkerij De Graankorrel",
    "category": { "id": 2, "name": "Boodschappen", "icon": "🛒", "colour": "c2" },
    "level": "high", "confidence": 92, "rows": 4,
    "examples": [ { "date": "2026-11-12", "amount": -450 } ] } ],
  "rows": 4, "left": 9, "limit": 2000, "groupLimit": 200 }
```
`groups` has the order of `GET /api/suggestions`. `examples` are at most 3 waiting rows, newest first, with date and signed cents only (no communication, IBAN, card text or raw row). `rows` is what the groups would categorise, `left` the waiting rows that stay without a category (no suggestion for their counterparty); `limit` and `groupLimit` are the most rows and groups one apply takes. Nothing of another user is used.

### `POST /api/suggestions/backfill` (0.5-6)
Body `{"items": [{"counterpartyKey": "bakkerij de graankorrel", "categoryId": 2}]}`: the groups the viewer ticked, 1 to 200 pairs (`400` "Kies minstens één en hoogstens 200 groepen." otherwise; an empty key, a key over 200 characters or a `categoryId` below 1 is `400` "De gegevens kloppen niet."). In one database transaction every pair is derived again from what the learning proposes now; a pair that is not offered (a wrong category, another user's counterparty, a decided or dismissed one, nothing waiting any more) is skipped and counted as `stale`; a pair named twice counts once. The rows of the other pairs get the category through `categorise.Confirm`, that is `categorise.Assign` with origin `suggestion`: a row with any category (manual, rule, import or suggestion) and a split row stay as they are. If the pairs would categorise more than 2000 rows the whole call answers `400` "Dat zijn te veel transacties in één keer. Kies minder groepen (hoogstens 2000 transacties)." with nothing written. Answers `200 {"categorised": 17, "groups": 3, "stale": 1}`.

The apply is always an explicit act over a previewed list, never automatic. It only categorises: it creates no rule and stores no decision in `category_suggestions` (a suggestion disappears by itself once no row of it waits), and no import batch, so an undo of an import does not undo it. Every row it touched has origin `suggestion` and can be changed by hand on its transaction. Unlike `POST /api/suggestions/confirm` it makes no rule: a rule for new rows stays a separate choice ("Maak regel" or Bevestigen on the suggestion).

**Stored** in `category_suggestions` with `user_id` = the viewer: one row per user, key and category, with the decision (`confirmed` | `dismissed`; `open` is never written: open suggestions are computed) and the confidence and `seen` at that moment. Migration 0006 merges duplicates (keeping the lowest id) and adds a unique index on (`user_id`, `counterparty_key`, `category_id`) for user rows. Removing a category with `moveTo` moves the decisions along (on a clash the target's stays), with `moveTo=none` they are deleted. Errors never repeat a key or a counterparty, and none is logged.

## Privacy rules and the route table (0.6-2)
The rules every route keeps, for every user (analysis 2, risk 7):
1. A user sees only the accounts they hold (`account_access`) and what is derived from them: transactions, balances, members, per-viewer counts, suggestions, backfill, imports, rules, alerts, notices, join offers, sync state, search results, `total` and `next`, transfer flags, error codes and messages. Another user's personal accounts and everything of theirs (devices, offers, notices, links, user rules, mappings, suggestions) appear nowhere: not as a name, an id, a masked IBAN, a count, a flag, nor as the difference between two answers.
2. Something the viewer cannot see answers exactly as something that does not exist: the same `404` status, code and message. `403` only for an account the viewer can see but may not change (read-only, or not the manager).
3. Members of a shared account see its full history and its members' names, roles and permissions, and (0.6-5) each member's contribution share, number of claimed senders and amount received from them on that account; nothing else about each other (never another member's sender IBAN).
4. A read-only member changes nothing.
5. No sum, flag, label or suggestion is computed from accounts the viewer cannot see: transfers match only the viewer's own accounts and overrides, suggestions learn only from the viewer's accounts.

`server/internal/server/privacy_test.go` holds one table, `privacyRows`, with a row per registered route: its kind (`public`, `auth`, `own`, `list`, `byid`, `admin`, `shared-tree`, `fallback`), the check that proves the rules for it, its probes and the other tests that cover it. `TestEveryRouteHasAPrivacyRow` reads the `HandleFunc` patterns from the package's code and fails for a route without a row or a row without a route. `TestPrivacyRoutes` runs every row's probes on a fresh world of three users (Bert, Partner who joined Bert's family account, and Derde whose account is offered to Bert): each probe must reach its route, answer its status, hold none of the other user's sentinel strings, answer another user's id exactly as a missing id without writing, and the owner's same request must not be a `404`. `TestPrivacySentinels` runs every read as both users in five states (baseline, Partner read-only, after Partner left, after Bert deleted the family account, after the admin deleted Partner) and checks that each sentinel shows up for its owner. `TestMatchingIsPerViewer` gives both users the same row and checks that suggestions, backfill, import duplicates, rule previews, category counts, rule ids and opposite-amount transfer matches come from the viewer's own accounts only; `TestTransferIsPerViewer` does the same for the transfer flags and kinds (0.6-3). Documented exceptions: the category tree is shared (any user's category names; removing a category refuses while any split uses it); the admin sees users' names and addresses (`GET /api/users`) and counts in `removal-preview`.

## Planned changes
- The planning alerts about one account (0.8) carry its `accountId` too, as the account-level sync alerts do since 0.3-5.
