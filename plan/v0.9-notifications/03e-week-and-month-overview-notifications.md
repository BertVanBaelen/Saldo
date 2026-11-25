# 0.9-3e · Week and month overview notifications

| | |
|---|---|
| Version | [0.9 Notifications](README.md) |
| Status | built 24-25 Nov 2026 (0.9.0-dev); the e-mail's receipt block is not yet seen in real mail clients (0.9-5) |
| Size | M |
| Features | NOTIF-6 |
| Concepts | [notification](../../analysis/concepts/notification.md), [period-overview](../../analysis/concepts/period-overview.md) |
| Screens | [overzichtbon](../../analysis/screens/overzichtbon.md), [emails](../../analysis/screens/emails.md), [meldingen](../../analysis/screens/meldingen.md) (the group) |
| Analysis | 4.4, 4.9, risk 15 |
| Depends on | [0.9-3](03-triggers-and-scheduler.md) (dispatcher, log, per-trigger baseline, quiet hours), [0.9-1](01-email-templates.md) (layout, rows 15 and 16), [0.9-3c](03c-overview-receipt-data.md) (the model). The link target is [0.9-3d](03d-overview-receipt-screen.md); the notification works without it (the link then opens the app's fallback page), so 3e can land before 3d |
| Who | Sonnet, from this file; the lead reviews the baseline and expiry tests |

## Goal
Two opt-in notifications, a week overview and a month overview, that open the receipt: a generic push and an e-mail with a static receipt, to each user about their own accounts.

## The two types (user decisions 23 Nov 2026)
| Key | Type (Dutch) | Group | Dot | Sent when | Recipient | Push | Email |
|---|---|---|---|---|---|---|---|
| `week` | Weekoverzicht | Overzicht | `--green` | **Sunday 19:00** (Brussels), for the week Monday to Sunday that is ending | everyone, about their own current accounts (`scope=alles`) | **off** | **off** |
| `month` | Maandoverzicht | Overzicht | `--green` | **19:00 on the last day of the month**, for that month | the same | **off** | **off** |

Both are **opt-in**: off for push and e-mail until the user switches them on in Meldingen (user decision, against the lead's proposal of week push on, month push and e-mail on). Sublines: "Elke zondag om 19:00, met wat je uitgaf per categorie" and "Op de laatste dag van de maand om 19:00, met je budgetten".

## Rules
- **When.** A daily trigger from 19:00 (Brussels): on a Sunday the week of that Monday to that Sunday is due, on the last day of a month that month is due. When the last day is a Sunday both are due and go out as two pushes with different tags; the digest ([0.9-3b](03b-bank-shared-and-transaction-triggers.md)) goes first, then the week, then the month. Quiet hours do not apply at 19:00; a catch-up after 22:00 (a restart, the Home Assistant backup window) waits for 07:00 as every push does.
- **Keys and expiry.** `overview:week:<Monday date>` and `overview:month:<YYYY-MM>`, one row per user and channel, `suppressed` where the type or channel is off (so switching it on on a Wednesday never sends last Sunday's, only the next one). The message `Expires` after **3 days**; after that it is dropped (the receipt page still works).
- **Baseline** (per trigger, [0.9-3](03-triggers-and-scheduler.md) step 6): `baseline:week` and `baseline:month` are written on the first run; a period whose 19:00 had already passed is marked `suppressed`, not sent, so the upgrade never sends an old overview.
- **Nothing to say, nothing sent.** The model's `empty` (no income, expenses or saved in the period, [0.9-3c](03c-overview-receipt-data.md)) writes no row and sends nothing. A period the history only partly covers still sends, with "vanaf <datum>" on the receipt.
- **The snapshot is a snapshot.** At 19:00 the period is still running, so today's bank rows are not booked yet (pending rows never count): the e-mail is labelled "Stand zondag 22 nov, 19:00" and carries the note of the model. The push is generic and so cannot disagree with the receipt that is opened later. The in-app receipt is computed on opening.
- **Push content.** Generic until the lock-screen spike decides ([0.9-2](02-web-push.md) step 8): title "Weekoverzicht: je bon staat klaar" / "Maandoverzicht: je bon staat klaar", line "Tik om te zien waar je geld heen ging." (no amounts, no account or bank names, tone info). At detail `full`: "Uitgegeven € 412 · gespaard € 50 · over € 390" with the week or month label. A push opens `/overzicht/bon/week/<Monday>?scope=alles` or `/overzicht/bon/maand/<YYYY-MM>-01?scope=alles`.
- **E-mail.** One mail per type, the layout of [0.9-1](01-email-templates.md) with the receipt block (rows 15 and 16 there): subject "Je weekoverzicht · week 47" / "Je maandoverzicht · oktober 2026" (no account, it covers all of them), kicker "Weekoverzicht" / "Maandoverzicht" (info tone), key figure "Over: € 390,03" with the note "Inkomen − uitgaven − gespaard", the receipt block, one button "Bekijk de bon", the "Meldingen aanpassen" footer link and the line "Je krijgt dit omdat 'Weekoverzicht' aanstaat." The receipt block is **static**: a table with a monospace stack (Geist Mono, then `ui-monospace`, Menlo, Consolas), dotted leaders drawn as a border, indented subcategory rows and budget lines on months, in the paper's one ink colour; the printer animation is not possible in a mail and is not attempted. The **plain-text part follows the existing rule** ("Label: waarde" rows, section words in capitals, subcategories indented by two spaces); padded columns are not used because proportional fonts break them.
- **Only about accounts you can see**, computed for the recipient with their own report rules, re-checked at delivery ([0.9-3](03-triggers-and-scheduler.md) step 3).

## Steps
1. **Types and defaults (Sonnet).** `notify.Types` gets `week` and `month` (group Overzicht, defaults off/off, sublines above); the defaults table of [0.9-3](03-triggers-and-scheduler.md) and the API of [0.9-4](04-meldingen-screen.md) take them from there.
2. **The trigger (Sonnet, the lead reviews).** `notify.overview`: due from 19:00 Brussels once per period (`notify_runs` plus the log), for every user, building `receipt.Build` for the period, skipping `empty`, writing rows for every channel, delivering through the dispatcher. A user's failure does not stop the others; a failed send is retried on the next run until `Expires`. Registered in `notify.Run` after the digest.
3. **The e-mail builders (Sonnet).** `mail.WeekOverview` and `mail.MonthOverview` on a plain struct converted from `receipt.Model` in `notify` (`mail` imports neither `receipt` nor `ledger`, as in 0.9-1), the receipt block in `layout.html` and `layout.txt` (one block shared by both), amounts with cents and no-break spaces as in the other mails, names escaped.
4. **Tests.** On the demo with a fake clock: Sunday 19:00 sends the week, the last day the month, both on a month end that is a Sunday; **both off by default** (a user with no rows sends nothing and writes `suppressed` rows); switching a type on mid-week sends the next one only; the **first run** after the upgrade sends nothing even at 19:30 on a Sunday; a catch-up at 23:00 pushes at 07:00 and a catch-up after three days drops; an empty period sends nothing; a user with only a savings account sends nothing; **visibility** (Partner's receipt never contains Bert's personal accounts; a user without accounts gets nothing); the push payload has no `€` and no account name at detail `generic`; the e-mail's plain-text part has every category and subcategory of the model; names with `<`, `&` and quotes are escaped; the receipt block is inside the layout's 520 px with a long category name. **Golden messages** for the demo story's simulated month are listed here when derived by the lead.
5. **Docs.** `docs/api.md` ("Notifications": the two types), `analysis/concepts/notification.md`, `analysis/screens/meldingen.md`.

## Done when
A user who switches both on gets exactly one week overview on Sunday at 19:00 and one month overview on the last day, as a generic push and an e-mail with a static receipt, each opening the receipt; nothing arrives for an empty period, for a switched-off type, or from before the upgrade.
