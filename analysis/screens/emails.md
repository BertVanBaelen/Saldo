# E-mails

Analysis: 4.9 ("Email style"), 12 (screen 13) · Design: E-mail-Berichten · Mockup: `finance-mockup/berichten.html` · Concepts: [notification](../concepts/notification.md), [buffer-and-states](../concepts/buffer-and-states.md), [authentication](../concepts/authentication.md), [account](../concepts/account.md) · Phases: [0.1-5](../../plan/v0.1-mockup/05-emails-and-push.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.2-4](../../plan/v0.2-foundation/04-sign-in-users-mail.md), [0.3-2](../../plan/v0.3-bank-sync/02-consent-reminders.md), [0.9-1](../../plan/v0.9-notifications/01-email-templates.md)

## Templates (9)
Login code · Planning red · Planning in the buffer · Link expires in 14 days · Link expires in 3 days · Sync stopped · Invitation · Member joined · New password.

## Design notes
Mockup files: `finance-mockup/emails/<name>.html` + `<name>.txt` (one per template, Go field list in the top comment), gallery `finance-mockup/berichten.html`.

**Layout (board option A "rustig")**: canvas `#EEF2EF`; white card max 520 px, 1 px `#E2E8E4`, radius 16. Top: 28 px logo (email variant: r26, white stroke 7, no clasp dot) + "Saldo" 17/600 `#166534`. Hero (padding 22×30): kicker 12/700 uppercase 0.08em in the tone text colour, title 24/600, optional account block, optional key-figure box (radius 14, tone soft background, Geist Mono 34/600 in tone text, sub 13 muted). Content (padding 18×30×26, gaps 16): text 15/1.55 `#2B3530`, details box (1 px border, radius 12, rows 14 px, label muted, value 500 right), one green button (`#15803D`, white, radius 12, 12×20), note 13 muted. Footer `#FAFBFA`, 12/1.55 `#6B766F`: why-line, " Meldingen aanpassen" link (`#166534`, underlined) except on code/invitation/password, then "Saldo draait op je eigen Home Assistant."
**Account block**: rows radius 12, 30 px circle green (person icon) or violet `#5B3FD9` (two-person icon), name 15/600, sub 12 muted "Persoonlijk · BE68 •••• •••• 4821" / "Gedeeld met Partner · BE12 •••• •••• 7730".
**Tones** (label + key figure): info `#DCFCE7`/`#166534`, warn `#FFF4DB`/`#8A5A00`, error `#FBE9E9`/`#B42323`, shared `#ECE8FF`/`#4A31C2`. Dark mode (mockup, not on the board): token dark values (card `#161D1A`, text `#E7EEEA`, button `#4ADE80` on `#0E1311`, soft/text pairs as in Meldingen-Android dark).
**Inbox line**: sender "Saldo <saldo@jouw-domein.be>", subject, preheader.

| # | File | Subject | Label / tone | Key figure | Accounts | Details rows | Button | Footer why |
|---|---|---|---|---|---|---|---|---|
| 1 | inlogcode | Je inlogcode: 4829 1736 | Inloggen / info | "4829 1736" · "Geldig tot 14:22 · werkt één keer" | – | Aangevraagd, Toestel | – | "…omdat iemand met jouw wachtwoord wil inloggen." (no mute) |
| 2 | planning-rood | Zichtrekening staat rood in februari | Planning · rood / error | "−€ 1.033,47" · "Verwacht saldo op 28 februari" | Zichtrekening | Grootste uitgave, Rood vanaf, Buffer | Bekijk de planning | "…omdat "Rekening staat rood" aanstaat." |
| 3 | planning-buffer | Zichtrekening zakt in januari in de buffer | Planning · buffer / warn | "€ 721,50" · "€ 178,50 onder je buffer van € 900,00" | Zichtrekening | Jaarlijkse kost, Laagste punt | Bekijk januari | "…aanstaat voor e-mail." |
| 4 | koppeling-14-dagen | Je Argenta-koppeling verloopt over 14 dagen (2 rekeningen) | Bankkoppeling / warn | "30 november" · "Laatste dag dat Saldo je rekeningen kan lezen" | both | Gekoppeld door, Sinds | Opnieuw koppelen | "…omdat jij deze koppeling hebt gemaakt." |
| 5 | koppeling-3-dagen | Laatste herinnering: Argenta verloopt over 3 dagen (2 rekeningen) | Laatste herinnering / error | "3 dagen" · "Verloopt op 30 november" | both | none | Nu opnieuw koppelen | same |
| 6 | sync-gestopt | Zichtrekening en Gedeelde rekening worden niet meer bijgewerkt | Synchronisatie gestopt / error | "30 nov · 04:02" · "Laatste geslaagde synchronisatie" | both | Bank, Status | Opnieuw koppelen | same |
| 7 | uitnodiging | Bert nodigt je uit voor Saldo | Uitnodiging / info | – | – | Uitgenodigd als, E-mail | Account aanmaken | "…omdat Bert je heeft uitgenodigd." (no mute) |
| 8 | lid-aangesloten | Partner is erbij op de Gedeelde rekening | Gedeelde rekening / shared | – | Gedeelde rekening | Rol, Sinds | Bekijk leden | "…omdat je beheerder bent van deze rekening." |
| 9 | nieuw-wachtwoord | Stel een nieuw wachtwoord in | Wachtwoord / info | – | – | Aangemaakt door, Geldig tot | Nieuw wachtwoord kiezen | "…omdat een beheerder dit voor je heeft aangevraagd." (no mute) |

**Email-client rules used** (for 0.8-1): table layout, every style inline, hidden preheader, web-safe stack after Geist, `€` + no-break space, account icons and logo as images (PNG in production: Gmail/Outlook drop SVG). A small `<style>` block only adds dark mode and 20 px side padding under 480 px; the mail is complete without it. Plain-text part: same copy, rows as "Label: waarde", button as "Tekst:" + URL, footer after "-- ".
