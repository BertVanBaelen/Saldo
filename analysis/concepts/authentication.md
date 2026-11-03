# Sign-in and security

Analysis: 7, 4.9 (always-email messages) · Data: `session`, `login_code`, `audit_log` · Screens: [inloggen](../screens/inloggen.md), [instellingen](../screens/instellingen.md), [emails](../screens/emails.md) · Phases: [0.1-5](../../plan/v0.1-mockup/05-emails-and-push.md), [0.1-6](../../plan/v0.1-mockup/06-missing-designs.md), [0.2-4](../../plan/v0.2-foundation/04-sign-in-users-mail.md), [1.0-2](../../plan/v1.0-release/02-security-review.md)

## Flow
1. Email and password (argon2id).
2. An **8-digit code** by email: valid 10 minutes, single use, stored hashed, 5 attempts, send-rate limited.
3. Optional "Log in with Home Assistant", still followed by the email code.

## Rules
- **No self-registration.** The first admin comes from a one-time setup link in the add-on log (valid 1 hour). Others are invited by email.
- **No "forgot password" link.** An admin sends a reset link. "Admin recovery" in the add-on options covers a locked-out sole admin.
- Rate limits per IP and per account, common-password blocklist, no account enumeration.
- Short sessions, CSRF and CSP, audit log of logins, failures, code sends, account joins and exports.
- Emails that can never be turned off: login code, invitation, password reset ([notification](notification.md)).
- Secrets (Enable Banking keys and tokens) are encrypted at rest with a key generated on first start and stored apart from the database. HA backups must be encrypted.
- Public access through the Cloudflared add-on. SMTP over STARTTLS or TLS only.

## In the design
Not designed yet (screen 1 in analysis 12). The email templates "Inlogcode", "Uitnodiging" and "Nieuw wachtwoord" are designed on the E-mails board.

From the email designs: the login code is shown as 4+4 digits ("4829 1736"), "werkt één keer", with the requesting device in the details ("Chrome op Windows"). An invitation link is valid 7 days, single use, role "Gebruiker". A password reset link is valid 1 hour, created by an admin; the email repeats that you then sign in with the email code.

## Open questions
- Copy and layout of the sign-in, code, first-admin setup and invitation screens (to design in 0.1-6).
