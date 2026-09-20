import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_PROVIDER_CONFIG, ProviderRegistry, loadLocalEnv } from '../index.ts';

/**
 * A key that the process cannot see is a key that does not exist.
 *
 * Act One spent weeks reporting "no video provider is configured" to somebody
 * who had configured one — it was in a file, or in another service's
 * environment, and nothing on this side ever read it. Two separate mistakes,
 * both of which end with a film that quietly came out as stills:
 *
 *  1. Never looking in the file.
 *  2. Looking at whether a provider OBJECT exists, which needs no credentials
 *     at all, and calling that "video is available".
 */
const KEYS = ['ACT_ONE_TEST_ONE', 'ACT_ONE_TEST_TWO', 'HF_CREDENTIALS'] as const;
const saved = new Map<string, string | undefined>();
for (const key of KEYS) saved.set(key, process.env[key]);

afterEach(() => {
  for (const key of KEYS) {
    const was = saved.get(key);
    if (was === undefined) delete process.env[key];
    else process.env[key] = was;
  }
});

describe('credentials from a file the repository ignores', () => {
  it('loads what is there and reports the names it set', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-env-'));
    await writeFile(
      path.join(dir, '.env.local'),
      ['# a comment', '', 'ACT_ONE_TEST_ONE=plain', "ACT_ONE_TEST_TWO='quoted value'", 'NOT_A_LINE'].join('\n'),
    );
    delete process.env.ACT_ONE_TEST_ONE;
    delete process.env.ACT_ONE_TEST_TWO;

    const loaded = loadLocalEnv(dir);
    expect(loaded).toEqual(['ACT_ONE_TEST_ONE', 'ACT_ONE_TEST_TWO']);
    expect(process.env.ACT_ONE_TEST_ONE).toBe('plain');
    expect(process.env.ACT_ONE_TEST_TWO).toBe('quoted value');
  });

  it('never overrides the real environment', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-env-'));
    await writeFile(path.join(dir, '.env.local'), 'ACT_ONE_TEST_ONE=from-the-file\n');
    process.env.ACT_ONE_TEST_ONE = 'from-the-deployment';

    expect(loadLocalEnv(dir)).toEqual([]);
    expect(process.env.ACT_ONE_TEST_ONE).toBe('from-the-deployment');
  });

  it('returns names, never values', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-env-'));
    await writeFile(path.join(dir, '.env.local'), 'ACT_ONE_TEST_ONE=s3cret\n');
    delete process.env.ACT_ONE_TEST_ONE;
    expect(loadLocalEnv(dir).join(' ')).not.toMatch(/s3cret/);
  });

  it('is quiet about a directory with no such file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-env-'));
    expect(loadLocalEnv(dir)).toEqual([]);
  });
});

describe('a provider that exists and a provider that can be called', () => {
  it('does not call generative media available on credentials nobody supplied', () => {
    delete process.env.HF_CREDENTIALS;
    delete process.env.HF_KEY;
    delete process.env.HF_API_KEY;
    const registry = new ProviderRegistry({});
    // Enabled: the object is constructible, which is the trap.
    expect(registry.mediaOrNull()).not.toBeNull();
    expect(registry.mediaReady()).toBeNull();
  });

  it('says available once the credentials are there', () => {
    process.env.HF_CREDENTIALS = 'key-id:key-secret';
    const registry = new ProviderRegistry({});
    expect(registry.mediaReady()).not.toBeNull();
  });

  it('stays null when an operator has switched generative media off', () => {
    process.env.HF_CREDENTIALS = 'key-id:key-secret';
    const registry = new ProviderRegistry({
      config: { ...DEFAULT_PROVIDER_CONFIG, media: { ...DEFAULT_PROVIDER_CONFIG.media, enabled: false } },
    });
    expect(registry.mediaOrNull()).toBeNull();
    expect(registry.mediaReady()).toBeNull();
  });
});
