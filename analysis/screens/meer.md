# Meer

Analysis: 12 (screen 12) · Design: Telefoon-Meer (desktop derived) · Mockup: `finance-mockup/meer.html` · Concepts: [app-shell](../concepts/app-shell.md), [user-and-visibility](../concepts/user-and-visibility.md), [bank-connection](../concepts/bank-connection.md) · Phases: [0.1-4](../../plan/v0.1-mockup/04-rekeningen-meer-meldingen.md), [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.4-4](../../plan/v0.4-categorisation/04-categories-and-rules-screen.md)

## Layout (phone, < 1024 px)
- Title "Meer" 26/600 (no back chevron), page gap 16.
- Profile card (link, radius 20, padding 14 16): 48 px avatar "B" on `--c2` (18/600), "Bert" 17/600, "Profiel, wachtwoord, taal" 13 muted, chip "Beheerder" (12/600, `--soft` / `--greenText`, padding 3 9).
- Section **GELD** (label 13/600 uppercase, margin 0 4), list card padding 0 16:
  - Rekeningen: "4 rekeningen · buffer en kleur", card icon on `--soft` / `--greenText` → `rekeningen.html`.
  - Bankkoppelingen: "Argenta · toestemming nog 12 dagen" in `--warn` 500, link icon on `--c1`.
  - Categorieën en regels: "3 suggesties om te bevestigen", tag on `--c3`.
  - Importeren: "CSV-bestand, bv. de export uit Bilance", upload on `--c4`.
- Section **APP**:
  - Instellingen: "Enable Banking, gebruikers, taal", sliders on `--c6` with `--text` ink (other tiles use `--onPastel`).
  - Meldingen: "Push en e-mail, per soort", bell on `--c5` → `meldingen.html`.
  - Weergave: moon on `--c2`, subline shows the current choice.
- Button "Afmelden": 48 px, radius 14, surface, 1 px line, `--neg` 15/600 (`.btn--danger`).
- Rows: min-height 56, 34 px icon tile radius 10 (18 px icon), title 15/500, subline 13 muted, 18 px muted chevron, dividers between rows.
- Counts come from the demo data (accounts, consent days, suggestions).

## Weergave (mockup)
The board only shows the row ("Volgt het systeem"). Mockup: the row is a disclosure button (`aria-expanded`, chevron turns 90°) that opens a segmented control **Systeem · Licht · Donker** (same look as Meldingen's look-ahead: `--bg` track, selected `--green` / `--onGreen`). Picking calls `Saldo.shell.setTheme('system' | 'light' | 'dark')`, saved per viewer, and the subline becomes "Volgt het systeem", "Licht" or "Donker".

## Desktop (≥ 1024 px, derived)
Not designed. Reached from the sidebar user block. Same content in a centred column, max 640 px, page gap 18, title 28/600. The Beheer items stay in the sidebar too.

## Mockup notes
- Profile, Bankkoppelingen, Categorieën, Importeren and Instellingen link to `#` until their screens exist (0.1-6). On the board, Instellingen links to Meldingen, which looks like a board slip.
- Afmelden shows the toast "Afmelden werkt nog niet in de mockup" until sign-in is designed.
