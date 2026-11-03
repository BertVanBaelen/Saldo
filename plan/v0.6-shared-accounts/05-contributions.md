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