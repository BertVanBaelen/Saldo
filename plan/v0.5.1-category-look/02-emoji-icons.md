# 0.5.1-2 · Emoji as category icon

| | |
|---|---|
| Version | [0.5.1](README.md) |
| Size | M |
| Builds on | CAT-6 ([0.4-1](../v0.4-categorisation/01-category-tree.md#added-after-04-testing-11-nov-2026-category-icons-cat-6)) |

## Goal
A category's icon is one emoji chosen by the user, from a built-in grid with Dutch search or typed/pasted (the phone's emoji keyboard).

## Contract (API, docs/api.md "Categories")
`icon` stays a string or `null` on every category and in the create/change bodies, and now holds **one emoji** (for example `"🏠"`, `"👨‍👩‍👧"`, `"🇧🇪"`, `"1️⃣"`). `null` or `""` clears it; leaving it out of a change keeps it; the web draws `🏷️` for `null`.

Server validation (`categorise.ValidIcon`, replaces the name list): trimmed; 1 to 64 bytes (raised from 32 in 0.5.1-3: a skin-toned ZWJ family is 41 bytes); valid UTF-8; no ASCII letter, space or control character; ASCII digits, `#` and `*` only when followed by U+FE0F or U+20E3 (keycaps); at least one rune of U+00A9 or higher. Anything else answers `400` with the existing invalid-icon message.

`shortcut: the server does not count graphemes (no Go dependency), the web enforces one grapheme with Intl.Segmenter; fine while only the web writes icons.`

## Server steps (`server/internal/...`)
1. Migration `db/migrations/0009_category_emoji.sql`: set `icon` from the old name for the 49 names below, then `UPDATE categories SET icon = NULL` for any other value that is plain ASCII (so nothing invalid is left). No schema change.
   `home 🏠, cart 🛒, car 🚗, fuel ⛽, bus 🚌, train 🚆, bike 🚲, plane ✈️, bolt ⚡, water 💧, flame 🔥, wifi 📶, phone 📱, tv 📺, health 🏥, pill 💊, sport 🏋️, food 🍽️, coffee ☕, beer 🍺, gift 🎁, school 🎓, book 📚, kids 🧒, paw 🐾, bag 👜, shirt 👕, scissors ✂️, wrench 🔧, repeat 🔁, wallet 👛, salary 💼, refund ↩️, piggy 🐷, bank 🏦, receipt 🧾, shield 🛡️, heart ❤️, music 🎵, film 🎬, gamepad 🎮, camera 📷, laptop 💻, tree 🌳, ticket 🎟️, hotel 🏨, tax 🏛️, tag 🏷️, dots 📦`
2. `categorise.Defaults` (and the demo seed, which uses it) carry the emoji of that table for each default category instead of the names. The 0009 data and the defaults must agree (test it: seed a 0.5.0-style database, migrate, compare with `Defaults`).
3. Delete `CategoryIcons`, the name list in `categorise/icons.go`, and `TestCategoryIconsMatchTheWeb`; rewrite `ValidIcon` and its tests (accepted: single emoji, ZWJ family, flag, keycap, with and without U+FE0F; refused: `"home"`, `"a"`, an inner space, 33+ bytes, control characters, a lone digit; empty means clear).
4. `ledger/categories.go` `iconOf` and the import mapping (`ledger/importcategories.go`, new categories carry an `icon`) use the new `ValidIcon`; update `server/internal/server/categories_test.go` and `importmapping_test.go` fixtures that send old names.
5. `docs/api.md`: the "Categories" section and the import-mapping section say `icon` is an emoji.
6. Migration test: build a database with the 0.5.0 schema (migrations up to 0008) holding seeded default categories with old names, one renamed category with a name icon, and rules/splits/mappings pointing at categories; apply 0009; assert emoji set, the odd value `NULL`, and unchanged row counts of rules, splits, mappings and transactions.

## Web steps (`web/src/...`)
1. New `lib/emoji.ts`: `DEFAULT_EMOJI = '🏷️'`; `categoryEmoji(icon)` (stored value or the default); `oneEmoji(text)` (trim; exactly one grapheme via `Intl.Segmenter`, containing an emoji/symbol, else `null`); a curated list of about 200 emoji in groups (Geld en rekeningen, Wonen, Eten en drinken, Boodschappen, Vervoer, Vrije tijd en reizen, Gezondheid en sport, Kinderen en dieren, Werk en school, Diversen), each with Dutch search words.
2. New `components/EmojiPicker.tsx` replacing `IconPicker.tsx`/`IconPicker.css`: a search field ("Zoek een emoji", matches Dutch words), the grouped grid as a radiogroup (roving tabindex, arrows move, as `IconPicker` did), and an "Eigen emoji" text field that accepts one emoji via `oneEmoji` (shows "Kies één emoji" otherwise). Props: `value`, `colour`, `labelledBy`, `onChange(emoji)`.
3. New small `components/CatIcon.tsx`: the emoji in a round tile tinted by the category colour (`catColours`), a small size (list rows) and a large one; emoji font stack in CSS (`"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`), `aria-hidden`.
4. Replace every use of `categoryIcon`, `CATEGORY_ICONS`, `CATEGORY_ICON_LABELS` and `IconPicker` in `pages/Categorieen.tsx`, `CategorieenBackfill.tsx`, `CategorieenEditors.tsx`, `ImporterenCategories.tsx`, `ImporterenControle.tsx`, `TransactieDetail.tsx`, `Transacties.tsx` (find them with grep; include the CSS of `tx-opt-ico` and `tx-part-dot`), and delete `lib/categoryIcons.ts`.
5. `components/Icon.tsx`: delete the category-only paths; keep every icon still used by the UI (grep `name="..."` and `icon:` values across `web/src`; the typecheck must pass). Update the header comment ("No emoji" is no longer true for categories).
6. Tests: `lib/emoji.test.ts` (`oneEmoji` accepts `👨‍👩‍👧`, `🇧🇪`, `1️⃣`, `🏷️`; rejects `ab`, `😀😀`, empty; every curated emoji is one grapheme; no duplicates), `components/EmojiPicker.test.tsx` (pick from the grid, search "huis", type an own emoji, invalid input shows the hint, arrow keys), and the updated tests of the pages above.

## Done when
No line-icon name is stored or drawn for a category anywhere; an existing database keeps its category look through 0009. Server: `cd server && go test ./...` passes. Web: `cd web && npx tsc -b --noEmit && npx vitest run` passes.
