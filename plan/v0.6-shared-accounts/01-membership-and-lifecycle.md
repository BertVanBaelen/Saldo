# 0.6-1 · Membership and lifecycle

| | |
|---|---|
| Version | [0.6 Shared accounts](README.md) |
| Status | planned, split into four slices on 16 Nov 2026 |
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
1. The first link of an account is `primary`, a joiner's link is `fallback` (1a). The nightly and the manual sync fetch an account from its primary; a fallback source is fetched **only while the primary is stopped** (consent lapsed, status failed, or the account not fetched for the stale period) and then fetches from the account's newest booking date minus the overlap, so it fills the gap. Rows merge on the existing dedupe key; a pending row is replaced only by rows of its own connection (`source_connection_id`).
2. Account state and the sync card use the primary; when the fallback is carrying the account the card says "Via de koppeling van <naam>". A healthy primary with a failed fallback is not an alert for the account.
3. Promote on removal (1c.3); no other priority changes.
4. Mark **to verify with real data**: whether two holders' consents give the same entry reference for one booking (duplicates are the risk). Check the per-connection sync claim, the `not_shared` marking and the sync report of 0.6-0 against two connections on one account.
5. Tests with the fake bank: primary healthy (fallback not called), primary expired (fallback fetches and fills the gap, no duplicates), both returning the same rows, entry references that differ for one booking (document what happens).

## Done when
Partner joins your shared account through her own bank link, without duplicate transactions, and each lifecycle action works.
