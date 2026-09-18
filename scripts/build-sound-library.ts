import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildSoundLibrary } from '@act-one/sound';

/**
 * Renders Act One's own sound library into local storage.
 *
 * Run once per deployment, before the first film. Until this has run the
 * library manifest describes files that do not exist, and the Sound Director
 * builds a perfectly correct mix of nothing at all — every film comes out
 * silent unless it happens to have narration, and nothing says why.
 *
 *   npm run sound-library            build whatever is missing
 *   npm run sound-library -- --force rebuild everything
 */
const storageDir = process.env['ACT_ONE_STORAGE_DIR'] ?? path.resolve('.act-one-demo/storage');
const force = process.argv.includes('--force');

await mkdir(storageDir, { recursive: true });

const started = Date.now();
console.log(`[sound] building into ${storageDir}${force ? ' (forced)' : ''}`);

const result = await buildSoundLibrary({
  storageDir,
  force,
  exists: async (target) => {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  },
  onProgress: (message, done, total) => {
    console.log(`[sound] ${String(Math.min(done + 1, total)).padStart(2)}/${total} ${message}`);
  },
});

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `[sound] ${result.written.length} written, ${result.skipped.length} already present, in ${seconds}s`,
);
if (result.skipped.length > 0 && !force) {
  console.log('[sound] pass --force to rebuild the ones that were skipped');
}
