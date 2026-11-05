-- Consent and sync reminders (phase 0.3-2) are about a bank connection, not an
-- account: the log names the connection, and state is the episode (the
-- consent's valid_until, or the last good sync of a failing connection).
ALTER TABLE notification_log ADD COLUMN connection_id INTEGER REFERENCES provider_connections (id) ON DELETE CASCADE;
CREATE INDEX notification_log_connection ON notification_log (connection_id, type, state, channel);
