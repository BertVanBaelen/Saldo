# 0.5-4 · Account groups and scope

| | |
|---|---|
| Version | [0.5 Shared accounts](README.md) |
| Status | planned |
| Features | SHARE-5 |
| Concepts | [account-group](../../analysis/concepts/account-group.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md) |
| Screens | [start](../../analysis/screens/start.md), [transacties](../../analysis/screens/transacties.md) |
| Analysis | 4.5, 5.3, risk 16 |
| Depends on | 0.5-3, 0.1-7 (decision on combined totals) |

## Goal
The group model every later screen relies on.

## Steps
1. Groups: Persoonlijk (your current accounts together) and one per shared account; group buffer = sum of account buffers.
2. Scope parameter `alles | persoonlijk | gedeeld` on every list and report endpoint; remembered per user.
3. Scope switch on Start and Transacties (Overzicht and Planning follow in 0.6 and 0.7).
4. Apply the 0.1-7 decision on what may be combined in Alles.

## Done when
Switching scope filters Transacties and Start correctly for both users.
