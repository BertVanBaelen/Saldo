# Recurring item

Analysis: 4.5 (1), 5.3, risk 12 · Data: `recurring_item` · Screens: [planning](../screens/planning.md) (tab "Terugkerend") · Phases: [0.1-3](../../plan/v0.1-mockup/03-planning.md), [0.7-1](../../plan/v0.7-planning/01-recurring-items.md)

## Rules
- Detected from history: same counterparty, similar amount (within ~10%), regular interval (monthly, quarterly, yearly), at least 3 occurrences (2 for yearly **[verify with real data]**).
- Must be **confirmed** by the user before the forecast relies on it. Unconfirmed items are clearly marked (risk 12).
- A confirmed item has: expected day, amount (fixed or average), frequency, optional end date, kind (`income` | `expense` | `transfer` | `saving`), owner (account or user).
- Amounts covered by a recurring item are not counted again in variable spending ([budget](budget.md)).

## Demo items
| Item | Amount | Day | Account |
|---|---|---|---|
| Salaris (Werkgever nv) | +€ 2.850 | 2nd | Zichtrekening |
| Huur | −€ 1.005 | 1st | Zichtrekening |
| Bijdrage gedeelde rekening | −€ 450 (each partner) | 1st | Zichtrekening → Gedeelde rekening |
| Familieverzekering (yearly) | −€ 684 | January | Zichtrekening |

| Spotify | −€ 11,99 | 17th | Zichtrekening |
| Naar spaarrekening (saving) | −€ 200 | 16th | Zichtrekening |
| Energie | −€ 145 | 5th | Gedeelde rekening |
| Internet en tv | −€ 28,99 | 8th | Gedeelde rekening |
| Netflix | −€ 13,99 | 12th | Gedeelde rekening |
| Bijdrage Partner | +€ 450 | 1st | Gedeelde rekening |

Suggestions to confirm ("Maandelijks · rond de 3e · 4 keer gezien"): Basic-Fit −€ 29,99, Proximus Mobile −€ 15, Farys water −€ 35. Toasts "Toegevoegd aan terugkerende posten" / "Genegeerd". In Alles the two halves of the contribution are hidden as an internal transfer.

Because rent and the contribution leave on the 1st and the salary arrives on the 2nd, the personal account dips below zero on the 1st.
