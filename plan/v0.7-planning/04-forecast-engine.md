# 0.7-4 · Forecast engine

| | |
|---|---|
| Version | [0.7 Planning](README.md) |
| Status | planned |
| Features | PLAN-4 |
| Concepts | [forecast](../../analysis/concepts/forecast.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [account-group](../../analysis/concepts/account-group.md), [internal-transfer](../../analysis/concepts/internal-transfer.md), [shared-account](../../analysis/concepts/shared-account.md) |
| Analysis | 5.3 |
| Depends on | 0.7-1, 0.7-2, 0.7-3 |

## Goal
The calculation behind every planning number, per group.

## Steps
1. Month projection from the latest bank balance: recurring, variable, one-off, saved, transfers in and out of the group; `left_or_short` against the group buffer.
2. Daily line: items on their day, variable spending spread over the days; lowest point of the month.
3. States per month and day: ok, in the buffer (warning), below zero (error); worst state across groups for a day in Alles.
4. Horizon 3 to 24 months.
5. Required monthly contribution for a shared account.
6. Table tests with the demo story: dip below zero on 1 November, January € 178,50 under the buffer, February −€ 1.033,47.

## Done when
The tests reproduce the Planning board's numbers.
