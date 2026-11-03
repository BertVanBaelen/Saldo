# Meldingen (notification settings)

Analysis: 12 (screen 11), 4.9 · Design: Telefoon-Meldingen (desktop derived) · Mockup: `finance-mockup/meldingen.html` · Concepts: [notification](../concepts/notification.md) · Phases: [0.1-4](../../plan/v0.1-mockup/04-rekeningen-meer-meldingen.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.9-4](../../plan/v0.9-notifications/04-meldingen-screen.md)

## Layout (phone, < 1024 px)
- Back chevron (22, stroke 2.4) to Meer, title "Meldingen" 26/600. Page gap 14.
- Channel card (padding 4 16): "Pushmeldingen" ("Op dit toestel · Saldo op je startscherm") and "E-mail" (`bert@jouw-domein.be`). Rows min-height 64, name 15/500, sub 13 muted, a `role="switch"` 52×32 on the right. Both on by default.
- Groups PLANNING, BANK, GEDEELD, TRANSACTIES: label 13/600 uppercase with the hint "Push · E-mail" (12 muted) on the right. List card padding 0 16. Each row (min-height 64, padding 8 0): a 10 px state dot, name 15/500, subline 12/1.35 muted, and two 44×36 toggle chips (radius 10, 1.5 px border) with a phone icon and a mail icon, `aria-pressed`, aria-label "<type> als pushmelding" / "<type> per e-mail". On: `--soft` fill, `--green` border, `--greenText` icon. Off: transparent, `--line` border, `--muted` icon.
- When a channel is off, its chips are `disabled` at 40 % opacity and show off. The stored choice comes back when the channel is turned on again.
- Types, sublines and defaults (push / e-mail):
  - Rekening staat rood: "Als een rekening in de planning onder € 0 zakt", dot `--neg`, on / on.
  - Rekening komt in de buffer: "Als een rekening onder haar eigen buffer zakt", `--warn`, on / off.
  - Koppeling verloopt: "14 en 3 dagen vooraf", `--warn`, on / on.
  - Synchronisatie gestopt: "Als Saldo een rekening niet meer kan lezen", `--neg`, on / on.
  - Iemand sluit aan: "Bij een gedeelde rekening waar jij beheerder bent", `--shared`, on / on.
  - Bijdrage ontbreekt: "Als een bijdrage op de 3e nog niet binnen is", `--shared`, off / off.
  - Te categoriseren: "Eén keer per dag om 19:00, als er iets is", `--green`, on / off.
- The Planning card ends with "Hoe ver vooruit kijken" (14/500): segmented control on `--bg` (padding 3, radius 12, buttons 36 px, 13/600, selected `--green` / `--onGreen`) with 1 maand · 3 maanden · 6 maanden (default 3), and the note "Je krijgt één melding per maand en per rekening, op de ochtend nadat de planning verandert." (12 muted).
- Card "Stille uren" ("Geen pushmeldingen van 22:00 tot 07:00") with a switch, on by default.
- Note (surface, 1 px line, radius 14, 13 muted): "Inlogcodes, uitnodigingen en wachtwoordlinks komen altijd per e-mail. Die kan je niet uitzetten."
- Dashed button "Stuur een testmelding" (48 px, `--greenText`) shows the toast "Testmelding verstuurd naar dit toestel", or "Pushmeldingen staan uit" when push is off.

## Desktop (≥ 1024 px, derived)
Not designed. Title 28/600 with the sub "Push en e-mail, per soort" (the subline from Meer), no back chevron. Page max 1040 px. Two-column grid: a left column of 340 px with the channel card, Stille uren, the always-by-email note and the test button; the four type groups on the right (`1fr`, gap 16). The DOM order matches the phone (grid areas), so reading order stays channels → types → quiet hours.

## Mockup notes
All choices are saved per viewer in `localStorage` (`saldo.meldingen`). The sidebar has no Meldingen item; the user block is marked current instead.
