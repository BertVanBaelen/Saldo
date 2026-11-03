# Version 0.6 · Shared accounts

**After this version you can** share the joint account with Partner: she links it with her own bank login and joins it, each of you sees only your own accounts, transfers between your own accounts no longer count as income or expenses, the Alles · Persoonlijk · Gedeeld switch filters every list, and you see both contributions arrive.

Status: planned. Analysis milestone: M3. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| SHARE-1 | Join a shared account by IBAN; manager and members with Lezen or Bewerken |
| SHARE-2 | Fallback bank sources, leave, manager hand-over, remove a link, delete a user |
| SHARE-3 | Privacy: every figure comes from your own accounts only (tested on every endpoint) |
| SHARE-4 | Internal transfers left out, transfers to savings shown as saved, "is / is not a transfer" [S] |
| SHARE-5 | Scope switch Alles · Persoonlijk · Gedeeld as a filter, sums as information only |
| SHARE-6 | Contributions to the shared account |

## Phases
| Phase | Title | Size | Features | Status |
|---|---|---|---|---|
| [0.6-1](01-membership-and-lifecycle.md) | Membership and lifecycle | L | SHARE-1, SHARE-2 | planned |
| [0.6-2](02-privacy.md) | Privacy suite for every endpoint | M | SHARE-3 | planned |
| [0.6-3](03-transfers-and-saved.md) | Transfer detection and saved | M | SHARE-4 | planned |
| [0.6-4](04-scope-and-sums.md) | Scope filter and sums | S | SHARE-5 | planned |
| [0.6-5](05-contributions.md) | Contributions | S | SHARE-6 | planned |

## Concepts
shared-account, user-and-visibility, internal-transfer, scope, account, bank-connection, notification (member joined, in-app only until 0.9).

## Exit criteria
Partner links the shared account, joins it, and sees only her own accounts; the privacy suite passes on every endpoint.