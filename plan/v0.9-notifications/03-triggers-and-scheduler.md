# 0.9-3 · Triggers, preferences and scheduler

| | |
|---|---|
| Version | [0.9 Notifications](README.md) |
| Status | planned |
| Size | M |
| Features | NOTIF-3 |
| Concepts | [notification](../../analysis/concepts/notification.md), [forecast](../../analysis/concepts/forecast.md), [bank-connection](../../analysis/concepts/bank-connection.md), [shared-account](../../analysis/concepts/shared-account.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md) |
| Analysis | 4.9, risk 15 |
| Depends on | [0.9-1](01-email-templates.md), [0.9-2](02-web-push.md), [0.8-3](../v0.8-planning/03-forecast-engine.md) (`planning.Forecast(ctx, db, account, today, horizon)`, no viewer), [0.8-4](../v0.8-planning/04-forecast-api-and-start.md) (the month-end red and buffer rule of the planning alerts) |

## Goal
The right message, once, at the right time, only about accounts you can see.

## Steps
1. `notification_pref` per user and type with the defaults from analysis 4.9; channel switches.
2. Triggers: forecast red / buffer per account within the look-ahead (1, 3 or 6 months), consent 14 and 3 days, sync stopped, member joined, to categorise (19:00 digest), new device, contribution missing [C].
3. `notification_log`: one message per account, month and state; sent the morning after the forecast changes.
4. Quiet hours for push (default 22:00–07:00, on); security messages ignore them.
5. Tests for repeat protection and visibility.

## Done when
The demo story produces exactly the expected messages over a simulated month.