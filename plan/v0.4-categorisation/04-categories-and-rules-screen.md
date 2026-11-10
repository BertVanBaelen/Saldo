# 0.4-4 · Categorieën en regels screen

| | |
|---|---|
| Version | [0.4 Categorisation](README.md) |
| Status | built (10 Nov 2026), to verify |
| Size | M |
| Features | CAT-5 |
| Concepts | [category](../../analysis/concepts/category.md), [categorisation-rule](../../analysis/concepts/categorisation-rule.md) |
| Screens | [categorieen](../../analysis/screens/categorieen.md), [meer](../../analysis/screens/meer.md) |
| Analysis | 4.2 |
| Depends on | [0.4-3](03-categorise-in-transacties.md) |

## Goal
See and manage all categories and rules in one place.

## Steps
1. Category tree editor as designed.
2. Rules list with priority (reorder), owner and conditions; the rule editor with a live preview; edit and delete.
3. Simple suggestions from history (counterparty → most frequent category, with confidence) in `category_suggestion`; low confidence only for confirmation; "N suggesties om te bevestigen" in Meer. Full learning follows in 0.5-6.

## Done when
Every rule can be found, changed and reordered, and suggestions can be confirmed or dismissed for good.

## Notes from 0.4-1 and 0.4-2 (10 Nov 2026)
- **Built in 0.4-4:** the reorder and the live preview of a rule, planned here as server work, exist now (see "Built" below). The planned reorder, a permutation of the `priority` values among the viewer's visible rules, became a renumbering of the rules the viewer can edit (Decisions 3).
- **Suggestions** must write through `categorise.Assign` with origin `suggestion`: it never replaces a rule's or a manual category. Built that way (Decisions 2).
- **Names with punctuation:** Bilance names contain commas and `&` (`Energie, nutsvoorzieningen`, `Eten & Drinken`). No UI or CSV code may split a category name on commas. For the 0.5-3 mapping, store the source path as two parts (top and sub), not one joined string, because a name may contain any punctuation, ` / ` included.

## Built (10 Nov 2026)
Server and web; the contract is in [docs/api.md](../../docs/api.md), "Rules" and "Suggestions".
- **Server:** `POST /api/rules/preview` (the live preview, "Past op N transacties"; counts only the viewer's own rows and writes nothing), `POST /api/rules/{id}/apply` (one rule on demand), `PUT /api/rules/order` (reorder), `GET /api/suggestions`, `POST /api/suggestions/confirm` and `POST /api/suggestions/dismiss` (`server/internal/server/categories.go`, `server/internal/ledger/rules.go`, `server/internal/ledger/suggestions.go`). The preview and the one-rule apply run on `categorise.Plan` and `Apply` (0.4-3), the suggestions on `categorise.Suggest` (`suggest.go`); a confirmed suggestion is written through `categorise.Assign`.
- **Migration 0006** (`0006_suggestions.sql`): merges duplicate decisions in `category_suggestions` (keeping the lowest id) and adds a unique index on (`user_id`, `counterparty_key`, `category_id`). Nothing wrote that table before, so a real database holds no duplicates; no other data changes.
- **Web:** `Categorieen.tsx` and `CategorieenEditors.tsx`, a Meer sub page with three tabs.
  - **Categorieën:** the tree under Uitgaven and Inkomsten with your own counts, the category editor (name, place, colour, "Subcategorie toevoegen") and the removal editor (parent, another category of the same type, or "Niet gecategoriseerd", with the note on the rules that follow).
  - **Regels:** the list by priority with owner and conditions, up and down arrows to reorder, the rule editor with the live preview and the box "Ook toepassen op bestaande transacties", and the read-only view of a rule on an account where you only have Lezen.
  - **Suggesties:** a card per suggestion with Bevestigen, Als regel and Negeren. Meer shows "N suggesties om te bevestigen".
  - Query parameters `?tab=categorieen|regels|suggesties` and `&regel=<id>`. "Regel aanpassen" and "Regel bekijken" in the Transacties detail open the rule through `?tab=regels&regel=<id>`; that settles the last item of "Not built here" in [0.4-3](03-categorise-in-transacties.md).
- **Tests:** server `rules_test.go` (preview, apply, reorder), `suggestions_test.go` and `categorise/suggest_test.go` (the model and the API), the migration test in `db_test.go`, the privacy sweep in `security_test.go`; web `Categorieen.test.tsx`, `categories.test.ts`, `Meer.test.ts`, `api.test.ts`. The server and web test suites pass; the by-hand check is in [docs/local-testing.md](../../docs/local-testing.md), "Categorieën en regels".

## Decisions (10 Nov 2026)
1. **Suggestions are computed on read; only decisions are stored.** `GET /api/suggestions` derives them from your own rows and writes nothing. Training rows are your rows with a category of origin `manual` or `import` (a rule's or a suggestion's category is an echo and does not train); a suggestion needs `MinSeen` 2 and `MinConfidence` 40 (constants in `categorise`). Only `confirmed` and `dismissed` are stored, per user, in `category_suggestions`; `open` is never written. A confirmed or dismissed suggestion never comes back for that counterparty and category.
2. **Confirming categorises the rows that wait now only.** Rows that arrive later need a rule (the button "Als regel") or, later, learning (0.5-6). The write goes through `Assign` with origin `suggestion` and never replaces a rule's, a manual, an imported or a split row's category. A second confirm answers `200 {"updated": 0}`, a second dismiss `204`.
3. **Reorder renumbers the rules you can edit.** The request names exactly those rules, top first; their priorities become distinct values, `v` being the old values from high to low (`v_0 ≥ v_1 ≥ …`, n rules). Built: `p_0 = max(v_0, n−1)` and `p_i = max(n−1−i, min(v_i, p_(i−1)−1))`. Planned: the same `p_0` and `p_i = min(v_i, p_(i−1)−1)`, which goes negative on low ties (for `v = [5, 0, 0]` it gives 5, 0, −1; the built formula gives 5, 1, 0). The two are identical for distinct values, and the built one never goes below 0, hence the floor `n−1−i`. Ties (such as several rules at the default 0) are broken, down to 0 at the bottom. Read-only rules keep their priority; another user's rules are never touched.
4. **The preview needs edit permission on the account** (a read-only account answers `403`), counts only your own rows and runs the same engine as "apply to similar" and `POST /api/rules/{id}/apply`, so applying the stored rule afterwards changes exactly the rows the preview announced.
5. **Amounts are compared without sign**, in the rule, the preview and the apply. The editor's help text says so ("Zonder teken: Saldo vergelijkt met het bedrag zonder plus of min, voor uitgaven en inkomsten."), which differs from the mockup's ("Bij een uitgavencategorie kijkt Saldo naar uitgaven, bij een inkomstencategorie naar inkomsten."). See open question 1.
6. **Removing a category with "Niet gecategoriseerd" deletes every user's rules for it**, as the server did from 0.4-1; the removal editor's note counts only the rules you can see. See open question 5.
7. **"Als regel" makes a user rule** on the suggestion's counterparty with "bevat" (the mockup said "is gelijk aan"), the suggestion's category and "Ook toepassen op bestaande transacties" ticked. A user rule applies to your personal accounts only. See open question 3.
8. **Deviations from the mockup:** the per-rule "Past op N transacties" is shown in the editor only; a new rule has no position select (move it afterwards with the arrows); the owner of a rule cannot change while editing (the server refuses; make a new rule); no hash deep links such as `#regel-3`, query parameters instead; the footnote under the category tree reads "Overschrijvingen tussen je eigen rekeningen herkent Saldo zelf: ze tellen niet mee als uitgave of inkomst. Wat naar een spaarrekening gaat, telt als gespaard." instead of the mockup's "… krijgen geen categorie …", because a transfer may get a category from a rule or a pick (decision of 10 Nov 2026) and sums treat transfers at query time, not by category.

## Not built here
- The per-rule "Past op N transacties" in the rules list (one preview request per rule): the editor shows it for the rule being edited.
- A position select on a new rule: it gets priority 0 (it wins ties against older rules at 0) and is moved afterwards with the arrows or the position select of its editor.
- Confidence on the suggestion strip in the Transacties detail: 0.5-6.
- Applying a confirmed suggestion to rows that arrive later (learning, new rows and backfill): 0.5-6.

## Open questions for the user
1. **Amount direction.** Rules compare the absolute amount, so an expense rule "Bedrag tussen € 20 en € 200" also catches a € 50 refund from the same counterparty. Recommendation: with an amount condition, match only rows whose sign fits the category's type (an expense category only money out, an income category only money in), and say so in the help text as the mockup did.
2. **Preview of an existing rule with an IBAN.** The IBAN of a stored rule only comes back masked, so the editor cannot send it, and the preview of such a rule stays idle ("Typ het IBAN opnieuw om te zien op welke transacties de regel past.") until the IBAN is typed again. Saving leaves it alone. Recommendation: when `ruleId` is sent and `counterpartyIban` is left out, the server uses the stored IBAN.
3. **"Als regel" and shared accounts.** A suggestion can come from rows of a shared account, but "Als regel" always makes a user rule, which never applies to an account with more than one member. Recommendation: add the account (or accounts) of the open rows to a suggestion, so "Als regel" can preselect that account's rule.
4. **Text of the apply box.** "(handmatige keuzes blijven altijd staan)" also holds for categories from an import and for split transactions. Recommendation: "(handmatige keuzes, importcategorieën en splitsingen blijven staan)"; the toast after saving already names what stayed.
5. **Removal and other users' rules.** "Niet gecategoriseerd" deletes every user's rules for the category, while the note counts only the rules you can see ("2 regels kiezen …"). Recommendation: word it "Je N regels" and add that rules of other users for this category go too, without a number, like the line about their transactions.
