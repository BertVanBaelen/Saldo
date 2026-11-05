# Saldo

Saldo answers one question: *will I have enough money at the end of each coming month, and how much is left or short?* It syncs your bank accounts, categorises your transactions and plans the coming months, and everything stays on your own Home Assistant.

> **Version 0.2 is under construction.** Signing in works; the bank link is not available yet. Follow the roadmap in the repository.

## Installation
1. In Home Assistant, go to **Settings → Add-ons → Add-on store → ⋮ → Repositories** and add `https://github.com/BertVanBaelen/Saldo`.
2. Fill in the **Configuration** tab: `public_url` and the mail server (`smtp_*`). Saldo sends every sign-in code by e-mail, so without a mail server nobody can sign in.
3. Start Saldo and expose it on your own domain with the **Cloudflared** add-on (service `http://<saldo-hostname>:8080`).
4. Open the **Log** tab. On the first start, while there is no account yet, Saldo writes a one-time link there: `<public_url>/setup/…`. Open it within an hour to create the first admin. Every restart writes a new link; the old one stops working.
5. Invite others from Instellingen → Gebruikers. There is no self-registration and no "forgot password" link: an admin sends a reset link instead.

## Public access
Saldo holds your bank data on a public address, so set this up before you link a bank.

- **Cloudflared route.** In the Cloudflared add-on, add a host for Saldo, for example `saldo.example.com` with service `http://<saldo-hostname>:8080`. The hostname is on Saldo's **Info** tab (something like `a1b2c3d4-saldo`). Saldo publishes no port on your network; only Cloudflared reaches it. Let Cloudflare redirect http to https ("Always Use HTTPS").
- **`public_url`.** Set it to the exact address you open, with `https://`, for example `https://saldo.example.com`. Saldo uses it for the links in e-mails and the bank redirect, accepts sign-in requests from that origin, marks the sign-in cookie `Secure` and sends `Strict-Transport-Security`. Without it nobody can be invited and no bank can be linked.
- **Backups must be encrypted.** The key that encrypts your bank credentials (`/data/secret.key`) sits in the same backup as the database. Only an encrypted Home Assistant backup keeps both safe. If the key is lost (a backup restored without it), the stored bank key cannot be read: store the Enable Banking key again under Instellingen and re-authorise the link at Bankkoppelingen.
- **Mail.** Fill in `smtp_host`, `smtp_port`, `smtp_security` (STARTTLS or TLS; the server certificate is checked), `smtp_user`, `smtp_password` and `smtp_from`. Use a mail account with its own two-step sign-in: the code by e-mail is the second factor.
- **First admin.** On the first start Saldo writes a one-time link `<public_url>/setup/…` to the **Log** tab, valid for an hour; a restart writes a new one. Open it, choose your name, address and password.
- **Admin recovery.** Locked out as the only admin? Turn `admin_recovery` on, restart, use the link in the log within an hour, then turn it off and restart again.

### Checklist before the first real bank link
1. Restore test: take an encrypted backup of an empty Saldo, uninstall Saldo, restore the backup and check that it starts with your account.
2. On the real address, open the browser's developer tools: the `saldo_device` cookie is `Secure`, `HttpOnly` and `SameSite=Strict`, and answers carry `Strict-Transport-Security`.
3. Run an external TLS and headers check on the address (for example SSL Labs and securityheaders.com): grade A, no plain-http access.
4. Register `<public_url>/bankkoppelingen/terug` as the redirect URL of your Enable Banking application (Instellingen → Enable Banking shows it).

## Signing in
You sign in with your e-mail address and password, then with an 8-digit code that Saldo e-mails you (valid 10 minutes, works once). The device or browser is then trusted and stays signed in until you sign it out, change your password, or do not use it for 90 days. Every new device sends you the e-mail "Nieuw toestel aangemeld". Instellingen → Toestellen lists your devices.

## Options
| Option | Meaning |
|---|---|
| `public_url` | The address you open Saldo on, for example `https://saldo.example.com`. Used in e-mails and for the bank redirect. |
| `log_level` | `debug`, `info` (default), `warn` or `error`. |
| `smtp_host` | The mail server, for example `smtp.example.com`. |
| `smtp_port` | Empty uses 587 for STARTTLS and 465 for TLS. |
| `smtp_security` | `starttls` (default) or `tls`. Saldo never sends mail unencrypted. |
| `smtp_user`, `smtp_password` | Your account at the mail server; often an app password. |
| `smtp_from` | The sender, for example `Saldo <saldo@example.com>`. Empty uses `smtp_user`. |
| `admin_recovery` | Off by default. When on, every start writes a link to choose a new password for the first admin to the log (valid 1 hour), with a warning. Use it only when you are locked out, and turn it off right after: anyone who can read the log can use the link. |

## Backups
Home Assistant backs up Saldo with the add-on stopped (cold backup). The database and the key that encrypts your bank credentials are both in the backup: **encrypt your Home Assistant backups**.
