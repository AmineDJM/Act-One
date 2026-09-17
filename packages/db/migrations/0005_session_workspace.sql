-- Act One :: the workspace a session is looking at
--
-- A session resolved its organisation as "the first membership this user has",
-- which is fine while everybody belongs to exactly one workspace and wrong the
-- moment anybody accepts an invitation: they join, and then never see what they
-- joined, because the old membership still sorts first.
--
-- The session now names the workspace it is in. It is validated against a live
-- membership on every request, so a session pointing at a workspace somebody
-- has been removed from falls back rather than granting access to it.

ALTER TABLE sessions ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
