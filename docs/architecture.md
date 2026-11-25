# Saldo architecture

How the code is organised. The *why* is in [`../analysis.md`](../analysis.md) (sections 7 and 8); the order of work is in [`../plan/`](../plan/README.md); the API contract is in [api.md](api.md).

## Overview
```
browser / installed PWA (Android, iPhone)
   │  HTTPS via the Cloudflared add-on
   ▼
saldo (one Go binary, Home Assistant add-on)
   ├── /api/*      JSON API (docs/api.md), every query scoped to the viewer
   ├── /healthz    watchdog and Docker health check
   └── /*          the built React app (SALDO_WEB_DIR), SPA fallback to index.html
   │
   ├── SQLite      /data/saldo.db (WAL), numbered migrations embedded in the binary
   └── bank        provider interface: Enable Banking (real) and a fake provider (tests, demo)
```

## Repository
| Folder | What |
|---|---|
| `server/` | Go module `github.com/BertVanBaelen/Saldo/server`: `cmd/saldo` (serve, healthcheck, version, `mail-preview`) and `internal/` packages (`config`, `db`, `bank`, `banklink`, `demo`, `ledger`, `categorise`, `users`, `auth`, `mail`, `importers`, `planning`, `notify`, `push`, `receipt`, `jobs`, `ratelimit`, `secrets`, `clock`, `apperr`, `server`; the reports of 0.7 live in `ledger/reports.go` because they share the per-viewer transfer rule of `ledger/transactions.go`; `planning` also holds the month-end warnings (`Warnings`), the contribution parts (`MemberPart`) and the budget reference (`LoadBudgetReference`) that `notify`, `receipt` and the server share; `notify` imports `ledger`, `planning`, `mail`, `push` and `receipt`, `receipt` imports `ledger` and `planning`, `mail` and `push` import none of them, and nothing below `notify` imports it) |
| `web/` | React 19 + Vite + TypeScript. `src/lib` (api client, types, formatting), `src/components` (shell, icons, shared UI), `src/pages` (one file per screen), global styles ported from the mockup |
| `saldo/` | The Home Assistant add-on: `config.yaml`, `DOCS.md`, `CHANGELOG.md`, translations |
| `Dockerfile`, `repository.yaml` | Multi-arch image (amd64, aarch64) and the add-on store entry |
| `.github/workflows/` | `ci.yml` (Go, web, secret scan, image build) and `release.yml` (publishes the version in `saldo/config.yaml` to `ghcr.io` and tags it) |
| `finance-mockup/` | The frozen HTML mockup: the design reference, not part of the app |
| `analysis.md`, `analysis/`, `plan/`, `design/` | Requirements, knowledge base, roadmap, design canvas copy |

## Principles
- **Money is `int64` cents** everywhere, also in JSON (analysis 5.1).
- **Privacy in every query:** financial tables are only reached through `account_access` for the viewer; a resource you cannot see is a `404`. Privacy tests run in CI from the first endpoint on (analysis 2, risk 7).
- **Accounts are independent:** states, buffers and forecasts are per account; sums across accounts are information only (analysis 4.5).
- **No real data outside the add-on:** the fake bank provider and the demo story serve development and tests. CI never calls a real bank. The repository is public.
- **Few dependencies:** the Go server uses the standard library plus `modernc.org/sqlite`; the web app uses React, React Router and Vite. The Planning screens add React Aria Components with a few controls copied from Untitled UI React into `web/src/ui/`, styled with `tw:`-prefixed Tailwind v4 utilities on Saldo's tokens (no preflight, imported only by `web/src/ui/`; [third-party-ui.md](third-party-ui.md)).
- **Notifications (0.9):** `server/internal/notify` is the dispatcher. Its triggers (the bank reminders, also to the manager of a shared account the link feeds; the 07:00 planning warnings; joins, invitations and missing contributions; the 19:00 digest of new uncategorised bank rows; the 19:00 week and month overviews) decide what is due at `now` and hand typed messages to `Deliver`, which picks the channels (`notify.Types` defaults, `notification_prefs`, `users.notify_email`, `users.quiet_hours`, the `push` subscriptions), re-checks that the user still sees the account, and claims the `notification_log` row (unique per user, channel and key) before it sends, so every message goes out at most once. The new-device message is delivered from the sign-in handler through the same `Deliver` (a security message: quiet hours do not hold it, the e-mail is always sent). One job, `notifications`, runs `notify.Service.Run` every 15 minutes (none in demo mode, where the sign-in handler keeps its direct mail); each trigger's first run records the state it finds without sending (`notify_runs`), so an upgrade never sends old state.
- **Push (0.9):** `server/internal/push` is the Web Push sender on the standard library (RFC 8030 delivery, RFC 8291 encryption, RFC 8292 VAPID), with its store (one subscription per device, bound to the device so signing out deletes it) and the SSRF guard (https only, an allowlist of push hosts, private addresses refused after DNS, no redirects). `push.Fake` serves the tests and demo mode, so neither calls a real push service; push is off without an https `public_url`. The VAPID key pair lives in the database (`push_keys`, the private half sealed with the secret box). The hourly job `push-prune` removes subscriptions of idle devices. Every push is generic text until the lock-screen check (`notify.Detail`).
- **Mail (0.9):** `server/internal/mail` has one builder per e-mail on plain structs (it imports no ledger, planning or receipt code), in one layout with a plain-text part and, when `public_url` is set, the logo and account icons as PNGs served without a session at `GET /mail/<file>`; `saldo mail-preview --to <address>` sends every template with demo values through the configured SMTP server ([local-testing.md](local-testing.md)).
- **The overview receipt (0.9):** the server builds the model of a week or month once (`GET /api/reports/receipt`, `server/internal/receipt`, which the e-mail uses too); the web app only draws it. The page `/overzicht/bon/:periode/:van` (`web/src/pages/OverzichtBon.tsx`, lazy-loaded with the UI library; the period and the `?scope=` live in the URL) prints it on the vendored `web/src/ui/ReceiptPrinter.tsx` with `ReceiptBody.tsx` as the paper, formatted from integer cents by `web/src/lib/receipt.ts`.

## Running it locally
```powershell
pwsh -File scripts/dev.ps1
```
starts the Go server in demo mode on http://localhost:8080 and the web app with hot reload on http://localhost:5180 (the frozen mockup keeps http://localhost:5173). Demo mode (`SALDO_DEMO=1`) seeds the demo story of analysis 12 and acts as Bert without signing in. Its state lives in `server/data-demo/`; `-Fresh` resets it and `-Stop` stops a leftover run. How to start, reset and stop, what to click through in ten minutes and the CSV files to import: [local-testing.md](local-testing.md). Without demo mode the API answers `401` until you sign in; the first-admin setup link is written to the server log (set `SALDO_MAIL_LOG=1` to read the e-mail codes there too).

Tests: `cd server; go test ./...` and `cd web; npm test`.