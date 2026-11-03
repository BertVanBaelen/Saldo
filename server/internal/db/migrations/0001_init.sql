-- Saldo v1 schema (analysis section 8, data model sketch).
-- Conventions: money is INTEGER cents (signed where it can be negative); dates are
-- TEXT 'YYYY-MM-DD' in Europe/Brussels; timestamps are TEXT RFC 3339 in UTC;
-- booleans are INTEGER 0/1. IBANs are stored in full, upper case, without spaces,
-- and masked only in API output. Later migrations add columns, not tables.

CREATE TABLE app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Users and sign-in -------------------------------------------------------------

CREATE TABLE users (
    id                INTEGER PRIMARY KEY,
    email             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash     TEXT,
    display_name      TEXT    NOT NULL,
    role              TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    language          TEXT    NOT NULL DEFAULT 'nl-BE',
    theme             TEXT    NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
    last_scope        TEXT    NOT NULL DEFAULT 'alles' CHECK (last_scope IN ('alles', 'persoonlijk', 'gedeeld')),
    lookahead_months  INTEGER NOT NULL DEFAULT 3 CHECK (lookahead_months IN (1, 3, 6)),
    quiet_hours_start TEXT    NOT NULL DEFAULT '22:00',
    quiet_hours_end   TEXT    NOT NULL DEFAULT '07:00',
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- A trusted device: a long-lived, revocable session (analysis 7).
CREATE TABLE devices (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    token_hash   TEXT    NOT NULL UNIQUE,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used_at TEXT,
    revoked_at   TEXT
);
CREATE INDEX devices_user ON devices (user_id);

-- One-time tokens: setup link, invitation, password reset, email change.
CREATE TABLE user_tokens (
    id         INTEGER PRIMARY KEY,
    kind       TEXT    NOT NULL CHECK (kind IN ('setup', 'invitation', 'password_reset', 'email_change')),
    token_hash TEXT    NOT NULL UNIQUE,
    user_id    INTEGER REFERENCES users (id) ON DELETE CASCADE,
    email      TEXT,
    role       TEXT    CHECK (role IN ('admin', 'user')),
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at TEXT    NOT NULL,
    used_at    TEXT
);

-- The emailed sign-in code (8 digits, 10 minutes, 5 attempts), stored hashed.
CREATE TABLE login_codes (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash    TEXT    NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    device_label TEXT,
    ip           TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at   TEXT    NOT NULL,
    used_at      TEXT
);
CREATE INDEX login_codes_user ON login_codes (user_id);

CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    event      TEXT    NOT NULL,
    user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
    device_id  INTEGER REFERENCES devices (id) ON DELETE SET NULL,
    ip         TEXT,
    detail     TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX audit_log_user ON audit_log (user_id, created_at);

-- Bank connections and accounts ------------------------------------------------

-- A user's consent at a bank through a provider. Secrets are encrypted at rest.
CREATE TABLE provider_connections (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider           TEXT    NOT NULL,              -- 'enablebanking' or 'fake'
    aspsp_name         TEXT    NOT NULL,              -- the bank, for example 'Argenta'
    aspsp_country      TEXT    NOT NULL DEFAULT 'BE',
    application_id     TEXT,
    private_key_enc    BLOB,
    session_id_enc     BLOB,
    consent_since      TEXT,                          -- date the consent was given
    valid_until        TEXT,                          -- timestamp the consent ends
    status             TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'active', 'expired', 'revoked')),
    sync_status        TEXT    NOT NULL DEFAULT 'ok' CHECK (sync_status IN ('ok', 'failed')),
    last_sync_at       TEXT,                          -- last successful sync
    last_attempt_at    TEXT,
    last_error         TEXT,
    created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX provider_connections_user ON provider_connections (user_id);

-- Personal or shared follows from the number of rows in account_access.
CREATE TABLE accounts (
    id         INTEGER PRIMARY KEY,
    type       TEXT    NOT NULL CHECK (type IN ('current', 'savings', 'investment')),
    source     TEXT    NOT NULL CHECK (source IN ('bank', 'manual')),
    iban       TEXT,
    name       TEXT    NOT NULL,
    colour     TEXT    NOT NULL DEFAULT 'green'
               CHECK (colour IN ('green', 'violet', 'blue', 'teal', 'orange', 'pink', 'yellow', 'gray')),
    buffer     INTEGER NOT NULL DEFAULT 0 CHECK (buffer >= 0),
    currency   TEXT    NOT NULL DEFAULT 'EUR',
    bank_name  TEXT,
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
-- IBAN is the key of bank accounts (analysis 6.3); manual accounts may repeat one.
CREATE UNIQUE INDEX accounts_bank_iban ON accounts (iban) WHERE source = 'bank';
CREATE INDEX accounts_iban ON accounts (iban);

-- Every financial query goes through this table (analysis 2).
CREATE TABLE account_access (
    account_id         INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    user_id            INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role               TEXT    NOT NULL CHECK (role IN ('manager', 'member')),
    permission         TEXT    NOT NULL CHECK (permission IN ('read', 'edit')),
    joined_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    contribution_share INTEGER CHECK (contribution_share BETWEEN 0 AND 100),
    PRIMARY KEY (account_id, user_id)
);
CREATE INDEX account_access_user ON account_access (user_id, account_id);

CREATE TABLE account_sources (
    account_id          INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    connection_id       INTEGER NOT NULL REFERENCES provider_connections (id) ON DELETE CASCADE,
    priority            TEXT    NOT NULL CHECK (priority IN ('primary', 'fallback')),
    external_account_id TEXT,                          -- provider id, changes per session
    status              TEXT    NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'failed')),
    last_sync_at        TEXT,
    last_attempt_at     TEXT,
    last_error          TEXT,
    PRIMARY KEY (account_id, connection_id)
);
CREATE INDEX account_sources_connection ON account_sources (connection_id);

CREATE TABLE balance_snapshots (
    id         INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    balance    INTEGER NOT NULL,
    date       TEXT    NOT NULL,
    origin     TEXT    NOT NULL CHECK (origin IN ('bank', 'manual')),
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX balance_snapshots_account ON balance_snapshots (account_id, date, id);

-- Categories, rules and imports ------------------------------------------------

-- One tree shared by all users: names, types and colours only.
CREATE TABLE categories (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    parent_id  INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    type       TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    colour     TEXT    NOT NULL DEFAULT 'c6' CHECK (colour IN ('c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'soft')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX categories_name ON categories (COALESCE(parent_id, 0), name COLLATE NOCASE);

-- A source category (full path) mapped to an app category; NULL = leave uncategorised.
CREATE TABLE category_mappings (
    id              INTEGER PRIMARY KEY,
    source          TEXT    NOT NULL,
    source_category TEXT    NOT NULL,
    category_id     INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (source, source_category)
);

-- Rules and suggestions belong to an account or to a user, never both.
CREATE TABLE category_suggestions (
    id              INTEGER PRIMARY KEY,
    account_id      INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users (id) ON DELETE CASCADE,
    counterparty_key TEXT   NOT NULL,
    category_id     INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    confidence      INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    times_seen      INTEGER NOT NULL DEFAULT 0,
    state           TEXT    NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'confirmed', 'dismissed')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    CHECK ((account_id IS NULL) <> (user_id IS NULL))
);

CREATE TABLE import_batches (
    id             INTEGER PRIMARY KEY,
    source         TEXT    NOT NULL,                   -- 'csv', 'bilance', …
    file_name      TEXT    NOT NULL,
    file_hash      TEXT    NOT NULL,
    account_id     INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created_by     INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    undone_at      TEXT,
    rows_imported  INTEGER NOT NULL DEFAULT 0,
    rows_skipped   INTEGER NOT NULL DEFAULT 0,
    rows_duplicate INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rules (
    id                  INTEGER PRIMARY KEY,
    account_id          INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
    user_id             INTEGER REFERENCES users (id) ON DELETE CASCADE,
    name                TEXT    NOT NULL DEFAULT '',
    priority            INTEGER NOT NULL DEFAULT 0,
    counterparty_match  TEXT,
    counterparty_iban   TEXT,
    communication_regex TEXT,
    amount_min          INTEGER,
    amount_max          INTEGER,
    category_id         INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    created_by          INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    CHECK ((account_id IS NULL) <> (user_id IS NULL))
);

-- Transactions -----------------------------------------------------------------

CREATE TABLE transactions (
    id                   INTEGER PRIMARY KEY,
    account_id           INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    amount               INTEGER NOT NULL,
    currency             TEXT    NOT NULL DEFAULT 'EUR',
    booking_date         TEXT    NOT NULL,
    value_date           TEXT,
    counterparty_name    TEXT    NOT NULL DEFAULT '',
    counterparty_iban    TEXT,
    communication        TEXT    NOT NULL DEFAULT '',
    status               TEXT    NOT NULL CHECK (status IN ('pending', 'booked')),
    external_id          TEXT,                         -- the bank's entry_reference
    dedupe_key           TEXT    NOT NULL,
    occurrence           INTEGER NOT NULL DEFAULT 1,   -- two identical coffees on one day
    source_connection_id INTEGER REFERENCES provider_connections (id) ON DELETE SET NULL,
    import_batch_id      INTEGER REFERENCES import_batches (id) ON DELETE CASCADE,
    raw_payload          TEXT,
    category_id          INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    category_origin      TEXT    CHECK (category_origin IN ('manual', 'rule', 'suggestion', 'import')),
    rule_id              INTEGER REFERENCES rules (id) ON DELETE SET NULL,
    note                 TEXT,
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (account_id, dedupe_key, occurrence)
);
CREATE INDEX transactions_account_date ON transactions (account_id, booking_date, id);
CREATE INDEX transactions_counterparty_iban ON transactions (counterparty_iban);
CREATE INDEX transactions_category ON transactions (category_id);

CREATE TABLE transaction_splits (
    id             INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    category_id    INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    amount         INTEGER NOT NULL
);
CREATE INDEX transaction_splits_transaction ON transaction_splits (transaction_id);

-- "Is a transfer" / "is not a transfer", per user (analysis 5.2).
CREATE TABLE transfer_overrides (
    user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    is_transfer    INTEGER NOT NULL CHECK (is_transfer IN (0, 1)),
    PRIMARY KEY (user_id, transaction_id)
);

-- Planning ---------------------------------------------------------------------

CREATE TABLE recurring_items (
    id             INTEGER PRIMARY KEY,
    account_id     INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    user_id        INTEGER REFERENCES users (id) ON DELETE CASCADE, -- NULL: belongs to the account
    counterparty   TEXT    NOT NULL DEFAULT '',
    description    TEXT    NOT NULL DEFAULT '',
    amount         INTEGER NOT NULL,
    amount_rule    TEXT    NOT NULL DEFAULT 'fixed' CHECK (amount_rule IN ('fixed', 'average')),
    frequency      TEXT    NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
    expected_day   INTEGER NOT NULL CHECK (expected_day BETWEEN 1 AND 31),
    expected_month INTEGER CHECK (expected_month BETWEEN 1 AND 12),
    end_date       TEXT,
    kind           TEXT    NOT NULL CHECK (kind IN ('income', 'expense', 'transfer', 'saving')),
    state          TEXT    NOT NULL DEFAULT 'suggested' CHECK (state IN ('suggested', 'confirmed', 'ignored')),
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX recurring_items_account ON recurring_items (account_id);

CREATE TABLE budgets (
    id             INTEGER PRIMARY KEY,
    account_id     INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    category_id    INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    monthly_amount INTEGER NOT NULL CHECK (monthly_amount >= 0),
    from_month     TEXT    NOT NULL,                   -- 'YYYY-MM'
    UNIQUE (account_id, category_id, from_month)
);

CREATE TABLE planned_items (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
    date        TEXT    NOT NULL,
    amount      INTEGER NOT NULL,                      -- signed
    description TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX planned_items_account ON planned_items (account_id, date);

-- Notifications ----------------------------------------------------------------

CREATE TABLE notification_prefs (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type    TEXT    NOT NULL,
    push    INTEGER NOT NULL CHECK (push IN (0, 1)),
    email   INTEGER NOT NULL CHECK (email IN (0, 1)),
    PRIMARY KEY (user_id, type)
);

CREATE TABLE push_subscriptions (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_id    INTEGER REFERENCES devices (id) ON DELETE SET NULL,
    endpoint     TEXT    NOT NULL UNIQUE,
    p256dh       TEXT    NOT NULL,
    auth         TEXT    NOT NULL,
    platform     TEXT    NOT NULL DEFAULT 'other' CHECK (platform IN ('android', 'ios', 'other')),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used_at TEXT
);

-- Sent messages, so a message is not repeated (analysis 4.9).
CREATE TABLE notification_log (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type       TEXT    NOT NULL,
    account_id INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
    month      TEXT,
    state      TEXT,
    channel    TEXT    NOT NULL CHECK (channel IN ('push', 'email')),
    sent_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX notification_log_lookup ON notification_log (user_id, type, account_id, month, state, channel);
