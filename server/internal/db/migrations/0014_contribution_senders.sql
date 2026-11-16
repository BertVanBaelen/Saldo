-- Contributions (0.6-5). A member of a shared account declares, from their
-- own side, which sender IBAN pays their contribution into it; the figure per
-- member and month is the sum of the account's own booked incoming rows from
-- those senders. One sender belongs to one member per account.
--   iban   normalised (upper case, letters and digits only), as accounts.iban
CREATE TABLE contribution_senders (
    id         INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    iban       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (account_id, iban)
);
CREATE INDEX contribution_senders_user ON contribution_senders (user_id);
