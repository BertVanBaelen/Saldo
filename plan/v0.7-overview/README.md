# Version 0.7 · Overview

**After this version you can** see what you earned, spent and saved per month, quarter, year or your own range, per account and together, per category with its share and trend, and open the transactions behind any number. Start shows this month's spending.

Status: released as 0.7.0 (17 Nov 2026), verifying. Analysis milestone: M4. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| OVER-1 | Income, expenses and saved per month, quarter, year or custom range, per account and as a sum |
| OVER-2 | Category breakdown with share, trend and drill-down to transactions |
| OVER-3 | Start: spending this month and contributions |

## Phases
| Phase | Title | Size | Features | Depends on | Status |
|---|---|---|---|---|---|
| [0.7-1](01-reports-api.md) | Reports engine and API | M | OVER-1, OVER-2 | 0.6-4 | released (0.7.0) |
| [0.7-2](02-transacties-drill-down.md) | Transacties: category and period filters for the drill-down | S | OVER-2 | 0.7-1 (the selection rule) | released (0.7.0) |
| [0.7-3](03-overzicht-screen.md) | Overzicht screen: chart, tiles, per account, categories | M | OVER-1, OVER-2 | 0.7-1, 0.7-2 (links) | released (0.7.0) |
| [0.7-4](04-overzicht-pickers.md) | Overzicht: custom range, account filter, deep links | S | OVER-1 | 0.7-3 | released (0.7.0) |
| [0.7-5](05-start-spending.md) | Start: "Uitgaven november" card | S | OVER-3 | 0.7-1 | released (0.7.0) |

0.7-2 and 0.7-5 can run in parallel with 0.7-3 once 0.7-1 is done. The "Bijdragen" row and the "N transacties te categoriseren" alert of the old 0.7-3 were built in 0.6-5 and 0.4-3; only the spending card is left.

**Who builds what.** Each phase file says which steps a small model (Sonnet) can take from the file as written, and which need a bigger model (Opus) or the lead. Subagents run unit tests only (`go test ./internal/<pkg>/...`, `npx vitest run`, `npx tsc -b --noEmit`); the lead runs the full gate per phase (`go test ./...`, `npm run typecheck`, `npm test`, `npm run build`, the demo at 375 px and desktop, light and dark).

## Decisions (17 Nov 2026: plan refinement, the user's answers and the review)
1. **One selection rule for transfers.** Every report is computed for a *selection* S: the one `current` account of the account filter (a savings or investment account answers `400`), or else every `current` account of the scope the viewer holds. A transfer (per viewer, `visibleTx`, unchanged) is **internal** (left out) when its other side is in S **and** that account's history has started (first booked row on or before the transfer's date plus 3 days, the pairing window). Any other transfer is a **flow** of S:
   | Other side | Outgoing (amount < 0) | Incoming (amount > 0) |
   |---|---|---|
   | in S, history started | left out | left out |
   | a savings or investment account | Gespaard + | Gespaard − (**net**, user decision; a month can be negative) |
   | a shared account, from a personal account | expense row "Naar gedeelde rekening" (`--shared`) | income |
   | any other own current account (also shared → personal, shared → shared, or an account in S before its history starts) | expense row "Naar eigen rekening" (or "Naar gedeelde rekening" as above) | income (not netted, user decision) |
   | none (override "is een overschrijving" without a detected partner) | left out | left out |

   This reproduces the mockup: in Alles the € 450 contribution is internal; in Persoonlijk it is "Naar gedeelde rekening"; in Gedeeld both contributions are income (€ 900); per account each account counts its own transfers and a footnote names the difference. Bilance history from before the shared account's history shows the contributions as "Naar gedeelde rekening" in Alles.
2. **The rule is written once**, as SQL built in Go (`reportBucket` over a `parts` relation on top of `visibleTx`, 0.7-1). `ReportMonths` groups by it; the Transacties drill-down (0.7-2) filters with it. No second copy.
3. **Categories decide income or expense, the sign only for uncategorised rows.** A refund lowers its expense category; an income-type category nets in income; uncategorised rows are "Niet gecategoriseerd" when negative, income when positive. Subcategories roll up into their top category. Income is one total. Pending rows never count. Split rows count by their parts.
4. **Month granularity on the wire.** The API returns months (plus `firstMonth`, `firstDate`); quarters, years and custom ranges are sums of months in the web app. One SQL query per request.
5. **Mockup numbers.** Income, saved and the transfer structure of the demo match the mockup; the per-category expenses do not. The story is kept (user decision); the mockup's category figures are illustrative; tests use the story's numbers.
6. **Drill-down** links go to `/transacties?categorie=<id>|geen|naar-gedeeld|naar-eigen&periode=2026-10&rekening=<id>`, with exactly the report's selection (current accounts only, booked rows only). The scope is the app-wide scope. The Start alert's `filter=niet-gecategoriseerd` is unchanged.
7. **Partial periods**: the running month, and a first month whose history starts after the 1st, are lighter, carry no trend and are not the default selection; so is a quarter that contains one or starts before the history, and a year that contains one (Jaar's "2025 · vanaf november" is drawn normal, as in the mockup). Trend: none for Jaar and next to a partial period; "nieuw" when the previous amount was 0; shares are not forced to 100 %. Maand = the last 6 complete months, Kwartaal = up to 4 full quarters, the running month only through Eigen.
8. **Start includes the transfer rows** (user decision, deviating from the mockup): Start and Overzicht give the same numbers per selection; in Alles "samen" is the report total and a footnote explains the € 450 counted per account.

## Known limits (document, do not solve in 0.7)
- **An equal contribution imported without IBAN pairs with your own.** `visibleTx`'s opposite-amount match is not one-to-one. If Partner's € 450 arrives on the shared account as an imported row without a counterparty IBAN, it pairs with Bert's own −€ 450 (same amount, within 3 days) and is treated as a transfer: in Alles it is left out, so income is too low by the contribution. Bank-synced rows carry counterparty IBANs, so the live shared account is not affected; imported (Bilance, CSV without IBAN) history can be. Pinned by `TestReportKnownLimits` (0.7-1); `visibleTx` is deliberately not changed in 0.7.
- **Membership changes reclassify history.** Sums are computed from today's membership: when Partner leaves the shared account it becomes personal (`members` = 1), so past "Naar gedeelde rekening" rows become internal in Alles or "Naar eigen rekening"; when Bert leaves a shared account it drops out of his visible accounts, so his past contributions to it become uncategorised expenses ("Niet gecategoriseerd"). Pinned by `TestReportKnownLimits` for the second case.
- **Undetected transfers.** Bilance-imported rows lack counterparty IBANs; a transfer to a manual savings account without an IBAN (the demo's "Reserve") is only found by the opposite-amount match, which needs a booked row on the other side. Such transfers count as expenses and "Gespaard" is too low until the user marks them "Is een overschrijving", which then leaves them out (no known other side, so not saved either). The same goes for a contribution imported from Bilance (−€ 450, no IBAN): it is "Niet gecategoriseerd" or its mapped category, never "Naar gedeelde rekening".
- **Investment accounts**: the report counts a transfer to one as Gespaard, while Transacties' `transferKind` labels it `internal` (0.6-3 knows `saved` only for savings). Investments get their own treatment in 2.0.
- **Savings and investment accounts' own rows** (interest of a bank-synced savings account) are never in a selection, so interest is not income.
- **Foreign currency**: amounts are summed as stored (the account currency); a row in another currency is not converted.
- **Transacties' own list** (without a drill-down `categorie`) still shows pending rows and every account of the scope, so its total can differ from a report row; the drill-down filter itself matches the report exactly.

## Local testing for 0.7 (lead, `docs/local-testing.md` section "Overview (0.7)")
- Click-through on the fresh demo with the numbers of 0.7-1 and 0.7-5 (Alles October, Persoonlijk with "Naar gedeelde rekening", Gedeeld € 900, per account and footnote, Kwartaal, Jaar with "2025 · vanaf november" drawn normal, Eigen with the running November, a drill-down from every pseudo-row, Start in all three scopes).
- **Bilance scenario** (the risky cases): import `fixtures/csv/bilance-voorbeeld.csv` (2025 history, a −€ 200 / +€ 200 savings pair without IBAN on 2025-09-16, interest on Spaarrekening) and the new `fixtures/csv/bilance-bijdrage.csv` (0.7-1 step 5: 2024 months with −€ 450 to the shared account, before its history). Then check on Overzicht: the history now starts in 2024 (short-history note moves, Jaar shows 2024); 2024 in Alles shows € 450 per month under "Niet gecategoriseerd" (a Bilance row has no counterparty IBAN, so it has no known other side and is not a "Naar gedeelde rekening" flow; with a category from the import mapping it shows there instead; marking the rows "Is een overschrijving" removes them from Overzicht entirely, see Known limits); September 2025 shows € 200 Gespaard (paired by amount with the Spaarrekening row) and no interest as income; the drill-down from "Niet gecategoriseerd" in 2024 lists the imported rows. The pre-history path of the rule ("Naar gedeelde rekening" before the shared account's history) is covered by unit tests only: the importer drops counterparty IBANs that fail mod-97, and the demo IBANs fail it on purpose.

## Release checklist (lead, after 0.7-5)
- Version `0.7.0` (the `-dev` suffix was dropped on 17 Nov 2026 with the user's OK, so it releases when it reaches main): `saldo/config.yaml`, `server/cmd/saldo/main.go` (`version` and the ldflags comment), `web/package.json` and `web/package-lock.json`, the health example in `docs/api.md`.
- `saldo/CHANGELOG.md` entry; `docs/api.md` "Reports" section and the new `GET /api/transactions` parameters; `docs/local-testing.md` section "Overview (0.7)" (a ten-minute click-through with the demo numbers of 0.7-1).
- Statuses: this README, the phase files, the 0.7 row in [`../README.md`](../README.md) and in the root `README.md`; `analysis/screens/overzicht.md` phase links.

## Concepts
period-overview, category, internal-transfer, scope, shared-account.

## Exit criteria
You can answer "what did we spend per category last quarter", with the Bilance history included, and every category row opens the transactions behind it.
