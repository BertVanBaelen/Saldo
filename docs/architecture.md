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
| `server/` | Go module `github.com/BertVanBaelen/Saldo/server`: `cmd/saldo` (serve, healthcheck, version) and `internal/` packages (`config`, `db`, `bank`, `demo`, `ledger`, `server`; later `auth`, `mail`, `categorise`, `importers`, `reports`, `planning`, `notify`) |
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
- **Few dependencies:** the Go server uses the standard library plus `modernc.org/sqlite`; the web app uses React, React Router and Vite.

## Running it locally
```powershell
pwsh -File scripts/dev.ps1
```
starts the Go server in demo mode on http://localhost:8080 and the web app with hot reload on http://localhost:5180 (the frozen mockup keeps http://localhost:5173). Demo mode (`SALDO_DEMO=1`) seeds the demo story of analysis 12 and acts as Bert without signing in. Without demo mode the API answers `401` until you sign in; the first-admin setup link is written to the server log (set `SALDO_MAIL_LOG=1` to read the e-mail codes there too).

Tests: `cd server; go test ./...` and `cd web; npm test`.