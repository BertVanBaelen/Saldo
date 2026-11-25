-- Notifications (0.9-3): the channel switches per user, the repeat-safe log
-- and the state of the daily triggers.
--
-- users.notify_email: the e-mail channel (Meldingen, "E-mail"); push is "this
-- device has a subscription" (0018). users.quiet_hours: push waits during
-- [22:00, 07:00) Brussels (security messages ignore it).
ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1 CHECK (notify_email IN (0, 1));
ALTER TABLE users ADD COLUMN quiet_hours INTEGER NOT NULL DEFAULT 1 CHECK (quiet_hours IN (0, 1));

-- notification_log is rebuilt: one row per user, channel and message key
-- (dedupe), unique, so a message goes out at most once whatever runs at the
-- same time. The dispatcher (package notify) claims the row before it sends
-- and marks it sent after; a channel that is off gets a suppressed row, so
-- switching it on later never replays an old state.
--   dedupe      the message key: account:<id>|rood|<month>|red,
--               connection:<id>|consent|14d:<valid_until>, ...
--   status      claimed (being sent), sent, suppressed (channel or type off,
--               or recorded by a trigger's first run)
--   claimed_at  when the row was claimed or written; a claim older than 10
--               minutes without sent is taken over (a crash between claim and send)
--   sent_at     when the send succeeded, NULL otherwise
--   account_id, month, state, connection_id  what the key is about, for the
--               re-arm of the planning warnings and the cascades
-- The 0.3-2 rows (consent and stop mails, all sent) keep their id and get the
-- key of their connection episode; a row without a connection (none was ever
-- written) gets a key of its own. Duplicates of one key (the old
-- read-then-write could race) keep the oldest row.
CREATE TABLE notification_log_new (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    type          TEXT    NOT NULL,
    account_id    INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
    connection_id INTEGER REFERENCES provider_connections (id) ON DELETE CASCADE,
    month         TEXT,
    state         TEXT,
    channel       TEXT    NOT NULL CHECK (channel IN ('push', 'email')),
    dedupe        TEXT    NOT NULL,
    status        TEXT    NOT NULL CHECK (status IN ('claimed', 'sent', 'suppressed')),
    claimed_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    sent_at       TEXT
);
CREATE UNIQUE INDEX notification_log_dedupe ON notification_log_new (user_id, channel, dedupe);
INSERT OR IGNORE INTO notification_log_new (id, user_id, type, account_id, connection_id, month, state, channel, dedupe, status, claimed_at, sent_at)
    SELECT id, user_id, type, account_id, connection_id, month, state, channel,
           CASE WHEN connection_id IS NOT NULL
                THEN 'connection:' || connection_id || '|' || type || '|' || COALESCE(state, '')
                ELSE 'legacy:' || id END,
           'sent', sent_at, sent_at
    FROM notification_log ORDER BY id;
DROP TABLE notification_log;
ALTER TABLE notification_log_new RENAME TO notification_log;
CREATE INDEX notification_log_account ON notification_log (account_id, type, month);
CREATE INDEX notification_log_connection ON notification_log (connection_id);

-- notify_runs: the day a daily trigger last finished ("planning" → the
-- Brussels date) and the baseline markers of each trigger's first run
-- ("baseline:planning", "baseline:connections", ...).
CREATE TABLE notify_runs (
    name TEXT PRIMARY KEY,
    day  TEXT
);
