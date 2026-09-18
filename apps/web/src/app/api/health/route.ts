import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getDatabase, getStore, isUsingMemoryStore } from '@/server/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Whether this instance can actually serve a customer.
 *
 * A process that answers HTTP is not a service that works: the first deploy
 * answered every page and could not create an account, because nothing had
 * run the migrations and the database had no tables. So this asks the
 * questions a deploy should fail on — is the database reachable, and is its
 * schema the one this code was written against — and a host that checks it
 * marks a broken deploy failed, with the reason here, before anyone signs up.
 *
 * Says what is wrong in words but never how the database is reached: the
 * connection string is the one thing this must not print.
 */
export async function GET(): Promise<NextResponse> {
  if (isUsingMemoryStore()) {
    return NextResponse.json({ ok: true, store: 'memory', note: 'Development only: nothing persists.' });
  }

  try {
    await getStore().users.count();
    const pending = await pendingMigrations();
    if (pending.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          store: 'postgres',
          reason: `${pending.length} migration(s) not applied: ${pending.join(', ')}. Run \`npm run migrate\` against this database.`,
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, store: 'postgres' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hostname = (error as { hostname?: string } | null)?.hostname ?? '';
    const reason = /does not exist/.test(message)
      ? 'The database has no schema. Run `npm run migrate` against it.'
      : /ENOTFOUND/.test(message) && /^dpg-[a-z0-9]+-a$/.test(hostname)
        ? "The database's internal hostname does not resolve: it is in a different Render region than this service. Put both in the same region."
        : /ECONNREFUSED|ENOTFOUND|timeout|password|authentication|ssl/i.test(message)
          ? 'The database cannot be reached with the configured DATABASE_URL.'
          : 'The database returned an error.';
    console.error(`[health] ${reason} ${message}`);
    return NextResponse.json({ ok: false, store: 'postgres', reason }, { status: 503 });
  }
}

/**
 * Migration files the database has not recorded as applied.
 *
 * The migrations live in the repository, not in the bundle, so they are read
 * from disk at request time from wherever this process was started — the
 * repository root, or the web app's own directory under a workspace script.
 * Where the files cannot be found the check degrades to "connected, tables
 * present", which the query above has already proved.
 */
async function pendingMigrations(): Promise<string[]> {
  const dir = [process.cwd(), path.join(process.cwd(), '..'), path.join(process.cwd(), '..', '..')]
    .map((base) => path.join(base, 'packages', 'db', 'migrations'))
    .find((candidate) => existsSync(candidate));
  const db = getDatabase();
  if (!dir || !db) return [];

  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const applied = await db.withPlatform(async (client) => {
    const rows = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    return new Set(rows.rows.map((row) => row.name));
  });
  return files.filter((file) => !applied.has(file));
}
