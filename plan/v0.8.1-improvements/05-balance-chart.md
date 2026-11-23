# 0.8.1-5 · Overzicht: balance per account with its buffer

| | |
|---|---|
| Version | [0.8.1 Improvements](README.md) |
| Status | planned |
| Size | M |
| Items | 7 |
| Concepts | [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [forecast](../../analysis/concepts/forecast.md), [scope](../../analysis/concepts/scope.md) |
| Screens | [overzicht](../../analysis/screens/overzicht.md) |
| Depends on | – (0.8-3 rules 1 and 2) |
| Files | `server/internal/planning/forecast_project.go` (extraction), new `planning/history.go` + test, `server/internal/server/reports_balances.go` + test, `privacy_test.go`, `docs/api.md`, new `web/src/pages/OverzichtSaldo.tsx` (+ test, css), one line in `Overzicht.tsx` |

## Goal
Item 7: "overzicht zou ik ook een grafiek willen van de balans die op de rekening staat, incl buffer." A card "Saldo" on Overzicht with each current account's end-of-day balance over the period in view, its buffer and the zero line.

## Where the history comes from
`balance_snapshots` has one point per sync day for bank accounts and none for Bilance history (the demo has one bank snapshot per account), so snapshots alone draw nothing useful. The engine already reconstructs past days (0.8-3 rule 1: start = newest snapshot + booked rows after its date; rule 2: end of day d = start − Σ booked rows dated after d). That rule becomes one function used by both (decision 1):
```go
func PastBalances(balance int64, rows []DayAmount, from, today string) []Point // one Point{Date, Balance} per day with booked rows, plus from−1
```
`Project` uses it for the running month's `Start` and past days. A new loader `LoadHistory(ctx, db, account, from, today)` reads the newest snapshot (the `LoadFacts` query) and the account's booked rows from **min(from, the snapshot's date)** to today, as `LoadFacts` does (`forecast_load.go:83`), so rows after the snapshot date enter the start (account-level, viewer-free).

## Rules
- **Route** `GET /api/reports/balances?scope=&account=&from=YYYY-MM&to=YYYY-MM` (server layer): the selection of `ledger.ReportSelection` (the exported wrapper of 0.8.1-2); per account `{id, buffer, firstDate, points: [{date, balance}]}`; `points` are step points (the balance holds until the next point), first point = the end of the day before `from` (or the account's first booked date when later), only days with booked rows after that; `to` ≤ the running month (no future: that is Planning). An account without any balance snapshot: `points: []` and `missing: true` (as `GET /api/planning`'s `missing`). Days before the account's first booked row are not drawn.
- **One account, one line** (0.8 decision 1). One account in view: a chart 150 px (phone) / 200 px (desktop). Several: small multiples, one per account (84 px each, as Start's "Komende maanden"), each with its own scale, name, dot and "Buffer € 900". Never a sum.
- **Drawing** (reuse Rekening's `Chart` geometry, moved to `components/BalanceLine.tsx`; Rekening keeps using it): step line in the account colour, area at 10 %, zero line solid `--muted`, buffer dashed (current accounts only), the stretch below the buffer tinted `--warnSoft` and below zero `--negSoft`. The selected column's months are a `--soft` band behind the line; tapping a chart selects nothing (the chart is not a control).
- **Stats** under each chart, for the selected column: lowest point, end ("Nu" for the running month) and days under the buffer. Demo Zichtrekening: October column "Einde € 1.023,55" (its low and days under buffer: lead derives); November column "Laagste −€ 431,45 op 1 nov" (`--neg`), "Nu € 1.968,82". An `aria-label` with the same text; the svg is `aria-hidden`.
- **Period**: the columns in view (Maand: 6 months; Jaar: the history). A manual account without transactions: "Geen transacties in deze periode · bekijk het saldoverloop op de rekening" (link). Missing balance: "Nog geen saldo".
- **Known limits** (README): drift from missing rows; the buffer is today's (buffer changes are not historised).

## Steps
1. **Opus**: `PastBalances`, the `Project` refactor with every 0.8-3 golden green, `LoadHistory`, `TestPastBalances`.
2. **Sonnet**: the route, handler test, privacy row, `docs/api.md` "Reports".
3. **Sonnet**: `BalanceLine` extraction (Rekening tests green), `OverzichtSaldo` card, vitest, `analysis/screens/overzicht.md` (new card, deviation).

## Tests (exact; 0.8-3 goldens)
- **Demo, today 2026-11-18**, Zichtrekening `from=2026-11`: first point 2026-10-31 102355; 2026-11-01 −43145; 2026-11-02 241855; 2026-11-08 236615; 2026-11-12 235216; 2026-11-16 205131; 2026-11-17 196882; no point after 17 Nov (the last value holds through today). Gedeelde rekening: 2026-10-31 52927, 2026-11-01 142927, 2026-11-03 128427, last value 94608.
- **Identity**: for every account of the demo and of `planningWorld`, the points of the running month equal `Project`'s past `Days` balances on the same dates, and the 2026-10-31 point equals `Months[0].Start`.
- `planningWorld` W1: the 2026-11-17 row after the snapshot date is included (balance 98500 on 2026-11-17, 100000 on 2026-11-16).
- Handler: savings account `400`; Partner's personal account for Bert `404`; Bert and Partner byte-identical for the shared account; `to` after the running month `400` "De eindmaand ligt na deze maand.".
- Vitest: two accounts → two charts and no total; November stats of the Zichtrekening "Laagste −€ 431,45 op 1 nov" in `--neg`; a missing account says "Nog geen saldo"; the buffer line is absent for a manual savings-like account (not current: not in the selection anyway).

## Who builds it
- **Opus**: step 1. **Sonnet**: steps 2–3.

## Done when
Overzicht shows each account's balance line with buffer and zero over the period in view, its November line passes through −€ 431,45 on 1 November in the demo, and the 0.8-3 goldens are unchanged.
