import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DIALOGUE_LEAD_MIN } from '@act-one/core';
import { buildMix, runFfmpeg } from '../index.ts';
import { bedReductionDb, dialogueLeadArgs, measureDialogueLead, parseEbur128Summaries, readDialogueLead } from '../dialogue-lead.ts';
import type { SoundDesign } from '../sound-director.ts';

/**
 * The dialogue lead, measured on real audio: a synthetic bed and a synthetic
 * voice, mixed by the real graph, metered by the real meter.
 */
let dir = '';
let bedPath = '';
let voicePath = '';
let sfxPath = '';

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
    music: { trackId: 'trk_1', storageKey: 'bed', startOffsetSeconds: 0, enterAtSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0, exitAtSeconds: 6, baseGainDb },
    cues: [],
    ending: { strategy: 'hard_stop', reason: 'fixture', musicOutSeconds: 0, sting: false },
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
  sfxPath = await synth('tick.wav', 'sine=frequency=1200', 1);
});

/**
 * A design WITH effects cues, which is what every narrated film actually has.
 *
 * The suite only ever built designs with `cues: []`, so no effects bus was
 * created, so the one configuration that has never worked in production was
 * the one configuration never tested. See the anullsink test below.
 */
function designWithCues(baseGainDb: number): SoundDesign {
  return {
    ...design(baseGainDb),
    cues: [
      { id: 'cue_1', atSeconds: 1.5, type: 'impact', sfxKind: null, storageKey: 'tick', gainDb: -8, durationSeconds: null },
      { id: 'cue_2', atSeconds: 3.0, type: 'impact', sfxKind: null, storageKey: 'tick', gainDb: -8, durationSeconds: null },
    ] as SoundDesign['cues'],
  };
}

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

  /*
   * THE BUG THAT SHIPPED, and why nothing caught it.
   *
   * The lead graph reuses the mix's bus graph and taps the music and voice
   * busses. The EFFECTS bus is built in there too — with `amix`, once there is
   * more than one cue — and nothing consumed it, so ffmpeg rejected the whole
   * graph with "Filter amix:default has an unconnected output" and the
   * measurement returned a bare null. The pipeline treats null as "skip the
   * correction", so it skipped silently on every narrated film with effects,
   * which is all of them. The suite never saw it because every fixture here
   * had `cues: []`.
   */
  it('meters the effects bus WITH the bed, so a mix with cues is measured whole', async () => {
    const plan = buildMix({
      design: designWithCues(0),
      resolvedPaths: { bed: bedPath, tick: sfxPath },
      voiceTracks: [{ path: voicePath, atSeconds: 1, durationSeconds: 4 }],
      durationSeconds: 6,
    });
    expect(plan.busses.sfx, 'the fixture must actually build an effects bus').toBeTruthy();

    const args = dialogueLeadArgs(plan, [{ atSeconds: 1, durationSeconds: 4 }])!.join(' ');
    // It used to be thrown away. A viewer does not hear busses, they hear the
    // voice and everything under it.
    expect(args).not.toContain('anullsink');
    expect(args).toContain('[nonvoice]');

    // And the real proof: ffmpeg accepts it and both meters report.
    const lead = await measureDialogueLead(plan, [{ atSeconds: 1, durationSeconds: 4 }]);
    expect(lead, 'a mix with effects cues must still be measurable').not.toBeNull();
    expect(Number.isFinite(lead!.leadLu)).toBe(true);
  }, 60_000);

  /*
   * THE DEFECT THE OLD METER COULD NOT SEE.
   *
   * With the effects bus discarded, a film could bury its narration under
   * cues and still be certified: only the music was weighed. Measured in the
   * finished film, the cues landing while the voice speaks read +0.7, -3.2 and
   * +2.9 dB over the moment before them — inaudible — while the ones landing
   * in a gap read +10 to +35. Raising the cues to fix that is exactly the
   * change the old meter would have waved through, whatever it cost the words.
   *
   * So: same bed, same voice, louder effects must measure a SHORTER lead.
   */
  it('reports a shorter lead when the effects get louder, with the bed unchanged', async () => {
    const windows = [{ atSeconds: 1, durationSeconds: 4 }];
    const measure = async (cueGainDb: number) => {
      const design = designWithCues(0);
      const plan = buildMix({
        design: { ...design, cues: design.cues.map((c) => ({ ...c, gainDb: cueGainDb })) },
        resolvedPaths: { bed: bedPath, tick: sfxPath },
        voiceTracks: [{ path: voicePath, atSeconds: 1, durationSeconds: 4 }],
        durationSeconds: 6,
      });
      return (await measureDialogueLead(plan, windows))!;
    };

    const quiet = await measure(-40);
    const loud = await measure(0);
    expect(loud.leadLu).toBeLessThan(quiet.leadLu);
  }, 120_000);

  it('says WHY it could not measure, rather than returning a bare null', async () => {
    const noVoice = buildMix({
      design: design(0), resolvedPaths: { bed: bedPath }, voiceTracks: [], durationSeconds: 6,
    });
    const out = await readDialogueLead(noVoice, []);
    expect('reason' in out).toBe(true);
    // Four different failures used to share one null; they must be tellable apart.
    expect((out as { reason: string }).reason).toMatch(/no_voice_bus|no_windows/);
  });

  it('measures a bed that drowns the voice, and says how far to take it down', async () => {
    /*
     * +12 dB on the bed, because at unity the duck already wins.
     *
     * This asserted that `design(0)` drowns the voice and it stopped being
     * true: the sidechain takes a unity-gain bed far enough down that the
     * voice leads by 8.4 LU, so the test was failing on a premise rather than
     * on a defect. A bed pushed 12 dB hot is one the compressor cannot rescue,
     * which is the condition the measurement exists to catch.
     */
    const plan = buildMix({
      design: design(12),
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
      design: design(12 - reduction),
      resolvedPaths: { bed: bedPath },
      voiceTracks: [{ path: voicePath, atSeconds: 1, durationSeconds: 4 }],
      durationSeconds: 6,
    });
    const after = await measureDialogueLead(corrected, [{ atSeconds: 1, durationSeconds: 4 }]);
    expect(after!.leadLu).toBeGreaterThanOrEqual(DIALOGUE_LEAD_MIN - 0.5);
    expect(bedReductionDb({ voiceLufs: -20, musicLufs: -26, leadLu: 6 })).toBe(0);
  }, 60_000);
});
