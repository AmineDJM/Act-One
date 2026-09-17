import 'server-only';
import { Database, MemoryStore, PgStore, type Store } from '@act-one/db';

/**
 * The application's Store.
 *
 * Postgres in production. When DATABASE_URL is absent the app runs against the
 * in-memory implementation instead of refusing to boot — that is what makes
 * `npm run dev` work on a fresh clone, and the in-memory store is a real
 * implementation of the same contract rather than a stub, so behaviour does not
 * diverge. It is refused outright in production, where a missing DATABASE_URL
 * means a misconfigured deploy, not a convenience.
 */
declare global {
  // eslint-disable-next-line no-var
  var __actOneStore: Store | undefined;
  // eslint-disable-next-line no-var
  var __actOneDb: Database | undefined;
}

function build(): Store {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DATABASE_URL is not set. Refusing to start in production without a database.',
      );
    }
    console.warn('[store] DATABASE_URL not set — using the in-memory store (development only).');
    return new MemoryStore();
  }

  const db = new Database({ connectionString });
  globalThis.__actOneDb = db;
  return new PgStore(db);
}

/**
 * Cached on globalThis rather than in a module variable: Next.js hot-reloads
 * modules in development, and a per-module pool leaks a connection pool on
 * every edit until Postgres refuses new connections.
 */
export function getStore(): Store {
  if (!globalThis.__actOneStore) {
    globalThis.__actOneStore = build();
  }
  return globalThis.__actOneStore;
}

export function getDatabase(): Database | null {
  return globalThis.__actOneDb ?? null;
}

export function isUsingMemoryStore(): boolean {
  return !process.env.DATABASE_URL;
}
