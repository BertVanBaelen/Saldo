# Version 0.5 · Shared accounts

**After this version you can** share the joint account with Partner: she links it with her own bank login and joins it, each of you sees only your own accounts, transfers between your own accounts no longer count as income or expenses, and every main screen has the Alles · Persoonlijk · Gedeeld switch.

Status: planned. Analysis milestone: M3. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| SHARE-1 | Join a shared account by IBAN; manager and members with Lezen or Bewerken |
| SHARE-2 | Fallback bank sources, leave, manager hand-over, remove a link, delete a user |
| SHARE-3 | Privacy: every figure comes from your own accounts only (tested) |
| SHARE-4 | Internal transfers left out, transfers to savings shown as saved, "is / is not a transfer" [S] |
| SHARE-5 | Account groups and the scope switch Alles · Persoonlijk · Gedeeld |
| SHARE-6 | Contributions to the shared account |

## Phases
| Phase | Title | Features | Status |
|---|---|---|---|
| [0.5-1](01-membership-and-lifecycle.md) | Membership and lifecycle | SHARE-1, SHARE-2 | planned |
| [0.5-2](02-privacy.md) | Per-viewer visibility | SHARE-3 | planned |
| [0.5-3](03-transfers-and-saved.md) | Transfer detection and saved | SHARE-4 | planned |
| [0.5-4](04-account-groups-and-scope.md) | Account groups and scope | SHARE-5 | planned |
| [0.5-5](05-contributions.md) | Contributions | SHARE-6 | planned |

## Concepts
shared-account, user-and-visibility, internal-transfer, account-group, account, bank-connection, notification (member joined, in-app only until 0.8).

## Exit criteria
Partner links the shared account, joins it, and sees only her own accounts; the privacy tests pass.
