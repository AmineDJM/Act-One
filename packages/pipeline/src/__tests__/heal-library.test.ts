import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalFsStorageProvider, type StorageProvider } from '@act-one/providers';
import type { StageContext } from '../context.ts';
import { healLibrary } from '../stages/render.ts';

/**
 * A film whose sounds are not in storage is not a silent film.
 *
 * The house library is rendered from its scores, so what storage lacks is
 * made where the film is being mixed, played from there, and kept under its
 * library key for the next film. Proved with two short effects, rendered and
 * mastered for real by FFmpeg, against a real local store.
 */
function contextWith(storage: StorageProvider): Pick<StageContext, 'registry'> {
  return { registry: { storage: () => storage } } as unknown as Pick<StageContext, 'registry'>;
}

describe('the house library, healed at render time', () => {
  it('makes what this film needs, plays it from the work directory, and keeps it for the next film', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'act-one-heal-store-'));
    const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-heal-work-'));
    const storage = new LocalFsStorageProvider({ root });
    const made = await healLibrary(contextWith(storage), ['library/sfx/ui-click.wav', 'library/sfx/whoosh-short.wav', 'org/elsewhere/voice.wav'], workDir);

    expect(Object.keys(made).sort()).toEqual(['library/sfx/ui-click.wav', 'library/sfx/whoosh-short.wav']);
    for (const [key, file] of Object.entries(made)) {
      expect(file.startsWith(workDir)).toBe(true);
      expect(existsSync(file)).toBe(true);
      expect(await storage.exists(key)).toBe(true);
    }
    // A key that is not the house library's is nobody's to make.
    expect(await storage.exists('org/elsewhere/voice.wav')).toBe(false);
  }, 60_000);

  it('still plays what it made when storage will not keep it', async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-heal-work-'));
    const refusing = { putFile: async () => { throw new Error('bucket is read-only'); } } as unknown as StorageProvider;
    const made = await healLibrary(contextWith(refusing), ['library/sfx/ui-click.wav'], workDir);
    expect(existsSync(made['library/sfx/ui-click.wav']!)).toBe(true);
  }, 60_000);

  it('does nothing when nothing of the house library is missing', async () => {
    const untouched = {} as StorageProvider;
    expect(await healLibrary(contextWith(untouched), [], '/nonexistent')).toEqual({});
    expect(await healLibrary(contextWith(untouched), ['org/elsewhere/voice.wav'], '/nonexistent')).toEqual({});
  });
});
