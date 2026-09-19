import { describe, it, expect, afterEach } from 'vitest';
import { LocalFsStorageProvider, SupabaseStorageProvider, sharedStorageRequired } from '../index.ts';

/**
 * Whether two machines can both reach what a film is stored in.
 *
 * The web service and the render worker are separate instances with separate
 * disks. A deployment with no object store configured got local disk from the
 * fallback: the worker wrote every master to its own instance, the web service
 * answered ENOENT to every download, and the film existed in the database, was
 * offered on the page, and could not be played by anybody. The only trace was
 * an error naming a path that had never been on the machine reading it.
 *
 * The fallback still exists, because a laptop and CI want it. What has changed
 * is that it is no longer silent, and no longer allowed where it cannot work.
 */
const SAVED = { NODE_ENV: process.env.NODE_ENV, SINGLE: process.env['ACT_ONE_SINGLE_MACHINE'] };

afterEach(() => {
  if (SAVED.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = SAVED.NODE_ENV;
  if (SAVED.SINGLE === undefined) delete process.env['ACT_ONE_SINGLE_MACHINE'];
  else process.env['ACT_ONE_SINGLE_MACHINE'] = SAVED.SINGLE;
});

describe('which stores two services can share', () => {
  it('knows local disk cannot be shared', () => {
    expect(new LocalFsStorageProvider().shared).toBe(false);
  });

  it('knows an object store over the network can', () => {
    expect(new SupabaseStorageProvider({ url: 'https://x.supabase.co', serviceKey: 'k' }).shared).toBe(true);
  });

  it('counts an unconfigured object store as shared, because it is the wiring that is missing', () => {
    // The distinction being drawn is about the kind of store, not about
    // whether somebody has filled the form in yet: an unconfigured Supabase
    // fails its own health check, which is a different and clearer message.
    expect(new SupabaseStorageProvider({}).shared).toBe(true);
  });
});

describe('when a deployment is allowed to use a store only it can read', () => {
  it('requires a shared store in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env['ACT_ONE_SINGLE_MACHINE'];
    expect(sharedStorageRequired()).toBe(true);
  });

  it('does not outside production, where one process reads what it wrote', () => {
    process.env.NODE_ENV = 'test';
    expect(sharedStorageRequired()).toBe(false);
  });

  it('lets a single-machine deployment say so, rather than guessing for it', () => {
    process.env.NODE_ENV = 'production';
    process.env['ACT_ONE_SINGLE_MACHINE'] = '1';
    expect(sharedStorageRequired()).toBe(false);
  });
});
