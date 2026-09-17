import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './client.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Migrations run inside a transaction each, recorded in schema_migrations, and
 * are never re-run. A migration that has already been applied but whose file
 * content changed is a hard error: silently diverging schemas between staging
 * and production is not a class of bug worth being relaxed about.
 */
export async function migrate(
  db: Database,
  options: { dir?: string; log?: (message: string) => void } = {},
): Promise<{ applied: string[]; skipped: string[] }> {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const log = options.log ?? (() => undefined);

  await db.withPlatform(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  });

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    const checksum = await sha256(sql);

    const existing = await db.withPlatform(async (client) => {
      const result = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name = $1',
        [file],
      );
      return result.rows[0] ?? null;
    });

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `Migration ${file} has already been applied but its contents changed. ` +
            'Add a new migration instead of editing an applied one.',
        );
      }
      skipped.push(file);
      continue;
    }

    log(`applying ${file}`);
    await db.withPlatform(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
    });
    applied.push(file);
  }

  return { applied, skipped };
}

async function sha256(input: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(input).digest('hex');
}
