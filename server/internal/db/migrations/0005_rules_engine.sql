-- The rules engine (phase 0.4-2). Only new columns: nothing is renamed or
-- dropped, so a populated database keeps every row as it was.
-- counterparty_match holds the counterparty text; counterparty_exact says
-- whether it must equal (1) or be contained in (0) the counterparty.
-- A communication condition is either a plain text (communication_contains)
-- or an RE2 regular expression (communication_regex), never both.
ALTER TABLE rules ADD COLUMN counterparty_exact INTEGER NOT NULL DEFAULT 0 CHECK (counterparty_exact IN (0, 1));
ALTER TABLE rules ADD COLUMN communication_contains TEXT;
CREATE INDEX rules_account ON rules (account_id);
CREATE INDEX rules_user ON rules (user_id);
