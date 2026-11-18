# Third-party UI code

The Planning screens (0.8-5, 0.8-6, 0.8-7) use a few controls that were copied into `web/src/ui/` and restyled with Saldo's tokens. The plan and the user's decision are in [plan/v0.8-planning/05a-ui-libraries.md](../plan/v0.8-planning/05a-ui-libraries.md). Existing screens do not use them.

## What was checked (18 Nov 2026)

| Library | How it installs | Free or paid | Licence |
|---|---|---|---|
| [Untitled UI React](https://github.com/untitleduico/react) | CLI `npx untitledui@latest init` / `add <component>`, or manual copy from the GitHub repository. Needs `react-aria-components`, `tailwindcss` 4.3, `tailwind-merge`, `tailwindcss-animate`, `tailwindcss-react-aria-components` and `@untitledui/icons` | The README says the MIT licence covers only what is in the open-source repository; Untitled UI React PRO is separate, under its own licence. Rule here: **only code from the public repository is copied**, nothing from the PRO tier or the website's PRO pages | MIT, Copyright (c) 2025 Untitled UI |
| [Kokonut UI](https://github.com/kokonut-labs/kokonutui) | shadcn/ui registry (`components.json` with `"@kokonutui": "https://kokonutui.com/r/{name}.json"`, no token), needs Tailwind v4, `motion`, `lucide-react` and the `cn` helper | Not checked whether a paid tier exists; the only file used (for an idea, no code) is in the public MIT repository | MIT, Copyright (c) 2025 kokonutUI (each file also says `@license: MIT`) |
| [React Aria Components](https://react-spectrum.adobe.com/react-aria/) 1.22 (Adobe) | npm | free | Apache-2.0 |

**Route taken.** No CLI and no `components.json`: both CLIs write unprefixed classes and their own colour palette into fixed folders, and every class had to be rewritten for Saldo's tokens and the `tw:` prefix anyway. The controls were copied by hand from the GitHub sources, reduced to what Saldo needs and restyled. Not installed: `tailwind-merge`/`clsx` (a 1-line `cx` in `web/src/ui/cx.ts`), `tailwindcss-animate`, `tailwindcss-react-aria-components` (Tailwind v4 has `data-*` variants), `@untitledui/icons` and `lucide-react` (inline SVG chevrons), `motion` (the one motion touch is a CSS transition).

**Kokonut.** Its tab component (`smooth-tab.tsx`) is 642 lines of swipe tabs on `motion`; only its idea, one indicator that slides to the selected tab, is used, as a CSS `transform` transition in `Tabs.tsx`. No number transition was added (optional in the plan): the candidates (`dynamic-text.tsx`, 1013 lines, rolls digits among other text effects; `split-flap-text.tsx`; `metric-card.tsx`) are large decorative effects and were not adopted; a later step can revisit this.

## Packages

| Package | Version | Where | Why |
|---|---|---|---|
| `react-aria-components` | 1.22.1 | dependency | the behaviour and accessibility of the controls (Apache-2.0) |
| `@internationalized/date` | 3.12.4 | dependency | ISO date ↔ calendar date for the date picker (Apache-2.0; already a dependency of the above) |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.5 | dev | builds the `tw:` utilities (MIT) |
| `@react-aria/optimize-locales-plugin` | 2.1.0 | dev | drops React Aria's strings for other languages from the bundle (keeps nl-NL and en-US; Apache-2.0) |

## How the styling is scoped

`web/src/ui/ui.css` imports only Tailwind's theme and utilities (no preflight, so no global reset) with the prefix `tw` (`tw:flex`), so no utility can match a class of the existing CSS. The utilities are not in a cascade layer: the existing CSS is unlayered, and an unlayered rule like `button { color: inherit }` would otherwise beat every layered utility. The colours, fonts, radii and the shadow are Saldo's tokens through `@theme inline`, so the light/dark switch of `tokens.css` works without a second switch; the default Tailwind palette is cleared. `ui.css` is imported by `web/src/ui/index.ts` only, so it ships with the screens that use the controls. `web/src/ui/ui.test.tsx` checks the compiled CSS. Reduced motion: the global rule in `tokens.css` already turns transitions off, and the classes add `motion-reduce:transition-none`.

## Vendored components

| File | Source | Licence | Copied | Changed |
|---|---|---|---|---|
| `web/src/ui/Tabs.tsx` | Untitled UI `components/application/tabs/tabs.tsx`; indicator idea from Kokonut `components/kokonutui/smooth-tab.tsx` | MIT (both) | 18 Nov 2026 | one style (underline), sliding green indicator, 44 px tabs, automatic keyboard activation |
| `web/src/ui/Input.tsx` (`Input`, `AmountInput`) | Untitled UI `components/base/input/input.tsx`, `label.tsx`, `hint-text.tsx` | MIT | 18 Nov 2026 | label, hint, error; the amount field is a string field with `€`, mono font, `inputMode="decimal"` |
| `web/src/ui/Select.tsx` | Untitled UI `components/base/select/select-native.tsx` | MIT | 18 Nov 2026 | native select, 44 px, inline chevron |
| `web/src/ui/Switch.tsx` | Untitled UI `components/base/toggle/toggle.tsx` | MIT | 18 Nov 2026 | one size, 44 px row |
| `web/src/ui/SegmentedControl.tsx` | Untitled UI `components/base/button-group/button-group.tsx` | MIT | 18 Nov 2026 | Saldo's segmented pill, single choice that cannot be emptied |
| `web/src/ui/DatePicker.tsx` (`DatePicker`, `Calendar`) | Untitled UI `components/application/date-picker/date-picker.tsx`, `calendar.tsx`, `cell.tsx` | MIT | 18 Nov 2026 | ISO strings in and out, nl-BE (Monday first), closes on select, 44 px days, today in Europe/Brussels |
| `web/src/ui/Badge.tsx` | Untitled UI `components/base/badges/badges.tsx` | MIT | 18 Nov 2026 | five tones on Saldo's tokens |

## Licence texts

### Untitled UI React

```
MIT License

Copyright (c) 2025 Untitled UI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Kokonut UI

```
MIT License

Copyright (c) 2025 kokonutUI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
