-- Lifecycle notices (0.6-1c). account_notices gets three types and survives
-- its account: a member left, the manager role moved, the account was deleted.
-- SQLite cannot change a CHECK or a foreign key, so the table is rebuilt; every
-- row keeps its id (POST /api/notices/{id}/read names it).
--   type          member, rules (0012); left: actor left the account; manager:
--                 actor is now its manager; deleted: actor deleted the account
--   account_id    NULL once the account is gone (only a deleted notice outlives it)
--   account_name  the account's name when it was deleted
--   actor_name    the actor's name at the time, for when the actor is deleted
CREATE TABLE account_notices_new (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    account_id   INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    type         TEXT    NOT NULL CHECK (type IN ('member', 'rules', 'left', 'manager', 'deleted')),
    actor_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL,
    read_at      TEXT,
    account_name TEXT,
    actor_name   TEXT
);
INSERT INTO account_notices_new (id, user_id, account_id, type, actor_id, created_at, read_at)
    SELECT id, user_id, account_id, type, actor_id, created_at, read_at FROM account_notices;
DROP TABLE account_notices;
ALTER TABLE account_notices_new RENAME TO account_notices;
CREATE INDEX account_notices_user ON account_notices (user_id, read_at);
CREATE INDEX account_notices_account ON account_notices (account_id);
