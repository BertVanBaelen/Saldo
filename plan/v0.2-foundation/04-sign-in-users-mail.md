# 0.2-4 · Sign-in, users, trusted devices and mail

| | |
|---|---|
| Version | [0.2 Foundation and first bank link](README.md) |
| Status | built (5 Nov 2026), server and web, tested against a recording mailer; to verify: a real mail server and Partner's iPhone. Left out: Log in with Home Assistant (ACC-3, optional) |
| Size | L |
| Features | ACC-1, ACC-2, ACC-3, ACC-4 |
| Concepts | [authentication](../../analysis/concepts/authentication.md), [user-and-visibility](../../analysis/concepts/user-and-visibility.md), [notification](../../analysis/concepts/notification.md) |
| Screens | [inloggen](../../analysis/screens/inloggen.md), [instellingen](../../analysis/screens/instellingen.md), [emails](../../analysis/screens/emails.md) |
| Analysis | 2, 4.9 (always-email messages), 7 |
| Depends on | [0.2-2](02-repository-addon-ci.md), [0.2-3](03-web-app-shell.md) |

## Goal
Only you and Partner can get in, with e-mail as the second factor, and a device you trust stays signed in.

## Steps
1. `user`, `user_token`, `login_code`, `device`, `audit_log`; roles admin and user; argon2id passwords; common-password blocklist.
2. Sign-in: e-mail and password, then an 8-digit code by e-mail (10 minutes, single use, hashed, 5 attempts, send-rate limit). No self-registration, no "forgot password".
3. Trusted devices: device session cookie (hashed token, `HttpOnly`, `Secure`, `SameSite=Strict`), renewed while used, ended after 90 days unused, on sign-out or on a password change; Instellingen → Toestellen with sign-out per device and everywhere else.
4. CSRF, CSP, rate limits per IP and account, no account enumeration, audit log (logins, failures, code sends, new devices, sign-outs).
5. First-admin setup link in the add-on log (1 hour); invitations (7 days); admin reset link (1 hour); admin recovery option; Instellingen → Gebruikers and Profiel.
6. SMTP mailer (STARTTLS or TLS) with the templates Inlogcode, Uitnodiging, Nieuw wachtwoord and **Nieuw toestel aangemeld**, with plain-text parts.
7. Optional: Log in with Home Assistant, followed by the e-mail code [C].

## Done when
You sign in with password and code, invite Partner, and she signs in on her iPhone; each new device sends the new-device e-mail; all failure paths are rate-limited and audited.