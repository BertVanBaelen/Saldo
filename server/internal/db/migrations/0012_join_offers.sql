-- Join (0.6-1a). Linking an IBAN that already exists as someone else's bank
-- account records an offer for the consent that listed it; accepting the offer
-- (and nothing else) makes the user a member. Only new tables: no row of an
-- existing table is touched.
--   external_account_id  the provider id of the account in that consent
--   created_at           when the consent last listed it (an offer lives 24 hours)
CREATE TABLE join_offers (
    id                  INTEGER PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    connection_id       INTEGER NOT NULL REFERENCES provider_connections (id) ON DELETE CASCADE,
    account_id          INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    external_account_id TEXT    NOT NULL,
    created_at          TEXT    NOT NULL,
    UNIQUE (connection_id, account_id)
);
CREATE INDEX join_offers_user ON join_offers (user_id);
CREATE INDEX join_offers_account ON join_offers (account_id);

-- In-app notices about an account, one row per addressee, shown through
-- GET /api/alerts until the addressee reads it (read_at, the per-user mark).
--   type   member: actor joined the account; rules: the addressee's user
--          rules no longer apply to it (it got a second member)
CREATE TABLE account_notices (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    type       TEXT    NOT NULL CHECK (type IN ('member', 'rules')),
    actor_id   INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL,
    read_at    TEXT
);
CREATE INDEX account_notices_user ON account_notices (user_id, read_at);
CREATE INDEX account_notices_account ON account_notices (account_id);
