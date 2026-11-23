-- One-off planned items without a day (0.8.1-9). A planned item may now mean "somewhere in this month":
-- it is stored as the month's 1st with whole_month = 1, so the index (account_id, date) and every month
-- filter on date keep working. Additive: every existing row is a dated item (0).
-- (0020 belongs to 0.8.1-7, contributors without Saldo; the migrator applies any unrecorded version.)
ALTER TABLE planned_items ADD COLUMN whole_month INTEGER NOT NULL DEFAULT 0 CHECK (whole_month IN (0, 1));
