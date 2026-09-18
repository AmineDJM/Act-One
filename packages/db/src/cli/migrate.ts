import { Database } from '../client.ts';
import { migrate } from '../migrate.ts';

/**
 * Applies every migration the database has not seen.
 *
 * A failure to connect is explained in words, and the connection string is
 * never printed: it carries the password, and a deploy log is not a vault.
 */
const db = new Database();
try {
  const result = await migrate(db, { log: (m) => console.log(`[migrate] ${m}`) });
  console.log(
    `[migrate] applied ${result.applied.length}, already current ${result.skipped.length}`,
  );
} catch (error) {
  console.error(`[migrate] ${explain(error)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}

function explain(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const hostname = (error as { hostname?: string } | null)?.hostname ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'ENOTFOUND' && /^dpg-[a-z0-9]+-a$/.test(hostname)) {
    return (
      `The database's internal hostname (${hostname}) does not resolve from here. ` +
      'Render internal hostnames only resolve inside one region, so the database is in a ' +
      'different region than this service. Put the database in the same region (delete ' +
      'the empty one and sync the Blueprint) or set DATABASE_URL to its external connection string.'
    );
  }
  if (code === 'ENOTFOUND') return `The database host does not resolve (${hostname}). Check DATABASE_URL.`;
  if (code === 'ECONNREFUSED') return 'Nothing is listening at the database address. Check DATABASE_URL.';
  if (/password authentication failed/i.test(message)) {
    return 'The database rejected the credentials in DATABASE_URL.';
  }
  if (/does not exist/.test(message) && /database/.test(message)) {
    return 'The database named in DATABASE_URL does not exist on that server.';
  }
  return message;
}
