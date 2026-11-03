# 0.8-3 · Triggers, preferences and scheduler

| | |
|---|---|
| Version | [0.8 Notifications](README.md) |
| Status | planned |
| Features | NOTIF-3 |
| Concepts | [notification](../../analysis/concepts/notification.md), [forecast](../../analysis/concepts/forecast.md), [bank-connection](../../analysis/concepts/bank-connection.md), [shared-account](../../analysis/concepts/shared-account.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md) |
| Analysis | 4.9, risk 15 |
| Depends on | 0.8-1, 0.8-2 |

## Goal
The right message, once, at the right time, only about accounts you can see.

## Steps
1. `notification_pref` per user and type with the defaults from analysis 4.9; channel switches.
2. Triggers: forecast red / buffer within the look-ahead (1, 3 or 6 months), consent 14 and 3 days, sync stopped, member joined, to categorise (19:00 digest), contribution missing [C].
3. `notification_log`: one message per group, month and state; sent the morning after the forecast changes.
4. Quiet hours for push (default 22:00–07:00, on).
5. Tests for repeat protection and visibility.

## Done when
The demo story produces exactly the expected messages over a simulated month.
