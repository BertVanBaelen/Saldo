# 0.8.1-7 · Shared accounts: Bijdragen for every shared account, contributors without Saldo

| | |
|---|---|
| Version | [0.8.1 Improvements](README.md) |
| Status | planned |
| Size | L |
| Items | 4 |
| Concepts | [shared-account](../../analysis/concepts/shared-account.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md) |
| Screens | [rekeningen](../../analysis/screens/rekeningen.md), [start](../../analysis/screens/start.md), [planning](../../analysis/screens/planning.md) |
| Depends on | – ; migration **0020** (default, README question 6: the migrator applies every unrecorded version, gaps allowed, so 0020 is safe whether or not 0.9-2's 0018 is already live) |
| Files | migration `0020_contributors.sql`, `server/internal/planning/detect_load.go` (senders), `server/internal/ledger/contributions.go` (+ test), `transactions.go` (contribution labels), `server/internal/server/{contributions,planning_forecast}.go` (+ tests), `privacy_test.go`, `docs/api.md`, `web/src/pages/{Bijdragen,Rekening,Start,PlanningBudget}.tsx`, `web/src/lib/types.ts` |

## Goal
Item 4: "instellingen voor gedeelde rekeningen stortingen ontbreken, moet ook mogelijk zijn voor niet gebruikers." User answer 19 Nov 2026: a contributor who is not a Saldo user is a **name + IBAN + share**; their transfers are recognised by IBAN, they get their part of the required contribution, their IBAN is stored for matching only and never shown to other users beyond name and share, and the entry can later be linked to a user.

## Root cause of "ontbreken"
`Rekening.tsx:1239` shows the Bijdragen card only when `a.members.length > 1`. A shared account with one member (0.8-0b: declared shared, the partner is not on Saldo) has no card at all, while `ledger.Contributions` and the planning need already use the derived shared flag. That condition conflicts with 0.8 decision 15 ("shared is one derived value"). Step 1 fixes it alone and can ship first.

## Data
```sql
CREATE TABLE contributors (
    id         INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    iban       TEXT    NOT NULL,                 -- normalised; for matching only
    share      INTEGER CHECK (share IS NULL OR share BETWEEN 0 AND 100),
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    link_user  INTEGER REFERENCES users (id) ON DELETE SET NULL,   -- a pending link offer (below)
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (account_id, iban)
);
```
Additive (no rebuild of `contribution_senders`, and **no new notice type**: `account_notices.type` is a CHECK list (`0013`), so this phase stores its two signals in `contributors` itself, below): an older binary on a restored backup ignores it. One IBAN per contributor (the user's model); a second IBAN is a second edit, not a list.

## Rules
- **Who.** Members with Bewerken add, rename, change the IBAN of and remove contributors (*default*; README question 7 offers manager only). Read-only members see them. Only on a shared account (derived flag), else `400` "Een persoonlijke rekening heeft geen bijdragen.".
- **IBAN.** Typed (`NormalizeIBAN`, checksum), or `{name, transactionId}`: an incoming row of this account whose IBAN the **server** resolves, as `ClaimSender`'s transaction proof (the transactions API never returns a counterparty IBAN and must not start to). One IBAN is one contributor or one member's sender per account: an IBAN already used here answers `409` "Deze IBAN kan je hier niet gebruiken.", the same text whoever holds it (member or contributor). Known limit: it still tells the typist that the IBAN is in use on this account; with two members that hints at the other member, which only someone who already knows that IBAN can learn. An IBAN of an account in Saldo is **accepted** and matched only against this shared account's own rows; no lookup outside the account is made, so the answer reveals nothing about other users (no "is this IBAN in Saldo" oracle).
- **A member's own account wins.** `ClaimSender` (0.6-5) also checks `contributors`: when a member proves an IBAN as their own (`fromAccount`, an account they hold) and a contributor of this account holds it, the member's claim replaces it: the contributor is deleted in the same transaction (shares reset to equal) and nothing else is stored: the manager sees the contributor gone from the card and the member's share; the audit line names no IBAN. A `transaction` proof never replaces a contributor (`409`, generic text). So nobody can block a member's own sender by registering it as someone else.
- **Who sees the IBAN** (user answer): the contributions API returns it masked by `MaskIBAN` (`BE68 •••• •••• 1234`) only to the member who created it and to the manager (to correct it); everyone else gets name, share, received, required. No route returns it in full after it is stored. `GET /api/transactions` carries no counterparty IBAN (checked 19 Nov 2026), so the "Bijdrage van Mama" label links a name to rows, not to an IBAN. Known limit: a categorisation rule on the shared account built from such a row shows its masked IBAN to members (0.4 rules, unchanged).
- **Recognition.** `received(contributor, month)` = Σ the shared account's booked incoming rows with `counterparty_iban = iban` in the month, the same SQL shape as a member's sender (0.6-5). A row so matched is labelled "Bijdrage van <naam>" in Transacties (`ContributionLabel` gets `contributorId`).
- **Shares.** `PUT /api/accounts/{id}/contribution-shares` (body `{"shares": …}`, 0.6-5) takes keys `"<userId>"` for members and `"c<id>"` for contributors, each exactly once, integers summing to 100, or `null` for equal. Adding or removing a contributor, like a join or leave, resets every share of the account to equal (`resetContributions` covers both tables).
- **Required part.** `memberPart(need, share, n)` with n = members + contributors; each contributor gets `required` and `covered` like a member. `GET /api/planning`'s `contribution.members` gets entries `{contributorId, name, me: false, share, required}` (no `userId`); `GET /api/accounts/{id}/contributions` gets `contributors: [{id, name, share, iban?, received, confirmed, required, covered}]` (`iban` only for the creator and the manager, masked).
- **Planning.** The need (0.8-3 rule 12) is unchanged: a contributor's money is recognised as `received`, and the forecast's income comes from the account's recurring items as now (a recurring item of kind `contribution` for "Bijdrage Mama" is how the forecast expects it; the Planning instellen screen of 0.8.1-8 lists it).
- **Linking to a user later.** When the person joins the account (invitation, 0.8-0b), the manager may offer the link: "Is dit <member>? Koppelen voorstellen" sets `link_user`. The member, and only that member, sees on their Bijdragen card "<naam> stond als bijdrager met rekening BE68 •••• •••• 1234. Is dat jouw rekening?" with **Ja, dat ben ik** / **Nee**. Ja, in one transaction: inserts the IBAN as that member's `contribution_senders` row, deletes the contributor, resets shares to equal, audit `contributor_linked` (ids only, no IBAN). Nee clears `link_user`. So a member's sender is never set without the member's own yes (0.6-5's rule). No automatic matching of contributors to users.
- **Unflagging.** `PATCH /api/accounts/{id}` with `shared: false` is refused while contributors exist: `400` "Verwijder eerst de bijdragers." (as an open invitation, 0.8-0b).
- **Detection** (`planning/detect_load.go:82` reads `contribution_senders` only): contributors' IBANs join `Senders`, so their transfers are suggested as kind `contribution`. Otherwise they would be confirmed as `income`, which rule 12 counts as other income and lowers the need while the contributor also gets a part (counted twice). An item already confirmed as `income` for such a sender is left as is: known limit, the Terugkerend list shows it and the user changes its kind.
- **Leaving and deleting.** Contributors belong to the account: they stay when members leave or the manager hands over; deleting the account deletes them (cascade). Deleting a user sets `created_by` NULL.
- **Start "Bijdragen" row** and the Budget tab block list contributors after the members, with the same ✓ rule.
- **0.9 impact.** 0.9-3b's contribution trigger (`contrib:<account>|<month>|<member>`) must use `c<id>` for contributors and notify the manager (a contributor has no channel). Write this into 0.9-3b when this phase lands.

## UI (`Bijdragen.tsx`)
- The card shows on every shared account (`a.kind === 'shared'`), one member included.
- Section "Bijdragers zonder Saldo": rows with name, chip (received / required, as members), share; "Bijdrager toevoegen" opens a `Sheet`: Naam, IBAN ("De IBAN waarvan de bijdrage komt. Saldo gebruikt hem alleen om de betaling te herkennen; andere leden zien hem niet."), Aandeel (optional; "Leeg: iedereen gelijk"). Edit and Verwijderen in the same sheet.
- The share editor lists members and contributors together ("Aandeel van Mama").
- Transaction detail of an incoming row on a shared account: "Dit is de bijdrage van …" offers "mij" (today's claim) and "iemand zonder Saldo" (opens the add sheet with a name field only; the request carries the `transactionId`, the server takes the IBAN from the row).

## Steps
1. **Sonnet**: the card on `kind === 'shared'` (`Rekening.tsx`), vitest: a flagged one-member account shows Bijdragen with "Mijn bijdrage" and the need. (Ships alone if the rest waits.)
2. **Opus**: migration, `contributors` CRUD in `ledger/contributions.go`, the IBAN rules, `received`, labels, `SetShares` with `c<id>`, `resetContributions`, linking, `TestContributors*`.
3. **Opus**: `memberPart` over members + contributors in `planning_forecast.go` and `contributions.go`; privacy rows and sentinels.
4. **Sonnet**: the UI above, `docs/api.md` "Contributions", `analysis/concepts/shared-account.md`.

## Tests
- **Need split** (demo shared account, November need 87118): with a contributor "Mama" and equal shares, each of Bert, Partner and Mama has required **€ 291** (⌈871,18 / 3⌉); shares 40/40/20 → € 349, € 349, € 175; 50/50 without contributors stays € 436 (0.8 golden).
- **Recognition**: a fixture row +30000 on the shared account from `BE68 5390 0754 7034` on 2026-11-05 with contributor Mama on that IBAN → Mama received 30000 in November, `covered` true (30000 ≥ 29100, equal three-way shares); the row's label "Bijdrage van Mama".
- **Member wins**: Bert registers Partner's personal IBAN as "Mama"; Partner claims it with `fromAccount` → Partner's sender, Mama gone, shares equal, the manager's notice; a `transaction` claim of the same IBAN by Bert → `409`.
- **IBAN rules**: an IBAN already Bert's sender here → `409` generic text (no name); the same IBAN on another shared account is fine; an IBAN of Partner's personal account is accepted and only this account's rows count; a bad checksum `400`.
- **Visibility**: Bert creates Mama; Bert and the manager see `iban` masked; Partner (member, not manager, not creator) gets no `iban` field; the full IBAN string appears in no answer of any route (sentinel scan over every privacy-test route).
- **Shares**: `{"1": 50, "3": 30, "c7": 20}` accepted; missing `c7` `400` "Geef elk lid precies één aandeel."; adding a contributor resets all to NULL.
- **One-member account**: Bert alone on a flagged account "Vakantiepot" with Mama 50/50 → `GET /contributions` lists Bert and Mama; Planning's contribution lists both.
- **Linking**: the manager offers Mama → Partner; only Partner's answer shows the offer; Partner says Ja → Partner's `mySenders` has the masked IBAN, `contributors` is empty, shares equal, audit row without IBAN; Nee → the offer is gone, nothing moved.
- **Unflag** with a contributor `400`; **detection** on the shared account suggests Mama's monthly transfer as kind `contribution`.
- **Prefill**: `POST` contributor `{name: "Mama", transactionId: <row>}` stores the row's IBAN; a row of another account or an outgoing row `400` (the generic `ClaimSender` refusal).
- Migration test: an 0.8.0 database migrates, `contributors` is empty and every contribution answer is unchanged.

## Who builds it
- **Sonnet**: steps 1 and 4.
- **Opus**: steps 2 and 3 (privacy-sensitive: IBANs, who sees what, share sums used by Planning and Start).

## Done when
Every shared account, also with one member, shows Bijdragen; a contributor without Saldo can be added with name, IBAN and share, their payment counts and gets its part of the need, nobody else sees their IBAN, and they can be linked to a member who joins later.
