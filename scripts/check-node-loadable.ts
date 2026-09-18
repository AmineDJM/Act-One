/**
 * Every module Node itself runs must be loadable by Node itself.
 *
 *   npm run check:node
 *
 * The worker and the CLIs run on `node --experimental-strip-types`, which
 * strips type annotations and refuses TypeScript syntax that needs real
 * transformation — parameter properties, enums, namespaces. The tests run
 * under Vitest, which transforms all of it, so a file that Node cannot load
 * passes every test and fails only in production, on the first job. This
 * runs Node's own stripper over every file it might load and fails on the
 * first it refuses. Component files (.tsx) are bundled, never loaded by Node.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const ROOTS = ['packages', 'apps/worker/src', 'scripts'];
const SKIP = new Set(['node_modules', 'dist', '.next', 'coverage']);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(root, []));
const refused: string[] = [];
for (const file of files) {
  try {
    stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' });
  } catch (error) {
    refused.push(`${file}: ${(error as Error).message.split('\n')[0]}`);
  }
}

if (refused.length > 0) {
  console.error(
    `Node cannot load ${refused.length} of ${files.length} files:\n${refused.join('\n')}`,
  );
  process.exit(1);
}
console.log(`Node can load all ${files.length} files.`);
