import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TRUE_PEAK_CEILING } from '@act-one/core';
import { deliverWithinCeiling, measureLoudness, runFfmpeg } from '../index.ts';

/**
 * The file that leaves is the file that is measured.
 *
 * A master under the ceiling as a WAV can be over it as the AAC anybody plays:
 * the encode raises peaks. Proved against real FFmpeg with a hard-edged tone
 * whose encode overshoots by more than three decibels, the worst case a
 * percussive bed and its impacts drift toward.
 */
let dir = '';

async function ffmpeg(args: string[]): Promise<void> {
  const result = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  if (!result.ok) throw new Error(result.stderr);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'act-one-deliver-'));
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'picture.mp4')]);
  // A square wave: every edge is a transient AAC overshoots.
  await ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.79*sgn(sin(2*PI*220*t))|0.79*sgn(sin(2*PI*220*t))':s=48000:d=4", '-c:a', 'pcm_s24le', path.join(dir, 'hot.wav')]);
  // A soft sine: nothing for the encode to overshoot.
  await ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.25*sin(2*PI*220*t)|0.25*sin(2*PI*220*t)':s=48000:d=4", '-c:a', 'pcm_s24le', path.join(dir, 'soft.wav')]);
});

describe('delivering a film within the true-peak ceiling', () => {
  it('measures the encoded file, and holds the master lower until the delivery is under −1 dBTP', async () => {
    const output = path.join(dir, 'hot.mp4');
    const encodedOnce = path.join(dir, 'hot-once.mp4');
    const once = await deliverWithinCeiling({ video: path.join(dir, 'picture.mp4'), master: path.join(dir, 'hot.wav'), output: encodedOnce, maxPasses: 1 });
    // What one plain encode ships: over the ceiling.
    expect(once.measured!.truePeakDb).toBeGreaterThan(TRUE_PEAK_CEILING);

    const delivery = await deliverWithinCeiling({ video: path.join(dir, 'picture.mp4'), master: path.join(dir, 'hot.wav'), output, pictureSeconds: 4 });
    expect(delivery.ok).toBe(true);
    expect(delivery.passes).toBeGreaterThan(1);
    expect(delivery.measured!.truePeakDb).toBeLessThanOrEqual(TRUE_PEAK_CEILING);
    // And it is what the file says, measured afresh.
    expect((await measureLoudness(output))!.truePeakDb).toBeLessThanOrEqual(TRUE_PEAK_CEILING);
  }, 60_000);

  it('muxes once and touches nothing when the encode stays under the ceiling', async () => {
    const delivery = await deliverWithinCeiling({ video: path.join(dir, 'picture.mp4'), master: path.join(dir, 'soft.wav'), output: path.join(dir, 'soft.mp4') });
    expect(delivery).toMatchObject({ ok: true, passes: 1 });
    expect(delivery.measured!.truePeakDb).toBeLessThan(TRUE_PEAK_CEILING);
  }, 60_000);
});
