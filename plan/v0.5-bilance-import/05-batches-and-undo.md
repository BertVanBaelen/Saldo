# 0.5-5 · Batches and undo

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | built, to verify (11 Nov 2026) |
| Size | S |
| Features | IMP-4 |
| Concepts | [import](../../analysis/concepts/import.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6 |
| Depends on | [0.5-4](04-overlap-and-duplicates.md) |

## Goal
Every import can be reversed in one step.

## Steps
1. `import_batch`: source, file name and hash, account, created by, created at, undone at, row counts.
2. Undo removes the batch's transactions (and only those).
3. Re-importing the same file adds nothing (file hash and dedupe key) and says so.
4. Import history with undo in the Importeren screen.

## Done when
Import, undo and re-import leave the data exactly as before the first import plus the file once.

## Carried over from 0.3
- `import_batches` (source, file name, SHA-256, account, created by, undone at, counts), the history list and the 0.3-6 re-import rule (an identical file adds nothing and makes a batch with 0 new rows) already exist, so steps 1, 3 and most of 4 are done. What is left: the undo itself, and what to do with 0-row batches.
- Deleting a batch also deletes the categories set on its rows (`transactions.import_batch_id` cascades): say so in the confirmation.

## Built (11 Nov 2026)
The contract is in [docs/api.md](../../docs/api.md), "Undo (0.5-5)" and `GET /api/imports`. No migration: `import_batches.undone_at` and the cascade on `transactions.import_batch_id` were there since 0001.
- **Undo** (`server/internal/ledger/undo.go`): `POST /api/imports/{id}/undo[?run=1]` deletes the transactions of the batch and sets `undone_at`, all in one database transaction; `GET /api/imports/{id}/undo-preview[?run=1]` counts `batches`, `rows`, `changed` and `categorised` first. The schema was read, not assumed: the only tables that point at a transaction are `transaction_splits` and `transfer_overrides`, both `ON DELETE CASCADE`, and `foreign_keys` is on (`db.go`); suggestions are computed from the rows on read, so those of an undone batch vanish. Authorisation as `reapply-categories`: edit access to the batch's account, hidden or unknown 404, read-only 403.
- **History list** (`GET /api/imports`): each batch also has `undoneAt` and `run`.
- **Web:** `ImporterenUndo.tsx` (the confirmation as the shared `Sheet`), the history rows of `Importeren.tsx` (undo button, "Ongedaan gemaakt op ...", "Niets nieuws toegevoegd", grouped files), the undo on the result step, the `undo` icon, the mockup's CSS for the batch action and the dialog.
- **Audit:** `import_undone` with the batch id and the counts.
- **Tests:** ledger (rows and only those, with splits and notes; access and states; a run all or nothing; import, undo, re-import equals before plus the file once), server (HTTP round trip, privacy sweep, 401), web (grouping and labels, the confirmation with counts and the call, the undo from the result).

## Decisions (11 Nov 2026)
1. **Undo removes all of the batch's rows, also the ones the user changed**, after a confirmation that counts first. Reversing the whole import is the point; a partial undo would leave a batch that is neither in nor out.
2. **"Changed" is defined by what is reliably knowable:** a category set by hand (origin `manual`) or by confirming a suggestion (`suggestion`), or a split. A rule's category is **not** counted, because rules also fire while importing (`tagByRules`), so origin `rule` cannot tell a rule at import from one applied later. A note is **not** counted either: a Bilance `Notitie` is stored as the note, and nothing remembers the imported text to compare with. So the count is a floor; the sheet still says that categories, splits and notes go.
3. **Authorisation:** edit access to the batch's account, not "created by the viewer": a shared account's imports belong to the account, and the history lists them for every member. This is the rule of `reapply-categories`. A read-only member sees the batch with the *Alleen lezen* chip instead of the button.
4. **Already undone is 400**, the repo's validation style (there is no 409 in `fail`): "Deze import is al ongedaan gemaakt." A batch with `imported: 0` is 400 too ("Deze import heeft niets toegevoegd, ..."): nothing to undo.
5. **Categories that stay:** the ones the import created, the ones handed to existing transactions (0.5-4's `categoryTaken`: writes outside the batch, origin `import`, which a manual pick replaces), and the saved mapping. Remembering which stored rows took a category would be a new table for one of the smallest effects of an import; the sheet says they stay.
6. **Re-import after an undo already worked:** there is no file-hash rule, the identical-file rule is the exact content match against the rows the account holds, and the undone rows are gone with the undo. The sync's `importAllowance` reads `undone_at IS NULL`; with the rows gone it has nothing of the file to count either. Exact matches against the undone batch's own rows disappear with the rows; the probable duplicates against synced rows are found again.
7. **0-row batches** (the same file again, or everything duplicate or after the cutoff) **stay in the list** as honest history, muted, labelled "Niets nieuws toegevoegd", with no button. Nothing is hidden and nothing is paged: the list is as long as the imports are many (a handful per user in practice); a filter or paging can come when a real history needs it. The wizard's button is off at zero, so such a batch only comes from the API or a race; the result step then says "Niets nieuws toegevoegd" with "Dit bestand was al geïmporteerd of staat al in Saldo; er is niets toegevoegd." (not "al geïmporteerd" alone: the server cannot tell the same file from rows the sync brought).
8. **Grouping, no migration:** batches of one file import are one **run**: same `file_hash`, same `created_by`, same `created_at` second. They are inserted in one transaction, so a run shares the second; `GET /api/imports` answers `run`, the lowest batch id of that group (a subquery). Two uploads of the same file by the same user in one second would group too, which is harmless (they undo together, as `run=1` says). A real `import_run` column would be cleaner but needs a migration for no visible gain.
9. **One call for a run:** `?run=1` makes the server collect the batches of the run itself and check every account, so the client sends no list of ids to validate, and one refused account refuses all (tested). The web app always uses `run=1` (a single batch is a run of one); per-account undo exists in the API only, since the UI undoes a file as one entry.
10. **Cache:** after an undo the history list and the shell counts (`refreshShell`: alerts, *Te categoriseren*) reload; the transaction lists load on every visit, so nothing else is cached.
11. **Mockup deviations** are listed in [importeren](../../analysis/screens/importeren.md) (no separate history screen with a card per batch, no mapping dialog or re-apply button, no per-account undo, no line for a shared account, no "categories put back").

## To verify
- Undo from the history and from the result with `bilance-voorbeeld.csv`, and the re-import ([fixtures](../../fixtures/csv/README.md)), by hand.
- On real data: whether the history gets long enough to need paging or a filter.

## For 0.5-6 (learning and backfill)
- Suggestions are computed on read from the rows that exist ([suggestions.go](../../server/internal/ledger/suggestions.go): training on origin `manual` and `import`), so rows of an undone batch stop training at once, with no cleanup. Keep it that way: anything 0.5-6 stores about learning (a table of counts, a cache) must be derived from rows again or be dropped when a batch is undone, or the undo leaves the suggestions behind.
- A backfill that writes categories to **existing** rows (as the 0.5-4 take-over does) is outside every batch and is not undone with one; if it gets its own undo, it needs its own record of what it touched.
- Batches now carry `undoneAt`; a backfill or re-apply over "the active batches" must skip batches with `undoneAt` set (`ReapplyCategories` on an undone batch finds no rows, which is harmless).
- `run` is a derived grouping, not a stored identifier: do not key anything on it.
