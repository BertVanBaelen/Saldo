# 0.6-1 · Membership and lifecycle

| | |
|---|---|
| Version | [0.6 Shared accounts](README.md) |
| Status | built (16 Nov 2026), to verify |
| Size | L (four M slices) |
| Features | SHARE-1, SHARE-2 |
| Concepts | [shared-account](../../analysis/concepts/shared-account.md), [account](../../analysis/concepts/account.md), [bank-connection](../../analysis/concepts/bank-connection.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md) |
| Screens | [bank-koppelen](../../analysis/screens/bank-koppelen.md), [rekeningen](../../analysis/screens/rekeningen.md) |
| Analysis | 4.8, 6.3 |
| Depends on | [0.3-1](../v0.3-bank-sync/01-sync-engine.md), [0.3-4](../v0.3-bank-sync/04-rekeningen-and-manual-accounts.md) |

## Goal
One account per IBAN, shared by its holders, with clear roles.

## What exists (16 Nov 2026, check before building)
- Tables `account_access` (role manager or member, permission read or edit, `joined_at`, `contribution_share`) and `account_sources` (primary or fallback, per-account sync state) from 0001; the unique index `accounts(iban) WHERE source='bank'`.
- `banklink.match` links an IBAN: a new one becomes the viewer's account (manager), an IBAN of someone else is skipped with reason `exists` (this is what the join replaces). `ledger.RemoveConnection` removes the viewer's own link with keep or delete history and keeps accounts another member sees. `ledger.DeleteAccount` deletes a manual account for its manager only.
- `Account.members`, the `permission` and `role` of the viewer and the read-only chip in Transacties and the detail exist; the demo has Partner (user 2) with her own accounts and the shared "Gedeelde rekening".
- `GET /api/alerts` derives the Start alerts; there is no stored in-app notice yet.

## Invariant (all slices)
Every account has at least one member and exactly one manager. Every lifecycle test asserts it; `account_access` cascades on user delete, so every action that removes a member does the hand-over or deletion explicitly in the same database transaction.

## 1a Join
Linking an IBAN that already exists offers "Deze rekening bestaat al. Wil je aansluiten?"; joining is bound to the consent that listed the IBAN.
1. Migration: `join_offers` (id, user_id, connection_id → `provider_connections` ON DELETE CASCADE, account_id → `accounts` ON DELETE CASCADE, external_account_id, created_at; unique per connection and account). `match`: the IBAN exists and the viewer has no `account_access` row: record an offer (no source, no access) instead of the `exists` skip; if the viewer already has access it stays a re-authorisation. `Linked` gets `offers: [{"id", "iban" (masked), "bank"}]`; nothing else about the account is revealed before joining.
2. `GET /api/join-offers` (the viewer's own pending offers; none older than 24 hours), `POST /api/join-offers/{id}/accept`, `DELETE /api/join-offers/{id}` (not now). Accept, in one transaction: the offer is the viewer's, its connection is still active and its consent fresh; insert `account_access` (member, edit, now) and `account_sources` (fallback, with the provider id), delete the offer. The joiner's connection is **not** fetched for this account yet (1d); accepting twice answers 404/409 and changes nothing.
3. In-app notice "Iemand sluit aan" for the other members (stored `account_notices` plus a per-user read mark; shown through `GET /api/alerts`, dismissable); no e-mail or push until 0.9.
4. Carried over from 0.4: a user rule applies only to an account with exactly one member, so when a personal account gets a second member the manager's user rules for it go dead. The notice says so and `POST /api/accounts/{id}/convert-rules` (manager) turns the manager's user rules that apply to the account into account rules; a rule id is returned only to a viewer who can see that rule (the new member sees "set by a rule" without it). Check how rules are scoped in `ledger/rules.go` before building.
5. Web: after the bank callback a dialog "Deze rekening bestaat al. Wil je aansluiten?" with the masked IBAN, "Aansluiten" and "Niet nu"; pending offers also listed on Bankkoppelingen; after joining a toast and the account shows "Gedeeld"; the notice on Start.
6. Tests (two users): happy path; before accepting the joiner sees nothing of the account (transactions, balances, members); another user or another connection cannot accept; expired, repeated and declined offers; the join leaves exactly one manager; `exists` no longer appears for a joinable IBAN; user rules die and convert.

## 1b Members and permissions
1. `PATCH /api/accounts/{id}/members/{userId}` `{ "permission": "read" | "edit" }` for the manager only (never on the manager). The account payload lists members with name, role, permission and `joinedAt`; a member sees the names of the co-holders of that account and nothing else about them.
2. Enforce **edit permission and manager role on every write endpoint** through one helper, with a table test over (manager, member with edit, member with read) × every write route: transaction category and note, similar, split and unsplit, rules of the account, apply, imports into the account (and undo), account name, colour and buffer (manager only), balance.
3. Web: "Leden" card on Rekening for shared accounts (avatar, name, role, Lezen/Bewerken toggle for the manager); read-only members see the lock chip "Alleen lezen" and **no edit controls** in Transacties, Rekeningen, Categorieën and Importeren (read-only accounts are not offered as import target).

## 1c Lifecycle
1. `POST /api/accounts/{id}/leave`: a member leaves; the manager leaving hands the role to the longest-standing member (`joined_at`, then user id); the last member cannot leave (answers with the delete hint). The leaver loses access and their own link stays (the account stops being fed by it).
2. `DELETE /api/accounts/{id}` for the manager now also deletes a shared or bank account for everyone (the web asks to type the account name); sources and the sync state go with it, transactions, splits and balances cascade; other members' connections keep their other accounts.
3. Removing your own link (exists): when the removed link was the primary source of an account that has a fallback, the fallback becomes primary (with 1d).
4. `DELETE /api/users/{id}` (admin only, not yourself, not the last admin), in one transaction: revoke the user's connections and wipe their secrets; personal accounts (sole member) are deleted with their history; shared accounts are left with hand-over; join offers, sessions, devices, preferences and rules go; an audit-log entry. Web: Instellingen, users list, "Verwijderen" with confirmation.
5. Tests for every action including the invariant after each one, and for a user who is manager of a shared account and sole holder of a personal one.

## 1d Primary and fallback sources
Decided 16 Nov 2026 (user: fetch the fallback only while the primary is stopped; advisor: define "stopped" on stored state, not on tonight's outcome).
1. **One carrier per account.** The first link of an account is `primary` (set in 1a/1c via `promotePrimary`); a joiner's link is `fallback`. Each night and on "Sync now" an account is fetched through exactly one source, its *carrier*: the primary, unless the primary is **stopped**, then the oldest fallback whose own connection is usable (active, consent not lapsed). "Stopped" is decided from state stored **before** this run, never from tonight's outcome and never from connection order: the primary's connection is expired or its consent lapsed, the primary source is `not_shared`, or the primary's `last_sync_at` is older than the stale threshold the alerts already use (look at `Connection.Stopped` and the 36/72 hour rules in `ledger/alerts.go` and reuse the existing value). This narrows "or its sync fails" to "has been failing for longer than the stale period": say so in the changelog and report.
2. **Takeover fills the gap.** The carrier fetches from the account's newest booking date (all rows, any source) minus the overlap, so a gap left by a stopped primary is filled. Rows merge on the existing dedupe key and the existing `checkReference`/`checkImported` logic: **add no new matching**.
3. **Pending rows follow the carrier, in both directions.** `StoreFetch` clears stale pending rows by `source_connection_id`; when the carrier changes (takeover, or the primary comes back), repoint the account's pending rows to the new carrier (as `promotePrimary` already does) so none stays orphaned; category and note on a pending row carry over to its booked row as before. Test it both ways.
4. **Exactly one carrier, also under concurrency.** Cases to pin with tests: a promoted primary that never synced (`last_sync_at` NULL) plus the re-linked ex-primary as fallback: only one fetches; two connections storing into one account at the same time ("Sync now" during the nightly): no duplicates and no spurious `store_failed` (serialise per account and pick the carrier under that claim if needed).
5. **Single-source accounts behave exactly as before.** The live silent failure is on that path: assert the fake bank's call log for a one-link account is unchanged and leave the 0.5.1 and 0.6-0 tests untouched.
6. **An idle fallback is not a problem state.** It never makes the account read stale or "never synced", never raises the account alert or the stopped e-mail, and a connection that only feeds idle fallbacks still ends `ok`. `broken()` and the `not_shared` marking also write fallback rows: decide what that shows and to whom, and test it.
7. **Account state and the card use the carrier.** Web contract (server adds to `GET /api/accounts`): `sourceRole` (`"primary"` | `"reserve"` | `null`: the viewer's own link's role on this account, `null` without a link), `carriedBy` (`{"name": "Bert", "me": true}` | `null`: whose link carries the account right now) and `viaReserve` (true while a fallback carries it). Rekening says "Via de koppeling van <naam>" when someone else's link carries it and "Je koppeling is reserve: ze neemt over als de koppeling van <naam> stopt" for your own reserve link; Bankkoppelingen marks a reserve account.
8. **To verify with real data:** whether two consents give the same entry reference for one booking, and what happens with two identical same-day bookings that arrive through different sources (they can collapse by content): test both with the fake bank and record the result here.
   Result with the fake bank (16 Nov 2026, `TestTakeoverReferences` in `server/internal/banklink/sources_test.go`): a booking the two consents list under different references is stored once, both when the fallback takes over and when the primary comes back (`checkReference` treats a new reference on a stored booking with the same content, whose own reference the fetch does not list, as that booking re-referenced). Two identical same-day bookings with references, of which the primary stored one: when the fallback lists both under its own references, both match the stored one by content and the second is not stored while the fallback carries; it arrives when the primary carries again and still lists it inside its fetch window. Without references both are kept (content key and occurrence). Not tested: one consent with references and the other without (the keys differ, so the overlap would be stored twice).
9. The demo never runs the real sync (`MarkSynced` stamps fallback rows too): takeover is provable only in Go tests; the browser checks the display states after editing rows.

## 1e Say what a new consent left out
Found on 16 Nov 2026 (user): a link with two accounts only synced one because the consent at the bank listed only one; Saldo kept quiet until the next sync marked the other `not_shared`.
1. `banklink.storeConsent`: accounts this connection fed before and the new consent no longer lists are marked at once (the existing `not_shared` marking, now at link time); `Linked` (the answer of `POST /api/bank/callback`) gets `missing: [{"iban": "BE68 •••• •••• 4821", "name": "Zichtrekening"}]` (always an array; only accounts the viewer holds and that this connection fed; nothing about anyone else's accounts).
2. Web (Bankkoppelingen, the result after the bank returns): when `missing` is not empty, a warning notice in plain Dutch: "Je hebt bij Argenta niet alle rekeningen gedeeld. <naam> (BE68 •••• 4821) ontbreekt: koppel opnieuw en vink alle rekeningen aan." with a button that restarts the link for that connection (re-authorise), shown above the success text.
3. Tests on both sides, including a re-authorisation that lists all accounts again (nothing missing, `not_shared` cleared) and one that adds an account.

## Done when
Partner joins your shared account through her own bank link, without duplicate transactions, and each lifecycle action works.
