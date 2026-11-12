# 0.5-4 · Overlap and duplicates

| | |
|---|---|
| Version | [0.5 Bilance import](README.md) |
| Status | built, to verify (11 Nov 2026) |
| Size | M |
| Features | IMP-3 |
| Concepts | [import](../../analysis/concepts/import.md), [transaction](../../analysis/concepts/transaction.md) |
| Screens | [importeren](../../analysis/screens/importeren.md) |
| Analysis | 4.6, risk 11 |
| Depends on | [0.5-2](02-import-wizard.md) |

## Goal
Old history from Bilance and recent history from the bank fit together without double counting.

## Steps
1. Suggested import cutoff = first synced date of the target account.
2. Probable duplicates: booking date ±1 day, same amount, similar counterparty; shown side by side in the preview, skipped by default.
3. For a skipped duplicate, apply the Bilance category to the existing transaction if it is uncategorised.

## Done when
Importing a file that overlaps the synced period adds only the older rows.

## Carried over from 0.3
- 0.3-6 already skips exact matches (booking date, amount, counterparty and communication equal, counted per occurrence), at import and in the sync. This phase adds the fuzzy part: booking date ±1 day and a similar counterparty.
- **Step 1 conflicts with the 0.3-6 fallback use.** A cutoff at the first synced date would block importing the rows after a failed sync. Offer the cutoff only for Bilance files, never for the generic CSV import.
- The preview already warns when new rows fall in the period the account syncs (counts only); the side-by-side view of probable duplicates can replace that warning for Bilance files.

## Built (11 Nov 2026)
The contract is in [docs/api.md](../../docs/api.md), "Overlap and duplicates".
- **One matcher** (`server/internal/ledger/duplicates.go`): `storedBooked` reads the booked rows an account holds in the date range of the file (one day wider for the fuzzy rule); `storedContent` (the sync's side, exact only) and `matchStored` (the import) both build on it. `matchStored` first matches exactly (`ContentHash`, counted per occurrence, as `dropPresent` did, which it replaces), then, for a Bilance file, fuzzily on what is left (`similarNames`, a small pure function with its test). A stored row is matched at most once.
- **Import** (`ledger.ImportFiles` gets an `ImportOptions{Include, Cutoffs}`): per account part, rows on or after the cutoff are skipped and counted first, then exact matches (`present`), then probable duplicates (skipped unless their line is included). A skipped duplicate hands the file's category to a stored row without category through `categorise.Assign` with origin `import` (new, with the strictest guard: only a row with no category and no splits). `Batch` carries `AfterCutoff`, `Found`, `Probable`, `Taken`, `Duplicates` and `FirstSynced`, none of them in the batch JSON.
- **Routes**: the parts `duplicates` (`{"include": [lines]}`) and `cutoffs` (`{"<accountId>": "yyyy-mm-dd" | null}`) on the preview and the import; the preview answers `duplicates` (`total`, first 200 `items`), `cutoffs` (the suggestion per account) and the counts `afterCutoff`, `probable`, `categoryTaken`; the import answers the same three counts. No new route, no migration.
- **Wizard** (`ImporterenControle.tsx`, `Importeren.tsx`): for a Bilance file *Controle* has a cutoff card per account and the side-by-side list; the 0.3-6 overlap warning stays for any other file. Result facts for the cutoff, the duplicates and the categories taken over.
- **Fixture**: `bilance-voorbeeld.csv` gets one row (28 rows): the bakery of 16 November 2026, a probable duplicate of a demo row that has no category. The expectations are in `fixtures/csv/README.md`.

## Decisions (11 Nov 2026)
1. **Fuzzy rule:** same account, same amount (exactly, so the same sign), booking dates at most one day apart, and a similar counterparty: equal after normalising (lower case, accents folded, punctuation as a space, digit-only words and the words `be bv bvba nv sa sprl vzw ab` dropped), or one contains the other as whole words (the shorter at least 4 characters), or at least half of the larger name's words are shared words of 3 letters or more. A name without words matches nothing. No spelling distance (`shortcut` in the code); a real export will show whether it is needed. The amount and the date are exact, so the name rule can be generous: a wrong match is listed, skipped only by default and one click from imported.
2. **The sync keeps the exact rule only.** Reusing the fuzzy matcher there would silently drop a real second payment of the same amount a day apart (two coffees, a parking and a toll), with no list to show the user and no undo; the import shows every match and lets the user include it. `storedContent` is the shared candidate query, not a second copy of the exact logic.
3. **One stored row, one incoming row.** Exact matches claim their stored rows first (per hash, in id order, as the counting rule always did), the fuzzy pass only sees what is left, rows go in file order, the closest date then the oldest id wins. So a stored row never swallows several rows of the file, and an exact match is never taken by a fuzzy one.
4. **Bilance only, 400 for the rest.** `duplicates` or `cutoffs` with a generic or Argenta file is `400` (clearer than ignoring it: the generic import is the fallback after a failed sync, which a cutoff would block). A cutoff for an account that is not in the import, a bad date, a bad key, a non-integer or out-of-range line, an unknown key or more than 5000 lines is `400`. A line that is not a probable duplicate is ignored.
5. **Cutoff semantic:** rows booked **on or after** the cutoff date are skipped; rows before it are imported. The suggestion is the booking date of the account's earliest booked row with a bank connection (imported rows never count; none, no suggestion). The server never applies it by itself: the wizard sends it as the default. Cutoff goes first: a row on or after it is not matched, so a probable duplicate there is moot and not listed; duplicates before the cutoff (an earlier Argenta import, or the day-before edge) still are. With the demo's suggested cutoff the fixture therefore shows no list; *Geen afkapdatum* shows it.
6. **Two checks on the first visit.** The suggestion comes with the first check (asked without a cutoff, as the server cannot know it earlier), the web then sets it as the default, which changes the check key once: the step asks the server twice, and once more per changed date. An account without a suggestion adds nothing. Both are previews against the hourly limit.
7. **Inclusions are not in the web check key.** The list and the counts do not depend on them, and a click that asked the server again would cost a preview each and blank the list. The web sends the cutoffs with every check and the inclusions with the import, and works the effect out from the listed rows (`new` plus the included, `probable` minus them, the categories, the takes). The server accepts `duplicates` on the preview too (for API clients). The list holds the first 200; *Alles opnemen* covers those, the rest is skipped and the screen says so.
8. **An included duplicate is a normal row** with its mapped category, through the same insert as any other; its stored twin is not touched.
9. **Category taken over:** only for a skipped probable duplicate (an exact match is a repeat of the same file or sync, there is nothing to take over), only when the stored row has no category and no splits, through `categorise.Assign` with the new origin `import` and a guard of `category_id IS NULL` on top of the usual one, in the import's transaction, rolled back with a preview. It counts as `categoryTaken`. The category is the one the file's row has through the mapping (a skipped or unchosen pair takes nothing).
10. **Nothing new is stored on the batch.** `afterCutoff`, `probable` and `categoryTaken` are in the preview counts and the answer of an import only, like `categorised`; `rows_duplicate` keeps counting exact matches. 0.5-5 decides whether the history needs them.
11. **A real import may end with zero rows** when every row is after the cutoff (the "no readable row" refusal only looks at the file before the cutoff is applied); the wizard disables the button at zero.
12. **Mockup deviations** are listed in [importeren](../../analysis/screens/importeren.md). The mockup's switch to turn the category take-over off is not built: it only fills transactions without a category.
13. **Fixture:** one row added (the bakery, EUR 8,40 on 16 November 2026, a day before the demo's uncategorised `Bakkerij De Graankorrel`), so the preview with *Geen afkapdatum* shows one take-over. The numbers quoted for 0.5-2 and 0.5-3 (rows, pairs, new, present) are updated in the fixtures README.

## To verify
- The two fuzzy matches of `bilance-voorbeeld.csv` by hand with *Geen afkapdatum* ([fixtures](../../fixtures/csv/README.md)), and the default flow with the suggested cutoff.
- On a real export: whether the name rule matches too little (the merchant names of Bilance against the bank's) or too much, and whether the first synced date of a real account is the right cutoff.

## For 0.5-5 (batches and undo)
- The take-over writes are on **existing** transactions, outside the batch: deleting a batch does not undo them. The simplest honest rule is to leave them (uncategorised rows that got a category, origin `import`, which a manual pick replaces) and to say so in the undo dialog; an undo that wants to be complete would have to remember which stored rows took a category.
- The import answer now also carries `afterCutoff`, `probable` and `categoryTaken` (top level, not in the batches); the history list shows none of them.
- Re-import of the same file after an undo: the probable duplicates are found again (their stored rows are still there); exact matches against the undone batch's own rows are gone with them.
