import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DIALOGUE_LEAD_MIN } from '@act-one/core';
import { buildMix, runFfmpeg } from '../index.ts';
import { bedReductionDb, dialogueLeadArgs, measureDialogueLead, parseEbur128Summaries } from '../dialogue-lead.ts';
import type { SoundDesign } from '../sound-director.ts';

/**
 * The dialogue lead, measured on real audio: a synthetic bed and a synthetic
 * voice, mixed by the real graph, metered by the real meter.
 */
let dir = '';
let bedPath = '';
let voicePath = '';

async function synth(name: string, source: string, seconds: number): Promise<string> {
  const out = path.join(dir, name);
  const result = await runFfmpeg([
    '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source,
    '-t', String(seconds), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out,
  ]);
  if (!result.ok) throw new Error(result.stderr);
  return out;
}

function design(baseGainDb: number): SoundDesign {
  return {
    id: 'snd_1',
    storyboardId: 'sbd_1',
    music: { trackId: 'trk_1', storageKey: 'bed', startOffsetSeconds: 0, enterAtSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0, baseGainDb },
    cues: [],
    silenceSeconds: 0,
    targetLufs: -16,
    notes: [],
  };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'act-one-lead-'));
  // A loud, full-band bed and a quieter, band-limited voice: the pair every
  // automated mix gets wrong.
  bedPath = await synth('bed.wav', 'anoisesrc=colour=pink:amplitude=0.5:seed=7', 6);
  voicePath = await synth('voice.wav', 'sine=frequency=220:beep_factor=4', 6);
});

describe('a film with narration', () => {
  it('mixes at all', async () => {
    // The voice fed the compressor's key and the mix from one label, which a
    // filter graph cannot do. Every narrated film would have failed here.
    const plan = buildMix({
      design: design(-6),
      resolvedPaths: { bed: bedPath },
      voiceTracks: [{ path: voicePath, atSeconds: 1, durationSeconds: 4 }],
      durationSeconds: 6,
    });
    const { mixArgs } = await import('../index.ts');
    const result = await runFfmpeg(mixArgs(plan, path.join(dir, 'narrated.wav')));
    expect(result.ok, result.stderr.slice(-400)).toBe(true);
  }, 60_000);
});

describe('dialogue lead', () => {
  it('builds a graph that meters the bed and the voice inside the voice windows', () => {
    const plan = buildMix({
      design: design(-6),
      resolvedPaths: { bed: bedPath },
      voiceTracks: [{ path: voicePath, atSeconds: 1, durationSeconds: 4 }],
      durationSeconds: 6,
    });
    const args = dialogueLeadArgs(plan, [{ atSeconds: 1, durationSeconds: 4 }]);
    expect(args).not.toBeNull();
    const graph = args![args!.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('sidechaincompress');
    expect(graph).toContain("aselect='between(t,1,5)'");
    expect(graph.match(/ebur128/g)).toHaveLength(2);
    expect(dialogueLeadArgs(plan, [])).toBeNull();
  });

  it('reads each meter by its instance number, not by the order it printed', () => {
    const stderr = [
      '[Parsed_ebur128_5 @ 0x2] Summary:',
      '  Integrated loudness:',
      '    I:         -12.3 LUFS',
      '[Parsed_ebur128_3 @ 0x1] Summary:',
      '  Integrated loudness:',
      '    I:         -30.1 LUFS',
    ].join('\n');
    expect(parseEbur128Summaries(stderr)).toEqual([-30.1, -12.3]);
  });

  it('measures a bed that drowns the voice, and says how far to take it down', async () => {
    const plan = buildMix({
      design: design(0),
      resolvedPaths: { bed: bedPath },
      voiceTracks: [{ path: voicePath, atSeconds: 1, durationSeconds: 4 }],
      durationSeconds: 6,
    });
    const lead = await measureDialogueLead(plan, [{ atSeconds: 1, durationSeconds: 4 }]);
    expect(lead).not.toBeNull();
    expect(Number.isFinite(lead!.leadLu)).toBe(true);
    expect(lead!.leadLu).toBeLessThan(DIALOGUE_LEAD_MIN);
    const reduction = bedReductionDb(lead!);
    expect(reduction).toBeGreaterThan(0);

    // Taking the bed down by that much lands the voice at least the floor above it.
    const corrected = buildMix({
      design: design(-reduction),
      resolvedPaths: { bed: bedPath },
      voiceTracks: [{ path: voicePath, atSeconds: 1, durationSeconds: 4 }],
      durationSeconds: 6,
    });
    const after = await measureDialogueLead(corrected, [{ atSeconds: 1, durationSeconds: 4 }]);
    expect(after!.leadLu).toBeGreaterThanOrEqual(DIALOGUE_LEAD_MIN - 0.5);
    expect(bedReductionDb({ voiceLufs: -20, musicLufs: -26, leadLu: 6 })).toBe(0);
  }, 60_000);
});
