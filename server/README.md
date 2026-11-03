# Saldo server

The Go server of Saldo: the JSON API under `/api` (contract: [`docs/api.md`](../docs/api.md)), the health endpoints and the built web app. Pure Go (no CGO), SQLite through `modernc.org/sqlite`.

## Run

Demo mode seeds the demo story (Bert, Partner, five accounts, a year of transactions, demo date 18 November 2026) through the fake bank provider and acts as Bert without signing in.

```powershell
cd server
$env:SALDO_DEMO = '1'
go run ./cmd/saldo
```

Then open http://localhost:8080/api/health. Without `SALDO_WEB_DIR`, `/` answers a short notice that the web app is not built; with it, the server serves the built app (`web/dist`) with a fallback to `index.html` for client-side routes.

Outside demo mode every `/api` route except `/api/health` answers `401` until sign-in exists (phase 0.2-4). Demo mode refuses to start on a database that holds non-demo data; use an empty state directory for it.

Subcommands: `saldo serve` (default), `saldo healthcheck` (exit 0 when `GET /healthz` on the local port answers 200, for the Docker `HEALTHCHECK`) and `saldo version`. Set the version at build time with `go build -ldflags "-X main.version=0.2.0" ./cmd/saldo`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SALDO_ADDR` | `:8080` | Listen address |
| `SALDO_STATE_DIR` | `./data` | Database (`saldo.db`) and migration backups (`backups/`); the add-on uses `/data` |
| `SALDO_WEB_DIR` | – | Built web app; empty or missing shows a notice |
| `SALDO_OPTIONS_FILE` | `<state>/options.json` | Add-on options (`log_level`, `public_url`); optional |
| `SALDO_DEMO` | `0` | `1` = demo mode |
| `SALDO_TODAY` | – (demo: `2026-11-18`) | Fixed date `YYYY-MM-DD`; the time of day keeps running |
| `SALDO_LOG_LEVEL` | `info` | `debug`, `info`, `warning` or `error`; overrides `log_level` from the options file |

Logs are JSON lines on stdout. Request logs hold the method, path, status and duration, never the query string.

## Layout

| Package | Holds |
|---|---|
| `cmd/saldo` | `main`: subcommands, startup, graceful shutdown on SIGINT/SIGTERM |
| `internal/config` | Environment and add-on options |
| `internal/clock` | Now and today in Europe/Brussels, with the demo date override |
| `internal/db` | Opening SQLite (WAL, foreign keys, busy timeout) and the embedded numbered migrations (`migrations/NNNN_name.sql`), with a backup before migrating a database that already has a schema |
| `internal/bank` | The provider interface (`ListAccounts`, `FetchTransactions`, `FetchBalances`); `bank/fake` serves the demo story |
| `internal/ledger` | Accounts, access, transactions, transfers, alerts and connections, always scoped to the viewer through `account_access` |
| `internal/users` | Profile and display preferences |
| `internal/demo` | Seeding the demo story and demo "Sync now" |
| `internal/ratelimit` | The 15-minute "Sync now" cooldown |
| `internal/server` | Routes, JSON helpers, middleware (request log, panic recovery, security headers, viewer) and the static web app |
| `internal/apperr` | Not found, forbidden and validation errors shared by the packages |

Money is `int64` cents everywhere. IBANs are stored in full and masked in every API response. The demo IBANs have wrong check digits on purpose, so they can never be a real account.

## Test

```powershell
cd server
go test ./...
go vet ./...
gofmt -l .
```

The tests cover configuration, migrations (on an empty database, idempotent, backup, rollback), IBAN masking, account states, transfer detection per viewer, the privacy rules (Bert never sees Partner's own account, Partner never sees Bert's personal accounts, a hidden account answers `404`), every API endpoint with `httptest` (shapes, errors, `401` outside demo mode), the sync rate limit and the web app fallback.
