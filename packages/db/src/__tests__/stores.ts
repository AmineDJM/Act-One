import { newId } from '@act-one/core';
import { Database } from '../client.ts';
import { MemoryStore } from '../memory-store.ts';
import { PgStore } from '../pg-store.ts';
import type { Store } from '../store.ts';

/**
 * The store implementations a conformance suite runs against.
 *
 * The in-memory store always. Postgres when ACT_ONE_TEST_DATABASE_URL names a
 * migrated database — CI does, so every rule the suites state about tenancy,
 * the queue and the ledger is proven against the implementation production
 * runs on, not only against the one that is convenient. Point it at a role
 * that is not a superuser: Postgres never applies row-level security to one,
 * and the whole point of running here is that the policies decide.
 */
export type StoreCase = {
  name: string;
  /** A store for one test. The in-memory one is fresh; the Postgres one shares the database. */
  open: () => Promise<Store>;
  close: (store: Store) => Promise<void>;
  /**
   * Empties the queue. Jobs are claimed globally, not per organisation, so a
   * suite about claiming cannot share a table with the jobs an earlier test
   * left behind. The in-memory store starts empty; the database does not.
   */
  clearJobs: (store: Store) => Promise<void>;
};

export function storeCases(): StoreCase[] {
  const cases: StoreCase[] = [
    {
      name: 'MemoryStore',
      open: async () => new MemoryStore(),
      close: async () => undefined,
      clearJobs: async () => undefined,
    },
  ];
  const url = process.env.ACT_ONE_TEST_DATABASE_URL;
  if (url) {
    cases.push({
      name: 'PgStore',
      open: async () => new PgStore(new Database({ connectionString: url, max: 2 })),
      close: (store) => (store as PgStore).close(),
      clearJobs: async (store) => {
        await (store as PgStore).raw((client) => client.query('DELETE FROM jobs'));
      },
    });
  }
  return cases;
}

export const postgresAvailable = Boolean(process.env.ACT_ONE_TEST_DATABASE_URL);

/**
 * A slug or an email that is unique per call. The Postgres schema enforces
 * uniqueness on both, and a suite that runs against a database that outlives
 * the test process cannot reuse "acme" twice.
 */
export function uniqueSlug(base: string): string {
  return `${base.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${newId('org').slice(-8)}`;
}

export function uniqueEmail(local: string, domain = 'example.com'): string {
  return `${local}-${newId('usr').slice(-8)}@${domain}`;
}
