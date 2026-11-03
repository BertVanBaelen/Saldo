# Version 1.0 · Release

**After this version you can** run Saldo at home on your real bank data, on the public domain, with a security review behind it, a tested backup and restore, and an export of all your data.

Status: planned. Analysis: 13.4 quality gates. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| DATA-1 | Export your data to CSV and JSON [S] |
| SEC-1 | Security review before the first real bank link |
| REL-1 | First real sync, backup and migration routine |
| REL-2 | Add-on release 1.0 with documentation |

## Phases
| Phase | Title | Features | Status |
|---|---|---|---|
| [1.0-1](01-export.md) | Export | DATA-1 | planned |
| [1.0-2](02-security-review.md) | Security review | SEC-1 | planned |
| [1.0-3](03-first-real-sync.md) | First real sync and backups | REL-1 | planned |
| [1.0-4](04-release.md) | Release | REL-2 | planned |

## Concepts
user-and-visibility, authentication, account, bank-connection.

## Exit criteria
Both of you use Saldo daily on real data, and a restore from an HA backup has been tested.
