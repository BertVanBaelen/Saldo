# 0.2-2 · Repository, add-on and CI

| | |
|---|---|
| Version | [0.2 Foundation and first bank link](README.md) |
| Status | in progress (3 Nov 2026): server, add-on folder, Dockerfile and workflows written; to check: CI on GitHub, install on Home Assistant |
| Size | M |
| Features | PLAT-2 |
| Concepts | [money-and-format](../../analysis/concepts/money-and-format.md) |
| Analysis | 7 (reliability), 8, 13.2, 13.3 |
| Depends on | – |

## Goal
A Go server packaged as a Home Assistant add-on, built by CI and installable from the public repository.

## Steps
1. Code layout from analysis 13.2 next to the preparation: `server/`, `web/`, `saldo/` (add-on folder), `docs/`, `.github/workflows/`, `Dockerfile`, `repository.yaml`. Add a `.gitattributes` that keeps LF line endings.
2. Go server with `modernc.org/sqlite`, numbered SQL migrations embedded in the binary, config from the add-on options, health endpoint, structured logs.
3. Money as `int64` cents everywhere, also in JSON; Europe/Brussels for month boundaries.
4. Cold backup support (add-on stops while HA backs up).
5. CI on every push: `go vet`, `go test`, web typecheck, lint, build, migration check, secret scan. Release workflow: multi-arch images (amd64, aarch64) to `ghcr.io`, add-on version bump, git tag.
6. Install the add-on on Home Assistant from the repository URL.

## Done when
The add-on installs on Home Assistant from the repository URL, starts, migrates an empty database and reports healthy.