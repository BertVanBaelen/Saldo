# App shell and navigation

Analysis: 12 ("Navigation") · Design: every Telefoon-* and Desktop-* board · Code: `finance-mockup/js/shell.js` · Phases: [0.1-1](../../plan/v0.1-mockup/01-foundation-and-start.md), [0.1-4](../../plan/v0.1-mockup/04-rekeningen-meer-meldingen.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.2-3](../../plan/v0.2-foundation/03-web-app-shell.md)

## Phone (< 1024 px)
- Bottom tab bar, 84 px (padding 8 8 22), `--surface`, top border. Five tabs: **Start · Transacties · Overzicht · Planning · Meer**.
- Tab: 22 px icon in a 56×30 pill, label 12. Active: pill `--soft`, colour `--greenText`, weight 600, `aria-current="page"`.
- Page header: title 26/600 left, actions right (44 px buttons). Sub pages (Meldingen, Rekeningen) show a back chevron to Meer.
- Content padding 16 20 24, gap 14.
- Beheer items live under **Meer**, with Meldingen and Weergave. Sub pages mark Meer as the current tab.

## Desktop (≥ 1024 px)
- Left sidebar 232 px, `--surface`, right border, padding 20 14 14:
  - Logo (32 px icon + "Saldo" 22/600 in `--greenText`).
  - Main nav: Start, Transacties (count badge "8"), Overzicht, Planning. Items 44 px, radius 10, 15/500; active `--soft` / `--greenText` / 600.
  - Group label "BEHEER": Rekeningen, Bankkoppelingen (warn dot, red when a sync failed), Categorieën, Importeren, Meldingen, Instellingen (Meldingen added 3 Nov 2026).
  - User at the bottom: avatar, name, role.
- Main: padding 26 32 32, gap 18. Header: title 28/600 with the date under it ("Woensdag 18 november"), scope switch and sync button on the right.

## Meer and Weergave on desktop
Meer is also a desktop page (centred column), reached from the sidebar user block, which is then marked current. The account detail page marks Rekeningen current.

## Pages without navigation
Sign-in pages (`<body data-shell="none">` in the mockup) have no sidebar or tab bar: a centred column of at most 440 px with the logo.

## Offline
The PWA caches only the app shell, never financial data in the service worker. When the connection drops, a banner sits on top of every page ("Je bent offline. Je ziet de gegevens van vandaag 08:12. Wijzigen kan weer zodra je verbinding hebt.") and saving is disabled.

## Mockup demo states
Meer has a mockup-only section "Mockup · toestand" to switch the demo state; `?demo=` and `?scope=` in the URL do the same ([demo-data](demo-data.md#demo-states)). Weergave has three values, Systeem · Licht · Donker, saved per viewer (`saldo.theme`).

## Icons (24 grid, stroke)
Start = house · Transacties = list with dots · Overzicht = bar chart · Planning = calendar · Meer = three dots · Rekeningen = card · Bankkoppelingen = link · Categorieën = tag · Importeren = upload · Instellingen = sliders · Meldingen = bell · Weergave = moon. Added for the new screens: edit, trash, arrows, split, transfer, shield, laptop, download, file, key, user-plus, external, bank, cloud-off, info, eye, filter (`js/icons.js`).
