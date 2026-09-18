-- Act One :: the platform's own workspace
--
-- The journal is written by the product, not by a customer, and its model
-- calls cost money like any other. Rather than let that cost fall outside
-- the ledger — or bend the ledger to allow work with no workspace — the
-- platform gets one workspace of its own, with a fixed id the code knows.
--
-- Nobody can sign into it: it has no memberships, and none can be made
-- through the product. It exists so that "what does the journal cost?" is
-- answered by the same query as "what does a customer cost?".

INSERT INTO organizations (id, name, slug, plan_id, credit_balance, max_project_cost_usd, is_suspended)
VALUES ('org_platform', 'Act One (platform)', 'act-one-platform', 'studio', 0, 1000, false)
ON CONFLICT (id) DO NOTHING;
