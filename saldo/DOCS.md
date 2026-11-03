# Saldo

Saldo answers one question: *will I have enough money at the end of each coming month, and how much is left or short?* It syncs your bank accounts, categorises your transactions and plans the coming months, and everything stays on your own Home Assistant.

> **Version 0.2 is under construction.** Sign-in and the bank link are not available yet; until they are, the add-on starts but its API answers "Inloggen is nog niet beschikbaar". Follow the roadmap in the repository.

## Installation
1. In Home Assistant, go to **Settings → Add-ons → Add-on store → ⋮ → Repositories** and add `https://github.com/BertVanBaelen/Saldo`.
2. Install **Saldo** and start it.
3. Expose it on your own domain with the **Cloudflared** add-on (service `http://<saldo-hostname>:8080`).

## Options
| Option | Meaning |
|---|---|
| `public_url` | The address you open Saldo on, for example `https://saldo.example.com`. Used in e-mails and for the bank redirect. |
| `log_level` | `debug`, `info` (default), `warn` or `error`. |

## Backups
Home Assistant backs up Saldo with the add-on stopped (cold backup). The database and the key that encrypts your bank credentials are both in the backup: **encrypt your Home Assistant backups**.