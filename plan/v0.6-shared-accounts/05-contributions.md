# 0.6-5 · Contributions

| | |
|---|---|
| Version | [0.6 Shared accounts](README.md) |
| Status | planned |
| Size | S |
| Features | SHARE-6 |
| Concepts | [shared-account](../../analysis/concepts/shared-account.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md) |
| Screens | [start](../../analysis/screens/start.md), [rekeningen](../../analysis/screens/rekeningen.md) |
| Analysis | 4.3, 5.3 |
| Depends on | [0.6-4](04-scope-and-sums.md) |

## Goal
See whether both partners paid their part into the shared account.

## Steps
1. Each member confirms "dit is mijn bijdrage" from their own side, which creates a rule on the shared account that labels those incoming payments; the other member's personal accounts are never used for this.
2. Split per member as a fixed percentage, default equal, set by the manager (`account_access.contribution_share`).
3. "Bijdragen november · Jij € 450 ✓ · Partner € 450 ✓" on Start and in the shared hero.
4. Required monthly contribution once the forecast exists (0.8-4).

## Done when
Both contributions show as received on Start in the month they arrive.

## What exists (16 Nov 2026)
`account_access.contribution_share` exists (nullable, 0 to 100) and the default category tree has the income category "Bijdrage". Step 4 (required monthly contribution) waits for the forecast (0.8-4) and is not built here.

## Built (16 Nov 2026, server)
**Deviation from step 1: no rule is created.** A rule never overwrites a manual or imported category, and rules with their IBAN condition are visible to every member, so a rule would expose a personal IBAN. Instead each member claims a sender in `contribution_senders` (migration 0014): from an account they hold (`fromAccountId`) or from an incoming row of the shared account whose sender is not in Saldo (`transactionId`); the server takes the IBAN from there, never from the request, and every unusable proof gets one generic refusal. The figure per member and month is the sum of the shared account's own booked incoming rows from that member's senders, independent of categories, rules and transfer flags, and identical for every member; nobody sees another member's sender IBAN, only a count. Rows from a claimed sender carry `contribution` ("Bijdrage van Partner"). The manager sets the split with `PUT /api/accounts/{id}/contribution-shares` (every member, integers, sum 100, or `null` for equal); the shares have no effect until 0.8-4. Leave, removing a member (delete user) and join delete the member's claims and reset every share to equal; deleting the account or the user cascades. Endpoints, messages and checks: docs/api.md "Contributions". Tests: `TestContributionClaims`, `TestContributionFigure`, `TestContributionShares`, `TestContributionsResetOnMembershipChange`, rows in `TestWritePermissions`, the four routes in the privacy table with a claim by each user in the sentinel world, `TestMigration0014AddsContributionSendersWithoutTouchingRows`. "✓" means something was received this month, not "paid their part".
