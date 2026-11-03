# 0.6-4 · Scope filter and sums

| | |
|---|---|
| Version | [0.6 Shared accounts](README.md) |
| Status | planned |
| Size | S |
| Features | SHARE-5 |
| Concepts | [scope](../../analysis/concepts/scope.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md) |
| Screens | [start](../../analysis/screens/start.md), [transacties](../../analysis/screens/transacties.md) |
| Analysis | 4.5, 5.3, risk 16 |
| Depends on | [0.6-3](03-transfers-and-saved.md) |

## Goal
The scope switch every later screen relies on, with sums that never pretend to be a verdict.

## Steps
1. Scope parameter `alles | persoonlijk | gedeeld` on every list and report endpoint (Persoonlijk = accounts with one member, Gedeeld = more than one); remembered per user.
2. Scope switch on Start and Transacties (Overzicht and Planning follow in 0.7 and 0.8), with empty states for a scope without accounts.
3. Sums across the accounts in view as information only, internal transfers left out; every state and buffer stays per account.

## Done when
Switching scope filters Transacties and Start correctly for both users, and no sum carries a state.