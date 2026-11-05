-- The sync engine (phase 0.3-1).

-- One balance per account, date and origin: a later sync of the same day
-- updates it instead of adding a row. Older duplicates keep their newest row.
DELETE FROM balance_snapshots WHERE id NOT IN (
    SELECT MAX(id) FROM balance_snapshots GROUP BY account_id, date, origin);
CREATE UNIQUE INDEX balance_snapshots_day ON balance_snapshots (account_id, date, origin);

-- The nightly job's attempts of the day (Brussels date), kept across restarts
-- so a restarting add-on cannot go past the bank's daily limit.
ALTER TABLE provider_connections ADD COLUMN background_day TEXT;
ALTER TABLE provider_connections ADD COLUMN background_attempts INTEGER NOT NULL DEFAULT 0;
