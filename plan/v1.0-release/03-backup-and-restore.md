# 1.0-3 · Backup, restore and migration routine

| | |
|---|---|
| Version | [1.0 Release](README.md) |
| Status | planned |
| Size | S |
| Features | REL-1 |
| Concepts | [bank-connection](../../analysis/concepts/bank-connection.md), [account](../../analysis/concepts/account.md) |
| Analysis | 7 (reliability), 13.4 |
| Depends on | [1.0-2](02-security-review.md) |

## Goal
Never lose the data you have been building up since 0.2.

## Steps
1. Restore a full encrypted Home Assistant backup on a test system and check that Saldo starts, decrypts its secrets and syncs.
2. Backup before every migration, as a release rule in the release workflow and in `DOCS.md`.
3. Write down the recovery steps (lost encryption key, lapsed consents, admin recovery).

## Done when
A restore from backup has been tested and the routine is documented.