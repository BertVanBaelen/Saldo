# Sign-in and security

Analysis: 7, 4.9 (always-email messages), risks 6, 18 · Data: `device`, `user_token`, `login_code`, `audit_log` · Screens: [inloggen](../screens/inloggen.md), [instellingen](../screens/instellingen.md), [emails](../screens/emails.md) · Phases: [0.1-5](../../plan/v0.1-mockup/05-emails-and-push.md), [0.1-6](../../plan/v0.1-mockup/06-decisions-in-the-mockup.md), [0.1-7](../../plan/v0.1-mockup/07-missing-designs.md), [0.2-4](../../plan/v0.2-foundation/04-sign-in-users-mail.md), [0.2-5](../../plan/v0.2-foundation/05-security-baseline.md), [1.0-2](../../plan/v1.0-release/02-security-review.md)

## Flow
1. Email and password (argon2id).
2. An **8-digit code** by email: valid 10 minutes, single use, stored hashed, 5 attempts, send-rate limited.
3. Optional "Log in with Home Assistant", still followed by the email code.
4. The device or browser is now **trusted** and stays signed in (see below).

## Trusted devices
Decision of 3 Nov 2026: devices and browsers do not need to sign in again every time.
- After password and code, the device gets a long-lived device session: a random token, stored hashed in `device`, sent as an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. It is renewed while used and ends after **90 days without use**, when signed out, or when the password changes (all other devices).
- Every new trusted device sends the user a **push and an email "Nieuw toestel aangemeld"** (device name, time; what to do if it was not you). The email cannot be turned off; the push follows the Meldingen settings but ignores quiet hours.
- Instellingen → **Toestellen** lists the devices (name, added, last used, "Dit toestel") with "Afmelden" per device and "Overal afmelden behalve hier".
- Risk 18: a stolen unlocked phone gives access until the device is signed out. Accepted, with the email and the device list as mitigation.

## Rules
- **No self-registration.** The first admin comes from a one-time setup link in the add-on log (valid 1 hour). Others are invited by email.
- **No "forgot password" link.** An admin sends a reset link. "Admin recovery" in the add-on options covers a locked-out sole admin.
- Rate limits per IP and per account, common-password blocklist, no account enumeration.
- Trusted device sessions (above), CSRF and CSP, audit log of logins, failures, code sends, new devices, sign-outs, account joins and exports.
- Emails that can never be turned off: login code, invitation, password reset ([notification](notification.md)).
- Secrets (Enable Banking keys and tokens) are encrypted at rest with a key generated on first start and stored apart from the database. HA backups must be encrypted.
- Public access through the Cloudflared add-on from the first development version, after the security baseline check (analysis 13.4). SMTP over STARTTLS or TLS only.

## In the design
The sign-in screens are designed in the mockup (`inloggen.html`, see [inloggen](../screens/inloggen.md)); Toestellen in [instellingen](../screens/instellingen.md). The email templates "Inlogcode", "Uitnodiging" and "Nieuw wachtwoord" are designed on the E-mails board, "Nieuw toestel aangemeld" in the mockup.

From the email designs: the login code is shown as 4+4 digits ("4829 1736"), "werkt één keer", with the requesting device in the details ("Chrome op Windows"). An invitation link is valid 7 days, single use, role "Gebruiker". A password reset link is valid 1 hour, created by an admin; the email repeats that you then sign in with the email code.

## Open questions
None for v1.
