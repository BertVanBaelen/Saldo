# Saldo mockup (version 0.1)

A clickable, responsive mockup of the *Saldo – ontwerp* design canvas, with the demo data from `analysis.md` section 12. Plain HTML, CSS and JavaScript, no build step. Phone layout below 1024 px (bottom tabs), desktop layout from 1024 px (sidebar). Light and dark follow the system; "Weergave" under Meer overrides it.

## Run
```bash
pwsh -NoProfile -File finance-mockup/serve.ps1
```
Then open http://localhost:5173/. (Opening the files straight from disk also works in most browsers.)

## Structure
| Path | Holds |
|---|---|
| `css/tokens.css` | Colour tokens (light and dark), fonts, radii, keyframes, reduced motion |
| `css/components.css` | Shell (sidebar, tab bar) and shared components |
| `css/screens/<screen>.css` | Styles used by one screen only |
| `js/format.js` | `eur`, `eur0`, Dutch dates, `esc` |
| `js/icons.js` | Inline stroke icons and the app logo |
| `js/data.js` | Shared demo data (accounts, groups, forecast, spending) |
| `js/shell.js` | Builds the shell, scope switch, theme, toast, sync progress |
| `js/screens/<screen>.js` | One screen: `Saldo.screens.<id> = { title, render(page, state) }` |
| `emails/` | The nine email templates (HTML + plain text) |
| `berichten.html` | Gallery of emails and push notifications |

Each page sets `<body data-screen="…">`; the shell renders the navigation and calls the screen's `render` again when the scope (Alles · Persoonlijk · Gedeeld) changes.

## Knowledge base
Every screen and concept is described in [`../analysis/`](../analysis/README.md); the plan is in [`../plan/`](../plan/README.md). The tokens and components here are the source for the React web app in phase 0.2-5.
