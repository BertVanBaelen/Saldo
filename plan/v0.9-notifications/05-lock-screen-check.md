# 0.9-5 · Lock screen and real-phone check, docs, release

| | |
|---|---|
| Version | [0.9 Notifications](README.md) |
| Status | open: the lead and the user, on both real phones and the live add-on, after the 0.9.0-dev build |
| Size | S |
| Features | NOTIF-5 |
| Concepts | [notification](../../analysis/concepts/notification.md) |
| Screens | [pushmeldingen](../../analysis/screens/pushmeldingen.md) |
| Analysis | risks 14, 18, 19 |
| Depends on | [0.9-2](02-web-push.md) (the spike is there), [0.9-3](03-triggers-and-scheduler.md), [0.9-3b](03b-bank-shared-and-transaction-triggers.md), [0.9-3d](03d-overview-receipt-screen.md), [0.9-3e](03e-week-and-month-overview-notifications.md), [0.9-4](04-meldingen-screen.md) |
| Who | Lead and the user (real phones) |

## Goal
The whole chain works on both real phones on the live add-on, the lock screen shows no amounts or account names, and 0.9.0 can be released.

## What changed
The lock-screen test used to be this phase's only content, after the push content was built. It moved to the end of [0.9-2](02-web-push.md) as a spike (README decision 3), so the payloads are generic until the phones say otherwise and nothing amount-bearing is built and stripped again. What is left here is the **end-to-end** check of the finished chain and the release.

## Steps
1. **Install 0.9.0-dev on the live add-on** after a Home Assistant backup (README decision 8; the whole dev build goes live in one install with migrations 0018 and 0019, and the sign-out hooks change `devices` handling, so the backup matters; rollback is restoring it). The lock-screen spike of 0.9-2 step 8 runs here, in the same session. The first start writes the baseline: confirm that **nothing** is sent.
2. **The checklist, on the Android phone and on the iPhone** (installed app; the iPhone from the home screen, signing in again once and getting the new-device e-mail and push for it):
   - Meldingen: push on, test notification arrives with the right icon; e-mail on; each chip changes what arrives; quiet hours on at 23:00 delays a test of a real type until 07:00 (use the fake clock in a staging copy if waiting is not an option).
   - **The exit criterion**: confirm an item so the demo or real forecast turns red; the next morning at 07:00 one push and one e-mail arrive, **nothing again** the day after, a fix and a new dip send one again.
   - Bank: a consent reminder (set a consent date in the database copy, or wait for the real one); the manager message of a shared account fed by someone else's link.
   - Shared: a join and an invitation; a contribution that is missing on the 3rd.
   - Digest: new bank rows at 19:00 produce the count only.
   - Overview: switch Weekoverzicht and Maandoverzicht on; the Sunday 19:00 push is generic and opens the receipt, which prints and can be torn off (a finger on the paper scrolls the page, the grab strip and the "Scheur af" button tear); the e-mail's static receipt block in the three mail clients, light and dark (0.9-1 step 6); nothing arrives for an empty week.
   - Security: signing in a new browser sends the new-device e-mail and a push to the other phone; **signing that device out** and signing in again leaves no push going to the old one.
3. **Lock screen.** With the final payloads, repeat the spike's settings on both phones (Android lock-screen notification setting, iPhone Show Previews) and confirm only "Planning: actie nodig" / "Bankkoppeling verloopt binnenkort" style text shows. If the spike allowed `full`, check that too and record it. Record the outcome in `analysis/concepts/notification.md` and close risks 14 and 19 in `analysis.md`.
4. **Mail clients** (0.9-1 step 6) done and the table filled in; the preview command documented.
5. **Docs and release** as in the README's release checklist: `docs/api.md`, `architecture.md`, `security-baseline.md` (outbound push hosts, VAPID storage, `/mail/*`), `third-party-ui.md`, `local-testing.md`, `CHANGELOG.md`, version bump to `0.9.0`, statuses everywhere, the v1.0-2 security review line for push and outbound traffic.

## Done when
The lock screen of both phones shows only generic text; a forecast that turns red sends one push and one e-mail the next morning and nothing again until the state changes, on both phones; a signed-out device receives nothing; 0.9.0 is released.
