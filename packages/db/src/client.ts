import pg from 'pg';
import { AppError } from '@act-one/core';

const { Pool } = pg;

/**
 * Postgres access.
 *
 * Two things this class exists to guarantee:
 *
 *  1. Tenant-scoped work runs inside a transaction that has set
 *     `app.organization_id`, so row-level security (migration 0002) is active.
 *     Calling code cannot forget, because the only way to get a client is
 *     through withTenant() or the explicitly-named withPlatform().
 *  2. Numerics come back as numbers. node-postgres returns NUMERIC as a string
 *     to avoid float precision loss, which silently turns cost arithmetic into
 *     string concatenation. We opt into numbers deliberately, and money is
 *     stored with enough scale that double precision is not a problem at our
 *     magnitudes.
 */
pg.types.setTypeParser(1700, (value: string) => Number.parseFloat(value));
pg.types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

export type QueryClient = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
};

export class Database {
  private readonly pool: pg.Pool;

  constructor(options: { connectionString?: string; max?: number; ssl?: boolean } = {}) {
    const connectionString = options.connectionString ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new AppError('internal', 'DATABASE_URL is not configured.');
    }
    const needsSsl =
      options.ssl ??
      (/\bsslmode=require\b/.test(connectionString) ||
        (!/localhost|127\.0\.0\.1/.test(connectionString) &&
          process.env.PGSSLMODE !== 'disable'));

    this.pool = new Pool({
      connectionString,
      max: options.max ?? Number(process.env.PGPOOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    // An unhandled pool error terminates the process by default. A render
    // worker losing the pool mid-job should log and let the job be reclaimed,
    // not take down an hour of rendering with it.
    this.pool.on('error', (error) => {
      console.error('[db] idle client error', error.message);
    });
  }

  /** Runs fn inside a transaction scoped to one organisation, with RLS active. */
  async withTenant<T>(organizationId: string, fn: (client: QueryClient) => Promise<T>): Promise<T> {
    if (!organizationId) {
      throw new AppError('internal', 'withTenant called without an organisation id.');
    }
    return this.transaction(async (client) => {
      await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', organizationId]);
      return fn(client);
    });
  }

  /**
   * Bypasses tenant isolation. Only the auth layer, the Super Admin console,
   * the job queue dispatcher and Stripe webhooks may use this, and each of
   * those applies its own filtering. Named to be conspicuous in review.
   */
  async withPlatform<T>(fn: (client: QueryClient) => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      await client.query('SELECT set_config($1, $2, true)', ['app.platform_access', 'on']);
      return fn(client);
    });
  }

  async transaction<T>(fn: (client: QueryClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Builds `SET col = $n` fragments from a patch, skipping undefined values. */
export function buildUpdate(
  patch: Record<string, unknown>,
  columnMap: Record<string, string>,
  startIndex = 1,
): { fragment: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  let index = startIndex;
  for (const [key, column] of Object.entries(columnMap)) {
    const value = patch[key];
    if (value === undefined) continue;
    parts.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  }
  return { fragment: parts.join(', '), values };
}
