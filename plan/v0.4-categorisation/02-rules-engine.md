# 0.4-2 · Rules engine

| | |
|---|---|
| Version | [0.4 Categorisation](README.md) |
| Status | built (10 Nov 2026), to verify: server only, the screens are 0.4-3 and 0.4-4 |
| Size | M |
| Features | CAT-2 |
| Concepts | [categorisation-rule](../../analysis/concepts/categorisation-rule.md), [transaction](../../analysis/concepts/transaction.md) |
| Analysis | 4.2 |
| Depends on | [0.4-1](01-category-tree.md) |

## Goal
Most transactions get the right category without you doing anything.

## Steps
1. `rule` table: owner (account or user), priority, conditions (counterparty name or IBAN, communication contains or regex, amount range), category.
2. Store the category origin on every transaction (manual, rule, suggestion, import) and the rule that set it.
3. Apply rules on every new transaction and on demand. Precedence: manual > highest-priority rule > suggestion. Re-running never overwrites a manual choice.
4. Table tests for matching and precedence.

## Done when
New synced transactions are categorised by your rules, and the tests prove manual choices stay.

## Built (10 Nov 2026)
Server side; the contract is in [docs/api.md](../../docs/api.md), "Rules".
- **Engine** `server/internal/categorise` (ledger imports it, never the other way): `Normalise`, `Prepare` and `Match` (pure, no database), `RulesFor` (the rules that apply to an account), `Assign` (the single automatic write) and `ApplyAccount`.
- **Migration** `0005_rules_engine.sql`, forward-safe (only `ADD COLUMN` and two indexes): `rules.counterparty_exact` and `rules.communication_contains`; `communication_regex` keeps the regex, `counterparty_match` the counterparty text, `name` stays unused. Tested on a populated version-4 database.
- **Endpoints:** `GET /api/rules`, `POST /api/rules`, `PATCH`/`DELETE /api/rules/{id}`, `POST /api/rules/apply`.
- **When:** new rows are tagged before insert in `ledger.StoreFetch` (every sync path, the demo link included; pending rows too) and in `Store.Import` (the preview included, rolled back); `ledger.NewTransaction` carries `CategoryID`, `CategoryOrigin`, `RuleID`, and a row that already has a category is left alone. Stored rows are only changed by `POST /api/rules/apply`.
- **Tests:** matcher and order table tests, a pathological pattern, `Assign` precedence, which rules apply to a personal or a shared account, API validation and permissions, apply idempotency and protection of manual and imported rows, sync and import tagging, the privacy sweep.

## Decisions (10 Nov 2026)
1. **Conditions** ANDed, at least one: counterparty contains or equals (normalised: lower case, Latin diacritics folded, white space collapsed), counterparty IBAN equal (8–34 letters and digits, no check-digit test: the demo IBANs are invalid on purpose), communication contains (normalised) or an RE2 regex (case-insensitive, white space collapsed, not folded; the first 1 000 characters), amount range on the **absolute** amount, inclusive.
2. **Priority** 0–1000, higher wins, ties go to the newest rule: priority DESC, id DESC everywhere.
3. **Which rules apply:** the account's rules, plus the member's user rules only when the account has exactly one member. A user rule never applies to a shared account.
4. **Where the category lives:** on the transaction (one per transaction, the same for every member). **Eligible** for automatic writes: no split parts, and no category or origin `rule`/`suggestion`. `manual`, `import` and unknown origins are never touched automatically. `Assign` repeats this guard in the SQL of its UPDATE; a suggestion never replaces a rule. 0.4-3, 0.4-4 and 0.5-6 must write automatic categories through `Assign`.
5. **No auto-apply** when a rule is created, changed or deleted; deleting keeps the categories it set (`rule_id` becomes NULL). A row that no rule matches any more keeps its category.
6. **Limits:** 140 characters counterparty, 200 communication, 200 rules per owner. Rules are not audit-logged.
7. **Pending to booked:** not built here; see 0.4-3, step 7.
