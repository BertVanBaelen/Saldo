# 0.1-7 · Review and freeze

| | |
|---|---|
| Version | [0.1 Mockup](README.md) |
| Status | planned |
| Features | UI-5 |
| Concepts | [account-group](../../analysis/concepts/account-group.md), [demo-data](../../analysis/concepts/demo-data.md), [design-system](../../analysis/concepts/design-system.md) |
| Screens | all |
| Depends on | 0.1-6 |

## Goal
Agree on the design with Partner and settle the open questions before code is written.

## Steps
1. Walk through the mockup with Partner on a phone and a desktop.
2. Decide the open questions:
   - Combined totals and buffer in Alles (Overzicht, Planning Maanden) vs "groups are never added together".
   - Consent expiry 12 or 14 days in the demo story; 8 vs 4 uncategorised demo rows.
3. Record the decisions in `analysis.md` (decision log) and the concept files.
4. Promote the screen-local styles that turned out shared into `tokens.css` / `components.css`: skeleton colours and shimmer, account colours, chart colours, small segmented control, sub-page header, compact account label, settings rows.
5. Freeze the token and component list for 0.2-5.

## Done when
No open question is left in the concept files for version 1 screens, and the component list is frozen.
