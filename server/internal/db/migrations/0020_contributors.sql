-- Contributors without Saldo (0.8.1-7). A shared account may name people who pay into it but do not
-- use Saldo: a name, the IBAN their transfers come from (normalised, for matching the account's own
-- rows only; never returned in full) and an optional share. link_user is a pending offer by the
-- manager to link the contributor to a member, who answers it. Additive: contribution_senders is
-- untouched and no notice type is added. One IBAN is one contributor or one member's sender per
-- account (the server checks both tables).
CREATE TABLE contributors (
    id         INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    iban       TEXT    NOT NULL,
    share      INTEGER CHECK (share IS NULL OR share BETWEEN 0 AND 100),
    created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    link_user  INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (account_id, iban)
);
