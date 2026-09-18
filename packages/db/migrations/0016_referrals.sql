-- Act One :: referrals
--
-- One row per person who arrived on somebody's referral link, from the
-- moment they sign up to the moment their inviter is paid for them. The
-- unique constraint on the invited user is the anti-abuse rule that
-- matters most: a person can be referred once, ever, by one person, so
-- credits cannot be minted by inviting the same account twice.
--
-- The programme's own rules (what a referral pays, the tiers, the cap)
-- live in platform_settings.product alongside the phase, because they are
-- the operator's configuration rather than a customer's data.
--
-- Platform-only, like invitations: a referral belongs to the platform, not
-- to either workspace, and both sides are read server-side.

CREATE TABLE referrals (
  id                       TEXT PRIMARY KEY,
  code                     TEXT NOT NULL,
  invite_code_id           TEXT NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
  inviter_user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_user_id          TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  invited_organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stage                    TEXT NOT NULL DEFAULT 'signed_up',
  inviter_credits_granted  INTEGER NOT NULL DEFAULT 0,
  invited_credits_granted  INTEGER NOT NULL DEFAULT 0,
  rewarded_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  data                     JSONB NOT NULL
);

CREATE INDEX referrals_inviter_idx ON referrals (inviter_user_id, created_at DESC);
CREATE INDEX referrals_stage_idx ON referrals (stage, created_at DESC);
CREATE INDEX referrals_organization_idx ON referrals (invited_organization_id);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals FORCE ROW LEVEL SECURITY;
CREATE POLICY referrals_platform_only ON referrals USING (app_is_platform()) WITH CHECK (app_is_platform());
