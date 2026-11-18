# Recurring item

Analysis: 4.5 (1), 5.3, risk 12 · Data: `recurring_item` · Screens: [planning](../screens/planning.md) (tab "Terugkerend") · Phases: [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.8-1](../../plan/v0.8-planning/01-planning-data.md), [0.8-2](../../plan/v0.8-planning/02-recurring-detection.md), [0.8-7](../../plan/v0.8-planning/07-terugkerend-and-eenmalig.md)

## Rules
- Detected from history (plan [0.8-2](../../plan/v0.8-planning/02-recurring-detection.md)): rows with the same counterparty key (normalised name, digits removed) and sign, a run of regular gaps (monthly 25–35 days and at least 3 rows, quarterly 80–100 and 3, yearly 350–380 and 2), recent enough, at least 75 % of the amounts within 10 % of the median. Thresholds to be checked on real data (risk 12).
- Must be **confirmed** by the user before the forecast relies on it (risk 12). Suggestions are computed on read and never stored; Bevestigen opens the form prefilled and stores a confirmed item, Negeren stores an ignored one, so it stays ignored for the account until "Toch tonen".
- A confirmed item belongs to an **account** (every member sees it, members with Bewerken change it): description, counterparty (to recognise the payment; may be empty for an item added by hand), signed amount (fixed, or the average of its recent payments), frequency (`monthly` | `quarterly` | `yearly`), expected day (and month for quarterly and yearly), optional end date, kind (`income` | `expense` | `saving` | `transfer` | `contribution`; on a shared account `transfer` is not used and `contribution` marks a member's payment). The table's `user_id` stays unused.
- Items can also be **added and edited by hand** (decision 3 Nov 2026), for costs that are not in the history yet.
- Rows matched to an occurrence of an item (same counterparty key and sign, within 7 days) are not counted again in variable spending ([budget](budget.md)).
- An occurrence up to 7 days late is still expected (on tomorrow); after that it is no longer counted and shows as "Verwacht, niet gezien" until its payment arrives or its next date passes.
- Day 29–31 in a short month falls on its last day; weekends are not modelled; four-weekly, twice-monthly and every-other-month items are not supported.

## Demo items (the story and the seed of plan 0.8-1)
| Item | Amount | Day | Account |
|---|---|---|---|
| Salaris (Werkgever NV) | +€ 2.850 | 2nd | Zichtrekening |
| Huur (Immo Verhaeghe) | −€ 1.005 | 1st | Zichtrekening |
| Naar gedeelde rekening (transfer) | −€ 450 | 1st | Zichtrekening |
| Netflix | −€ 13,99 | 12th | Zichtrekening |
| Naar spaarrekening (saving) | −€ 200 | 16th | Zichtrekening |
| Spotify | −€ 11,99 | 17th | Zichtrekening |
| Familiale verzekering (yearly, added by hand) | −€ 684 | 15 January | Zichtrekening |
| Bijdrage Bert (contribution) | +€ 450 | 1st | Gedeelde rekening |
| Bijdrage Partner (contribution) | +€ 450 | 1st | Gedeelde rekening |
| Energie (Luminus) | −€ 145 | 3rd | Gedeelde rekening |
| Internet en tv (Proximus) | −€ 42,98 | 9th | Gedeelde rekening |

The mockup differs: Netflix on the shared account (12th), Energie on the 5th, Internet en tv € 28,99 on the 8th, and the suggestions Basic-Fit −€ 29,99, Proximus Mobile −€ 15, Farys water −€ 35 (not in the story). The app suggests, for Bert, **Decathlon** (−€ 42,90, every quarter around the 27th, 4 times seen) and **Action** (−€ 62,47, monthly around the 23rd, 12 times seen); Partner also gets Basic-Fit, De Lijn, Werkgever BV and her own "Naar gedeelde rekening". Toasts "Toegevoegd aan terugkerende posten" / "Genegeerd". Both halves of the contribution are listed, each on its own account (plan 0.8 decision 9).

Because rent and the contribution leave on the 1st and the salary arrives on the 2nd, the personal account dips below zero on the 1st.
