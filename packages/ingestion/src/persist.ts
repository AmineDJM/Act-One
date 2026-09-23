import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AssetRef } from './schema.ts';
import type { IngestionResult } from './engine.ts';

/**
 * Writes a run to a directory: `manifest.json` and one file per asset.
 *
 * File names come from the manifest, which the schema already restricts to
 * `[a-z0-9._-]`; each is still re-validated and resolved against the target
 * directory before writing, so a manifest from anywhere cannot write outside it.
 */
export async function writeIngestion(result: IngestionResult, directory: string): Promise<string[]> {
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  const written: string[] = [];
  for (const asset of result.assets) {
    const ref = AssetRef.parse(asset);
    const target = path.resolve(root, ref.fileName);
    if (path.dirname(target) !== root) throw new Error(`Refusing to write ${ref.fileName} outside ${root}.`);
    await writeFile(target, asset.data);
    written.push(target);
  }
  const manifestPath = path.join(root, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  written.push(manifestPath);
  return written;
}
