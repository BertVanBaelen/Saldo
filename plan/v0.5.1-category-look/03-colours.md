# 0.5.1-3 · 16 category colours and a custom colour

| | |
|---|---|
| Version | [0.5.1](README.md) |
| Size | M |
| Builds on | [0.5.1-2](02-emoji-icons.md) |

## Goal
Choose a category colour from 16 pastels or pick any colour of your own, in light and dark mode, readable everywhere a category colour is drawn.

## Contract (API)
`colour` stays one string. Accepted and returned: `c1`…`c16` (the six existing plus ten new), `soft` (income default), or a custom `#rrggbb` (the server lowercases it; `#fff`, `red`, 8-digit hex and anything else answer `400`). Income top categories may now take any of them (default `soft`); subcategories keep their parent's colour (recolouring a top category recolours its subcategories).

Storage (decision 2 of the [README](README.md)): migration `0010_category_tint.sql` is `ALTER TABLE categories ADD COLUMN tint TEXT`, nothing else. Writing a legacy key (`c1`…`c6`, `soft`) sets `colour` and clears `tint`; writing `c7`…`c16` or a hex sets `colour = 'c6'` and `tint = <value>`; every read returns `COALESCE(tint, colour)`. Comment the shortcut in code: `shortcut: two columns because the CHECK on colour cannot be widened without a table rebuild (foreign keys would cascade-delete rules and splits), rebuild in 1.0-3 and drop tint.`

## Server steps
1. Migration 0010 and its test (database made by the 0.5.0 code: existing categories keep their colour, `tint` is NULL, counts of dependent tables unchanged).
2. `ledger/categories.go`: `topColour` validation (legacy keys, `c7`…`c16`, hex; income may use all). Every colour write goes through **one helper** that sets `colour` and `tint` together: create (top and sub), change, the cascade to subcategories (`UPDATE categories SET type = ?, colour = ? WHERE parent_id = ?` near line 358 must also set `tint`), a move under a parent (adopts the parent's *effective* colour), and a type change (resets to the default colour of the new type and clears `tint`). Reads use one shared SQL expression for the effective colour. A missed read site shows up silently as grey (tinted rows store `colour = 'c6'`), so these are ALL the sites, switch each and find any more with `grep -rn -i "colour" server/internal --include=*.go` (multi-line SQL included): `ledger/categories.go` (list around line 69 and the single-row read around line 152), `ledger/backfill.go` (line ~85), `ledger/duplicates.go` (its categories query, `Colour` field line ~44), `ledger/imports.go` (line ~328), `ledger/transactions.go` (categories join ~181 and the split rows ~227), `ledger/importcategories.go`.
   Also (phase 2 follow-up): raise `categorise.ValidIcon`'s byte limit from 32 to 64, because a skin-toned ZWJ family (for example 👨🏽‍👩🏽‍👧🏽‍👦🏽, 41 bytes) is one emoji that the web accepts; update its test (accepts that family, refuses 65 bytes), the plan text in `02-emoji-icons.md` and `docs/api.md`.
3. Demo seed unchanged (defaults keep `c1`…`c6` and `soft`).
4. Tests: validation matrix; income with a palette colour and with hex; recolour cascade to subcategories; list and transaction payloads show the effective colour; moving under a parent adopts the parent's effective colour; `docs/api.md` updated.

## Web steps
1. `web/src/styles/tokens.css`: add `--c7`…`--c16` with distinct hues not yet covered (existing: light blue, apricot, pink, lavender, yellow, grey; add for example mint, lime, turquoise, coral, peach, lilac, rose, sand, olive, denim), defined in **all three** blocks (light `:root`, `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, `:root[data-theme="dark"]`). Add root tokens for custom colours, per theme and **unitless** (measured in Chrome 156 on 16 Nov 2026): light `--tint-l-min: 0.84; --tint-l-max: 0.93; --tint-c-max: 0.12;` dark `--tint-l-min: 0.68; --tint-l-max: 0.80; --tint-c-max: 0.13;` (the dark values go in both dark blocks).
2. `lib/categories.ts` `catColours(colour)`: palette keys give `var(--cN)` with `--onPastel` text (c6 keeps `--onC6`, `soft` keeps `--greenText`). A hex (validated again with `/^#[0-9a-f]{6}$/`, else the c6 look) gives `bg: oklch(from #hex clamp(var(--tint-l-min), l, var(--tint-l-max)) min(c, var(--tint-c-max)) h)` with `--onPastel` text, so any custom colour becomes a pastel in light mode and a mid-tone in dark mode with the same readable text. **Do not use HSL or percentages**: `hsl(from … clamp(70%, l, 88%))` and `oklch(from … clamp(72%, …))` are NOT supported (checked with `CSS.supports`); `l` and `c` are unitless numbers. Measured with these tokens over `#0000ff #000000 #ffffff #ff0000 #00ff00 #ffff00 #8800ff #00ffff #ff00ff #808080`: worst text contrast about 10 in light and 6 in dark. Relative colour syntax needs Chrome 119, Safari 16.4 or Firefox 128; say so in the doc comment above `catColours`. jsdom cannot evaluate this, so the lead checks the rendering in a real browser; unit tests cover the string `catColours` returns and the token values only. Update `CategoryColour` in `lib/types.ts` (palette union plus `` `#${string}` ``). Replace the remaining direct colour logic (the `softChip` border in `TransactieDetail`, the `Importeren.tsx` tile, `ImporterenCategories`, the `Look` in `CategorieenEditors`) by `catColours`.
3. Category editor (`CategorieenEditors.tsx`): the PASTELS list becomes 16 swatches with Dutch names plus an "Eigen kleur" swatch holding a native `<input type="color">` (labelled, keyboard reachable); the preview shows the resulting tile. Remove the "income is always soft" lock: income tops use the same control with `soft` as default.
4. Tests: `lib/categories.test.ts` (palette key, hex, invalid hex falls back); a tokens test that parses `tokens.css`: every `--c1`…`--c16` exists in all three blocks with WCAG contrast of at least 4.5 against `--onPastel` (`--onC6` for c6) in its own block, clamp tokens present; editor test (pick a palette swatch, pick a custom hex, an income top can be recoloured).

## Done when
Any colour of the palette or a custom hex can be set and shows in Categorieën, Transacties, the detail and the import mapping, in both themes. Server `cd server && go test ./...`; web `cd web && npx tsc -b --noEmit && npx vitest run`.
