# Version 0.5.1 · Category look and picker (and a sync fix)

**After this version you can** pick your own emoji as the icon of a category, give a category any of 16 pastels or your own colour, find a category on a transaction in two taps (main category, then subcategory) instead of a chip row and a long dropdown, and a bank link with two accounts syncs both of them.

Status: built (16 Nov 2026), to verify on the live add-on; version in `saldo/config.yaml` is `0.5.1-dev` until then. Written on request after 0.5.0; not a roadmap version of the analysis, so no feature ids. Shared accounts stays 0.6 ([../v0.6-shared-accounts/README.md](../v0.6-shared-accounts/README.md)).

Set on 16 Nov 2026 (user): the work is a patch release on top of 0.5; emoji replace the line icons of categories; 16 palette colours plus a custom hex; the picker is a two-step drill-down.

## Phases
Run in this order. 1 touches only the bank link and sync code, so it may run next to 2; 2, 3 and 4 share `TransactieDetail.tsx`, `CategorieenEditors.tsx` and `lib/categories.ts`, so they run one after the other.

| Phase | Title | Size | Status |
|---|---|---|---|
| [0.5.1-1](01-sync-two-accounts.md) | Fix: a link with two accounts syncs only the last | S | hardened, cause on the live system unconfirmed |
| [0.5.1-2](02-emoji-icons.md) | Emoji as category icon | M | built, to verify |
| [0.5.1-3](03-colours.md) | 16 category colours and a custom colour | M | built, to verify |
| [0.5.1-4](04-category-picker.md) | Two-step category picker | M | built, to verify |

## Decisions (16 Nov 2026)
1. **Emoji replace the category line icons.** `categories.icon` keeps its column and API name and now holds one emoji. Migration 0009 turns the 49 old names into emoji. `Icon.tsx` keeps the icons the rest of the UI uses (nav, buttons, `home`, `phone`, `bank`, `shield`, `laptop`, `tag`).
2. **Colours without a table rebuild.** `categories.colour` has a `CHECK` list and every migration runs in a transaction with foreign keys on: rebuilding `categories` would cascade-delete rules, splits, budgets and mappings. So migration 0010 only adds a nullable `tint` column. The API field `colour` stays one string (the *effective* colour: `tint` when set, else `colour`); the Go store hides the two columns. `shortcut: two columns, widen the CHECK with a table rebuild in 1.0-3 and drop tint`.
3. **Income may use the palette too.** Income top categories default to `soft` as before but can take any colour.
4. **Dark mode in CSS only.** Palette colours get light and dark tokens; a custom hex is turned into a pastel (light) or mid-tone (dark) by CSS relative-colour clamping on root tokens, so the same dark text stays readable and no JS theme state is needed.
5. **Picker:** drill-down inline in the detail (no second `Sheet`: the detail may already be in one). A main category stays selectable by itself; the other type (income or expense) stays reachable; split parts use the same component.
6. **Not built:** a "recent categories" row and search in the picker (the drill-down was chosen); a drill-down on the Transacties filter and the import mapping (they keep their dropdown, now with emoji).

## Process for the agents
- Subagents run **unit tests only**: `cd server && go test ./internal/<pkg>/...` and, in `web`, `npx vitest run <files>` plus `npx tsc -b --noEmit`. No dev server, no browser, no commit, no push.
- After each phase the lead runs the full gate: `go test ./...` (no `-race`: no gcc here), `npm run typecheck`, `npm test`, `npm run build`, then the demo (`scripts/dev.ps1 -Fresh`, through `preview_start`) in light and dark and at 375 px, and each new migration against a database created by the 0.5.0 code.
- Version in `saldo/config.yaml` becomes `0.5.1-dev` (a bare `0.5.1` on main releases it); the changelog entry is written at the end and says the update rewrites icon values.
