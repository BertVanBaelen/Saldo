# Version 0.6 · Shared accounts

**After this version you can** share the joint account with Partner: she links it with her own bank login and joins it, each of you sees only your own accounts, transfers between your own accounts no longer count as income or expenses, the Alles · Persoonlijk · Gedeeld switch filters every list, and you see both contributions arrive.

Status: released as 0.6.0 (17 Nov 2026), verifying on the live add-on. Built on branch `v0.6-shared-accounts` (16 Nov 2026). Analysis milestone: M3. Roadmap: [../README.md](../README.md).

## Features
| Id | Feature |
|---|---|
| SHARE-1 | Join a shared account by IBAN; manager and members with Lezen or Bewerken |
| SHARE-2 | Fallback bank sources, leave, manager hand-over, remove a link, delete a user |
| SHARE-3 | Privacy: every figure comes from your own accounts only (tested on every endpoint) |
| SHARE-4 | Internal transfers left out, transfers to savings shown as saved, "is / is not a transfer" [S] |
| SHARE-5 | Scope switch Alles · Persoonlijk · Gedeeld as a filter, sums as information only |
| SHARE-6 | Contributions to the shared account |

## Phases
0.6-1 was split into four gated slices on 16 Nov 2026 (it was one L). The roadmap text predates 0.3 to 0.5: part of the work already exists (see "What exists" in each file), so every phase starts by checking the code and builds only what is missing. Slices run one after the other; each ends with the lead's full gate and one commit on the branch (no push).

| Phase | Title | Size | Status |
|---|---|---|---|
| [0.6-0](00-sync-diagnostics.md) | Sync diagnostics for the account that never syncs | S | built, to verify |
| [0.6-1a](01-membership-and-lifecycle.md#1a-join) | Join an existing account | M | built, to verify |
| [0.6-1b](01-membership-and-lifecycle.md#1b-members-and-permissions) | Members and permissions | M | built, to verify |
| [0.6-1c](01-membership-and-lifecycle.md#1c-lifecycle) | Lifecycle: leave, hand-over, delete, delete a user | M | built, to verify |
| [0.6-1d](01-membership-and-lifecycle.md#1d-primary-and-fallback-sources) | Primary and fallback sources | M | built, to verify (fallback behaviour with real data) |
| [0.6-1e](01-membership-and-lifecycle.md#1e-say-what-a-new-consent-left-out) | Say at link time which accounts a new consent left out | S | built, to verify |
| [0.6-2](02-privacy.md) | Privacy suite for every endpoint | M | built, to verify |
| [0.6-3](03-transfers-and-saved.md) | Transfer detection and saved | M | built, to verify |
| [0.6-4](04-scope-and-sums.md) | Scope filter and sums | S | built, to verify |
| [0.6-5](05-contributions.md) | Contributions | S | built, to verify |

## Decisions (16 Nov 2026)
1. **Everything in slices, commit per slice, no push** (user). Nothing goes to main or a release without the user's word.
2. **Fallback fetches only while the primary is stopped** (user): the fallback source is fetched when the primary consent has lapsed or its sync failed, and fills the gap; while the primary works it is not called. Marked "to verify with real data": nobody knows yet whether two holders' consents give the same entry reference for one booking.
3. **Join is bound to a consent.** Linking an IBAN that already exists records a join offer for that consent; the join call names the offer, never an account id, and nothing about the account is revealed before (only the masked IBAN).
4. **Invariant:** every account has at least one member and exactly one manager. Every lifecycle test asserts it. `account_access` cascades on user delete, so leave, hand-over and delete-user do their cleanup explicitly in one transaction.
5. **Last member cannot "leave"**: they delete the account (a clear warning) or remove their link keeping history.
6. **Two-user checks:** the demo only acts as Bert. A demo-only way to act as Partner is added (ignored outside demo mode, tested), and `saldo-demo` in `.claude/launch.json` drops `-Fresh`.
7. **The live sync bug is explained** (user, 16 Nov 2026): the consent at the bank listed only one of the two accounts, so Saldo never got the other; with both selected it works. 0.5.1 already marks such an account `not_shared`; 0.6-0 keeps the per-account sync report; 0.6-1e will say at link time which known accounts a new consent left out. No 0.5.2 patch is needed.

## Concepts
shared-account, user-and-visibility, internal-transfer, scope, account, bank-connection, notification (member joined, in-app only until 0.9).

## Process
- **Briefs are self-contained.** Subagents do not inherit skills: each brief says to load the `ponytail` skill and to query the graph (`python -m graphify query "<symbol>"`, symbol names, not sentences) before reading files.
- **Models:** the server side of join, lifecycle and sources, and the privacy review go to a stronger model (Opus); web halves and mechanical work to Sonnet. The privacy reviewer gets the code and the rule, not the implementer's summary.
- Subagents run unit tests only (`cd server && go test ./internal/<pkg>/...`, `cd web && npx vitest run <files>`, `npx tsc -b --noEmit`), no dev server, no browser, no git writes.
- **Lead's gate per slice:** `go test -count=1 ./...` (no `-race`: no gcc here; CI runs it), `go vet`, `gofmt -l`, `npm run typecheck`, `npm test`, `npm run build`, then the demo (`preview_start saldo-demo`) as Bert and as Partner, light and dark, 375 px, and each new migration on a database made by the previous release binary (keep a `v0.5.1` build in the scratchpad). Then one commit.
- Files edited with Python must keep LF (`newline=''`), or use the Edit tool.

## Exit criteria
Partner links the shared account, joins it, and sees only her own accounts; the privacy suite passes on every endpoint.
