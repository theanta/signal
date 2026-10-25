-- ============================================================
-- Accounts: forced password change, and one-time links for invites.
--
-- Run after 2026-10-28_platform_admin.sql. One transaction. The same block,
-- minus BEGIN/COMMIT, closes supabase/schema.sql.
-- ============================================================

BEGIN;

-- users.must_change_password: set when an admin chose the password (a
-- temporary one) or sent an invite; cleared when the user sets their own.
-- Readable by tenant sessions so Team can show who is still "invited".
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
GRANT SELECT (must_change_password) ON users TO authenticated;

-- One-time "set your password" links (invites; later, password resets).
-- Only the SHA-256 of the token is stored. service_role only, like
-- refresh_tokens: no tenant session can read or write it.
CREATE TABLE IF NOT EXISTS password_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_tokens_user ON password_tokens(user_id);

ALTER TABLE password_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON password_tokens;
CREATE POLICY "service_role_all" ON password_tokens FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON password_tokens FROM anon, authenticated;
GRANT ALL ON password_tokens TO service_role;

COMMIT;
