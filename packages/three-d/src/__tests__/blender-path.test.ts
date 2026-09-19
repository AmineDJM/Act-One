import { describe, it, expect, afterEach } from 'vitest';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBlender } from '../renderer.ts';

/**
 * Where Blender is found, and in what order.
 *
 * This matters more than it looks. A worker that cannot find Blender does not
 * fail — every 3D shot quietly stages itself flat and the film still renders,
 * so the only symptom is that the technique is missing. It went missing in
 * production for exactly that reason: the build installed the two browsers
 * and not this.
 */
const INSTALLED = path.join(
  path.resolve(fileURLToPath(new URL('../../../..', import.meta.url))),
  'node_modules',
  '.blender',
  'blender',
);

const before = process.env['ACT_ONE_BLENDER_PATH'];
afterEach(() => {
  if (before === undefined) delete process.env['ACT_ONE_BLENDER_PATH'];
  else process.env['ACT_ONE_BLENDER_PATH'] = before;
});

describe('finding Blender', () => {
  it('lets a caller name one outright', async () => {
    expect(await resolveBlender('/somewhere/blender')).toBe('/somewhere/blender');
  });

  it('lets the host name one, over anything the build downloaded', async () => {
    process.env['ACT_ONE_BLENDER_PATH'] = '/opt/host/blender';
    expect(await resolveBlender()).toBe('/opt/host/blender');
  });

  it('uses the copy the build downloaded, with nothing configured at all', async () => {
    delete process.env['ACT_ONE_BLENDER_PATH'];
    const present = await access(INSTALLED, constants.X_OK).then(() => true).catch(() => false);
    const resolved = await resolveBlender();
    // On a machine where the build has not run, PATH is the honest answer.
    expect(resolved).toBe(present ? INSTALLED : 'blender');
  });
});
