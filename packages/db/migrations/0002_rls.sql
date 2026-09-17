-- Act One :: row level security
--
-- Application code already scopes every query by organization_id. This is the
-- second lock on the same door.
--
-- The application connects as a non-superuser role and, at the start of each
-- request transaction, sets `app.organization_id` to the caller's organisation.
-- Policies compare that setting to the row's organization_id, so a query that
-- forgets its WHERE clause returns nothing instead of returning another
-- customer's film. A bug becomes an empty result set rather than a breach.
--
-- `current_setting(..., true)` returns NULL when unset; every policy therefore
-- fails closed. The one deliberate exception is the platform role used by the
-- Super Admin console and the render worker, which bypasses RLS explicitly.

CREATE OR REPLACE FUNCTION app_current_organization() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '');
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION app_is_platform() RETURNS BOOLEAN AS $$
  SELECT COALESCE(current_setting('app.platform_access', true), 'off') = 'on';
$$ LANGUAGE SQL STABLE;

DO $$
DECLARE
  tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'memberships', 'invitations', 'subscriptions', 'brands', 'projects',
    'product_understandings', 'concepts', 'treatments', 'storyboards', 'scenes',
    'assets', 'renders', 'variants', 'qa_reports', 'jobs', 'generation_costs',
    'comments', 'approvals', 'revision_requests', 'product_credentials',
    'credential_audit_events', 'voice_consents'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = app_current_organization() OR app_is_platform())
       WITH CHECK (organization_id = app_current_organization() OR app_is_platform())',
      tenant_table || '_tenant_isolation',
      tenant_table
    );
  END LOOP;
END
$$;

-- Organizations themselves: a member sees only their own organisation row.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant_isolation ON organizations
  USING (id = app_current_organization() OR app_is_platform())
  WITH CHECK (id = app_current_organization() OR app_is_platform());

-- Users and sessions are cross-tenant by nature (one person, many orgs), so they
-- are reachable only by the platform role and by the auth layer, which runs
-- with platform access and its own explicit filters.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_platform_only ON users USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_platform_only ON sessions USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_settings_platform_only ON platform_settings
  USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE provider_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_secrets_platform_only ON provider_secrets
  USING (app_is_platform()) WITH CHECK (app_is_platform());

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events FORCE ROW LEVEL SECURITY;
CREATE POLICY stripe_events_platform_only ON stripe_events
  USING (app_is_platform()) WITH CHECK (app_is_platform());
