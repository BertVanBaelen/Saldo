# Security baseline (phase 0.2-5)

The check of analysis 7 before the first real bank link (analysis 9, risks 13 and 20). Reviewed on 5 November 2026 against branch `v0.2-finish` with phases 0.2-4 and 0.2-6 merged. The full review follows in 1.0-2.

Result per item: **ok** (checked, nothing to change), **fixed** (in this phase, commit `ab3d903` unless stated), **accepted** (with the reason), **1.0-2** (deferred to the full review), **user** (needs the user, see the checklist in `saldo/DOCS.md`).

## Access and privacy
| Item | Result |
|---|---|
| Every `/api` route needs a viewer, except health, login, verify, redeem and token lookup (`requireViewer`, `isPublic`) | ok; `TestOutsideDemoModeEverythingButHealthIs401` covers every route |
| Every financial query is scoped to the viewer through `account_access` or `user_id` (all of `ledger/` and `banklink/` read) | ok. Connections and Enable Banking settings by `user_id`; accounts, members, sync state, transactions, transfer detection and the uncategorised count by `account_access`; the sync runs only on connections listed for the viewer |
| Object-level checks on `{id}` routes: accounts, devices, connections answer 404 for someone else's object, the same as for a missing one | ok |
| Users and invitations are admin-only (403 for others); an admin sees every user by design | ok |
| Privacy sweep: user B calls every data endpoint of `docs/api.md`, also with user A's ids, and sees none of A's names, IBANs, amounts, counterparties, devices or transfers | fixed: `TestPrivacySweep` (next to the demo-based `TestPrivacyEndpoints`) |
| Linking an IBAN that another user already linked shows that it exists (masked) | accepted: only a holder can authorise the account at the bank (analysis 6.3) |
| Demo mode acts as Bert without signing in | accepted: environment variable only, not an add-on option, refused on a real database |

## Sign-in
| Item | Result |
|---|---|
| argon2id (64 MiB, t=2, p=2), at most two hashes at a time, constant-time compare | ok |
| No account enumeration: same answer and the same argon2 work for an unknown address, a wrong password and a user over the code limit; the code mail goes out in the background | ok |
| Code: 8 digits from `crypto/rand`, hashed together with the challenge, 10 minutes, 5 attempts, single use, newest code only; verify runs in one `BEGIN IMMEDIATE` transaction, so two verifies cannot both win | ok |
| Device, setup, invitation and reset tokens: 32 random bytes, stored as SHA-256, single use, re-checked inside the redeeming transaction | ok |
| Rate limits per IP, per address, per user (codes, wrong current password, bank links) | ok; in memory, a restart resets them (accepted) |
| Client IP: `CF-Connecting-IP` is believed from any private or loopback peer | accepted: other add-ons on the Home Assistant network could fake an IP and slip past the per-IP limit, but the per-address and per-user limits still hold |
| Device cookie `Secure` behind Cloudflared, which reaches Saldo over plain http | fixed: `Secure` with an https `public_url`, or when a trusted peer says the edge was https (`X-Forwarded-Proto`, `CF-Visitor`); a public peer cannot claim it. `TestDeviceCookieSecureBehindProxy` |
| `HttpOnly`, `SameSite=Strict`, 90 days idle, password change and reset sign out the other devices | ok |
| Sign-in links in the request log (`/setup/…`, `/uitnodiging/…`, `/nieuw-wachtwoord/…`, `/api/auth/token/…`): anyone who can read the add-on log could use them | fixed: `logPath` leaves the token out. `TestTokensNotLogged` |
| Setup link and admin-recovery link written to the log on purpose | accepted (analysis 7); recovery is off by default and warns loudly |
| Mail log mode (`SALDO_MAIL_LOG`) writes codes to the log | accepted: development only, warned at start |

## Browser
| Item | Result |
|---|---|
| CSRF: `http.CrossOriginProtection` on every unsafe request (logout and the bank callback included), with the public URL as trusted origin; JSON content type required. Behind Cloudflared the Host header is the public host and browsers send `Sec-Fetch-Site`; the installed PWA is same-origin | ok; `TestCrossOriginPostIsRefused` |
| CSP: built `dist/index.html` loads only `/theme-init.js`, `/assets/*.js` and `.css`, fonts from `/assets`; no inline script, no other origin. Matches `default-src 'self'` | ok; `style-src 'unsafe-inline'` accepted (React style attributes) |
| Other headers: `nosniff`, `X-Frame-Options DENY`, `frame-ancestors 'none'`, `Referrer-Policy same-origin`, COOP, Permissions-Policy | ok |
| HSTS | fixed: `max-age=31536000` with an https `public_url`; `includeSubDomains` left out (other services on the domain). `TestHSTS` |
| Cache: API and `/healthz` `no-store`; `index.html`, `sw.js`, manifest `no-cache`; hashed assets immutable; the service worker never caches `/api` | ok |
| XSS sinks: no `dangerouslySetInnerHTML`, `innerHTML` or `eval` in the web app; mails use `html/template` | ok |
| Open redirect via `?terug=` | fixed (hardening): a backslash is refused, as browsers read it as a slash; React Router already refused to leave the origin. Test in `Inloggen.test.tsx` |
| Bank code and `state` travel in the URL of the return page, and in `?terug=` when the user returns signed out | accepted: the query is never logged, `Referrer-Policy same-origin`, the page clears its URL, the state works once, for that viewer only, for 15 minutes |

## Bank link
| Item | Result |
|---|---|
| `state`: 32 random bytes, kept hashed in memory, bound to viewer and connection, 15 minutes, spent by any attempt, compared in constant time, one generic answer | ok; `TestBankCallbackRejectsStates`. A restart loses pending consents (accepted) |
| Private key and session id sealed with AES-256-GCM, key file `0600` in a `0700` folder apart from the database; never returned, never logged; provider errors carry only a status and a code | ok; leak checks in `bank_test.go` |
| Lost `secret.key` (database restored without it) | fixed: linking asks to store the key again instead of answering 500; the sync marks the connection `credentials`. `TestBankLinkWithUnreadableKey` |
| Two users linking the same new IBAN at once | fixed (defensive): the insert is conflict-safe and yields the `exists` skip. `BEGIN IMMEDIATE` already serialised the two transactions, so the 500 was not reachable in practice. `TestConcurrentLinkSameIBAN` |
| SSRF: the only outbound hosts are the fixed Enable Banking API and the configured SMTP server; the redirect URL comes from `public_url` (demo mode: the request's host, sent only to the fake bank) | ok |
| The detached 5-minute context of link and sync | ok: it starts only after a valid state (callback) or the 15-minute cooldown (sync); link is limited to 10 per user per hour |
| Logs: no full IBANs (only counts and connection ids), no amounts | ok |

## Server and operation
| Item | Result |
|---|---|
| Request bodies at most 64 KiB, unknown fields refused; provider answers read up to 32 MiB | ok |
| Timeouts: `ReadHeaderTimeout` 10 s, `ReadTimeout` 30 s, `WriteTimeout` 60 s (bank calls extend their own), `IdleTimeout` 120 s; SMTP 30 s; Enable Banking 60 s | ok |
| SMTP: STARTTLS or TLS only, certificate checked (`ServerName`, TLS 1.2+); subjects Q-encoded, addresses parsed, names without control characters | ok |
| Dockerfile: multi-stage, static binary, `ca-certificates` and `tzdata` only, healthcheck | ok. Runs as root: accepted for a Home Assistant add-on (`/data` is root-owned, the Supervisor sandboxes the container); 1.0-2. `alpine:3` not pinned by digest: 1.0-2 |
| CI: actions pinned by commit, `persist-credentials: false`, read-only token, gitleaks on the full history | ok. The gitleaks download has no checksum check: 1.0-2 |
| `govulncheck ./...` | fixed: 14 standard-library findings in Go 1.27.0 (`net/http`, `html/template`, `crypto/tls`, `crypto/x509`, ...); `go.mod` now asks for toolchain 1.27.3, then 0 findings |
| `npm audit --omit=dev` | ok: 0 vulnerabilities. This is the blocking CI check: it covers what ships (React, the router, the fonts) |
| UI libraries of the Planning screens (0.8-5a): `react-aria-components` 1.22 and `@internationalized/date` (Apache-2.0, shipped), `tailwindcss` 4.3 + `@tailwindcss/vite` + `@react-aria/optimize-locales-plugin` (build only); components copied from Untitled UI React and Kokonut UI (MIT), see [third-party-ui.md](third-party-ui.md) | ok: `npm audit --omit=dev` 0 vulnerabilities on 18 Nov 2026 (the build-only locales plugin joins the known `picomatch` chain below through `unplugin`); CSP unchanged (React Aria positions popovers with inline `style` attributes, covered by `style-src 'unsafe-inline'`; no inline script) |
| `npm audit` (all dependencies) | warns only, see "Known advisories in build and test tools" below |
| Audit log has no screen yet | 1.0-2 (planned with Instellingen) |

## Known advisories in build and test tools
**Warning.** `npm audit` of all dependencies currently reports one high advisory that CI does not block on: `picomatch` ReDoS (GHSA-fc5q-39xc-vjpf, CVSS 7.5, availability only), reached through `vite`, `vitest`, `tinyglobby` and `fdir`. Found 17 Nov 2026 while releasing 0.6.0.
- **No patched version exists.** The advisory covers every `picomatch` version up to 4.0.7, the newest. Older versions are worse (they also hit GHSA-c2c7-rcm5-vvqj), so downgrading does not help; checked with `overrides` in a scratch copy.
- **It does not ship.** `picomatch` is installed only in the `web` stage of the Dockerfile (`node:26-alpine`) while `npm run build` runs on the build machine. The final image is `alpine:3` with the Go binary and `web/dist` only: no Node.js, no `node_modules`, and the built JavaScript does not contain `picomatch`.
- **Why the risk is small.** An attacker would have to control a glob pattern given to `picomatch`. Here the patterns are in our own build and test configuration; no user input or bank data reaches it. The worst case is a hung build or test run.
- **How CI treats it.** The blocking step is `npm audit --omit=dev --audit-level=high` (what ships). A second step runs the full `npm audit` and only warns. A new high advisory in a shipped dependency still stops the release.
- **To undo.** When `picomatch` publishes a patched version and `package-lock.json` has it, make the full `npm audit --audit-level=high` blocking again (one step in `.github/workflows/ci.yml`). Check this in 1.0-2 at the latest.

## Needs the user
1. Cloudflared route to the add-on and `public_url` set to the https address (`saldo/DOCS.md`, "Public access").
2. Home Assistant backups encrypted, and a restore test of the empty add-on from such a backup.
3. On the real domain: the cookie is `Secure`, `Strict-Transport-Security` is sent, an external TLS and headers check passes, plain http redirects to https.
4. The redirect URL `<public_url>/bankkoppelingen/terug` registered in the Enable Banking application.
5. SMTP through an account with its own two-step sign-in (risk 6).

## Go / no-go for the first real bank link
**Go**, once these are closed:
- the fixes of this phase are merged and running on the add-on (a build from Go 1.27.3 or later);
- items 1 to 4 of "Needs the user" are done and checked on the real domain.

Nothing found in this review blocks real data after that. The items marked 1.0-2 do not expose data in the household setup Saldo targets; they wait for the full review before 1.0.
