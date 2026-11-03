# 0.2-4 · Sign-in, users and mail

| | |
|---|---|
| Version | [0.2 Foundation](README.md) |
| Status | planned |
| Features | ACC-1, ACC-2, ACC-3 |
| Concepts | [authentication](../../analysis/concepts/authentication.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md), [notification](../../analysis/concepts/notification.md) |
| Screens | [inloggen](../../analysis/screens/inloggen.md), [instellingen](../../analysis/screens/instellingen.md), [emails](../../analysis/screens/emails.md) |
| Analysis | 2, 7 |
| Depends on | 0.2-3, design from 0.1-6 |

## Goal
Only you and Partner can get in, with e-mail as the second factor.

## Steps
1. Users table, roles admin and user, argon2id passwords, common-password blocklist.
2. Sign-in: e-mail and password, then an 8-digit code by e-mail (10 minutes, single use, hashed, 5 attempts, send-rate limit). No self-registration, no "forgot password".
3. Sessions with short lifetime, CSRF, CSP, rate limits per IP and account, no account enumeration, audit log.
4. First-admin setup link in the add-on log (1 hour); invitations (7 days); admin reset link (1 hour); admin recovery option.
5. SMTP mailer (STARTTLS or TLS) with the templates from 0.1-5: Inlogcode, Uitnodiging, Nieuw wachtwoord, with plain-text parts.
6. Optional: Log in with Home Assistant, followed by the e-mail code [C].
7. Admin screen to invite users and send reset links.

## Done when
You sign in with password and code, invite Partner, and she signs in; all failure paths are rate-limited and audited.
