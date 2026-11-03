# Pushmeldingen

Analysis: 4.9, 12 (screen 14), risk 14 · Design: Meldingen-Android, Meldingen-Icoon · Mockup: `finance-mockup/berichten.html` · Concepts: [notification](../concepts/notification.md), [buffer-and-states](../concepts/buffer-and-states.md), [design-system](../concepts/design-system.md#app-icon-beurs) · Phases: [0.1-5](../../plan/v0.1-mockup/05-emails-and-push.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.1-8](../../plan/v0.1-mockup/08-review-and-freeze.md), [0.9-2](../../plan/v0.9-notifications/02-web-push.md), [0.9-5](../../plan/v0.9-notifications/05-lock-screen-check.md)

## Content
Lock screen without amounts, notification shade in light and dark, the expanded red planning notification with a small chart, and the status-bar icon (24×24 dp silhouette, 2 dp margin, circle colour per type).

## Design notes
Mockup: `finance-mockup/berichten.html` (sections "Pushmeldingen", "Meldingsicoon", "App-icoon"); icon files `finance-mockup/img/statusbar-icon.svg`, `app-icon.svg`, `app-icon-round.svg`.

**Notification anatomy** (shade card radius 24, padding 12): 36 px circle in the channel colour with the white status-bar silhouette; head line "Saldo · {time}", amount pill right (Geist Mono 12/600, radius 999, soft background + text colour of the type), expand chevron (32×28, radius 14); title 14/600; one line 13 muted, cut to one line with ellipsis until expanded. Amounts are rounded to whole euros (`−€ 1.033`).

| Type | Title | Line | Amount | Circle | Pill light / dark |
|---|---|---|---|---|---|
| rood | Persoonlijk staat rood in februari | Verwacht −€ 1.033 op 28 februari. De autoherstelling van 10 februari duwt je onder nul. | −€ 1.033 | `#C62828` | `#FBE9E9`/`#B42323` · `#3A1A1C`/`#FF7B7B` |
| buffer | Zichtrekening zakt in januari in de buffer | Verwacht € 722. Dat is € 179 onder je buffer van € 900. | € 722 | `#A15C07` | `#FFF4DB`/`#8A5A00` · `#2E2414`/`#F5B94A` |
| consent | Argenta verloopt over 14 dagen | Koppel opnieuw om je zichtrekening en de gedeelde rekening te blijven synchroniseren. | 14 dagen | `#A15C07` | as buffer |
| cat | 8 transacties te categoriseren | Colruyt, Delhaize, NMBS en 5 andere. | 8 | `#15803D` | `#DCFCE7`/`#166534` · `#13321F`/`#86EFAC` |

**Expanded red notification**: text unclamped plus a chart box (radius 14, chip background): 240×76 bars for nov, dec, jan, feb (€ 1.265, € 1.160, € 722, −€ 1.033) on a −€ 1.200…€ 1.400 scale, buffer zone and dashed buffer line at € 900, red zone below the zero line, "feb" label bold red. Open by default in both shade frames; the chevron toggles each card, "Opnieuw tonen" resets.
**Actions** defined on the board but not shown (`showActions: false`): rood "Bekijk planning" / "Later", buffer "Bekijk januari" / "Later", consent "Opnieuw koppelen" / "Morgen", cat "Categoriseren".
**Lock screen rule**: no amounts, no account names. Generic titles "Planning: actie nodig" (red) and "Bankkoppeling verloopt binnenkort" (ochre), line "Ontgrendel om de details te zien"; same coloured circle.
**Shade themes** (Android's own, not the app tokens): light shade `#E6ECE8`, card `#FFFFFF`, chip `#EEF2EF`; dark shade `#0B0F0D`, card `#1C221F`, chip `#2A322E`. Bars `#15803D`/`#C62828` light, `#4ADE80`/`#FF6B6B` dark.
**Status-bar icon** (Meldingen-Icoon): silhouette of coin + wallet with clasp hole on a 24 dp grid, 2 dp margin, one colour, 1.5 dp gap between coin and wallet so they stay apart at 16 px; deliver as vector drawable. Circle colour per type: green info, ochre warning, red error.
