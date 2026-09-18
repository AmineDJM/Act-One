import { Database } from '../client.ts';

/**
 * Creates (or updates) the role the application connects as.
 *
 *   ACT_ONE_APP_ROLE=act_one_app ACT_ONE_APP_ROLE_PASSWORD=... npm run db:app-role
 *
 * Row-level security is the second lock on every tenant table, and Postgres
 * never applies it to a superuser. Migrations run as the database owner; the
 * web app and the worker must not. This provisions a role that can read and
 * write every table and bypass nothing, so the policies in 0002_rls.sql are
 * the ones actually deciding what a query returns. The same role is what the
 * test suite connects as to prove those policies hold.
 */
const name = process.env.ACT_ONE_APP_ROLE ?? 'act_one_app';
const password = process.env.ACT_ONE_APP_ROLE_PASSWORD ?? '';
if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
  console.error(`[app-role] "${name}" is not a usable role name.`);
  process.exit(1);
}

const db = new Database();
try {
  await db.withPlatform(async (client) => {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN
          EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', '${name}');
        END IF;
      END
      $$
    `);
    if (password) {
      await client.query(`ALTER ROLE "${name}" WITH PASSWORD $1`.replace('$1', quoteLiteral(password)));
    }
    await client.query(`GRANT USAGE ON SCHEMA public TO "${name}"`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${name}"`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${name}"`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${name}"`,
    );
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${name}"`);
  });
  console.log(`[app-role] ${name} can read and write every table and bypasses no policy.`);
} finally {
  await db.close();
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
