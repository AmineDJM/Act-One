import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyseVoice, levelVoice, runFfmpeg, stitchVoice, wavDurationSeconds } from '../index.ts';
import { readFile } from 'node:fs/promises';

/**
 * The voice tools against real FFmpeg, on synthesised recordings whose
 * facts are known: a tone with silence either side, a tone that clips, a
 * gap in the middle. What is proved is that the meter reads what was
 * written into the file, because everything downstream trusts it.
 */
let dir = '';

async function synth(name: string, graph: string, seconds: number): Promise<string> {
  const out = path.join(dir, name);
  const result = await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', graph,
    '-t', String(seconds), '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', out,
  ]);
  if (!result.ok) throw new Error(result.stderr);
  return out;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'act-one-voice-'));
});

describe('analysing a recording', () => {
  it('reads duration, peak and the silence at both ends', async () => {
    // 0.5 s silence, 2 s of tone at -6 dBFS, 1 s silence.
    const file = await synth(
      'padded.wav',
      "sine=frequency=220:sample_rate=24000:duration=2,volume=4,adelay=500:all=1,apad=pad_dur=1",
      3.5,
    );
    const facts = await analyseVoice(file, { loudness: true });
    expect(facts).not.toBeNull();
    expect(facts!.durationSeconds).toBeCloseTo(3.5, 1);
    expect(facts!.peakDb).toBeGreaterThan(-7);
    expect(facts!.peakDb).toBeLessThan(-5);
    expect(facts!.headSilenceSeconds).toBeCloseTo(0.5, 1);
    expect(facts!.tailSilenceSeconds).toBeCloseTo(1, 1);
    expect(facts!.silences).toEqual([]);
    expect(facts!.integratedLufs).toBeLessThan(0);
  });

  it('sees a gap in the middle and a tone that clips', async () => {
    const gapped = await synth(
      'gapped.wav',
      "sine=frequency=220:sample_rate=24000,volume=4,volume=enable='between(t,1,2.2)':volume=0",
      3.5,
    );
    const facts = await analyseVoice(gapped);
    expect(facts!.silences).toHaveLength(1);
    expect(facts!.silences[0]!.start).toBeCloseTo(1, 1);
    expect(facts!.silences[0]!.end).toBeCloseTo(2.2, 1);

    // FFmpeg's sine sits at -18 dBFS; twenty-four decibels up is over the top.
    const hot = await synth('hot.wav', 'sine=frequency=220:sample_rate=24000,volume=16', 1);
    const loud = await analyseVoice(hot);
    expect(loud!.peakDb).toBeGreaterThan(-0.3);
  });

  it('reads a WAV header without FFmpeg', async () => {
    const file = await synth('header.wav', 'sine=frequency=220:sample_rate=24000', 1.25);
    expect(wavDurationSeconds(new Uint8Array(await readFile(file)))).toBeCloseTo(1.25, 2);
    expect(wavDurationSeconds(new Uint8Array(10))).toBeNull();
  });
});

describe('levelling and stitching', () => {
  it('applies a gain and joins passages with the pauses asked for', async () => {
    const a = await synth('a.wav', 'sine=frequency=220:sample_rate=24000,volume=2', 1);
    const b = await synth('b.wav', 'sine=frequency=330:sample_rate=24000,volume=2', 1.5);
    const levelled = path.join(dir, 'a-up.wav');
    await levelVoice(a, levelled, 6);
    const before = await analyseVoice(a);
    const after = await analyseVoice(levelled);
    expect(after!.peakDb - before!.peakDb).toBeCloseTo(6, 0);

    const target = path.join(dir, 'stitched.wav');
    const stitched = await stitchVoice({
      segments: [
        { path: a, gapAfterSeconds: 0.4, durationSeconds: 1, trimTailSeconds: 0.2 },
        { path: b, gapAfterSeconds: 0.9, durationSeconds: 1.5, gainDb: -3 },
      ],
      target,
      leadInSeconds: 0.3,
      leadOutSeconds: 0.5,
    });
    expect(stitched.durationSeconds).toBeCloseTo(0.3 + 0.8 + 0.4 + 1.5 + 0.9 + 0.5, 2);
    const facts = await analyseVoice(target, { minSilenceSeconds: 0.3 });
    expect(facts!.durationSeconds).toBeCloseTo(stitched.durationSeconds, 1);
    expect(facts!.headSilenceSeconds).toBeCloseTo(0.3, 1);
    // The gap between the passages, and the lead-out, are the only silences.
    expect(facts!.silences).toHaveLength(1);
    expect(facts!.silences[0]!.end - facts!.silences[0]!.start).toBeCloseTo(0.4, 1);
    expect(facts!.tailSilenceSeconds).toBeCloseTo(0.9 + 0.5, 1);
  });
});
