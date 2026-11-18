# 0.8-4 · Forecast API, planning alerts and Start "Komende maanden"

| | |
|---|---|
| Version | [0.8 Planning](README.md) |
| Status | released (0.8.0), verifying |
| Size | M |
| Features | PLAN-4, PLAN-6 |
| Concepts | [forecast](../../analysis/concepts/forecast.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [scope](../../analysis/concepts/scope.md) |
| Screens | [start](../../analysis/screens/start.md) |
| Analysis | 4.5 (warnings), 4.9 (look-ahead) |
| Depends on | [0.8-3](03-forecast-engine.md) |

## Goal
The forecast on the wire, the red and buffer alerts on Start, and Start's "Komende maanden" bars, replacing the "Komt in versie 0.8" placeholder.

## Endpoint
`GET /api/planning?scope=alles|persoonlijk|gedeeld&horizon=3|6|12|24&month=YYYY-MM`
- The current accounts of the scope the viewer holds, in `GET /api/accounts` order; one `planning.Forecast` each (`today` from the clock). `horizon` default 3; another value `400` "Kies 3, 6, 12 of 24 maanden.". `month` (default the running month) selects which month's `days` are returned; it must be within the answer's months, else `400` "Kies een maand binnen de planning.".
- Answer (money in cents; field names as the engine's types in lowerCamel; `days` only for `month`):
```json
{
  "today": "2026-11-18",
  "accounts": [
    { "id": 1, "buffer": 90000, "balance": 196882, "balanceDate": "2026-11-18",
      "months": [ { "month": "2026-11", "start": 102355, "end": 120685, "left": 30685, "state": "ok",
                    "income": 286850, "out": 248520, "saved": 20000,
                    "low": { "date": "2026-11-01", "balance": -43145, "state": "red" },
                    "lines": [ { "key": "today", "amount": 196882, "labels": [] }, { "key": "pending", "amount": -2499, "labels": ["Bol.com"] } ],
                    "budgets": [ { "categoryId": 3, "plan": 35000, "source": "budget", "spent": 6690, "rest": 28310 } ] } ],
      "days": [ { "date": "2026-11-01", "balance": -43145, "state": "red",
                  "items": [ { "kind": "booked", "label": "Huur", "amount": -100500 } ] } ] }
  ],
  "missing": []
}
```
- Every account also has `missed` (0.8-3 rule 5b: `[{itemId, label, date, amount}]`, expected but not seen, not counted).
- **Required contribution** (user decision 18 Nov 2026; the shares of 0.6-5 take effect): on a shared account (`kind` shared: the 0.8-0b flag or more than one member; a flagged account with one member gets one member at 100 %) every month carries `contribution`: `{"need": 87200, "costs": 80045, "otherIncome": 0, "bufferGap": 7073, "members": [{"userId": 1, "name": "Bert", "me": true, "share": 50, "required": 43600}, …]}`. `need` is `Need.Amount` rounded **up to whole euros**; each member's `required` = ⌈`Need.Amount` × share / 100⌉ in whole euros, where share is the stored `contribution_share` or, when the shares are `NULL`, 100 / members (equal). Members in member order, names as `GET /api/accounts/{id}/contributions` gives them (a member sees only the members of that account, which they see there already). `need` and `required` do not depend on the viewer; `me` does. A personal account has no `contribution`. Shares always sum to 100 (`PUT …/contribution-shares` enforces it; a membership change resets them to equal), so no other case exists; a share of 0 gives `required` 0.
- `GET /api/accounts/{id}/contributions?month=` (0.6-5) gets, for a month inside the forecast (the running month to + 24: the 25 months of the engine's horizon 24), `need` (as above) and per member `required` and `covered` (`received ≥ required`); outside that range, or for an account without balance, both `null`. `confirmed` keeps its meaning (`received > 0`). The handler calls `planning.Forecast` (the server layer, as for the alerts).
- Every account carries `dataDate` (0.8-3 rule 5: the newest successful sync, or for a manual account its snapshot or newest row date); the summary shows "Stand van <datum>" when it is before today.
- `missing`: ids of current accounts of the scope without any balance (the screen says "Nog geen saldo"). An empty scope: `accounts: []`.
- `401` without a viewer. No `account` parameter: the web app filters by scope; a single account is a scope of one.

## Planning alerts (`GET /api/alerts`, merged in the server layer; `ledger` does not import `planning`)
- For each current account of the scope the viewer holds, with the viewer's look-ahead `L` = `users.lookahead_months` (1, 3 or 6; default 3): the months from the running month to the running month + L.
- **Red**: the first of those months whose **end** is below 0: kind `neg`, type `planning`, title "<naam> staat rood in <maand>", note "Verwacht eindsaldo −€ 1.134 · bekijk de planning", href `/planning?maand=<YYYY-MM>#maanden` (0.8-5 opens that month).
- **Buffer**: the first month before that red month (or in the window when there is none) whose end is ≥ 0 and below the buffer: kind `warn`, title "<naam> zakt in de buffer in <maand>", note "Verwacht € 635, € 265 onder de buffer van € 900".
- At most one of each per account. Month names in Dutch lower case; a month more than 11 months ahead gets its year ("in januari 2028"). Amounts in whole euros as Start's other alerts (`eur0`). Position: item 3 of the alert order in `analysis/screens/start.md`, after sync and consent.
- Demo (Bert, alles, L = 3): "Zichtrekening staat rood in februari" / "Verwacht eindsaldo −€ 1.134 · bekijk de planning" and "Zichtrekening zakt in de buffer in januari" / "Verwacht € 635, € 265 onder de buffer van € 900"; none for the Gedeelde rekening. With L = 1 neither (November and December end above the buffer).
- 0.9-3 uses the same function for its notifications (one per account, month and state). `users.lookahead_months` has no screen before 0.9-4: the tests set it in the database; everyone runs on the default 3 until then.
- The privacy row of `GET /api/alerts` gets its description extended: planning alerts only for accounts the viewer holds, from the account-level forecast.

## Start (`web/src/pages/Start.tsx`)
- Replace `ForecastSoon` with `StartForecast` (`pages/StartForecast.tsx`): one `GET /api/planning?scope=<scope>&horizon=3` per scope and `dataVersion`. One bar chart per account (the account's colour and name), four columns: "nov · nu", "dec", "jan", "feb" (the running month's short name plus "· nu"); bars from 0 to the month end (negative in `--neg` below the zero line), a dashed buffer line; under each bar the month, the end balance (Mono 12, `--neg` when below 0) and the result: "+€ 307" (`--greenText`, left ≥ 0), "−€ 265" (`--warn`, in the buffer), "rood" (`--neg`). Heights 84 px with several accounts, 124 px for one; each chart an `aria-label` that reads every value ("Zichtrekening: november € 1.207, € 307 boven buffer; …"). Legend Boven buffer · Onder buffer · Rood: negatief saldo. The section sub "Verwacht eindsaldo per rekening" and, per chart, "Buffer € 900" next to the title (from the mockup). Spec: `analysis/concepts/forecast.md` "In the design".
- Demo bars: Zichtrekening € 1.207 (+€ 307), € 1.088 (+€ 188), € 635 (−€ 265), −€ 1.134 (rood); Gedeelde rekening € 629 (+€ 29), € 728 (+€ 128), € 828 (+€ 228), € 927 (+€ 327).
- The hero and the "Komende maanden" section head link to `/planning` ("Planning" link, as designed); the planning alerts link to the month. The "Komt in versie 0.8" tag and the `ForecastSoon` placeholder go away. A failed request leaves the section out (as the spending card does); an account in `missing` shows "Nog geen saldo".

## Start's shared hero
The "Bijdragen november" row (`ContributionRow`, `Bijdragen.tsx`) keeps its chips "Jij € 450 ✓" / "Partner € 450 ✓"; with a `required` the ✓ means `covered`, and a member below it reads "Partner € 200 · nodig € 436" (`--warn`); without a forecast it behaves as in 0.6-5. Demo: both "✓" (€ 450 against € 436).

## Steps
1. **Sonnet**: handler `server/planning.go` `GET /api/planning`, validation, handler tests, the privacy row and sentinels.
2. **Sonnet**: the planning alerts in the alerts handler, their tests.
3. **Sonnet**: `web/src/lib/planning.ts` (types, `api.planning(scope, horizon, month)`), `StartForecast.tsx`, Start wiring, vitest tests.
4. **Sonnet**: the `contribution` and `missed` fields, the contributions endpoint's `need`/`required`/`covered`, Start's chip; `docs/api.md` "Planning (0.8)" (this route and the alerts) and "Contributions" (remove "no effect yet", add the three fields); `plan/v0.6-shared-accounts/05-contributions.md` step 4 status.

## Tests
- Handler: defaults (horizon 3, month = running month, four months, `days` of November only), the `400`s, `401`, an empty scope, a scope with a current account without balance (`missing`), savings accounts never listed.
- `TestPlanningAPIDemo` (seeded): alles has accounts `[1, 4]`; Zichtrekening months `2026-11` … `2027-02` ends 120685, 108789, 63493, −113403 and states ok, ok, buffer, red; Gedeelde rekening 62882, 72837, 82792, 92747, all ok; `month=2027-02` returns 28 days for each account with 10 February the first day of the Zichtrekening's last red run; persoonlijk has `[1]`, gedeeld `[4]`. **Viewer Partner**: gedeeld answers the Gedeelde rekening byte-identical to Bert's (decision 2); persoonlijk has Partner's own Zichtrekening (5).
- **Required contribution** (`TestPlanningContribution`, seeded): the Gedeelde rekening's November `contribution` is need 87200 (87118 rounded up), costs 80045, bufferGap 7073, Bert and Partner `required` 43600 each (⌈43559⌉); December to February need 80100, `required` 40100 each (⌈40022,5⌉). The contributions endpoint for November gives `need` 87200, both `required` 43600, `received` 0 and `covered` false (the demo claims no senders: Start then shows the 0.6-5 "nog niet ingesteld" state, unchanged); after Bert claims his sender (`fromAccountId` 1) Bert's `received` is 45000 and `covered` true. **Unequal shares**: with `PUT …/contribution-shares` `{"1": 70, "2": 30}` November gives Bert 61000 (⌈60982,6⌉) and Partner 26200 (⌈26135,4⌉), December Bert 56100 (⌈56031,5⌉) and Partner 24100 (⌈24013,5⌉). The Zichtrekening has no `contribution`. Partner's answer equals Bert's except `me`. A read-only member sees the same figures (shares stay editable by the manager only, 0.6-5).
- Alerts: the two demo alerts above with exact titles and notes; L = 1 gives none; L = 6 still one red and one buffer for the Zichtrekening (the first months); a personal account of Partner never gives Bert an alert.
- **Privacy**: a row for `GET /api/planning`; `TestPrivacySentinels`: Partner's personal account's forecast (its balance 143215 and the planning sentinels of 0.8-1) never appears in Bert's answer in any scope or month; the shared account's answer is the same for both members.
- Vitest (`ContributionRow`): "✓" from `covered` when `required` is present, "nodig € 436" when not covered, the 0.6-5 behaviour without `required`.
- Vitest (`StartForecast`): bars per account with the demo labels, the `aria-label`, the single-account height, the negative bar, "rood", the link to `/planning`, no section on a failed request, "Nog geen saldo".

## Who builds it
- **Sonnet**: steps 1–4 from this file (the engine is done).

## Done when
Start shows the demo bars and the two alerts above, linking to Planning, and the API answers per account the same for every member.
