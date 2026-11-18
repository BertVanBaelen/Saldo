-- Shared flag and invitations (0.8-0b). An account is shared when its manager
-- declared it so (shared = 1) or when it has more than one member; the two are
-- one derived value (ledger.IsShared). A row of account_invitations is an open
-- invitation of user_id by invited_by; accepting, declining and revoking delete
-- it, and one older than 30 days is ignored (ledger.InvitationTTL). Additive,
-- so an older binary on a restored backup ignores both.
ALTER TABLE accounts ADD COLUMN shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1));

CREATE TABLE account_invitations (
    id         INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,  -- the invitee
    invited_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL,
    UNIQUE (account_id, user_id)
);
CREATE INDEX account_invitations_user ON account_invitations (user_id);
