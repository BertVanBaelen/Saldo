# Version 1.0 · Release

**After this version you can** run Saldo at home with confidence: a full security review behind it, a tested backup and restore, an export of all your data, and documentation to install it again from scratch.

Status: planned. Analysis: 13.4 quality gates. Roadmap: [../README.md](../README.md).

Since 3 Nov 2026 the real bank data is in use from version 0.2 (after the security baseline), so this version no longer holds the first real sync.

## Features
| Id | Feature |
|---|---|
| DATA-1 | Export your data to CSV and JSON [S] |
| SEC-1 | Full security review |
| REL-1 | Backup, restore and migration routine |
| REL-2 | Add-on release 1.0.0 with documentation |

## Phases
| Phase | Title | Size | Features | Status |
|---|---|---|---|---|
| [1.0-1](01-export.md) | Export | S | DATA-1 | planned |
| [1.0-2](02-security-review.md) | Full security review | M | SEC-1 | planned |
| [1.0-3](03-backup-and-restore.md) | Backup, restore and migration routine | S | REL-1 | planned |
| [1.0-4](04-release.md) | Release 1.0.0 | S | REL-2 | planned |

## Concepts
user-and-visibility, authentication, account, bank-connection.

## Exit criteria
Both of you use Saldo daily on real data, the review is written, and a restore from an HA backup has been tested.