# 0.8-0b · Declare an account shared, and invite people

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | L |
| Features | PLAN-0 |
| Concepts | [shared-account](../../analysis/concepts/shared-account.md), [scope](../../analysis/concepts/scope.md), [account](../../analysis/concepts/account.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md), [internal-transfer](../../analysis/concepts/internal-transfer.md) |
| Screens | [rekeningen](../../analysis/screens/rekeningen.md), [start](../../analysis/screens/start.md) |
| Analysis | 2, 4.3, 6.3 |
| Depends on | [0.8-0a](00-saving-categories.md) (both touch `reportBucket`/`reportWorld`; build them in this order), [0.6-1](../v0.6-shared-accounts/01-membership-and-lifecycle.md) (join, notices, permissions, leave) |

## Goal
The user's bug report of 18 Nov 2026: "I have 2 accounts with one bank link but I cannot assign one of them as a shared one." Today an account is shared only when it has more than one member (`members > 1`), and the only way to get a second member is that the other holder links the same IBAN with their own bank login and accepts the join offer (0.6-1a). The user's design: "in the Rekeningen settings I want to be able to set it as shared and then a select screen comes to invite other people. If the other person adds it they are immediately accepted and this is not editable." It comes before 0.8-1 because the contribution need (0.8-3/0.8-4), the item kinds of a shared account (0.8-1) and the 0.7 reports all read "is this account shared".

## Model
- Migration **`0016_shared_flag.sql`** (planning's migration becomes `0017`): `ALTER TABLE accounts ADD COLUMN shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1));` and
  ```sql
  CREATE TABLE account_invitations (
      id         INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,  -- the invitee
      invited_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
      created_at TEXT    NOT NULL,
      UNIQUE (account_id, user_id)
  );
  CREATE INDEX account_invitations_user ON account_invitations (user_id);
  ```
  A row is an **open** invitation; accepting, declining and revoking delete it. Invitations older than 30 days (`InvitationTTL`) are ignored on read and deleted by the next write on that account. Additive, so an older binary on a restored backup ignores both (the pre-migration copy in `/data/backups` as always).
- **One derived value**: `shared = accounts.shared = 1 OR members > 1`. In SQL it is one column `shared` in the `vis` CTE of `visibleTx` (`(a.shared = 1 OR (SELECT COUNT(*) …) > 1) AS shared`, next to `members`), in Go one helper `ledger.IsShared(flag bool, members int) bool`. Every site that means "personal or shared" switches to it; the sites that mean "how many people" keep `members`:

  | Site | Today | After |
  |---|---|---|
  | `ledger/accounts.go` `Account.Kind` (API `kind`) | `members > 1` | `IsShared` (the query also selects `a.shared`) |
  | `transactions.go` `scopeCond` | `tx.members = 1` / `> 1` | `tx.shared = 0` / `= 1` |
  | `transactions.go` `transferKind` | `tx.members = 1 AND ov.members > 1` | `tx.shared = 0 AND ov.shared = 1` |
  | `transactions.go` contribution label (`tx.members > 1`) | | `tx.shared = 1` |
  | `reports.go` `reportParts` (`members`, `other_members`) and `reportKey` (`toShared`) | `members = 1 AND other_members > 1` | `shared = 0 AND other_shared = 1` (columns `shared`, `other_shared` from `vis`) |
  | `reports.go` `reportSelection` (`members` for `scopeCond`) | count | the same `shared` expression |
  | `contributions.go` (`a.members < 2`: "personal account has no contributions") | members | `!IsShared` (a flagged account with one member has contributions: one member, share 100 %) |
  | `manage.go` `access` | `members` | adds `shared` (members stays: leave and delete rules are about people) |
  | `categorise.go`, `categorise/plan.go`, `joins.go` convertible rules, `lifecycle.go` | `members` | **unchanged**: user rules, leaving, the manager hand-over and the last member's delete are about the number of people, not the label (a user rule of Bert keeps applying to a flagged account while he is its only member; the 0.6 "rules" notice comes when a second member joins, as today) |
  | web: `lib/accounts.ts` scope helpers, Start, Rekeningen, Planning | `kind` from the API | unchanged (they already read `kind`) |
- Grep check for the implementer: `members` and `Kind` in `server/internal/**/*.go` (non-test), every hit listed above or justified in the commit message.
- **Switching off** (`shared` back to 0) is allowed only while the manager is the only member and no invitation is open (`400` "Een rekening met meer leden blijft gedeeld." / "Trek eerst de uitnodiging in."). Every join (an accepted invitation or a 0.6 join offer, `ledger.addMember`) sets the flag to 1, so when the last other member leaves, the flag stays 1 (the account stays shared until the manager switches it off). Membership and flag changes reclassify history in sums, like 0.7's known limit for membership changes.

## Invitations and acceptance
- **Invite**: the manager of an account with `shared = 1` invites another user of this Saldo instance. Not themselves, not a member (`400` "… is al lid."), not twice (`409` "… is al uitgenodigd."; the existing invitation stands). The invitee gets nothing by e-mail in 0.8 (push and e-mail come with 0.9); they see an alert.
- **Alert for the invitee** (`GET /api/alerts`, built from `account_invitations` like the join offers, not a stored notice): `{"kind": "ok", "type": "invite", "title": "Bert nodigt je uit voor Vakantiepot", "note": "Voeg de rekening toe om ze samen te volgen", "href": "/rekeningen?uitnodiging=7", "invitationId": 7}`. On Rekeningen that link opens a small dialog: "Bert nodigt je uit voor Vakantiepot. Als je ze toevoegt, zie je haar saldo en geschiedenis, en ziet Bert wat je op deze rekening doet. Je persoonlijke rekeningen blijven van jou." with "Toevoegen" and "Weigeren".
- **What the invitee sees before accepting**: the account's name and the inviter's display name, nothing else (no IBAN, balance, rows, members). Every account route answers `404` for them until they accept. Written as a privacy rule and tested.
- **Accept = immediate membership** ("If the other person adds it they are immediately accepted"): `POST /api/invitations/{id}/accept` makes the invitee a member with **Bewerken** (the 0.6 default for a joining co-holder), `joined_at` now, **without a source** (the account stays fed by the manager's link; the invitee may link the IBAN later through their own bank link, which then adds a fallback source as for any member), deletes the invitation, resets the contribution shares to equal (as every membership change does, 0.6-5) and writes the 0.6 `member` notices for the other members (and the `rules` notice for the manager when the account goes from one to two people). No approval step by the manager. The manager changes the permission afterwards with the existing `PATCH /api/accounts/{id}/members/{userId}` (0.6-1b).
- **Accept through a bank link**: when the invitee links the same IBAN through their own bank link and a join offer would be created (`banklink`, 0.6-1a), an open invitation for that user and account turns it into an immediate accept (as above, but with the fallback source of that connection), without the "Wil je aansluiten?" question. Without an invitation the 0.6-1a flow is unchanged.
- **Decline / revoke**: `DELETE /api/invitations/{id}` by the invitee (declines) or by the manager (revokes); the other side gets no notice. An invitation of a user who is deleted cascades; a deleted account cascades.
- **Not editable** (user decision 18 Nov 2026): once an invited person has joined, the shared state is fixed: the switch is gone (more than one member), the acceptance cannot be undone or approved after the fact. The manager can still change the member's permission, hand over, remove the account for everyone, and the member can leave (0.6-1c, unchanged).

## Endpoints (`server/invitations.go`, literal patterns; each with a privacy row)
| Route | Who | Answer |
|---|---|---|
| `PATCH /api/accounts/{id}` with `{"shared": true|false}` | manager | the account (`kind` follows); other members `403` "Alleen de beheerder kan dit wijzigen." |
| `GET /api/accounts/{id}/invitable` | manager | `{"users": [{"id": 2, "name": "Partner", "initial": "P", "state": "member" | "invited" | "free", "invitationId": 7}]}`: every other active user of the instance, by name; display names and initials only |
| `POST /api/accounts/{id}/invitations` `{"userId": 2}` | manager, `shared = 1` | `201 {"id": 7, "userId": 2, "name": "Partner", "createdAt": …}`; not shared `400` "Zet de rekening eerst op gedeeld." |
| `POST /api/invitations/{id}/accept` | invitee | `200` the account as the new member sees it; expired or someone else's `404` |
| `DELETE /api/invitations/{id}` | invitee or the account's manager | `204`; anyone else `404` |

`GET /api/accounts` (there is no `GET /api/accounts/{id}`) gains `invitations` on each account for its manager (`[{id, userId, name, createdAt}]`, `[]` for others). The accept answer is the bare account (not wrapped in `{"account": …}` like a join offer's), and the bank-link callback lists the accounts joined through an invitation under `joined: [{id, name}]` (always an array, also in `accounts`).

## UI
- **Rekening** (`Rekening.tsx`, the account's settings; manager only): a switch row "Dit is een gedeelde rekening" with help "Zet je deze rekening op gedeeld, dan telt ze mee onder Gedeeld en kan je anderen uitnodigen. Wie je uitnodigt, ziet haar saldo en geschiedenis, nooit je andere rekeningen." Switching on opens the **invite sheet**; with more than one member the switch is replaced by the text "Gedeeld met Partner" (not editable); with an open invitation switching off is refused with the message above. Non-managers and read-only members see the state (the "Gedeeld" label they see today), never the switch.
- **Invite sheet** (the app's `Sheet`, 0.8-0c motion): title "Wie nodig je uit?", one selectable row per user from `/invitable` (initial in a circle, name; members shown with "lid", disabled; invited ones with "uitgenodigd" and "Intrekken"), a primary "Uitnodigen" (disabled until one is selected), toast "Partner is uitgenodigd". A note at the bottom: "Staat de persoon er niet bij? Een beheerder van Saldo nodigt nieuwe mensen uit in Instellingen → Gebruikers." (link for an admin; no second user-invitation flow). Empty list: only that note.
- **Rekeningen**: the open invitations of the manager's accounts show under the account ("Uitgenodigd: Partner"); the invitee's dialog of the alert as described.
- **Bankkoppelingen**: no join dialog for an IBAN covered by an invitation (accepted directly; toast "Je bent nu lid van Vakantiepot").

## Steps
1. **Opus**: migration 0016, the `shared` column in `vis`, `IsShared`, every site of the table, the `reportWorld` extension and `TestScopeFollowsSharedFlag`, `TestTransferKindFollowsSharedFlag`, the privacy suite changes.
2. **Opus**: invitations (ledger), accept with notices and shares reset, the banklink auto-accept, their tests.
3. **Sonnet**: handlers, handler tests, privacy rows, `docs/api.md` (Accounts `shared`, a new section "Invitations", Join: the auto-accept), the alert type `invite`.
4. **Sonnet**: the switch, the invite sheet, the invitee dialog, the Rekeningen lines, vitest.
5. **Sonnet**: analysis `shared-account.md`, `scope.md`, `account.md`, `start.md`, `rekeningen.md`; `docs/local-testing.md` section (below).

## Tests
- **`reportWorld` extension**: A9 **Pot** (Bert, current, manual, IBAN X9, `shared = 1`, one member). Rows: t1 A1 2026-05-02 −1000 to X9; t2 A9 2026-05-02 +1000 from X1 (A9's first booked row). 2026-05: alles nothing (t1 and t2 internal); **persoonlijk** `toShared` 1000 (A9 is shared, so not in Persoonlijk); **gedeeld** income 1000 (t2); A1 alone `toShared` 1000. Transacties: t1 has `transferKind` `shared`. With `shared = 0` (same test, flag cleared): persoonlijk nothing (both internal), gedeeld has no A9 (and no row), t1 `transferKind` `internal`. After Partner becomes a member of A9 (flag cleared again): as with the flag set. No 0.7 or 0.8-0a total changes (May had no rows).
- `TestSharedFlag`: only the manager sets it; switching off refused with a second member and with an open invitation; the flag stays when the second member leaves; `kind` follows; `GET /api/transactions?scope=gedeeld` and the reports include A9 when flagged.
- `TestInvitations`: invite, twice (`409`), a member (`400`), not shared (`400`), yourself (`400`); accept makes a member with edit, no source, shares reset, `member` notices to the others, the invitation gone; decline and revoke; expiry after 30 days; deleted user cascades; the banklink auto-accept with an invitation (fallback source, no offer left) and the unchanged offer without one.
- **Privacy** (`privacy_test.go`): rows for the five routes; `TestPrivacySentinels`: before accepting, the invitee's answers of `/api/accounts`, `/api/transactions`, `/api/reports/months`, `/api/planning…` (once 0.8-1 exists) contain none of the account's sentinels; `/api/accounts/{id}` of it is the `404` of a missing one; the alert shows only the account name and the inviter's name; `/invitable` shows names and initials only (no e-mail, no account), and `403` for a non-manager.
- Contributions: a flagged account with one member answers its one member with share `null` (equal, 100 %).
- Vitest: switch visible for the manager only, sheet opens on switching on, rows and states from `/invitable`, the POST, the Instellingen note, "Gedeeld met Partner" instead of the switch, the invitee dialog's accept and decline.

## Who builds it
- **Opus**: steps 1 and 2 (the derived value across SQL and Go, the join interplay, privacy).
- **Sonnet**: steps 3–5 from this file.

## Done when
A one-member account can be declared shared and counts under Gedeeld everywhere, an invited user who adds it is a member at once, and nobody learns more than the account's name before accepting.
