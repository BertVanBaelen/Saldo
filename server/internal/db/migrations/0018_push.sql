-- Web Push (0.9-2). push_keys holds the one VAPID key pair: the public key
-- plain (it is public: every browser gets it from GET /api/push/key), the
-- private key sealed with the secret box (secrets.Box, key file next to the
-- database). id is always 1, so there is never a second pair.
CREATE TABLE push_keys (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    public_key  TEXT    NOT NULL,
    private_key BLOB    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- push_subscriptions (0001) is rebuilt: a subscription belongs to exactly one
-- device and goes with it (device_id NOT NULL ... ON DELETE CASCADE). SQLite
-- cannot change a foreign key, hence the rebuild; a row without a device is
-- dropped (nothing wrote this table before 0.9, so in practice none exist).
-- Signing a device out (revoked_at) deletes its subscriptions in the same
-- transaction (package auth); the hourly push-prune job removes those of
-- devices that went idle.
CREATE TABLE push_subscriptions_new (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_id    INTEGER NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    endpoint     TEXT    NOT NULL UNIQUE,
    p256dh       TEXT    NOT NULL,
    auth         TEXT    NOT NULL,
    platform     TEXT    NOT NULL DEFAULT 'other' CHECK (platform IN ('android', 'ios', 'other')),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used_at TEXT
);
INSERT INTO push_subscriptions_new (id, user_id, device_id, endpoint, p256dh, auth, platform, created_at, last_used_at)
    SELECT id, user_id, device_id, endpoint, p256dh, auth, platform, created_at, last_used_at
    FROM push_subscriptions WHERE device_id IS NOT NULL;
DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
CREATE INDEX push_subscriptions_device ON push_subscriptions (device_id);
