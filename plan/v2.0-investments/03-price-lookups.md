# 2.0-3 · Price lookups

| | |
|---|---|
| Version | [2.0 Investments](README.md) |
| Status | later |
| Features | INV-3 |
| Concepts | [account](../../analysis/concepts/account.md) |
| Analysis | 3, 7 (outbound traffic) |
| Depends on | 2.0-1 |

## Goal
Values that update themselves where possible.

## Steps
1. Optional price lookup by ISIN from a public price source.
2. Research the Saxo OpenAPI (not blocking); Trade Republic only has unofficial APIs.

## Done when
Positions with an ISIN update their value automatically.
