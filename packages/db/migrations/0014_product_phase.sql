-- Act One :: the product's phase, invitations, and requests for access
--
-- The platform's one settings row gains the product configuration: which
-- phase the product is in, what the landing page says, which mark the name
-- carries. Invitation codes open the door in a private beta — bounded by
-- uses and by time, withdrawable — and a referral code is one with an
-- owner. Requests for access wait for a person to decide. None of this
-- belongs to a workspace, so all of it is the platform's alone.

ALTER TABLE platform_settings ADD COLUMN product JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE invite_codes (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  kind               TEXT NOT NULL DEFAULT 'invite',
  note               TEXT NOT NULL DEFAULT '',
  max_uses           INTEGER,
  uses               INTEGER NOT NULL DEFAULT 0,
  expires_at         TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  owner_user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX invite_codes_owner_idx ON invite_codes (owner_user_id) WHERE owner_user_id IS NOT NULL;

CREATE TABLE invite_redemptions (
  code_id  TEXT NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code_id, user_id)
);
CREATE INDEX invite_redemptions_user_idx ON invite_redemptions (user_id);

CREATE TABLE beta_applications (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL,
  name                TEXT NOT NULL DEFAULT '',
  company             TEXT NOT NULL DEFAULT '',
  website             TEXT,
  message             TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'pending',
  invite_code_id      TEXT REFERENCES invite_codes(id) ON DELETE SET NULL,
  note                TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ,
  decided_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX beta_applications_status_idx ON beta_applications (status, created_at DESC);
CREATE INDEX beta_applications_email_idx ON beta_applications (lower(email), created_at DESC);

DO $$
DECLARE platform_table TEXT;
BEGIN
  FOREACH platform_table IN ARRAY ARRAY['invite_codes', 'invite_redemptions', 'beta_applications']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', platform_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', platform_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (app_is_platform()) WITH CHECK (app_is_platform())',
      platform_table || '_platform_only', platform_table
    );
  END LOOP;
END $$;
