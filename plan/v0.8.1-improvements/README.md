# Version 0.8.1 · Improvements after using 0.8.0

**After this version you can** see in one bar how much went out in a period (costs stacked, savings on top), read each category against its budget (the same budget as in Planning), open income, expenses and savings per category and subcategory, follow each account's balance with its buffer on Overzicht, see per month how much it wins or loses and how low the balance dips, set budgets, recurring and one-off items (also one-offs without a day, spread over their month) in one "Planning instellen" screen, and record contributions to a shared account from someone who does not use Saldo.

Status: **released as 0.8.1** (built 23 Nov 2026 on branch `v0.8.1-improvements`, cut from the released 0.8.0, main `856596e`; merged to main it releases); the full Go and web tests, the build and the audit are green, and the demo was walked through by API and DOM. Not done: looking at it by eye (375 px, dark mode, the slide, charts) and the "lead derives" checks on real data. Refined 19 Nov 2026 with the user's answers of the same day; every question is decided. Roadmap: [../README.md](../README.md).

## The user's eight items (19 Nov 2026, verbatim) and where they land
| # | Item | Phase |
|---|---|---|
| 1 | "in overzicht kaart wil ik zien hoeveel winst / verlies ik per maand zou maken. grijs getalletje is hoeveel dat er op het einde van de maand op men rekening zou staan. als er in het begin 1000 euro op de rekening staat en op het einde 800 dan moet dit duidelijker zijn." | [0.8.1-6](06-month-change-and-low.md) |
| 2 | "instellingen planning zouden duidelijker moeten zijn." | [0.8.1-8](08-planning-instellen.md), [0.8.1-9](09-one-off-without-day.md) |
| 3 | "in maand overzicht planning moet er meer nadruk komen op laagste niveau." | [0.8.1-6](06-month-change-and-low.md) |
| 4 | "instellingen voor gedeelde rekeingn stortingen ontbreken, moet ook mogelijk zijn voor niet gebruikers." | [0.8.1-7](07-contributors-without-saldo.md) |
| 5 | "overzicht grafieken moeten kosten opeen staan om duidelijk te maken hoeveel er totaal uit is gegaan." | [0.8.1-3](03-stacked-chart.md) |
| 6 | "overzicht percentages per categorie zou ten opzichte van budget moeten zijn (zelfde budget als in de planning)." | [0.8.1-2](02-budget-reference.md), [0.8.1-4](04-overzicht-breakdown-and-budget.md) |
| 7 | "overzicht zou ik ook een grafiek willen van de balans die op de rekening staat, incl buffer." | [0.8.1-5](05-balance-chart.md) |
| 8 | "in overzicht als ik op inkomen of uitgaven of sparen tik wil ik per categorie kunnen zien hoeveel. ook een dropdown per sub categorie." | [0.8.1-1](01-report-detail.md), [0.8.1-4](04-overzicht-breakdown-and-budget.md) |

## The user's answers (19 Nov 2026)
- **Item 1**: keep the grey number (end-of-month balance); the coloured chip becomes the month **result** = end − start (= income − expenses − saved): red "−€ 200", green "+€ X". The buffer state stays visible another way (0.8.1-6: card accent, state label, lowest-point line).
- **Item 2**: the design page "IMP: Planning instellen" (boards Telefoon- and Desktop-Planning-Instellen): a new screen, not a tab; Planning keeps Kalender, Maanden, Budget; Terugkerend, Eenmalig and the category budgets move there (0.8.1-8).
- **Item 4**: a contributor who is not a Saldo user is a name + IBAN + share; recognised by IBAN; gets their part of the required contribution; their IBAN is stored for matching only and not shown to other users beyond name and share; can later be linked to a user (0.8.1-7).
- **Item 6**: the percentage counts everything in the category (Overzicht's own amount, recurring items included) against Planning's budget; without a budget against the average of the last 6 months.
- **Round 2 (same day)**: item 5 as proposed (Gespaard on top, "Samen uit · over"); one-offs may have no day and are spread over the month (new phase 0.8.1-9); any member with Bewerken manages contributors; the lowest point includes the running month's past days; budgets save after 0.8 s with "Terugzetten"; migrations 0020 (contributors) and 0021 (one-offs).

## What exists (read 19 Nov 2026)
- **Item 1.** The grey number is `.fc-end` (`--muted`, `web/src/styles/components.css:509`) under each bar of Start's "Komende maanden" (`StartForecast.tsx:50`); beside it `resultLabel` = end − buffer ("+€ 307"), which reads as a profit. The Maanden chip is |end − buffer| ("€ 306,85 over"). `PlanMonth.start`/`end` are on the wire (`start + income − out − saved = end`): no API change.
- **Item 2.** Planning has five tabs (`planningTabs.ts`), budgets are edited by tapping a Budget-tab row (`PlanningBudgetEditor.tsx`), the tab is in the hash (`#terugkerend`, `#eenmalig`); server alerts link to `#maanden`, Bijdragen to `#budget`.
- **Item 3.** `PlanMonth.low {date, balance, state}` is on the wire and unused.
- **Item 4.** `ContributionsCard` renders only when `a.members.length > 1` (`Rekening.tsx:1239`): a shared account with one member (the partner is not on Saldo) has no Bijdragen card at all. Contributions exist per member only (`contribution_senders.user_id NOT NULL`, `account_access.contribution_share`, `memberPart`).
- **Item 5.** Three bars side by side (`Overzicht.tsx:167`); `s.total` already holds "Naar gedeelde/eigen rekening" and "Niet gecategoriseerd".
- **Item 6.** Shares are amount ÷ total (`lib/reports.ts:293`). The engine's `plan(c, m)` and `spent[c][m]` are private to `planning.Project`.
- **Item 7.** Rekening has a "Saldoverloop" chart from `balance_snapshots`; the demo has one bank snapshot per account and Bilance history has none; the engine reconstructs past days from the newest balance (0.8-3 rules 1–2).
- **Item 8.** The report rolls up to top categories (`reportKey`); income and saved are one number; `parts` already joins the row's own category.

## Decisions (19 Nov 2026)
1. **No rule is written twice.** Item 8's detail is a column of the report's own statement (`detail=1`), and its drill-down filters reuse `reportBucket`. Item 6 reads the engine's `plan`/`spent`, extracted into functions `Project` itself calls. Item 7 reads forecast rule 2, extracted the same way. Every 0.7 and 0.8-3 golden stays unchanged.
2. **Accounts stay independent** (0.8 decision 1). One balance line per account (small multiples), one Planning-instellen tile per account (not per scope), budget references in Alles are a sum of each account's plan (information, no verdict), no total over tiles.
3. **"Uit" = Uitgaven + Gespaard** in the stacked bar; tiles keep both apart; a line "Samen uit · over" below (user answer).
4. **Budget percentage = the row's full amount against Planning's budget** (user answer): numerator the report's own category amount, recurring items included; reference the account's budget row (the one Planning uses), else a **full-amount 6-month average from the report's own rule** over the engine's history months (`planning.HistoryMonths`). This is a second average next to the engine's variable-only one, chosen so numerator and reference count the same rows; Planning's figures do not change. They differ where a category holds recurring items (0.8.1-2 lists where; footnote in 0.8.1-4).
5. **Month result = end − start**, savings included (user answer); the buffer state from the end stays the verdict (0.8 decision 14) and moves to colour and a label.
6. **The lowest point is shown, not judged**: its own line coloured by its own state, the whole month including the running month's past days; the card's tone stays on the end (user answer).
7. **Contributors without Saldo are account-level** (0.8.1-7): typed IBAN accepted, matched only against the shared account's own rows, masked to the creator and the manager only; a member who proves the same IBAN as their own account replaces the contributor; linked to a member by the manager.
8. **One settings screen** (0.8.1-8): the design is followed; tiles map to accounts; the engine's item kinds stay reachable under the design's Uitgave/Inkomst switch; stored descriptions are shown (no "Jouw bijdrage").

9. **One-offs without a day** (0.8.1-9, user answer): stored as the month's 1st with `whole_month = 1`; spread like variable spending (later months every day, the running month the days after today, nothing left: tomorrow), exact cents, never matched, never late; items with a day and the 0.8-3 goldens unchanged.
10. **Contributors**: any member with Bewerken adds and edits them; IBAN masked to the creator and the manager (user answer). Migrations: 0020 contributors, 0021 one-offs; 0.9 keeps 0018/0019, its fallback becomes 0022.
11. **Budget saving** in Planning instellen: −/+ save after 0.8 s; "Terugzetten" restores the values of when the screen opened (user answer; how, 0.8.1-8).

## Known limits (document, do not solve in 0.8.1)
- Past budget percentages compare against **today's** 6-month average (a budget never applies backwards; budget rows only exist from the month they were set, so in the demo October shows averages only).
- Overzicht and Planning's Budget tab can show different figures for one category and month: Overzicht counts recurring items in the amount and in its average, Planning does not (W1's Gym; the demo's Wonen and Abonnementen have a reference only on Overzicht). A budgeted category with a recurring item can exceed 100 % on Overzicht.
- A one-off without a day that is paid during its month is counted twice until the month ends (planned items are never matched).
- The balance history is reconstructed backwards from the newest balance: a missing row shifts every earlier day; no line before the first booked row; today's buffer is drawn for the past.
- Stacked bars omit negative keys (refund surplus, net withdrawal); the "Samen uit" figure is net.
- A contributor's payment from another IBAN is not `received`; contributors get no notifications.
- The live budget impact in Planning instellen is the engine's arithmetic for one changed category from the running month on; the server answer replaces it after saving.

## Phases
| Phase | Title | Size | Items | Depends on | Who | Status |
|---|---|---|---|---|---|---|
| [0.8.1-1](01-report-detail.md) | Report detail per category and subcategory, and their drill-downs | M | 8 | – | Opus (rule), Sonnet (handler, web types) | planned |
| [0.8.1-2](02-budget-reference.md) | Budget reference per category and month (budget row, else a full-amount 6-month average) | M | 6 | – | Opus (two small helpers), Sonnet (route) | planned |
| [0.8.1-3](03-stacked-chart.md) | Overzicht: stacked "uit" bar | S | 5 | – | Sonnet | planned |
| [0.8.1-4](04-overzicht-breakdown-and-budget.md) | Overzicht: breakdown sheets, subcategories, rows against budget | M | 6, 8 | 0.8.1-1, -2, -3 | Sonnet | planned |
| [0.8.1-5](05-balance-chart.md) | Overzicht: balance per account with its buffer | M | 7 | – | Opus (extraction), Sonnet (route, UI) | planned |
| [0.8.1-6](06-month-change-and-low.md) | Start and Maanden: month result and lowest point | S | 1, 3 | – | Sonnet | planned |
| [0.8.1-7](07-contributors-without-saldo.md) | Bijdragen on every shared account; contributors without Saldo | L | 4 | – (migration 0020) | Opus (schema, shares, privacy), Sonnet (UI) | planned |
| [0.8.1-8](08-planning-instellen.md) | "Planning instellen" screen; Planning keeps three tabs | L | 2 | 0.8.1-6, 0.8.1-2 step 1 | Sonnet | planned |
| [0.8.1-9](09-one-off-without-day.md) | One-offs without a day: data (migration 0021) and engine spread | M | 2 | after 0.8.1-2 step 1 and 0.8.1-5 step 1 (same engine file) | Opus (engine), Sonnet (API, UI) | planned |

**Build order** (revised after the review of 19 Nov 2026).
- **Wave 1** (in parallel, no file in common): 0.8.1-1 steps 1–2 (`ledger/reports.go`, `transactions*.go`), 0.8.1-2 step 1 (`planning/forecast_project.go`, `server/planning_forecast.go`), 0.8.1-3 (`Overzicht.tsx`, `lib/reports.ts`), 0.8.1-6 (`lib/planning*.ts`, `PlanningMaanden.tsx`, `StartForecast.tsx`), 0.8.1-7 step 1 (`Rekening.tsx`, one line; can ship first).
- **Wave 2**: 0.8.1-5 step 1, then 0.8.1-9 step 2 (both `forecast_project.go`, after 0.8.1-2 step 1, the 0.8-3 suite green after each); 0.8.1-7 steps 2–3 (after 0.8.1-1: both touch `transactions.go`; after 0.8.1-2 step 1: both touch `planning_forecast.go`); 0.8.1-8 (after 0.8.1-6: `lib/planningMonths.ts`).
- **Wave 3**: the API and web-type steps 0.8.1-1 step 3, 0.8.1-2 step 2, 0.8.1-5 step 2, 0.8.1-9 step 1 and 0.8.1-7 step 4 all add to `privacy_test.go`, `docs/api.md` and `lib/{types,api}.ts`: one at a time in that order, each rebased on the last. 0.8.1-5 step 3 after 0.8.1-7 step 1 (`Rekening.tsx`: the `BalanceLine` extraction). 0.8.1-9 step 3 after 0.8.1-8 (the one-off sheet, Eenmalig).
- **Wave 4**: 0.8.1-4 (after 0.8.1-1, -2, -3; `Overzicht.tsx`, `OverzichtSheet.tsx`, `lib/reports.ts`), then 0.8.1-7 step 4's `PlanningBudget.tsx` part if 0.8.1-8 has not touched it yet (-8 first).
- Migrations: 0020 (0.8.1-7), 0021 (0.8.1-9); the migrator applies any unrecorded version, so the merge order of the two does not matter.

**Risky.** Three changes to `planning/forecast_project.go` (0.8.1-2 helpers, 0.8.1-5 past balances, 0.8.1-9 the new spread rule with new goldens): all 0.8-3 goldens must pass unchanged after each; the report's wider `GROUP BY` (the 4 s speed test in `reports_test.go`); the contributors' privacy rules and the share sum used by Planning, Start and 0.9-3b; 0.8.1-8 moves two tabs with their tests and changes URLs.

**Who builds what.** As in 0.8: subagents run unit tests only; the lead runs the full gate per phase (`go test ./...`, `npm run typecheck`, `npm test`, `npm run build`, the demo at 375 px and desktop, light and dark). Goldens come from `TestReportMonthsDemo`, `reportWorld`, `TestForecastDemo` and `planningWorld`; anything marked "lead derives" is computed by the lead with a throwaway script before the phase starts and written into the phase file; builders never adjust a golden to the code.

## Conflicts with 0.8.0 rules and the 0.9 plan (resolved here)
- **Derived shared flag** (0.8 decision 15): `Rekening.tsx` hides Bijdragen on `members > 1`; 0.8.1-7 step 1 uses `kind === 'shared'`.
- **Per-account independence** (0.8 decision 1): the design's two scope tiles "Persoonlijk"/"Gedeeld" with a total each would sum accounts with several accounts per scope; 0.8.1-8 makes one tile per account.
- **Stored descriptions** (0.8 decision 9): the design's "Jouw bijdrage" row is per viewer; 0.8.1-8 shows the stored description.
- **Month verdict** (0.8 decision 14): unchanged; the result chip (item 1) and the low line (item 3) are information, the card's tone and the alerts stay on the month end.
- **0.9 migrations**: 0.9 claims 0018 (push, applied live during the lock-screen spike) and 0019; 0.8.1-7 takes 0020 and 0.8.1-9 takes 0021, so 0.9-3b's fallback "0020" becomes 0022.
- **URLs**: `/planning#terugkerend` and `#eenmalig` redirect to `/planning/instellen#…` (0.8.1-8); `#kalender`, `#maanden`, `#budget` and the alerts' `?maand=…#maanden` keep working.
- **0.9-3b contribution trigger** (`contrib:<account>|<month>|<member>`): must cover contributors (`c<id>`), notifying the manager; 0.9-1's planning e-mail wording ("over/onder buffer") should match the app's new month wording.

## Open questions
None left from 19 Nov 2026: every answer is a decision above (3, 4, 6, 9, 10, 11). Numbers marked "lead derives" in 0.8.1-2, -4 and -9 are computed by the lead before those phases; they are not questions for the user.

## Release checklist (lead, after the last phase)
- Version `0.8.1-dev` during the phases; release the bare `0.8.1`, bumped in `saldo/config.yaml`, `server/cmd/saldo/main.go` (`version` and the ldflags comment), `web/package.json` and `web/package-lock.json`, the health example in `docs/api.md`.
- `saldo/CHANGELOG.md`: one line per item in the user's terms.
- `docs/api.md`: "Reports" (`detail=1`, `/api/reports/budgets`, `/api/reports/balances`), "Transactions" (new `category` values), "Planning" (`average` in `budgets`, planned items with `month`/`wholeMonth`), "Contributions" (contributors, `c<id>` shares, linking).
- `docs/local-testing.md`: section "Overzicht and Planning (0.8.1)" with each phase's "Done when".
- `server/internal/server/privacy_test.go`: rows for every new route; the contributor IBAN sentinel.
- `analysis/screens/{overzicht,planning,start,rekeningen}.md` and `analysis/concepts/{shared-account,budget,period-overview}.md`: the deviations (stacked bar, budget bars, breakdown sheets, balance card, month result and low, three Planning tabs and "Planning instellen", contributors). Never `finance-mockup/`.
- The 0.9 plan: 0.9-3b's fallback migration number (0022), 0.9-3b contributors, 0.9-1 wording.
- Statuses: this README, the phase files, a 0.8.1 row in [`../README.md`](../README.md) and the root `README.md`.

## Exit criteria
On the demo: October in Alles stacks to € 1.905,49 out; November's "Vrije tijd € 66,90 van € 350,00" and "Boodschappen € 295,21 van € 550,00" (unchanged by the full-amount rule: no recurring item sits in them) and Wonen against its 6-month average (lead derives; expected 100 %); the Inkomen, Uitgaven and Gespaard sheets add up to their tiles; the Zichtrekening's balance line passes −€ 431,45 on 1 November; Start's November "+€ 183" and the Maanden card's "+€ 183,30" with "Laagste punt 1 nov · −€ 431,45"; Planning has three tabs and a cog to "Planning instellen", where Vrije tijd + € 10 shows "Februari −€ 1.174,03 · € 40 minder"; a one-member shared account shows Bijdragen with a contributor "Mama" whose payment counts.
