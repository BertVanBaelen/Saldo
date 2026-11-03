# Notification and email

Analysis: 4.9, 7, risks 14, 15 · Data: `notification_pref`, `push_subscription`, `notification_log` · Screens: [meldingen](../screens/meldingen.md), [emails](../screens/emails.md), [pushmeldingen](../screens/pushmeldingen.md) · Phases: [0.1-4](../../plan/v0.1-mockup/04-rekeningen-meer-meldingen.md), [0.1-5](../../plan/v0.1-mockup/05-emails-and-push.md), [0.2-4](../../plan/v0.2-foundation/04-sign-in-users-mail.md), [0.3-4](../../plan/v0.3-bank-sync/04-consent-reminders.md), [0.8-1](../../plan/v0.8-notifications/01-email-templates.md), [0.8-2](../../plan/v0.8-notifications/02-web-push.md), [0.8-3](../../plan/v0.8-notifications/03-triggers-and-scheduler.md), [0.8-4](../../plan/v0.8-notifications/04-meldingen-screen.md), [0.8-5](../../plan/v0.8-notifications/05-lock-screen-check.md)

## Channels
Push (Web Push to the installed PWA, VAPID keys generated on first start) and email (SMTP from the add-on options). Each user turns each channel on or off and chooses per type.

## Types and defaults
| Key | Type (Dutch) | Group in settings | Dot | Sent when | Push | Email |
|---|---|---|---|---|---|---|
| `rood` | Rekening staat rood | Planning | `--neg` | forecast puts a group below € 0 within the look-ahead | on | on |
| `buffer` | Rekening komt in de buffer | Planning | `--warn` | forecast puts a group below its buffer | on | off |
| `consent` | Koppeling verloopt | Bank | `--warn` | 14 and 3 days before consent expiry | on | on |
| `stop` | Synchronisatie gestopt | Bank | `--neg` | consent lapsed or sync keeps failing | on | on |
| `joined` | Iemand sluit aan | Gedeeld | `--shared` | someone joins a shared account you manage | on | on |
| `contrib` | Bijdrage ontbreekt [C] | Gedeeld | `--shared` | a contribution has not arrived by the 3rd | off | off |
| `cat` | Te categoriseren | Transacties | `--green` | new uncategorised transactions, max once a day at 19:00 | on | off |

Always by email, cannot be turned off: login code, invitation, password reset.

## Rules
- Look-ahead for planning warnings: 1, 3 (default) or 6 months. One message per group, per month and per state, the morning after the forecast changes (`notification_log` prevents repeats).
- Quiet hours for push, default 22:00–07:00 and **on** by default. A test notification button.
- When a channel is off, its per-type choices are disabled and shown off, but kept: they come back when the channel is turned on again.
- Messages name the account: name, personal or shared, masked IBAN (`BE68 •••• •••• 4821`). The email subject names it too.
- Push: title, one line and the key amount (`−€ 1.033`). The red planning push expands to a small chart. No amounts or account names on the **lock screen** **[verify]** (risk 14).
- Android status-bar icon: one-colour silhouette of the app icon, 24×24 dp with 2 dp margin, as a vector. Circle colour per type: green info, ochre warning, red error.
- You only get messages about accounts you can see.

## Email style
White card with the Saldo logo, a short label, the key amount or code in the type colour, an account block, a details table, one green button, and a footer explaining why you get it with a link to the notification settings (not on login, invitation and password emails). Dutch, with a plain-text part. Sender `saldo@<your-domain>`.

## From the design (0.1-5)
- Push amounts are whole euros (`€ 722`, `−€ 1.033`); emails show cents. The red push names the **group** ("Persoonlijk staat rood…"), the email names the **account** ("Zichtrekening staat rood…").
- Lock screen: "Planning: actie nodig" / "Bankkoppeling verloopt binnenkort", line "Ontgrendel om de details te zien".
- Push actions (defined, not yet shown): "Bekijk planning" / "Later", "Bekijk januari" / "Later", "Opnieuw koppelen" / "Morgen", "Categoriseren".
- Email sender display name "Saldo". Footer ends with "Saldo draait op je eigen Home Assistant."; mute link "Meldingen aanpassen". Member joined uses the violet shared tone. Per-template spec: [emails](../screens/emails.md#design-notes), push spec: [pushmeldingen](../screens/pushmeldingen.md#design-notes).

Templates (9): login code, planning red, planning in the buffer, link expires in 14 days, link expires in 3 days, sync stopped, invitation, member joined, new password.
