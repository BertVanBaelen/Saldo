# Saldo

Saldo answers one question: *will I have enough money at the end of each coming month, and how much is left or short?* It syncs your bank accounts, categorises your transactions and plans the coming months, and everything stays on your own Home Assistant.

> **Version 0.2 is under construction.** Signing in works; the bank link is not available yet. Follow the roadmap in the repository.

## Installation
1. In Home Assistant, go to **Settings → Add-ons → Add-on store → ⋮ → Repositories** and add `https://github.com/BertVanBaelen/Saldo`.
2. Fill in the **Configuration** tab: `public_url` and the mail server (`smtp_*`). Saldo sends every sign-in code by e-mail, so without a mail server nobody can sign in.
3. Start Saldo and expose it on your own domain with the **Cloudflared** add-on (service `http://<saldo-hostname>:8080`).
4. Open the **Log** tab. On the first start, while there is no account yet, Saldo writes a one-time link there: `<public_url>/setup/…`. Open it within an hour to create the first admin. Every restart writes a new link; the old one stops working.
5. Invite others from Instellingen → Gebruikers. There is no self-registration and no "forgot password" link: an admin sends a reset link instead.

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
