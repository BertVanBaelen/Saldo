-- Planning data (0.8-1). The planning tables exist since 0001 and nothing wrote
-- them; two of them need a different shape, and SQLite cannot change a CHECK,
-- so both are rebuilt (every row is copied, ids kept). Nothing references
-- either table.
--   recurring_items.kind               gains 'contribution' (a member's payment into a shared account)
--   recurring_items.counterparty_iban  the counterparty's IBAN, normalised as accounts.iban; NULL when the
--                                      rows it was confirmed from carry none. Never in an API answer.
--   budgets.monthly_amount             may be NULL: "no budget from this month on, use the average"
CREATE TABLE recurring_items_new (
    id               INTEGER PRIMARY KEY,
    account_id       INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    user_id          INTEGER REFERENCES users (id) ON DELETE CASCADE, -- NULL: belongs to the account
    counterparty     TEXT    NOT NULL DEFAULT '',
    counterparty_iban TEXT,
    description      TEXT    NOT NULL DEFAULT '',
    amount           INTEGER NOT NULL,
    amount_rule      TEXT    NOT NULL DEFAULT 'fixed' CHECK (amount_rule IN ('fixed', 'average')),
    frequency        TEXT    NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
    expected_day     INTEGER NOT NULL CHECK (expected_day BETWEEN 1 AND 31),
    expected_month   INTEGER CHECK (expected_month BETWEEN 1 AND 12),
    end_date         TEXT,
    kind             TEXT    NOT NULL CHECK (kind IN ('income', 'expense', 'transfer', 'saving', 'contribution')),
    state            TEXT    NOT NULL DEFAULT 'suggested' CHECK (state IN ('suggested', 'confirmed', 'ignored')),
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
INSERT INTO recurring_items_new (id, account_id, user_id, counterparty, description, amount, amount_rule, frequency,
                                 expected_day, expected_month, end_date, kind, state, created_at)
    SELECT id, account_id, user_id, counterparty, description, amount, amount_rule, frequency,
           expected_day, expected_month, end_date, kind, state, created_at FROM recurring_items;
DROP TABLE recurring_items;
ALTER TABLE recurring_items_new RENAME TO recurring_items;
CREATE INDEX recurring_items_account ON recurring_items (account_id);

CREATE TABLE budgets_new (
    id             INTEGER PRIMARY KEY,
    account_id     INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    category_id    INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    monthly_amount INTEGER CHECK (monthly_amount IS NULL OR monthly_amount >= 0),
    from_month     TEXT    NOT NULL,                   -- 'YYYY-MM'
    UNIQUE (account_id, category_id, from_month)
);
INSERT INTO budgets_new (id, account_id, category_id, monthly_amount, from_month)
    SELECT id, account_id, category_id, monthly_amount, from_month FROM budgets;
DROP TABLE budgets;
ALTER TABLE budgets_new RENAME TO budgets;
