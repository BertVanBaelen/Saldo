# Graph Report - Saldo  (2026-11-16)

## Corpus Check
- 405 files · ~479,263 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 46 file(s) not represented in the graph (top: .css 29, .csv 10, (none) 6)

## Summary
- 4341 nodes · 13631 edges · 147 communities (126 shown, 21 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 1828 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Go Server Core & Ledger Tests
- Web API Types & Tests
- HTTP Server Handlers & Routes
- Web Shell, Icons & Settings Screens
- Web Accounts & Formatting Screens
- Bank Test Harness & Helpers
- Web Category Editors & Transaction Detail
- Bilance Import Plan (v0.5)
- Mockup Transacties Screen
- Server Domain Types & Alerts
- Mockup Categorieen Screen
- Shared Accounts & Planning Concepts
- Bank Sync & Foundation Plan
- Mockup Import Wizard
- Web Import Wizard
- Rules, Plan & DB Queries
- Web Auth, Context & Backfill UI
- Category & Rule Creation Logic
- Mockup Rekeningen Screen
- Categorisation Plan (v0.4)
- Mockup Rekening Detail Screen
- Mockup Plan (v0.1)
- Mockup Instellingen Screen
- SQL Schema (0001_init)
- Mockup Bankkoppelingen Screen
- Mockup Sign-in Screen
- Auth Tokens & Login Flow
- Bank Provider Interface & Sessions
- Transaction Import & Storage
- Mockup Planning Screen
- Release Workflow (GitHub Actions)
- Foundation Plan (v0.2)
- Auth Integration Tests
- CI Workflow (GitHub Actions)
- Sync Service & Scheduler Tests
- CSV Fixtures & Import Wizard Docs
- Notifications Plan (v0.9) & Design System
- E-mail Template System (Mockup)
- Mockup Overzicht Screen
- Notify Service & Tests
- Transfers, Budget & Privacy Concepts
- Add-on config.yaml
- DB Migrate, Open & Seed
- API Docs: Import & Suggestions
- Mockup Screen Module
- Import Preview & Rule Application
- Notification & Planning Design Spec
- Add-on Translations (set 1)
- Add-on Translations (set 2)
- Enable Banking Client
- Import Wizard & Category Origin Screens
- Importer Parser Tests
- Web Transacties Screen
- Enable Banking Client Tests
- Mockup Start Screen
- Data Model & Import Concepts
- Import Rule Tests
- Investments Plan (v2.0)
- Add-on Docs & Changelog
- Release Plan (v1.0), Roles & Security
- E-mail Templates & Notification Toggles
- Forecast Charts & Scope Switch
- web tsconfig.app.json
- Transfer Detection & Forecast Method
- web package.json Dev Dependencies
- Web README & PWA Meta
- Auth & Security Baseline
- Demo Mode, Privacy & Bank Link
- Categorising Transactions API & Sheet
- Import Field Parsing
- web tsconfig.node.json
- Forecast & Budget Engine
- Bank Alert E-mails
- Privacy Test Suite
- Bank Sync Requirements & Accounts
- Demo Story & Fake Bank
- Bank Connection Linking
- Transaction Query & Cursor
- Colour Tokens & Phone Screens
- Accounts API & Buffer Design
- Brand Mark & Icon Assets
- CHANGELOG & Release Notes
- Buffer States & Chart Helpers
- Trusted Devices & Notification Types
- Notification & E-mail Design Options
- Mockup Shell Navigation
- Import Upload & Category Plan
- Roadmap & Decision Log
- Shared Account Roles & Permissions
- Rule Matching Engine
- Mockup Meldingen Screen
- Server Security Review Scope
- Architecture & Repo Layout
- Rules & Categories API
- Fake Bank Story Data
- Mailer & Message Sending
- Month Formula & Free-to-Spend
- Import Column Mapping
- web Dependencies & main.tsx
- Vite Config & Service Worker Plugin
- Design: App Icon & Navigation
- CSV Table Reading
- Server README & Config
- Period Charts & Pickers
- Category Editor Screens
- Design Canvas & Boards
- Planning Calendar Design
- Dependabot Config
- Account Access & Import Undo
- E-mail Layout Templates
- Icon Rendering Script
- Ledger Plan & Apply Tests
- Spikes, Risks & Security Requirements
- Shared vs Personal Account Design
- Admin Role & Privacy Rules
- Account Settings & Buffer Design
- Mockup Data Module
- Release 1.0.0 & Translations
- Contribution Split & Category Breakdown
- Preferences & Display Settings
- Mockup Meer Screen
- Category Backfill
- web npm Scripts
- Demo States & Conventions
- Scheduler
- Minor: repository.yaml
- Minor: GET /api/me and preferences (scope, them
- Minor: Mockup page bootstrap pattern (shared sh
- Minor: tsconfig.json
- Minor: Accounts and data sources (bank API vs m
- Minor: Open decision: Handelaar or Titel as the
- Minor: Icon set (24 grid stroke SVG)
- Minor: Motion (reduced under prefers-reduced-mo
- Minor: Reliability and data volume (SQLite, col
- Minor: Meldingen icoon (status bar icon)
- Minor: Saldo app-icoon
- Minor: Look-ahead setting: 1, 3 or 6 months
- Minor: Stille uren 22:00 to 07:00
- Minor: Stuur een testmelding
- Minor: github.com/BertVanBaelen/Saldo/server
- Minor: Account lifecycle: leave, hand-over, del

## God Nodes (most connected - your core abstractions)
1. `Icon()` - 134 edges
2. `Server` - 106 edges
3. `expectError()` - 62 edges
4. `Invalid()` - 57 edges
5. `viewerOf()` - 56 edges
6. `delay()` - 56 edges
7. `errorMessage()` - 56 edges
8. `useApp()` - 55 edges
9. `writeJSON()` - 54 edges
10. `decode()` - 54 edges

## Surprising Connections (you probably didn't know these)
- `Decision: accounts are independent` --semantically_similar_to--> `Accounts are independent (unit of every verdict)`  [INFERRED] [semantically similar]
  README.md → analysis/concepts/scope.md
- `Decision: trusted devices with new-device push and email` --semantically_similar_to--> `Trusted devices (hashed token cookie, 90 days)`  [INFERRED] [semantically similar]
  README.md → analysis/concepts/authentication.md
- `States: yellow in the buffer, red below zero` --semantically_similar_to--> `States (ok green, in the buffer ochre, below zero red)`  [INFERRED] [semantically similar]
  analysis.md → analysis/concepts/buffer-and-states.md
- `Decision: sums as information only` --semantically_similar_to--> `Sums as information, never a verdict`  [INFERRED] [semantically similar]
  README.md → analysis/concepts/scope.md
- `Forecast calculation per month and per current account` --semantically_similar_to--> `Month formula projected_end and left_or_short`  [INFERRED] [semantically similar]
  analysis.md → analysis/concepts/forecast.md

## Import Cycles
- 2-file cycle: `server/internal/demo/demo.go -> server/internal/ledger/ledger_test.go -> server/internal/demo/demo.go`
- 2-file cycle: `server/internal/ledger/fetch_test.go -> server/internal/ledger/ledger_test.go -> server/internal/ledger/fetch_test.go`
- 2-file cycle: `server/internal/demo/sync.go -> server/internal/ledger/ledger_test.go -> server/internal/demo/sync.go`
- 3-file cycle: `server/internal/demo/demo.go -> server/internal/ledger/fetch_test.go -> server/internal/ledger/ledger_test.go -> server/internal/demo/demo.go`
- 3-file cycle: `server/internal/demo/sync.go -> server/internal/ledger/fetch_test.go -> server/internal/ledger/ledger_test.go -> server/internal/demo/sync.go`
- 3-file cycle: `server/internal/banklink/banklink.go -> server/internal/ledger/ledger_test.go -> server/internal/demo/sync.go -> server/internal/banklink/banklink.go`
- 3-file cycle: `server/internal/banklink/sync.go -> server/internal/ledger/ledger_test.go -> server/internal/demo/sync.go -> server/internal/banklink/sync.go`
- 4-file cycle: `server/internal/banklink/banklink.go -> server/internal/ledger/fetch_test.go -> server/internal/ledger/ledger_test.go -> server/internal/demo/sync.go -> server/internal/banklink/banklink.go`
- 4-file cycle: `server/internal/banklink/sync.go -> server/internal/ledger/fetch_test.go -> server/internal/ledger/ledger_test.go -> server/internal/demo/sync.go -> server/internal/banklink/sync.go`

## Hyperedges (group relationships)
- **Per-account verdict model (independent accounts, buffer, states, forecast, free to spend, sums as info)** — analysis_concepts_scope_accounts_independent, analysis_concepts_buffer_and_states_buffer, analysis_concepts_buffer_and_states_states, analysis_concepts_forecast_month_formula, analysis_concepts_budget_free_to_spend, analysis_concepts_scope_sums_as_information [EXTRACTED 1.00]
- **Bilance import pipeline (wizard, category mapping, overlap and duplicates, undo, learned suggestions, backfill)** — analysis_concepts_import_wizard_steps, analysis_concepts_import_category_mapping, analysis_concepts_import_overlap_and_duplicates, analysis_concepts_import_undo, analysis_concepts_categorisation_rule_suggestions, analysis_concepts_categorisation_rule_backfill [EXTRACTED 1.00]
- **Sign-in and device security (sign-in flow, trusted devices, new-device notice, secrets encryption)** — analysis_concepts_authentication_sign_in_flow, analysis_concepts_authentication_trusted_devices, analysis_concepts_authentication_new_device_notification, analysis_concepts_authentication_secrets_encryption, analysis_concepts_authentication_no_self_registration [EXTRACTED 1.00]
- **Import wizard flow from file to undo** — analysis_screens_importeren_wizard_steps, analysis_screens_importeren_category_mapping_table, analysis_screens_importeren_cutoff, analysis_screens_importeren_probable_duplicates, analysis_screens_importeren_import_undo [EXTRACTED 1.00]
- **Category choice precedence: manual, rule, suggestion** — analysis_concepts_transaction_category_origin, analysis_screens_categorieen_rule_priority_order, analysis_screens_categorieen_rules_tab, analysis_screens_categorieen_suggestions_tab [INFERRED 0.85]
- **Desktop boards sharing one sidebar and token set** — design_project_desktop_start_dc, design_project_desktop_overzicht_dc, design_project_desktop_planning_dc, design_project_desktop_rekeningen_dc, design_project_desktop_start_dc_sidebar [INFERRED 0.95]
- **Phone screens sharing the five-tab bottom navigation** — design_project_telefoon_start_dc, design_project_telefoon_transacties_dc, design_project_telefoon_overzicht_dc, design_project_telefoon_planning_dc, design_project_telefoon_meer_dc, design_project_telefoon_meldingen_dc, design_project_telefoon_rekeningen_dc [EXTRACTED 1.00]
- **Bilance import flow from wizard to learned suggestions** — docs_api_csv_import, docs_api_bilance_preset, docs_api_category_mapping, docs_api_overlap_and_duplicates, docs_api_import_undo, docs_api_suggestion_backfill, docs_local_testing_bilance_import_test [INFERRED 0.95]
- **Notification channels: push panel, e-mail templates, settings and alerts API** — design_project_telefoon_meldingen_dc_notification_kinds, design_project_meldingen_android_dc_notification_panel, design_project_e_mail_berichten_dc_email_style, docs_api_alerts_endpoint, docs_api_bank_alert_emails, design_project_meldingen_icoon_dc_notification_icon [INFERRED 0.85]
- **Bank consent expiry e-mail flow (14-day reminder, 3-day reminder, sync stopped)** — finance_mockup_emails_koppeling_14_dagen_html_template, finance_mockup_emails_koppeling_3_dagen_html_template, finance_mockup_emails_sync_gestopt_html_template, finance_mockup_emails_koppeling_14_dagen_bank_consent_expiry [INFERRED 0.85]
- **Mandatory account-access e-mails (login code, new device, password link, invitation)** — finance_mockup_emails_inlogcode_html_template, finance_mockup_emails_nieuw_toestel_html_template, finance_mockup_emails_nieuw_wachtwoord_html_template, finance_mockup_emails_uitnodiging_html_template, finance_mockup_emails_inlogcode_mandatory_emails [EXTRACTED 1.00]
- **Planning alert e-mails (red balance and buffer warning)** — finance_mockup_emails_planning_rood_html_template, finance_mockup_emails_planning_buffer_html_template, finance_mockup_emails_planning_rood_planning_forecast, finance_mockup_emails_planning_buffer_account_buffer [INFERRED 0.85]
- **Bilance import wizard flow (Bestand to Klaar and undo)** — fixtures_csv_readme_step_bestand, fixtures_csv_readme_step_kolommen, fixtures_csv_readme_step_categorieen, fixtures_csv_readme_step_controle, fixtures_csv_readme_step_klaar, fixtures_csv_readme_step_ongedaan_maken [EXTRACTED 1.00]
- **Generic CSV import test fixtures (Argenta header set)** — fixtures_csv_readme_valid_csv, fixtures_csv_readme_overlap_csv, fixtures_csv_readme_other_account_csv, fixtures_csv_readme_non_euro_csv, fixtures_csv_readme_malformed_csv, fixtures_csv_readme_several_accounts_csv, fixtures_csv_readme_large_csv [EXTRACTED 1.00]
- **Mockup decisions of 3 Nov 2026 (0.1-6)** — plan_v0_1_mockup_06_decisions_in_the_mockup_accounts_are_independent, plan_v0_1_mockup_06_decisions_in_the_mockup_sums_as_information, plan_v0_1_mockup_06_decisions_in_the_mockup_new_device_notification_type, plan_v0_1_mockup_06_decisions_in_the_mockup_demo_story, plan_v0_1_mockup_06_decisions_in_the_mockup_mockup_demo_states [EXTRACTED 1.00]
- **Automatic category writers that go through categorise.Assign** — plan_v0_4_categorisation_02_rules_engine_assign_write_path, plan_v0_4_categorisation_03_categorise_in_transacties_plan_apply, plan_v0_4_categorisation_04_categories_and_rules_screen_suggestions_on_read, plan_v0_5_bilance_import_04_overlap_and_duplicates_category_takeover [EXTRACTED 1.00]
- **Layers that keep synced and imported history from double counting** — plan_v0_3_bank_sync_01_sync_engine_dedupe_key, plan_v0_3_bank_sync_06_csv_import_exact_duplicate_rule, plan_v0_3_bank_sync_06_csv_import_overlap_warning, plan_v0_5_bilance_import_04_overlap_and_duplicates_fuzzy_rule, plan_v0_5_bilance_import_04_overlap_and_duplicates_cutoff [INFERRED 0.85]
- **Bilance import flow from export layout to undo** — plan_v0_5_bilance_import_01_spike_bilance_csv_bilance_export_layout, plan_v0_5_bilance_import_02_import_wizard_bilance_preset, plan_v0_5_bilance_import_03_category_mapping_wizard_categories_step, plan_v0_5_bilance_import_04_overlap_and_duplicates_duplicates_side_by_side, plan_v0_5_bilance_import_05_batches_and_undo_undo [INFERRED 0.85]
- **Demo story numbers reproduced by reports, forecast and free-to-spend tests** — plan_v0_7_overview_01_reports_api_demo_story, plan_v0_8_planning_04_forecast_engine_demo_forecast_numbers, plan_v0_8_planning_05_free_to_spend_demo_numbers [INFERRED 0.85]
- **Internal transfers left out at query time of every sum** — plan_v0_6_shared_accounts_03_transfers_and_saved_transfer_detection, plan_v0_6_shared_accounts_04_scope_and_sums_sums_info_only, plan_v0_7_overview_01_reports_api_period_totals, plan_v0_8_planning_04_forecast_engine_month_projection [INFERRED 0.85]
- **Notification delivery: triggers, log, e-mail templates and web push** — plan_v0_9_notifications_03_triggers_and_scheduler_notification_triggers, plan_v0_9_notifications_03_triggers_and_scheduler_notification_log, plan_v0_9_notifications_01_email_templates_email_templates, plan_v0_9_notifications_02_web_push_push_subscription [INFERRED 0.85]
- **Multipart e-mail rendering (HTML plus plain text) for NOTIF-1** — server_internal_mail_templates_layout_html_html_email_layout, server_internal_mail_templates_layout_text_text_email_layout, server_readme_internal_mail, plan_v0_9_notifications_readme_notif_1 [INFERRED 0.85]
- **Release 1.0 phases: export, security review, backup and restore, release** — plan_v1_0_release_01_export, plan_v1_0_release_02_security_review, plan_v1_0_release_03_backup_and_restore, plan_v1_0_release_04_release [EXTRACTED 1.00]
- **Encrypted backup, secret key and restore recovery** — saldo_docs_encrypted_backups, saldo_docs_secret_key, plan_v1_0_release_03_backup_and_restore_restore_test, plan_v1_0_release_03_backup_and_restore_recovery_steps [INFERRED 0.85]
- **Saldo PWA and web icon set** — web_public_icons_apple_touch_icon, web_public_icons_icon_192, web_public_icons_icon_512, web_public_icons_icon_maskable_512, web_public_favicon [INFERRED 0.85]
- **Saldo brand mark variants in the finance mockup** — finance_mockup_img_app_icon, finance_mockup_img_app_icon_round, finance_mockup_img_favicon, finance_mockup_img_statusbar_icon, finance_mockup_emails_img_logo [INFERRED 0.85]

## Communities (147 total, 21 thin omitted)

### Community 0 - "Go Server Core & Ledger Tests"
Cohesion: 0.06
Nodes (69): InvalidError, Default, Sub, Target, Config, options, SMTP, account (+61 more)

### Community 1 - "Web API Types & Tests"
Cohesion: 0.03
Nodes (120): @testing-library/react, vitest, AppContextValue, SYNC_MAX_MS, SYNC_POLL_MS, Api, ApiError, browser (+112 more)

### Community 2 - "HTTP Server Handlers & Routes"
Cohesion: 0.06
Nodes (50): TokenInfo, window, importLimits, Store, New(), DeviceName(), ReadUpload(), TestReadUpload() (+42 more)

### Community 3 - "Web Shell, Icons & Settings Screens"
Cohesion: 0.06
Nodes (112): react-router-dom, useApp(), AppRoutes(), Boot, NAV, NavItem, navItem(), ScreenId (+104 more)

### Community 4 - "Web Accounts & Formatting Screens"
Cohesion: 0.07
Nodes (100): RFC-3339, Sheet(), Skel(), accColour(), accountIcon(), accountState(), COLOURS, inScope() (+92 more)

### Community 5 - "Bank Test Harness & Helpers"
Cohesion: 0.06
Nodes (104): formPart, TestDeviceName(), TestDateRange(), TestDeterministic(), TestRecentRows(), TestSessionsAndAccounts(), SeedDefaults(), TestCategoryIconsMatchTheWeb() (+96 more)

### Community 6 - "Web Category Editors & Transaction Detail"
Cohesion: 0.05
Nodes (84): react-dom, IconProps, paths, IconPicker(), Props, Select(), SelectOption, SelectProps (+76 more)

### Community 7 - "Bilance Import Plan (v0.5)"
Cohesion: 0.04
Nodes (81): Importeren (wizard), Enable Banking application id and private key (PEM, encrypted), Empty state (leeg) with three setup steps, Saldo API contract (version 0.2 doc), Saldo architecture doc, Local testing guide, Bilance export layout (invented values), Import cutoff (afkapdatum) (+73 more)

### Community 8 - "Mockup Transacties Screen"
Cohesion: 0.07
Nodes (77): accLabel(), accountsInScope(), applyCustom(), applyHash(), applyOpt(), avatar(), bindDd(), bindDetail() (+69 more)

### Community 9 - "Server Domain Types & Alerts"
Cohesion: 0.04
Nodes (44): Syncer, Alert, source, layout, tone, due, owner, callbackBody (+36 more)

### Community 10 - "Mockup Categorieen Screen"
Cohesion: 0.07
Nodes (70): esc(), anim(), announce(), applyRoute(), cancel(), catChip(), catEditor(), catOptions() (+62 more)

### Community 11 - "Shared Accounts & Planning Concepts"
Cohesion: 0.08
Nodes (71): Analysis document v1.2, Budget and free to spend concept, Buffer and states concept, Rule and learning (categorisation) concept, Category concept, Forecast concept, Import batch (CSV, Bilance) concept, Internal transfer and saved concept (+63 more)

### Community 12 - "Bank Sync & Foundation Plan"
Cohesion: 0.04
Nodes (70): Account concept, Bank connection, consent and sync concept, Bank koppelen (wizard), Rekeningen and account detail, Partner (second user), PLAT-1 Verified bank API facts (spike S1), Review with Partner on the real app, 0.2-1 Spike S1 Enable Banking (+62 more)

### Community 13 - "Mockup Import Wizard"
Cohesion: 0.08
Nodes (72): accName(), accountOptions(), accPill(), actionBar(), afterCount(), anim(), badge(), batchCard() (+64 more)

### Community 14 - "Web Import Wizard"
Cohesion: 0.06
Nodes (70): blank(), buildChoices(), CategoryChoice, CategoryRef, columnsOf(), CutoffSuggestion, defaultPick(), doubled() (+62 more)

### Community 15 - "Rules, Plan & DB Queries"
Cohesion: 0.06
Nodes (41): execer, Result, BackfillInput, BackfillResult, execer, Removed, Similar, SimilarResult (+33 more)

### Community 16 - "Web Auth, Context & Backfill UI"
Cohesion: 0.07
Nodes (56): react, App(), AppContext, applyTheme(), AppProvider(), isOnline(), syncMessage(), Toast (+48 more)

### Community 17 - "Category & Rule Creation Logic"
Cohesion: 0.07
Nodes (41): AccountPatch, CategoryInput, NewAccount, Opt, RuleInput, RulePreviewInput, SavedMapping, stored (+33 more)

### Community 18 - "Mockup Rekeningen Screen"
Cohesion: 0.08
Nodes (53): account(), addChooser(), addForm(), addSave(), anim(), avatar(), bufferCard(), bufferField() (+45 more)

### Community 19 - "Categorisation Plan (v0.4)"
Cohesion: 0.05
Nodes (52): Pending to booked handling, pending rows excluded from totals, Transaction detail sheet or panel (read-only until 0.4), Import endpoints (preview, import, history) with hourly limits, 0.4-1 Category tree, Categories API (GET, POST, PATCH, DELETE with moveTo), Category icons (CAT-6, migration 0007, CategoryIcons list mirrored in the web), Shared two-level category tree (categories table, sub inherits parent type and colour), Category removal re-points everything in one database transaction (the merge) (+44 more)

### Community 20 - "Mockup Rekening Detail Screen"
Cohesion: 0.09
Nodes (57): alertRow(), anim(), bankDays(), buildHistory(), cardHead(), catLook(), chartSvg(), closeDialog() (+49 more)

### Community 21 - "Mockup Plan (v0.1)"
Cohesion: 0.06
Nodes (47): App shell and navigation concept, Demo data concept, Meer, inloggen.html (Inloggen sign-in page), instellingen.html (Instellingen settings page), meer.html (Meer menu page), meldingen.html (Meldingen preferences page), overzicht.html (Overzicht period overview page) (+39 more)

### Community 22 - "Mockup Instellingen Screen"
Cohesion: 0.09
Nodes (56): anim(), appIdField(), applySub(), bank(), bankSetup(), bankStatus(), bankTest(), checkItem() (+48 more)

### Community 23 - "SQL Schema (0001_init)"
Cohesion: 0.07
Nodes (50): account_access, account_access_user, account_sources, account_sources_connection, accounts, accounts_bank_iban, accounts_iban, app_settings (+42 more)

### Community 24 - "Mockup Bankkoppelingen Screen"
Cohesion: 0.12
Nodes (51): accIcon(), acct(), btn(), chip(), closeRemove(), connSummary(), ctx(), empty() (+43 more)

### Community 25 - "Mockup Sign-in Screen"
Cohesion: 0.11
Nodes (50): afterFill(), alertBox(), badge(), busy(), checkCode(), codeAlert(), digitEls(), digits() (+42 more)

### Community 26 - "Auth Tokens & Login Flow"
Cohesion: 0.06
Nodes (27): Device, Invitation, Login, queryer, Session, tokenRow, pendingState, states (+19 more)

### Community 27 - "Bank Provider Interface & Sessions"
Cohesion: 0.08
Nodes (26): source, accountResource, Provider, fetch, Account, Balance, Provider, Session (+18 more)

### Community 28 - "Transaction Import & Storage"
Cohesion: 0.09
Nodes (44): ImportRow, NewTransaction, pendingRow, resolved, storedRow, categoriseHistory(), insertAccount(), nullIfEmpty() (+36 more)

### Community 29 - "Mockup Planning Screen"
Cohesion: 0.12
Nodes (43): accPill(), addPlanned(), bind(), breakdown(), budget(), buds(), bufLabel(), chartHeight() (+35 more)

### Community 30 - "Release Workflow (GitHub Actions)"
Cohesion: 0.05
Nodes (43): concurrency, cancel-in-progress, group, GH_TOKEN, SHA, VERSION, jobs, release (+35 more)

### Community 31 - "Foundation Plan (v0.2)"
Cohesion: 0.06
Nodes (39): Money, dates and formatting concept, PLAT-2 Home Assistant add-on (Go server, SQLite, CI), Toolchain note (no Node, Go or Python on the dev machine), 0.2-2 Repository, add-on and CI, CI on every push (vet, test, typecheck, lint, build, migration check, secret scan), Cold backup support (add-on stops while HA backs up), Go server with modernc.org/sqlite and embedded SQL migrations, Money as int64 cents, Europe/Brussels month boundaries (+31 more)

### Community 32 - "Auth Integration Tests"
Cohesion: 0.08
Nodes (24): call, env, bankEnv, keyChunk(), TestBankCredentials(), TestConcurrentLinkSameIBAN(), TestDeviceCookieSecureBehindProxy(), TestTokensNotLogged() (+16 more)

### Community 33 - "CI Workflow (GitHub Actions)"
Cohesion: 0.06
Nodes (39): run, runs-on, steps, jobs, image, secrets, server, web (+31 more)

### Community 34 - "Sync Service & Scheduler Tests"
Cohesion: 0.07
Nodes (26): Opener, scriptBank, syncEnv, Service, New(), TestStoreConsentKeepsARemovedLinkRemoved(), at(), newSyncEnv() (+18 more)

### Community 35 - "CSV Fixtures & Import Wizard Docs"
Cohesion: 0.07
Nodes (34): fixtures/csv README (CSV fixtures for the import wizard), Account name mapping (Naar welke rekeningen?), Argenta header set, bilance-tweede.csv (second Bilance file, reuses saved mapping), bilance-voorbeeld.csv (invented Bilance export, 28 rows), Category mapping (Voorstel, Niet categoriseren, Nieuwe categorie), Demo and test accounts (Zichtrekening, Spaarrekening, Reserve), Category origin import (not replaced by rules) (+26 more)

### Community 36 - "Notifications Plan (v0.9) & Design System"
Cohesion: 0.11
Nodes (33): Design system concept, Notification and e-mail concept, E-mails, Meldingen (notification settings), Pushmeldingen, Board to screen file mapping, 0.9-1 Remaining e-mail templates, NOTIF-1 Remaining e-mail templates (+25 more)

### Community 37 - "E-mail Template System (Mockup)"
Cohesion: 0.11
Nodes (33): Saldo runs on the user's own Home Assistant, Inlogcode e-mail (HTML template), Login code (8-digit one-time e-mail code), Inlogcode e-mail (plain-text part), Bank consent expiry (180 days), Koppeling verloopt over 14 dagen e-mail (HTML template), Koppeling 14 dagen e-mail (plain-text part), Laatste herinnering koppeling 3 dagen e-mail (HTML template) (+25 more)

### Community 38 - "Mockup Overzicht Screen"
Cohesion: 0.15
Nodes (34): accountsInner(), aggregate(), catRows(), cats(), catsFor(), change(), chartBody(), chartCard() (+26 more)

### Community 39 - "Notify Service & Tests"
Cohesion: 0.16
Nodes (31): recorder, Service, carryDB(), carryState(), TestCarryPendingToBooked(), stored(), storeFetch(), TestStoreFetch() (+23 more)

### Community 40 - "Transfers, Budget & Privacy Concepts"
Cohesion: 0.07
Nodes (28): categorise.Suggest, category_suggestions decisions table (dismissed, confirmed), Suggestion confidence levels high and low, GET /api/suggestions, Bilance history import, Risk 12 history depth for recurring items, Privacy test suite covering every endpoint, Per-viewer query-time transfer detection (+20 more)

### Community 41 - "Add-on config.yaml"
Cohesion: 0.06
Nodes (32): arch, backup, boot, description, environment, SALDO_OPTIONS_FILE, SALDO_STATE_DIR, SALDO_WEB_DIR (+24 more)

### Community 42 - "DB Migrate, Open & Seed"
Cohesion: 0.12
Nodes (31): migration, serve(), count(), openDB(), TestDefaultIcons(), TestSeedDefaults(), ValidIcon(), New() (+23 more)

### Community 43 - "API Docs: Import & Suggestions"
Cohesion: 0.11
Nodes (31): Argenta preset, Which balance: booked ITBD or CLBD, Bilance preset, categorise.Confirm, categorise.Suggest, Category mapping per user and source (0.5-3), Category taken over by an existing row, CSV import (phases 0.3-6 and 0.5-2) (+23 more)

### Community 44 - "Mockup Screen Module"
Cohesion: 0.15
Nodes (31): appIconSection(), applyMailScheme(), chart(), circle(), emailsSection(), fitFrame(), fitFrames(), glyph() (+23 more)

### Community 45 - "Import Preview & Rule Application"
Cohesion: 0.07
Nodes (10): applied, countsBody, importBody, pair, bankEnv, editableIDs(), pair, pair (+2 more)

### Community 46 - "Notification & Planning Design Spec"
Cohesion: 0.09
Nodes (29): Mail: bank link expires in 14 days, Mail: last reminder, 3 days, Mail: account goes red in February, Mail: synchronisation stopped, Category pastel palette c1..c6, Mini forecast chart in the red notification (nov to feb), Notification kinds: rood, buffer, consent, cat, Notification channels: Pushmeldingen and E-mail master switches (+21 more)

### Community 47 - "Add-on Translations (set 1)"
Cohesion: 0.07
Nodes (28): description, name, configuration, admin_recovery, log_level, public_url, smtp_from, smtp_host (+20 more)

### Community 48 - "Add-on Translations (set 2)"
Cohesion: 0.07
Nodes (28): description, name, configuration, admin_recovery, log_level, public_url, smtp_from, smtp_host (+20 more)

### Community 49 - "Enable Banking Client"
Cohesion: 0.09
Nodes (10): Client, Client, SessionInfo, New(), parseKey(), signJWT(), unwrapURL(), EnableBanking() (+2 more)

### Community 50 - "Import Wizard & Category Origin Screens"
Cohesion: 0.10
Nodes (27): Category origin (manual, rule, suggestion, import), Mark as transfer / not a transfer, Transaction note (max 200 characters), Pending to booked inheritance, Pending transaction, Transaction split over categories, Geschiedenis toepassen (backfill sheet), Read-only rule view (+19 more)

### Community 51 - "Importer Parser Tests"
Cohesion: 0.15
Nodes (23): firstOptions(), Inspect(), Parse(), check(), FuzzParse(), invalidMessage(), TestArgentaFixture(), TestArgentaPresetDelimiters() (+15 more)

### Community 52 - "Web Transacties Screen"
Cohesion: 0.12
Nodes (23): cap(), amountClass(), catView(), CatChip(), categoryOptions(), DROP_TITLE, DropKind, groupByDay() (+15 more)

### Community 53 - "Enable Banking Client Tests"
Cohesion: 0.16
Nodes (20): newTestClient(), pkcs1PEM(), pkcs8PEM(), TestCheckApplication(), TestContextCancelled(), TestCreateSession(), TestErrorsCarryNoSecrets(), TestFetchBalances() (+12 more)

### Community 54 - "Mockup Start Screen"
Cohesion: 0.17
Nodes (25): accountRow(), alert(), alerts(), contributionRow(), forecast(), forecastChart(), header(), hero() (+17 more)

### Community 55 - "Data Model & Import Concepts"
Cohesion: 0.13
Nodes (24): Categorisation requirements (rules, learning, manual wins), Apply to similar transactions and create a rule, Backfill: Geschiedenis toepassen, Learning from history (counterparty to most frequent category), Live preview and apply one rule on demand, Precedence: manual > rule > suggestion, import protected, Categorisation rules (conditions, owner, evaluation order, reordering), Learned suggestions (smoothed confidence, high or low) (+16 more)

### Community 56 - "Import Rule Tests"
Cohesion: 0.30
Nodes (24): storeFunc, coffees(), dump(), fetchWith(), TestSyncNextToAnImport(), TestSyncUnchangedWithoutImports(), count(), csvRow() (+16 more)

### Community 57 - "Investments Plan (v2.0)"
Cohesion: 0.12
Nodes (21): 2.0-1 Investment accounts, Investment account type per platform, private to its owner, Manual value updates with history, or CSV import per platform, 2.0-2 Net worth, Net worth per platform and in total over time (INV-2), 2.0-3 Price lookups, Optional price lookup by ISIN from a public price source (INV-3), Research the Saxo OpenAPI (not blocking) (+13 more)

### Community 58 - "Add-on Docs & Changelog"
Cohesion: 0.22
Nodes (22): Recovery steps: lost encryption key, lapsed consents, admin recovery, Add-on documentation in DOCS.md: install, Cloudflared, SMTP, Enable Banking per user, app install on Android and iPhone, backups, admin recovery, Enable Banking bank link and first sync (0.2.0), Fixes 0.2.1 and 0.2.2: empty accounts list and unfinished links, Sign-in: password, e-mailed code, trusted devices (0.2.0), Saldo add-on documentation (DOCS.md), admin_recovery option: recovery link in the log for a locked-out admin, Cold backup of Saldo by Home Assistant (database plus key) (+14 more)

### Community 59 - "Release Plan (v1.0), Roles & Security"
Cohesion: 0.17
Nodes (22): Sign-in and security concept, User, roles and visibility, Inloggen and Code, Instellingen, Afmelden button, APP section (Instellingen, Meldingen, Weergave), Security baseline (phase 0.2-5), 1.0-1 Export (+14 more)

### Community 60 - "E-mail Templates & Notification Toggles"
Cohesion: 0.12
Nodes (22): Nine e-mail templates, Template inlogcode, Template koppeling-3-dagen, Template nieuw-wachtwoord, Template planning-buffer, Template planning-rood, Template sync-gestopt, Template uitnodiging (+14 more)

### Community 61 - "Forecast Charts & Scope Switch"
Cohesion: 0.11
Nodes (22): Overzicht demo values (Oct 2026), Account colour palette (8 colours), Decision of 3 Nov 2026: each account judged on its own, Hero Saldo nu, Komende maanden forecast charts, Scope switch Alles / Persoonlijk / Gedeeld, Uitgaven november, Monthly demo data M (Nov 2025 to Oct 2026) (+14 more)

### Community 62 - "web tsconfig.app.json"
Cohesion: 0.09
Nodes (21): compilerOptions, allowImportingTsExtensions, exactOptionalPropertyTypes, isolatedModules, jsx, lib, module, moduleDetection (+13 more)

### Community 63 - "Transfer Detection & Forecast Method"
Cohesion: 0.12
Nodes (21): Alert row component, UI components (buttons, chips, cards, toggle, toast), Core question: enough money at end of each month, Transfer detection rule (own IBAN or opposite amount within 3 days), Saved (gespaard) transfers to savings, Transfer override (is or is not a transfer, per user), Income, expenses and saved per month, Period picker (Maand, Kwartaal, Jaar, Eigen) (+13 more)

### Community 64 - "web package.json Dev Dependencies"
Cohesion: 0.12
Nodes (20): jsdom, @testing-library/dom, @types/node, @types/react, @types/react-dom, typescript, description, devDependencies (+12 more)

### Community 65 - "Web README & PWA Meta"
Cohesion: 0.13
Nodes (19): First add-on build: Go server, database, health check, web app shell (0.2.0), Saldo brand green (#15803D) and Geist typography, Saldo Go server: JSON API, health endpoints, built web app (pure Go, SQLite via modernc.org/sqlite), web/index.html PWA entry page, React entry src/main.tsx mounted on #root, Web app manifest link and icons, Installable-app meta tags: theme-color #15803D, apple-mobile-web-app and mobile-web-app capable, theme-init.js script loaded before the app (+11 more)

### Community 66 - "Auth & Security Baseline"
Cohesion: 0.15
Nodes (17): Mail: invitation to Saldo, Mail: login code, Mail: set a new password, Audit log events, Bank connections endpoints incl. removal with history keep or delete, Two-step login with e-mailed 8-digit code, One-time tokens: setup, invitation (7 days), password reset (1 hour), Sign-in rate limits (+9 more)

### Community 67 - "Demo Mode, Privacy & Bank Link"
Cohesion: 0.13
Nodes (17): Nu synchroniseren button with progress bar and toast, Bank callback with single-use state bound to the viewer, Bank link through Enable Banking with fake provider for demo and tests, Demo mode (SALDO_DEMO=1), Error format and codes, POST and GET /api/sync with 15 minute cooldown, Demo mode: Bert, fixed date 18 November 2026, invalid IBANs, scripts/dev.ps1 start, reset and stop (+9 more)

### Community 68 - "Categorising Transactions API & Sheet"
Cohesion: 0.16
Nodes (19): Right side panel with transaction detail, Core components: buttons, filter chips, alert cards, transaction rows, status chips, Toepassen op vergelijkbare en regel maken checkbox, Oudere transacties laden with skeleton, Pending transaction state: In behandeling, Splitsen and Is een overschrijving actions, Transaction list grouped by day with search and filters, Transactie bewerken bottom sheet (+11 more)

### Community 69 - "Import Field Parsing"
Cohesion: 0.19
Nodes (18): Row, amountBody(), capRunes(), cardSafe(), checkDate(), cleanText(), decimalHint(), digits() (+10 more)

### Community 70 - "web tsconfig.node.json"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+10 more)

### Community 71 - "Forecast & Budget Engine"
Cohesion: 0.14
Nodes (18): [verify] Alles scope adds both group buffers together, Desktop header buffer pill, Planning demo values (Persoonlijk / Gedeelde rekening), Free to spend formula, Group summary (free to spend per group), Month chain formula, Budget tab, Maanden tab (+10 more)

### Community 72 - "Bank Alert E-mails"
Cohesion: 0.26
Nodes (14): StopReason, accountBlock(), anyShared(), ConsentExpiring(), dayCount(), AccountRef, longDate(), namesList() (+6 more)

### Community 73 - "Privacy Test Suite"
Cohesion: 0.15
Nodes (17): accountIDs(), allTransactions(), ids(), seeded(), TestAccountsForBert(), TestAccountsWithoutAccountsIsAnEmptyList(), TestAccountSyncFailedAlertNamesTheAccount(), TestAlertsForARealLink() (+9 more)

### Community 74 - "Bank Sync Requirements & Accounts"
Cohesion: 0.17
Nodes (15): Account and data lifecycle (remove link, manager hand-over), Bank sync requirements (nightly, balance snapshot, pending), Secrets encrypted at rest (Enable Banking keys), Enable Banking provider facts (own app per user, 180-day consent), Linking flow (state, callback page, join or create), Nightly sync and Sync now (balance stored, pending marked), Accounts from the Rekening(en) column mapped by name, Enable Banking provider facts (+7 more)

### Community 75 - "Demo Story & Fake Bank"
Cohesion: 0.14
Nodes (15): Architecture (Go server, React PWA, HA add-on, public repo), Account demo values (18 Nov 2026), Provider adapter and fake provider, Budget demo values (November 2026), Demo spending November (Alles 1.852,37), Demo story shared by mockup, dev and tests, Forecast demo values (January in buffer, February negative), Planned item demo items (Autoherstelling, belastingteruggave) (+7 more)

### Community 76 - "Bank Connection Linking"
Cohesion: 0.14
Nodes (9): connection, Linked, accountName(), match(), scanConnection(), TestAccountName(), TestErrorCode(), cleanCode() (+1 more)

### Community 77 - "Transaction Query & Cursor"
Cohesion: 0.13
Nodes (8): cursor, Page, Split, decodeCursor(), escapeLike(), Transaction, TxQuery, TestCursor()

### Community 78 - "Colour Tokens & Phone Screens"
Cohesion: 0.28
Nodes (16): Desktop Transacties screen, E-mail: alle berichten (9 mails), Saldo colour tokens (light and dark), Typography: Geist and Geist Mono, Meldingen Android (push notification mockup), Saldo Start licht en donker, Telefoon Meer screen, Telefoon Meldingen settings screen (+8 more)

### Community 79 - "Accounts API & Buffer Design"
Cohesion: 0.17
Nodes (13): Mail: member joined the shared account, Buffer line and zero line: onder buffer and negatief zones, Account colour palette: green, violet, blue, teal, orange, pink, yellow, gray, Rekening instellen sheet: name, colour, minimum buffer, Buffer per rekening summary bar, Persoonlijke and Gedeelde rekeningen lists, Account state: Boven buffer, In de buffer, Rood, Hero balance card: Saldo nu with buffer bar and status chip (+5 more)

### Community 80 - "Brand Mark & Icon Assets"
Cohesion: 0.17
Nodes (15): Email logo (28px rounded green tile with wallet), Email template image assets, People icon (two-person white line icon), Person icon (single-person white line icon), App icon (rounded-square green tile), App icon round (circular green badge), Saldo brand green (#15803D), Saldo wallet-with-coin brand mark (+7 more)

### Community 81 - "CHANGELOG & Release Notes"
Cohesion: 0.27
Nodes (16): Saldo CHANGELOG, Import batches and undo (0.5-5), Categorieen en regels screen with suggestions (0.4), Category tree with Dutch default set (0.4), Categorise in Transacties: change, apply to similar, notes, splits (0.4), Category icons (0.4), Category mapping in the import wizard (0.5-3), CSV import with Argenta preset (0.3.0) (+8 more)

### Community 82 - "Buffer States & Chart Helpers"
Cohesion: 0.15
Nodes (14): Account colours (eight, separate from category pastels), States (ok green, in the buffer ochre, below zero red), Where states show (Start chip, alerts, forecast, notifications), Category pastel colours (--c1 to --c6), App icon Beurs (coin peeking from a wallet), Colour tokens (light and dark), Typography (Geist, Geist Mono), Komende maanden bar chart per account (+6 more)

### Community 83 - "Trusted Devices & Notification Types"
Cohesion: 0.15
Nodes (15): Desktop sidebar with Beheer group, Phone bottom tab bar (Start, Transacties, Overzicht, Planning, Meer), New device signed in push and e-mail, No self-registration and no forgot-password link, Sign-in flow (password, 8-digit e-mail code, optional HA login), Trusted devices (hashed token cookie, 90 days), Bankkoppelingen screen and sync status UI, Consent reminders at 14 and 3 days (+7 more)

### Community 84 - "Notification & E-mail Design Options"
Cohesion: 0.13
Nodes (15): First sync progress (strategy=longest), SCA redirect to Argenta (app, Digipass, itsme), Bank-link wizard steps (to design), E-mail account block (personal / shared), E-mail client rules (table layout, inline styles), E-mail layout option A (rustig), E-mail tones (info, warn, error, shared), Template koppeling-14-dagen (+7 more)

### Community 85 - "Mockup Shell Navigation"
Cohesion: 0.23
Nodes (9): init(), navItem(), offlineBanner(), renderSidebar(), renderTabbar(), rerender(), setDemo(), setScope() (+1 more)

### Community 86 - "Import Upload & Category Plan"
Cohesion: 0.19
Nodes (13): AccountCount, CategoryCount, NewCategory, Options, Parsed, RowError, CategoryChoice, CategoryPlan (+5 more)

### Community 87 - "Roadmap & Decision Log"
Cohesion: 0.16
Nodes (10): Confirmation before the forecast relies on a recurring item, Recurring item detection (counterparty, ~10% amount, interval, 3 occurrences), Recurring items added and edited by hand, Decision log, Roadmap in priority order (milestones M0 to v2), States: yellow in the buffer, red below zero, Table recurring_item, Release status 9 Nov 2026 (0.2 released, 0.3 built) (+2 more)

### Community 88 - "Shared Account Roles & Permissions"
Cohesion: 0.16
Nodes (14): account_access (data), account_source (data), Shared account grouping by IBAN and joining, Shared account manager (beheerder), Member permission Lezen / Bewerken, Primary and fallback sources, Transaction dedupe key, Prompt: Deze rekening bestaat al. Wil je aansluiten? (+6 more)

### Community 89 - "Rule Matching Engine"
Cohesion: 0.19
Nodes (14): Candidate, i64(), TestMatch(), TestMatchOrder(), TestNormalise(), TestPathologicalPatternIsFast(), bounded(), collapse() (+6 more)

### Community 90 - "Mockup Meldingen Screen"
Cohesion: 0.34
Nodes (13): anim(), channels(), chip(), groups(), header(), lockedChip(), lookAhead(), onClick() (+5 more)

### Community 91 - "Server Security Review Scope"
Cohesion: 0.18
Nodes (14): Review scope: sign-in, trusted devices, CSRF, CSP, rate limits, bank callback state, secret encryption, privacy scoping, imports, exports, push, outbound traffic, Demo mode (SALDO_DEMO): seeded demo story acting as Bert, demo date 18 November 2026, internal/auth: argon2id passwords, e-mailed code, trusted devices, setup/invitation/reset links, audit log, internal/bank: provider interface (ListAccounts, FetchTransactions, FetchBalances), internal/bank/enablebanking: real Enable Banking client, internal/bank/fake: fake provider serving the demo story and link wizard, internal/banklink: sealed credentials, single-use link state, IBAN account matching, real sync, internal/categorise: default category tree, rule matcher and Assign (+6 more)

### Community 92 - "Architecture & Repo Layout"
Cohesion: 0.18
Nodes (12): Saldo stijl (style guide canvas), Bank provider interface: Enable Banking and fake provider, Architecture overview: one Go binary as Home Assistant add-on, Repository layout: server, web, saldo, finance-mockup, design, Running locally with scripts/dev.ps1, SQLite store with embedded numbered migrations, web: React 19, Vite, TypeScript app, Saldo mockup README (version 0.1) (+4 more)

### Community 93 - "Rules & Categories API"
Cohesion: 0.23
Nodes (12): Categories: shared two-level tree, default tree, categorise.Assign, categorise.SetManual, DELETE category with moveTo (also merge), Category icons list, Rule preview and apply, PUT /api/rules/order, Rules: conditions, owner, priority (+4 more)

### Community 94 - "Fake Bank Story Data"
Cohesion: 0.29
Nodes (9): month, row, slot, build(), everyOther(), fixed(), story(), text() (+1 more)

### Community 95 - "Mailer & Message Sending"
Cohesion: 0.23
Nodes (7): Log, SMTP, TestBankMailsEscapeNames(), build(), Message, TestBuildIsMultipartAlternative(), mailbox

### Community 96 - "Month Formula & Free-to-Spend"
Cohesion: 0.24
Nodes (12): Account types (current, savings, investment), Manual account (private, IBAN only for recognising transfers), Budget editing (stepper, average of 6 months, no budget), Free to spend (Vrij te besteden) formula per account, Variable spending (budget or average minus recurring), Buffer (minimum balance per current account), Daily balance line (calendar), Forecast horizon (3, 6, 12, 24 months) (+4 more)

### Community 97 - "Import Column Mapping"
Cohesion: 0.27
Nodes (7): Mapping, detectPreset(), hasAll(), normaliseHeader(), suggest(), mappingOf(), mappingBody

### Community 98 - "web Dependencies & main.tsx"
Cohesion: 0.18
Nodes (8): @fontsource-variable/geist, @fontsource-variable/geist-mono, dependencies, @fontsource-variable/geist@^5.3.0, @fontsource-variable/geist-mono@^5.3.0, react@^19.3.1, react-dom@^19.3.1, react-router-dom@^7.18.5

### Community 99 - "Vite Config & Service Worker Plugin"
Cohesion: 0.20
Nodes (6): vite, @vitejs/plugin-react, vite@^8.3.5, @vitejs/plugin-react@^6.2.1, PUBLIC_SHELL, serviceWorker()

### Community 100 - "Design: App Icon & Navigation"
Cohesion: 0.18
Nodes (11): Desktop sidebar: Start, Transacties, Overzicht, Planning and Beheer group, Mail: account dips into the buffer in January, Saldo brand: Rustig, Helder, Met kleur, Android notification panel (light and dark), Notification icon silhouette (Beurs met munt), Notification tone colours: green info, ochre warning, red error, App icon Beurs (coin peeking out of a wallet), Favicon variants 32 and 16 px (+3 more)

### Community 101 - "CSV Table Reading"
Cohesion: 0.25
Nodes (8): record, table, decode(), detectDelimiter(), excelSep(), quoteMessage(), readTable(), tooManyFields()

### Community 102 - "Server README & Config"
Cohesion: 0.22
Nodes (10): Saldo server README, cmd/saldo: subcommands serve, healthcheck, version and graceful shutdown, Configuration variables SALDO_* and add-on options file, internal/apperr: not found, forbidden and validation errors, internal/clock: now and today in Europe/Brussels with demo date override, internal/config: environment and add-on options, internal/users: profile and display preferences, JSON-line logs: no query string, SMTP password never logged (+2 more)

### Community 103 - "Period Charts & Pickers"
Cohesion: 0.22
Nodes (10): Booking-date month rule (Europe/Brussels), Chart bar colours (income, expenses, saved), Income, expenses and saved bar chart, Loading shimmer on period or scope change, Not designed: empty state, custom range, account filter, Period picker (Maand, Kwartaal, Jaar, Eigen), Summary tiles Inkomen / Uitgaven / Gespaard, barInc / barExp / barSav colour tokens (+2 more)

### Community 104 - "Category Editor Screens"
Cohesion: 0.20
Nodes (10): Category editor, Categorieen tab (shared category tree), Category icon picker (49 icons), Category removal editor, Categorieen empty and offline states, Category mapping table, Notification type: Te categoriseren, Push type cat (te categoriseren) (+2 more)

### Community 105 - "Design Canvas & Boards"
Cohesion: 0.29
Nodes (10): Desktop Meer (derived, from sidebar user block), Desktop-Overzicht board, Desktop-Planning board, Desktop-Rekeningen board, Desktop-Start board, Desktop sidebar navigation (shared by all desktop boards), Licht and Donker CSS design tokens, Design source (copy) (+2 more)

### Community 106 - "Planning Calendar Design"
Cohesion: 0.24
Nodes (10): Daily balance chart with buffer and zero zones, Daily line formula, Day card, Plan form (planned expense or income), Eenmalig tab, Kalender tab, SVG daily balance chart with scrub overlay, Calendar grid with day states (+2 more)

### Community 107 - "Dependabot Config"
Cohesion: 0.20
Nodes (9): web, interval, updates, directory, groups, package-ecosystem, schedule, version (+1 more)

### Community 108 - "Account Access & Import Undo"
Cohesion: 0.20
Nodes (5): access, Balance, UndoPreview, accessOf(), undoBatches()

### Community 109 - "E-mail Layout Templates"
Cohesion: 0.36
Nodes (9): NOTIF-1 All ten e-mails with plain-text parts, tested in three mail clients, HTML e-mail layout template (layout.html), Footer: Why plus "Saldo draait op je eigen Home Assistant", Hidden preheader text with padding characters, Template data fields: Subject, Preheader, Tone, Kicker, Heading, Accounts, Figure, FigureNote, Intro, Rows, Button, ButtonURL, Note, Why, Tone colour set (Text, Soft, DarkText, DarkSoft), Plain-text e-mail layout template (layout.txt), Plain-text footer: Why plus "Saldo draait op je eigen Home Assistant" (+1 more)

### Community 110 - "Icon Rendering Script"
Cohesion: 0.22
Nodes (6): sharp, sharp@^0.35.5, glyph, jobs, out, src

### Community 111 - "Ledger Plan & Apply Tests"
Cohesion: 0.50
Nodes (9): addTx(), exec(), ledgerDB(), TestApplyAccount(), TestAssign(), TestRulesFor(), state(), TestPlanAndApply() (+1 more)

### Community 112 - "Spikes, Risks & Security Requirements"
Cohesion: 0.36
Nodes (8): Personal data in Bilance rows (card holder name kept only in raw row), Development plan (layout, defaults, order of work), Quality gates (security baseline, full review, backups), Risks and checks (20 items), Security requirements (sign-in, encryption, public access), Spike S1: Enable Banking with real Argenta account, Spike S2: Bilance CSV inspection, Still to verify (spikes S1, S2, recurring thresholds, push on phones)

### Community 113 - "Shared vs Personal Account Design"
Cohesion: 0.29
Nodes (8): Shared account design (violet card, Bijdragen), Transaction list row design, Persoonlijk / Gedeeld account groups, Persoonlijke and Gedeelde rekeningen sections, Account label chip (Persoonlijk / Gedeeld), Transaction list grouped by day, Account list rows with buffer column, Persoonlijk and Gedeeld account cards

### Community 114 - "Admin Role & Privacy Rules"
Cohesion: 0.25
Nodes (8): Admin role (manages users only), User avatar and sidebar footer design, Beheerder naming collision (admin vs manager), Privacy tests (user A never sees user B), Server-side visibility: own accounts only, First-admin setup from one-time add-on log link, Profile, password, language, Meer profile card

### Community 115 - "Account Settings & Buffer Design"
Cohesion: 0.32
Nodes (8): Rekening instellen sheet / panel, Buffer per rekening card, Desktop settings panel (Herstellen, Opslaan), Minimumbuffer stepper (50 euro steps), Mockup persistence in localStorage, Savings accounts have no buffer, Buffer per rekening card with stacked bar, Settings panel (Naam, Kleur, Minimumbuffer, Voorbeeld)

### Community 117 - "Release 1.0.0 & Translations"
Cohesion: 0.29
Nodes (7): 1.0-4 Release 1.0.0, Translations for the add-on options, Release 1.0.0 (REL-2): a versioned add-on updated like any other, Release workflow and the 1.0.0 tag, REL-2 Add-on release 1.0.0 with documentation, internal/db: SQLite open (WAL, foreign keys) and embedded numbered migrations, Embedded migrations with database backup before migrating an existing schema

### Community 118 - "Contribution Split & Category Breakdown"
Cohesion: 0.38
Nodes (7): Monthly contribution split, Per categorie breakdown with drill-down, Naar gedeelde rekening (contribution row in Persoonlijk), Trend against previous period, Terugkerend tab, Per categorie rows with trend and share bar, Terugkerend tab (suggestions and confirmed)

### Community 119 - "Preferences & Display Settings"
Cohesion: 0.29
Nodes (7): user (data), Weergave (light, dark, follow system), Weergave disclosure (Systeem, Licht, Donker), Channel card (Pushmeldingen / E-mail switches), Hoe ver vooruit kijken (1, 3, 6 months), Stille uren (22:00 to 07:00), Stuur een testmelding

### Community 120 - "Mockup Meer Screen"
Cohesion: 0.52
Nodes (6): anim(), onClick(), paint(), render(), row(), themeRow()

### Community 121 - "Category Backfill"
Cohesion: 0.38
Nodes (5): BackfillCategory, BackfillExample, BackfillGroup, BackfillPreview, pair

### Community 122 - "web npm Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, icons, preview, test, typecheck

### Community 123 - "Demo States & Conventions"
Cohesion: 0.33
Nodes (5): Mockup demo-state picker and theme (Weergave), Demo states (normaal, leeg, verouderd, fout, lezen, offline), Glossary English to Dutch labels, Glossary of Dutch UI terms, Conventions (English files, Dutch UI labels, phase ids, [verify] marker)

### Community 124 - "Scheduler"
Cohesion: 0.47
Nodes (3): Func, job, Scheduler

### Community 125 - "Minor: repository.yaml"
Cohesion: 0.50
Nodes (3): maintainer, name, url

### Community 126 - "Minor: GET /api/me and preferences (scope, them"
Cohesion: 0.67
Nodes (3): Profile card: Bert, Beheerder, Scope switch Alles / Persoonlijk / Gedeeld, GET /api/me and preferences (scope, theme, role)

## Ambiguous Edges - Review These
- `Buffer and states concept` → `[verify] Alles scope adds both group buffers together`  [AMBIGUOUS]
  analysis/screens/planning.md · relation: conceptually_related_to
- `Decision of 3 Nov 2026: each account judged on its own` → `Desktop hero card Saldo nu`  [AMBIGUOUS]
  design/project/Desktop-Start.dc.html · relation: conceptually_related_to
- `Demo forecast numbers (Zichtrekening February -1.033,47)` → `Demo free-to-spend numbers (365,44 and 46,86)`  [AMBIGUOUS]
  plan/v0.8-planning/05-free-to-spend.md · relation: shares_data_with
- `Investment platform: Argenta funds` → `CSV import with Argenta preset (0.3.0)`  [AMBIGUOUS]
  plan/v2.0-investments/README.md · relation: conceptually_related_to

## Knowledge Gaps
- **246 isolated node(s):** `github.com/BertVanBaelen/Saldo/server`, `bankEnv`, `pair`, `RFC-3339`, `Saldo (self-hosted Bilance replacement as Home Assistant add-on)` (+241 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 739 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Backfill of uncategorised history (Geschiedenis toepassen)` connect `Bilance Import Plan (v0.5)` to `Transfers, Budget & Privacy Concepts`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **What connects `github.com/BertVanBaelen/Saldo/server`, `bankEnv`, `pair` to the rest of the system?**
  _246 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Go Server Core & Ledger Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.06437741099095681 - nodes in this community are weakly interconnected._
- **Why does `GET/POST /api/suggestions/backfill` connect `Bilance Import Plan (v0.5)` to `Web Auth, Context & Backfill UI`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Should `Web API Types & Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.02716942804545166 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Buffer and states concept` and `[verify] Alles scope adds both group buffers together`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Decision of 3 Nov 2026: each account judged on its own` and `Desktop hero card Saldo nu`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._