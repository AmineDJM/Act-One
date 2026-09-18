import { describe, it, expect } from 'vitest';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { runFfmpeg } from '@act-one/sound';
import { isBlenderAvailable, renderThreeDScene } from '../index.ts';

/**
 * Blender, actually run.
 *
 * Every other test here checks the script and the plan; none had ever handed
 * either to Blender, because no host had it. This renders the smallest scene
 * the rig accepts and looks at what came back. Skipped where there is no
 * Blender, and says so — a skipped test is not a passed one.
 */
const available = await isBlenderAvailable();

describe.skipIf(!available)('a 3D scene in Blender', () => {
  it('renders every frame, with the interface on the screen', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-blender-'));
    // A bright interface on a dark void: if the screen made it into the frame,
    // the frame is not dark.
    const width = 800;
    const height = 500;
    const data = Buffer.alloc(width * height * 3, 245);
    for (let y = 0; y < 40 * width * 3; y += 3) {
      data[y] = 30; data[y + 1] = 32; data[y + 2] = 38;
    }
    const screen = path.join(dir, 'screen.png');
    await writeFile(screen, await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer());

    const frames = path.join(dir, 'frames');
    const result = await renderThreeDScene({
      scene: {
        rig: 'browser_float',
        camera: 'slow_push',
        screenAssets: [screen],
        durationSeconds: 0.5,
        fps: 24,
        width: 480,
        height: 480,
        samples: 16,
        depthOfField: 0,
        background: 'void',
        backgroundColor: '#08080c',
        accentColor: '#2f6fed',
      },
      outputDir: frames,
      timeoutMs: 8 * 60_000,
    });

    expect(result.ok, result.ok ? '' : result.error).toBe(true);
    if (!result.ok) return;
    expect(result.frameCount).toBe(12);

    const files = (await readdir(frames)).filter((f) => f.startsWith('frame_')).sort();
    // Frames are EXR with alpha, for the compositor. Read one the way the
    // compositor would: decoded, and laid over the void.
    const png = path.join(dir, 'frame.png');
    const converted = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(frames, files[0]!), png]);
    expect(converted.ok, converted.stderr).toBe(true);
    const first = await sharp(png).flatten({ background: '#08080c' }).stats();
    const mean = first.channels.reduce((sum, channel) => sum + channel.mean, 0) / first.channels.length;
    const spread = Math.max(...first.channels.map((channel) => channel.stdev));
    // A void with an interface in it: not black, and not flat.
    expect(mean).toBeGreaterThan(12);
    expect(spread).toBeGreaterThan(10);
  }, 10 * 60_000);
});
