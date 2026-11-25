# 0.9-1 · E-mail templates, layout and the preview command

| | |
|---|---|
| Version | [0.9 Notifications](README.md) |
| Status | built 24-25 Nov 2026 on branch `v0.9-notifications` (0.9.0-dev); step 6, the client check in three real mail clients, is open and runs with 0.9-5 |
| Size | M |
| Features | NOTIF-1 |
| Concepts | [notification](../../analysis/concepts/notification.md), [buffer-and-states](../../analysis/concepts/buffer-and-states.md), [account](../../analysis/concepts/account.md), [shared-account](../../analysis/concepts/shared-account.md) |
| Screens | [emails](../../analysis/screens/emails.md) |
| Analysis | 4.9 |
| Depends on | [0.2-4](../v0.2-foundation/04-sign-in-users-mail.md) (mailer, layout), [0.3-2](../v0.3-bank-sync/02-consent-reminders.md) (bank mails). **Nothing of 0.8**: the templates take plain structs; [0.9-3](03-triggers-and-scheduler.md) and [0.9-3b](03b-bank-shared-and-transaction-triggers.md) fill them. Can run in parallel with [0.9-2](02-web-push.md) |
| Who | Sonnet, from this file |

## Goal
Every e-mail Saldo sends exists as a Go function in `server/internal/mail`, in the one layout, with a plain-text part, correct links and images, and has been seen in three real mail clients.

## What exists (checked 18 Nov 2026)
`mail/templates.go` has the layout (`layout.html`, `layout.txt`, three tones) and `LoginCode`, `Invitation`, `PasswordReset`, `NewDevice`; `mail/bank.go` has `ConsentExpiring` (14 and 3 days), `SyncStopped` and the account block (`AccountRef`: name, shared, masked IBAN, "with"). So of the ten designed e-mails three are missing: planning red, planning in the buffer, member joined. The layout has **no "Meldingen aanpassen" link** and its brand is text, not the logo of the board.

## The list (design id in brackets)
| # | Function | Subject (names the account) | Tone | Designed |
|---|---|---|---|---|
| 1 | `LoginCode` | Je inlogcode: 4829 1736 | info | done (0.2-4) |
| 2 | `PlanningRed` | Zichtrekening staat rood in februari | error | board 2 |
| 3 | `PlanningBuffer` | Zichtrekening zakt in januari in de buffer | warn | board 3 |
| 4 | `ConsentExpiring` 14 days | Je Argenta-koppeling verloopt over 14 dagen (2 rekeningen) | warn | done (0.3-2) |
| 5 | `ConsentExpiring` 3 days | Laatste herinnering: Argenta verloopt over 3 dagen | error | done (0.3-2) |
| 6 | `SyncStopped` | Zichtrekening en Gedeelde rekening worden niet meer bijgewerkt | error | done (0.3-2) |
| 7 | `Invitation` | Bert nodigt je uit voor Saldo | info | done (0.2-4) |
| 8 | `MemberJoined` | Partner is erbij op de Gedeelde rekening | shared | board 8, **two variants** |
| 9 | `PasswordReset` | Stel een nieuw wachtwoord in | info | done (0.2-4) |
| 10 | `NewDevice` | Nieuw toestel aangemeld: Chrome op Android | info | done (0.2-4) |
| 11 | `SharedInvitation` | Bert nodigt je uit voor de Gedeelde rekening | shared | **no design** |
| 12 | `ContributionMissing` | Je bijdrage voor de Gedeelde rekening is er nog niet (member) / Partners bijdrage … (manager) | shared | **no design, two variants** |
| 13 | `UncategorisedDigest` | 8 transacties te categoriseren | info | **no design** |
| 14 | bank mails to a manager | "Partners Argenta-koppeling verloopt over 14 dagen" / "… is verlopen" | warn / error | **variant of 4–6** |
| 15 | `WeekOverview` | Je weekoverzicht · week 47 | info | **no design**, static receipt block ([0.9-3e](03e-week-and-month-overview-notifications.md)) |
| 16 | `MonthOverview` | Je maandoverzicht · oktober 2026 | info | **no design**, static receipt block, with budgets |

Rows 11 to 16 exist because the Meldingen screen offers an e-mail chip for those types (`invite`, `contrib`, `cat`, `week`, `month`) and for the manager's bank messages (0.9-3b); the board never designed them. They are built from the same layout and shown to the user in the preview (step 6) before they count as done.

## Steps
1. **Layout.** Add `SettingsURL` (the footer link "Meldingen aanpassen", set by the builder: all notification mails, not login, invitation, password reset or new device) and `BaseURL`; the brand becomes the logo PNG when `BaseURL` is set, the text brand as today when it is not (no public address: no images, no links).
2. **Images.** PNG versions of the logo (white-stroke e-mail variant, 28 px at 2x), `person.png` (green circle) and `people.png` (violet circle), embedded in `server/internal/mail/img/` and served without a session at `GET /mail/{file}` for exactly those file names (`Cache-Control: public, max-age=…`, `nosniff`, 404 otherwise). Gmail and Outlook drop SVG, so PNG. `privacy_test.go` gets a row: `/mail/` serves only those files.
3. **The templates of rows 2, 3, 8, 11, 12, 13, 14** as Go functions on plain structs, no `ledger` or `planning` import:
   - `PlanningRed{Account AccountRef, Month, EndBalance, EndDate, RedFrom, Cause, Buffer, ActionURL}`; the figure is `−€ 1.033,47` with U+2212 and no-break spaces; rows "Grootste uitgave", "Rood vanaf", "Buffer".
   - `PlanningBuffer{Account, Month, EndBalance, UnderBuffer, Buffer, LowestPoint, Cause, ActionURL}`; rows "Grootste uitgave", "Laagste punt".
   - `MemberJoined{Account, Who, Role, Since, Via, MembersURL}` with `Via = Link | Invitation`: "Partner heeft de Gedeelde rekening ook bij Argenta gekoppeld" versus "Partner heeft je uitnodiging voor de Gedeelde rekening aangenomen"; the role row says "Lid · mag bewerken" or "Lid · alleen lezen".
   - `SharedInvitation{Account, Inviter, ActionURL}`: the alert on Start is the in-app version; the mail only says who invited you and that you see the account's name until you add it.
   - `ContributionMissing{Account, Member, Required, Received, Month, ForSelf bool}`: self variant "Je bijdrage van € 436 is er nog niet" (partial: "€ 200 van € 436 is binnen"), manager variant "Partners bijdrage is er nog niet"; both name the account and the month, neither names a personal account.
   - `UncategorisedDigest{Count, Samples []string (empty by decision 7), ActionURL}`: count only.
   - Manager variant of `ConsentExpiring`/`SyncStopped`: an `Owner` field ("Partner") and only the **shared** accounts the link feeds; the button text is "Bekijk de rekening" (the manager cannot re-link someone else's consent), the note says the manager can add their own link as a fallback.
   - `WeekOverview` and `MonthOverview` on a plain struct converted from `receipt.Model` by `notify` (`mail` imports neither `receipt` nor `ledger`): subject, kicker, the key figure "Over: € 390,03" ("Inkomen − uitgaven − gespaard"), the **receipt block**, the button "Bekijk de bon", the "Stand zondag 22 nov, 19:00" line and the model's notes. The receipt block is a static table in the one layout: a monospace stack (Geist Mono, `ui-monospace`, Menlo, Consolas), dotted leaders as a border, categories with amounts and trends, **indented subcategory rows**, on months a budget line ("budget 550,00 · 117 %") under a category, all in the paper's single ink colour (the printer animation is not possible in a mail and is not attempted). Its plain-text part follows the "Label: waarde" rule (section words in capitals, subcategories indented two spaces, no padded columns: proportional fonts break them). Tests: every category and subcategory of the model is in both parts, names are escaped, a long category name does not break the 520 px layout.
4. **Deep links.** The builders take absolute URLs; the callers (0.9-3, 0.9-3b) build them from `public_url`: `/planning?maand=YYYY-MM&rekening=<id>#maanden` (the `groep` parameter of the mockup does not exist; `rekening` is added to Planning in 0.9-3), `/rekeningen/<id>` for members, `/bankkoppelingen`, `/transacties?filter=niet-gecategoriseerd`, `/meldingen`. A test asserts every URL a template renders starts with the given base and that none is built without one.
5. **Preview command.** `saldo mail-preview --to <address> [--only <function>]` in `cmd/saldo` renders every template with the demo values of the mockup (`finance-mockup/emails/*.html` comments hold the field lists) and sends them through the configured SMTP, subject prefixed "[voorbeeld]". Without SMTP configuration it exits with a clear message. It never reads the database.
6. **Client check (the user, with the preview).** Gmail (web and Android app), Outlook (web or desktop) and Apple Mail on the iPhone, light and dark. Record per template and client what differs in the table below; fix what is unreadable, accept rounded corners that Outlook drops. The new rows 11–16 are approved by the user here.
7. **Tests** (`go test ./internal/mail/...`): each function renders; HTML and text carry the same facts; names with `<`, `&` and quotes are escaped (as `TestBankMailsEscapeNames`); no `SettingsURL` on the four mails without it; the plain-text footer delimiter is the existing `--` line (kept as shipped in 0.2-4 and pinned by every golden; the RFC 3676 `-- ` with a trailing space is a later option); amounts and dates are Dutch (`€ 1.033,47`, `10 februari`); a very long account name wraps and does not break the table.

## Client check (filled in by the user, 0.9-1 step 6)
| Template | Gmail web | Gmail Android | Outlook | Apple Mail iPhone | Notes |
|---|---|---|---|---|---|
| (to fill in) | | | | | |

## Done when
All templates of the list render correctly in the three mail clients, light and dark, rows 11 to 16 are approved, and the preview command sends them.
