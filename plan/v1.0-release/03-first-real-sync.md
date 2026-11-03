# 1.0-3 · First real sync and backups

| | |
|---|---|
| Version | [1.0 Release](README.md) |
| Status | planned |
| Features | REL-1 |
| Concepts | [bank-connection](../../analysis/concepts/bank-connection.md), [account](../../analysis/concepts/account.md) |
| Analysis | 7 (reliability), 13.4 |
| Depends on | 1.0-2 |

## Goal
Go live on real data without risk of losing it.

## Steps
1. Encrypted Home Assistant backups switched on; test a restore.
2. Run the first real sync on a copy of the database, then on the live one.
3. Backup before every migration, as a release rule.

## Done when
Both of you are linked with real accounts and a restore from backup has been tested.
