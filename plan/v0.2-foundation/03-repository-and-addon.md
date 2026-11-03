# 0.2-3 · Repository and add-on skeleton

| | |
|---|---|
| Version | [0.2 Foundation](README.md) |
| Status | planned |
| Features | PLAT-2 |
| Concepts | [money-and-format](../../analysis/concepts/money-and-format.md) |
| Analysis | 7 (reliability), 8, 13.2, 13.3 |
| Depends on | – |

## Goal
A Go server packaged as a Home Assistant add-on, with the database and CI in place.

## Steps
1. Git repository with the layout from analysis 13.2: `server/`, `web/`, `finance/` (add-on folder), `finance-mockup/`, `docs/`, `.github/workflows/`, Dockerfile, `repository.yaml`.
2. Go server with `modernc.org/sqlite`, numbered SQL migrations embedded in the binary, config from the add-on options, health endpoint, structured logs.
3. Money as `int64` cents everywhere, also in JSON; Europe/Brussels for month boundaries.
4. Cold backup support (add-on stops while HA backs up).
5. CI on every push: `go vet`, `go test`, web typecheck, lint, build, migration check. Release workflow.

## Done when
The add-on installs on Home Assistant, starts, migrates an empty database and reports healthy.
