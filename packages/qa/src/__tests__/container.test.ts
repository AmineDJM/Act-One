import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFfmpeg } from '@act-one/sound';
import { decodeCleanly, playabilityIssues, readContainer, verifyMaster } from '../container.ts';

/**
 * Real files. The reference films on the marketing site are masters this
 * pipeline produced; the bad ones are made here with the same encoder, each
 * wrong in one specific way a browser refuses.
 */
const work = fileURLToPath(new URL('../../../../apps/web/public/work/', import.meta.url));
let dir = '';

async function encode(name: string, args: string[]): Promise<string> {
  const out = path.join(dir, name);
  const result = await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    ...args,
    out,
  ]);
  if (!result.ok) throw new Error(result.stderr);
  return out;
}

const GOOD = [
  '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-movflags', '+faststart',
];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'act-one-container-'));
});

describe('readContainer', () => {
  it('reads what the reference films actually are', async () => {
    const facts = await readContainer(path.join(work, 'northwind.mp4'));
    expect(facts.brands).toContain('isom');
    expect(facts.faststart).toBe(true);
    expect(facts.video).toMatchObject({ codec: 'avc1', profile: 100, chromaFormat: 1, bitDepth: 8 });
    expect(facts.video!.colour).toEqual({ primaries: 1, transfer: 1, matrix: 1, fullRange: false });
    expect(facts.video!.level).toBeLessThanOrEqual(51);
    expect(facts.audio).toMatchObject({ codec: 'mp4a', objectType: 2, sampleRate: 48000, channels: 2 });
    expect(facts.durationSeconds).toBeGreaterThan(5);
    expect(facts.video!.sampleCount).toBeGreaterThan(100);
  });

  it('parses a file it just watched being made', async () => {
    const facts = await readContainer(await encode('good.mp4', GOOD));
    expect(facts.video).toMatchObject({ width: 640, height: 360, profile: 100, level: 40 });
    expect(facts.video!.sampleCount).toBe(30);
    expect(playabilityIssues(facts, { width: 640, height: 360 })).toEqual([]);
  });
});

describe('playabilityIssues', () => {
  it('passes every reference film', async () => {
    for (const film of ['northwind', 'meridian', 'halyard']) {
      const facts = await readContainer(path.join(work, `${film}.mp4`));
      expect(playabilityIssues(facts), film).toEqual([]);
    }
  });

  it('refuses a moov box at the end of the file', async () => {
    const file = await encode('slow-start.mp4', GOOD.filter((a) => a !== '+faststart' && a !== '-movflags'));
    const issues = playabilityIssues(await readContainer(file));
    expect(issues.some((i) => /moov box is after/.test(i))).toBe(true);
  });

  it('refuses 4:4:4 chroma, which no browser decodes', async () => {
    const file = await encode('444.mp4', GOOD.map((a) => (a === 'yuv420p' ? 'yuv444p' : a === 'high' ? 'high444' : a)));
    const issues = playabilityIssues(await readContainer(file));
    expect(issues.some((i) => /High 4:4:4|4:2:0/.test(i))).toBe(true);
  });

  it('refuses untagged colour', async () => {
    const file = await encode('untagged.mp4', GOOD.filter((a) => !/^(-color_primaries|-color_trc|-colorspace|bt709)$/.test(a)));
    const issues = playabilityIssues(await readContainer(file));
    expect(issues.some((i) => /untagged|not BT\.709/.test(i))).toBe(true);
  });

  it('refuses the wrong size and a missing audio track', async () => {
    const facts = await readContainer(await encode('good2.mp4', GOOD));
    expect(playabilityIssues(facts, { width: 1920, height: 1080 })).toEqual([
      'Master is 640x360, not the 1920x1080 that was asked for.',
    ]);
    expect(playabilityIssues({ ...facts, audio: null })).toEqual(['No audio track.']);
    expect(playabilityIssues({ ...facts, audio: null }, { width: 0, height: 0, audio: false })).toEqual([]);
  });

  it('refuses a level above 5.1', () => {
    const facts = {
      brands: ['isom'],
      faststart: true,
      durationSeconds: 1,
      video: { codec: 'avc1', profile: 100, level: 52, chromaFormat: 1, bitDepth: 8, width: 3840, height: 2160, colour: { primaries: 1, transfer: 1, matrix: 1, fullRange: false }, sampleCount: 30, durationSeconds: 1 },
      audio: { codec: 'mp4a', objectType: 2, sampleRate: 48000, channels: 2 },
    };
    expect(playabilityIssues(facts)).toEqual(['H.264 level 5.2 exceeds 5.1, the ceiling for hardware decoders.']);
  });
});

describe('decodeCleanly', () => {
  it('decodes a good file without complaint and a truncated one with one', async () => {
    const good = await encode('decode-good.mp4', GOOD);
    expect((await decodeCleanly(good)).ok).toBe(true);

    const { readFile, writeFile } = await import('node:fs/promises');
    const bytes = await readFile(good);
    // Cut the media in half, keeping the (front-loaded) index that says it is whole.
    const truncated = path.join(dir, 'truncated.mp4');
    await writeFile(truncated, bytes.subarray(0, Math.floor(bytes.length * 0.6)));
    const result = await decodeCleanly(truncated);
    expect(result.ok).toBe(false);
    expect(result.complaint.length).toBeGreaterThan(0);
  });
});

describe('verifyMaster', () => {
  it('gives a clean verdict on a real master', async () => {
    const { issues } = await verifyMaster(path.join(work, 'meridian.mp4'), { width: 1920, height: 1080 });
    expect(issues).toEqual([]);
  });
});
