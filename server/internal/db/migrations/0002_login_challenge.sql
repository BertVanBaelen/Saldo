-- The sign-in challenge (phase 0.2-4): the browser holds a random token between
-- "password" and "code"; the row keeps only its SHA-256 hash, so the code can
-- only be checked together with the challenge it was sent for.
ALTER TABLE login_codes ADD COLUMN challenge_hash TEXT;
CREATE UNIQUE INDEX login_codes_challenge ON login_codes (challenge_hash);
