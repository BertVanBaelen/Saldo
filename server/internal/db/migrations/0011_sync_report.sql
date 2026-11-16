-- Sync report (0.6-0): what the last successful sync of an account asked the
-- bank for and what it got back, so a silent sync can be told from a broken one
-- without logs. All columns are nullable and only added, so no row is touched:
-- an account has no report until its next successful sync, and a failed sync
-- leaves the old report in place.
--   last_from           the date_from asked ('' = the longest history)
--   last_fetched        rows the bank returned
--   last_added          rows that were new to Saldo
--   last_newest         newest booking date the bank returned ('' = no rows)
--   last_balance_date   date of the balance stored ('' = none)
--   last_external_tail  last 4 characters of the provider account id used
ALTER TABLE account_sources ADD COLUMN last_from TEXT;
ALTER TABLE account_sources ADD COLUMN last_fetched INTEGER;
ALTER TABLE account_sources ADD COLUMN last_added INTEGER;
ALTER TABLE account_sources ADD COLUMN last_newest TEXT;
ALTER TABLE account_sources ADD COLUMN last_balance_date TEXT;
ALTER TABLE account_sources ADD COLUMN last_external_tail TEXT;
