import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A build has no database.
 *
 * The machine that runs `next build` is not the machine that runs the
 * migrations, and on a fresh environment it is talking to a database whose
 * tables do not exist yet. Next prerenders every public page it can, so a
 * marketing page that reads published rows does not merely render stale — it
 * fails the build, and the deploy stops.
 *
 * The invariant is one line: a public page that reads the database renders per
 * request. This walks the route tree and holds it, because the failure only
 * shows up on a deploy to a fresh environment, which is exactly when nobody
 * wants to be reading a stack trace.
 *
 * The console and the signed-in product are exempt for a different reason:
 * they read the session, which opts them out of static generation anyway, and
 * the console declares it explicitly on top of that.
 */
const APP = fileURLToPath(new URL('../app', import.meta.url));

/** Signed-in and staff surfaces, which are dynamic by virtue of reading a session. */
const AUTHENTICATED = ['app', 'admin', 'api'];

const ROUTE_FILES = new Set(['page.tsx', 'route.ts', 'sitemap.ts', 'robots.ts', 'opengraph-image.tsx']);

async function routeFiles(dir: string, relative = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const at = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (relative === '' && AUTHENTICATED.includes(entry.name)) continue;
      found.push(...(await routeFiles(path.join(dir, entry.name), at)));
      continue;
    }
    if (ROUTE_FILES.has(entry.name)) found.push(at);
  }
  return found;
}

describe('what the build is allowed to need', () => {
  it('renders every public page that reads the database per request', async () => {
    const files = await routeFiles(APP);
    expect(files.length).toBeGreaterThan(8);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(path.join(APP, file), 'utf8');
      // Data loading lives in the route file in this codebase: a page either
      // imports a server module or it renders constants.
      const readsDatabase = /from '@\/server\//.test(source);
      if (!readsDatabase) continue;
      const perRequest = /export const dynamic = 'force-dynamic'/.test(source);
      if (!perRequest) offenders.push(file);
    }

    expect(offenders, `these prerender at build time and read the database:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('is looking at the route tree it thinks it is', async () => {
    const files = await routeFiles(APP);
    expect(files).toContain('collections/page.tsx');
    expect(files).toContain('sitemap.ts');
    // And it is not reaching into the surfaces it exempts.
    expect(files.some((file) => file.startsWith('admin/'))).toBe(false);
    expect(files.some((file) => file.startsWith('app/'))).toBe(false);
  });
});
