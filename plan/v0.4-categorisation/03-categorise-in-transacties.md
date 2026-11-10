# 0.4-3 · Categorise in Transacties

| | |
|---|---|
| Version | [0.4 Categorisation](README.md) |
| Status | built (10 Nov 2026), to verify |
| Size | M |
| Features | CAT-3, CAT-4 |
| Concepts | [transaction](../../analysis/concepts/transaction.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [category](../../analysis/concepts/category.md) |
| Screens | [transacties](../../analysis/screens/transacties.md), [start](../../analysis/screens/start.md) |
| Analysis | 4.2 |
| Depends on | [0.4-2](02-rules-engine.md) |

## Goal
Fix a category in a tap and teach Saldo at the same time.

## Steps
1. Detail sheet / panel: category pills, saves at once; the rule that set a category, with "Regel aanpassen".
2. "Toepassen op vergelijkbare en regel maken" with the count of similar transactions; creates a rule and updates them; toast "Regel gemaakt · N andere bijgewerkt".
3. Note per transaction.
4. Split over several categories [S] (`transaction_split`).
5. Filter "Niet gecategoriseerd" with count, the Start alert "N transacties te categoriseren" and the sidebar badge.
6. Read-only members of a shared account see no edit controls.
7. Carry a manual choice from a pending row to its booked row. Today `ledger.StoreFetch` deletes a pending row the bank no longer reports, with its category and note, when the booked row arrives in the same fetch. Proposed rule: same account, same amount, equal normalised counterparty (`categorise.Normalise`), booked date within 7 days of the pending date, one to one, closest date first; carry the category with origin `manual` and the note, nothing else. Test: categorise a pending row by hand, sync its booked row, the booked row has the category and note, and nothing else moved.

## Done when
You categorise from the phone and desktop, and a created rule picks up the next matching transaction.

## Notes from 0.4-1 and 0.4-2 (10 Nov 2026)
- **One write path for automatic categories:** "apply to similar" writes the clicked row with origin `manual` itself, and the similar rows through `categorise.Assign` (or `ApplyAccount`), which only changes eligible rows (no split; no category, or a rule's or a suggestion's) and repeats that guard in its UPDATE.
- **`import` is protected** from automatic writers. "Apply to similar" must decide explicitly whether it overrides categories from a Bilance import (it may, as an explicit user action; never silently a `manual` one) and say so in the count it shows.
- **Pending to booked:** step 7 above is required for the exit criterion "a manual choice is never overwritten".
- **Rule visibility:** never return a rule or `rule_id` the viewer cannot see. Example: a user rule of one member set a category on a personal account that becomes shared in 0.6; show "set by a rule" without the rule then.
- **Splits on pending rows:** undecided (a pending row may still change its amount).

## Built (10 Nov 2026)
Server and web; the contract is in [docs/api.md](../../docs/api.md), "Categorise a transaction".
- **Server:** `categorise.SetManual` (`manual.go`: the manual write, next to `Assign`); `categorise.Plan` and `Apply` (`plan.go`: one engine for the preview and the write of "apply to similar", the one 0.4-4's rule preview is planned on); `PATCH /api/transactions/{id}` (category, note), `GET` and `POST /api/transactions/{id}/similar`, `PUT` and `DELETE /api/transactions/{id}/split` (`server/internal/ledger/categorise.go`, `server/internal/server/transactions.go`). A transaction now carries `categoryOrigin`, `ruleId`, `note` and `splits`. No migration.
- **Carry-over (step 7):** in `ledger.StoreFetch`, before the rules run; `NewTransaction` has a `Note` field that `InsertTransactions` stores.
- **Web:** `TransactieDetail.tsx`, one component for the phone sheet and the desktop panel: category pills of the main categories plus a select "Alle categorieën" over the whole tree, the source strip ("Zelf gekozen", "Via regel", "Suggestie" with "Bevestigen", "Uit je importbestand"), "Toepassen op vergelijkbare en regel maken" with the live preview, note, split editor, read-only view, offline state. `lib/categories.ts` holds the tree helpers and the split arithmetic. A pick saves at once; "Opslaan" saves the note and applies the rule in one go and closes the phone sheet. Every change reloads the "Niet gecategoriseerd" count and the shell (badge, Start alert).
- **Tests:** server `plan_test.go` (`SetManual`, `Plan` and `Apply`), `transactions_test.go` (API, permissions, rule visibility, manual never overwritten, cross-origin), `carry_test.go` (carry-over), the privacy sweep in `security_test.go`; web `TransactieDetail.test.tsx`, `categories.test.ts`, `Transacties.test.tsx`, `api.test.ts`. Server and web tests pass; the by-hand check is in [docs/local-testing.md](../../docs/local-testing.md), "Added in 0.4: categorisation".

## Decisions (10 Nov 2026)
1. **Splits only on booked rows:** a pending row's amount may still change (`400` "Splitsen kan pas als de bank de transactie boekt."). This settles the "undecided" note above. The row keeps its own category, origin and rule under a split, hidden, so an unsplit restores them; while split it shows none, is not "te categoriseren", is never changed by a rule and cannot get a category by hand, and it counts once under each part's category.
2. **A pick is manual:** picking the same category over a rule's, a suggestion's or an import's makes it `manual` (the lock); the same manual category again changes nothing. A category cannot be removed with `PATCH` (`null` is refused): it is changed, not removed.
3. **"Apply to similar" changes only rows with no category or one from a rule or a suggestion.** Manual categories, categories from an import (the Bilance import included: the open question in the note above) and splits are never replaced, and the preview and the toast say how many stayed and why ("N overgeslagen: …"). A row that already has the category counts as skipped for no reason.
4. **Which rule it makes:** counterparty contains, priority 0, no other condition. A user rule when the account has one member (it covers every account where you are the only member), an account rule when it is shared (the text says "De regel geldt voor alle leden van de …"). The box is hidden for a row without a counterparty name.
5. **Repair path instead of an undo:** an existing rule of the same owner whose only condition is that counterparty is reused with the new category ("Regel bijgewerkt", no duplicate). After a wrong bulk apply, pick the right category again with the box ticked and the rows the rule set follow. There is no history of rows to restore, so no "Ongedaan maken".
6. **Who sees what:** `GET .../similar` needs edit permission like the `POST` (a read-only member sees no rule box). `ruleId` is only returned for a rule the viewer can see; otherwise the strip says "Via een regel" without "Regel aanpassen". This settles "Rule visibility" above.
7. **Notes:** at most 200 characters, a line break becomes a space, visible to everyone with access to the account (read-only members too; a shared account's field says so), not searched.
8. **Carry-over (step 7), built as proposed:** same account, same signed amount, equal normalised counterparty, booking dates at most 7 days apart either way, one to one, closest first (then the lower pending id, then the earlier booked row). It carries the note and a `manual` category, nothing else (no rule link, no split), only onto a booked row stored in that fetch, and the same fetch again changes nothing.
9. **Transfers** may carry a category (the decision of 0.4-2 stands: nothing skips them). The picker stays hidden for a transfer without a category, which shows "Overschrijving tussen eigen rekeningen"; 0.6-3 designs how a transfer is marked and categorised. A transfer that has a category can be changed.
10. **Step 5 already existed from 0.3** (the `uncategorised=1` filter, the Start alert, the badge). It now follows every change: a pick, a rule's updates, a split and its undo all reload the count.

## Not built here
- The "Is een overschrijving" button: 0.6-3.
- The category dropdown of the "Categorie" filter (it offers "Niet gecategoriseerd" only): the drill-down of 0.7-2.
- Confidence on the suggestion strip: 0.5-6.
- The target of "Regel aanpassen" and "Regel bekijken" is built in 0.4-4: both open the rule through `/categorieen?tab=regels&regel=<id>`.
