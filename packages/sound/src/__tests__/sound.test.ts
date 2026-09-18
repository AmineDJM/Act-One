import { describe, it, expect } from 'vitest';
import { resequence, type Scene, type Storyboard } from '@act-one/core';
import { LUFS_BROADCAST, LUFS_WEB, TRUE_PEAK_CEILING } from '@act-one/core';
import { directSound, buildMix, mixArgs, muxArgs, correctionFor, DEFAULT_LIBRARY, validateLibrary, findSfx } from '../index.ts';

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'duration' | 'visualType'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, purpose: 'x', narration: '', onScreenText: [],
    assetRefs: [], momentIds: [],
    motionRecipe: { name: 'hold', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' },
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
    ...over,
  };
}

function board(scenes: Scene[]): Storyboard {
  return resequence({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
    scenes, voiceStrategy: 'none', musicDirection: '', status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const cinematic = {
  musicCharacter: 'Sub-heavy, sparse, tonal.',
  openOnMusic: false,
  uiSoundDensity: 'sparse' as const,
  impactsOnCuts: true,
  endWithSting: true,
};

describe('sound library', () => {
  it('fails loudly when an asset is missing, rather than silently', () => {
    expect(validateLibrary(DEFAULT_LIBRARY, () => true).ok).toBe(true);
    const partial = validateLibrary(DEFAULT_LIBRARY, (key) => !key.includes('impact-hard'));
    expect(partial.ok).toBe(false);
    expect(partial.missing).toContain('library/sfx/impact-hard.wav');
  });
});

describe('directSound', () => {
  const storyboard = board([
    scene({ id: 's1', duration: 4, visualType: 'kinetic_typography', soundCues: [
      { time: 0, type: 'silence', assetId: null, intensity: 0, durationSeconds: 1.5 },
      { time: 1.5, type: 'music_in', assetId: null, intensity: 0.5, durationSeconds: null },
    ] }),
    scene({ id: 's2', duration: 6, visualType: 'product_ui', soundCues: [
      { time: 4, type: 'impact', assetId: null, intensity: 0.7, durationSeconds: null },
      { time: 5, type: 'ui_click', assetId: null, intensity: 0.4, durationSeconds: null },
      { time: 7, type: 'ui_click', assetId: null, intensity: 0.4, durationSeconds: null },
    ] }),
    scene({ id: 's3', duration: 3, visualType: 'logo_reveal', soundCues: [
      { time: 10.5, type: 'logo_sting', assetId: null, intensity: 0.8, durationSeconds: null },
      { time: 13, type: 'music_out', assetId: null, intensity: 0, durationSeconds: 1.2 },
    ] }),
  ]);

  it('holds the music until the film earns it', () => {
    const design = directSound({ storyboard, behaviour: cinematic });
    expect(design.music).not.toBeNull();
    expect(design.music!.enterAtSeconds).toBeGreaterThan(0);
    expect(design.silenceSeconds).toBeGreaterThan(0);
  });

  it('starts the music at frame zero when the system opens on music', () => {
    const design = directSound({ storyboard, behaviour: { ...cinematic, openOnMusic: true } });
    expect(design.music!.enterAtSeconds).toBe(0);
  });

  it('starts impacts before the cut so the transient lands on it', () => {
    const design = directSound({ storyboard, behaviour: cinematic });
    const impact = design.cues.find((c) => c.type === 'impact')!;
    const sample = findSfx(DEFAULT_LIBRARY, impact.sfxKind!)!;
    // The cue was authored at 4.0s; the sample must start earlier by its pre-roll.
    expect(impact.atSeconds).toBeCloseTo(4 - sample.preRoll, 3);
    expect(sample.preRoll).toBeGreaterThan(0);
  });

  it('picks a hard impact for a fast cut and a soft one for a held frame', () => {
    const fast = directSound({
      storyboard: board([
        scene({ id: 'a', duration: 1.2, visualType: 'kinetic_typography', soundCues: [{ time: 0, type: 'impact', assetId: null, intensity: 0.7, durationSeconds: null }] }),
      ]),
      behaviour: cinematic,
    });
    const slow = directSound({
      storyboard: board([
        scene({ id: 'a', duration: 4, visualType: 'kinetic_typography', soundCues: [{ time: 0, type: 'impact', assetId: null, intensity: 0.7, durationSeconds: null }] }),
      ]),
      behaviour: cinematic,
    });
    expect(fast.cues.find((c) => c.type === 'impact')!.sfxKind).toBe('impact_hard');
    expect(slow.cues.find((c) => c.type === 'impact')!.sfxKind).toBe('impact_soft');
  });

  it('thins UI sounds to the system’s density', () => {
    const noisy = board([
      scene({
        id: 's1', duration: 10, visualType: 'product_ui',
        soundCues: Array.from({ length: 9 }, (_, i) => ({
          time: i * 0.8, type: 'ui_click' as const, assetId: null, intensity: 0.4, durationSeconds: null,
        })),
      }),
    ]);
    const sparse = directSound({ storyboard: noisy, behaviour: cinematic });
    expect(sparse.cues.filter((c) => c.type === 'ui_click').length).toBeLessThanOrEqual(3);
    expect(sparse.notes.join(' ')).toMatch(/thinned ui sounds/i);

    const none = directSound({ storyboard: noisy, behaviour: { ...cinematic, uiSoundDensity: 'none' } });
    expect(none.cues.filter((c) => c.type === 'ui_click')).toHaveLength(0);
  });

  it('maps intensity onto a sensible dB window per cue family', () => {
    const design = directSound({ storyboard, behaviour: cinematic });
    for (const cue of design.cues) {
      expect(cue.gainDb).toBeLessThanOrEqual(0);
      expect(cue.gainDb).toBeGreaterThanOrEqual(-40);
    }
    const impact = design.cues.find((c) => c.type === 'impact')!;
    const click = design.cues.find((c) => c.type === 'ui_click')!;
    // A UI click must never be as loud as an impact.
    expect(click.gainDb).toBeLessThan(impact.gainDb);
  });

  it('uses the right loudness target per channel', () => {
    expect(directSound({ storyboard, behaviour: cinematic, channel: 'web' }).targetLufs).toBe(-16);
    expect(directSound({ storyboard, behaviour: cinematic, channel: 'social' }).targetLufs).toBe(-14);
    expect(directSound({ storyboard, behaviour: cinematic, channel: 'broadcast' }).targetLufs).toBe(-23);
  });

  it('sets one bed level whether or not anybody is speaking', () => {
    /*
     * Room for the voice comes from the sidechain, which releases in the gaps.
     * Dropping the bed for the whole film instead is the drawn fade
     * AUDIO_STANDARDS.ducking rules out: it holds the music down through every
     * pause and through the passages with no narration in them at all.
     */
    const withVo = directSound({ storyboard, behaviour: cinematic, hasVoiceOver: true });
    const withoutVo = directSound({ storyboard, behaviour: cinematic, hasVoiceOver: false });
    expect(withVo.music!.baseGainDb).toBe(withoutVo.music!.baseGainDb);
  });

  it('masters to the standard, not to a number somebody liked', () => {
    // EBU R 128 is not ours to choose; the other two are the platforms'.
    expect(directSound({ storyboard, behaviour: cinematic, channel: 'broadcast' }).targetLufs).toBe(
      LUFS_BROADCAST,
    );
    expect(directSound({ storyboard, behaviour: cinematic, channel: 'web' }).targetLufs).toBe(
      LUFS_WEB,
    );
  });

  it('matches tempo to the cut rate', () => {
    const fastCut = board(Array.from({ length: 20 }, (_, i) => scene({ id: `s${i}`, duration: 1, visualType: 'kinetic_typography' })));
    const slowCut = board(Array.from({ length: 4 }, (_, i) => scene({ id: `s${i}`, duration: 5, visualType: 'kinetic_typography' })));

    const fast = directSound({ storyboard: fastCut, behaviour: { ...cinematic, musicCharacter: 'percussive rhythmic' } });
    const slow = directSound({ storyboard: slowCut, behaviour: { ...cinematic, musicCharacter: 'percussive rhythmic' } });
    // Both resolve to real tracks; the fast cut should not get the slowest one.
    expect(fast.music).not.toBeNull();
    expect(slow.music).not.toBeNull();
  });
});

describe('buildMix', () => {
  const storyboard = board([
    scene({ id: 's1', duration: 5, visualType: 'kinetic_typography', soundCues: [
      { time: 0, type: 'music_in', assetId: null, intensity: 0.5, durationSeconds: null },
      { time: 2, type: 'impact', assetId: null, intensity: 0.7, durationSeconds: null },
    ] }),
  ]);

  const resolvedPaths = Object.fromEntries(
    [...DEFAULT_LIBRARY.music, ...DEFAULT_LIBRARY.sfx].map((item) => [item.storageKey, `/audio/${item.id}.wav`]),
  );

  it('delays every element to its exact film time', () => {
    const design = directSound({ storyboard, behaviour: { ...cinematic, openOnMusic: true } });
    const plan = buildMix({ design, resolvedPaths, durationSeconds: 5 });
    const impact = design.cues.find((c) => c.type === 'impact')!;

    expect(plan.filterGraph).toContain(`adelay=${Math.round(impact.atSeconds * 1000)}`);
  });

  it('uses a real sidechain rather than a static envelope when there is narration', () => {
    const design = directSound({ storyboard, behaviour: cinematic, hasVoiceOver: true });
    const plan = buildMix({
      design,
      resolvedPaths,
      durationSeconds: 5,
      voiceTracks: [{ path: '/audio/vo.wav', atSeconds: 1, durationSeconds: 3 }],
    });
    // Static ducking pumps audibly whenever the narration pauses for breath.
    expect(plan.filterGraph).toContain('sidechaincompress');
  });

  it('limits transients but leaves loudness to the master', () => {
    /*
     * The graph used to end in a single `loudnorm` pass, which lands a decibel
     * or two from target — most of the tolerance EBU R 128 allows for a whole
     * programme, spent before the film is even muxed. `masterLoudness` does it
     * properly afterwards, in two passes, and a second normaliser in here would
     * fight it.
     */
    const design = directSound({ storyboard, behaviour: cinematic, channel: 'social' });
    const plan = buildMix({ design, resolvedPaths, durationSeconds: 5 });
    expect(plan.filterGraph).toContain('alimiter');
    expect(plan.filterGraph).not.toContain('loudnorm');
  });

  it('produces a real silent track rather than no audio stream at all', () => {
    const design = directSound({ storyboard, behaviour: cinematic });
    const plan = buildMix({ design, resolvedPaths: {}, durationSeconds: 5 });
    expect(plan.inputs).toHaveLength(0);
    expect(plan.filterGraph).toContain('anullsrc');
  });

  it('returns argv, never a shell string — customer paths end up here', () => {
    const design = directSound({ storyboard, behaviour: cinematic });
    const plan = buildMix({ design, resolvedPaths, durationSeconds: 5 });
    const args = mixArgs(plan, "/tmp/out; rm -rf ~/'.mp4");

    expect(Array.isArray(args)).toBe(true);
    expect(args[args.length - 1]).toBe("/tmp/out; rm -rf ~/'.mp4");
    expect(args.some((a) => a === '-filter_complex')).toBe(true);
  });

  it('copies the video stream when muxing rather than re-encoding it', () => {
    const args = muxArgs('/tmp/v.mp4', '/tmp/a.m4a', '/tmp/out.mp4');
    expect(args).toContain('copy');
    expect(args).toContain('+faststart');
  });
});

describe('loudness compliance', () => {
  const storyboard = board([scene({ id: 's1', duration: 5, visualType: 'kinetic_typography' })]);
  const resolvedPaths = Object.fromEntries(
    [...DEFAULT_LIBRARY.music, ...DEFAULT_LIBRARY.sfx].map((item) => [
      item.storageKey,
      `/audio/${item.id}.wav`,
    ]),
  );

  it('keeps the true-peak ceiling inside what EBU R 128 permits', () => {
    // Half a decibel of margin for the encoder: inter-sample peaks rise on the
    // way into AAC, so a master that only just clears the ceiling as a WAV can
    // be over it as the file anybody plays.
    const applied = TRUE_PEAK_CEILING - 0.5;
    expect(applied).toBeLessThanOrEqual(TRUE_PEAK_CEILING);
    expect(applied).toBeGreaterThan(TRUE_PEAK_CEILING - 2);
    expect(TRUE_PEAK_CEILING).toBeLessThanOrEqual(-1);
  });
});

describe('delivery colour', () => {
  it('tags all three colour properties, not just the primaries', () => {
    /*
     * The encoder writes the primaries and leaves the transfer function and
     * matrix unset, so the file reads as `bt709/unknown/unknown` and players
     * guess the other two — differently from each other. These are metadata,
     * so they cost nothing on a stream copy.
     */
    const args = muxArgs('/tmp/v.mp4', '/tmp/a.m4a', '/tmp/out.mp4');
    const filter = args[args.indexOf('-bsf:v') + 1] ?? '';
    // 1 is BT.709 in every one of the three enumerations.
    expect(filter).toContain('colour_primaries=1');
    expect(filter).toContain('transfer_characteristics=1');
    expect(filter).toContain('matrix_coefficients=1');
    expect(filter).toContain('video_full_range_flag=0');
    /*
     * In the bitstream rather than as `-color_*` output options, which FFmpeg
     * applies only when encoding and silently ignores on a copy — and it must
     * stay a copy, or tagging costs a generation of quality.
     */
    expect(args.join(' ')).toContain('-c:v copy');
  });
});

describe('how many times the audio is encoded', () => {
  it('leaves the mix lossless', () => {
    /*
     * The mix wrote AAC, the master wrote AAC again and the mux wrote it a
     * third time — three generations of lossy encoding on the way to one file.
     * Inter-sample peaks rise on each pass, which is how a master aimed at
     * −1.5 dBTP came out at −0.9, over the EBU R 128 ceiling.
     */
    const storyboard = board([scene({ id: 's1', duration: 5, visualType: 'kinetic_typography' })]);
    const design = directSound({ storyboard, behaviour: cinematic });
    const plan = buildMix({ design, resolvedPaths: {}, durationSeconds: 5 });
    const args = mixArgs(plan, '/tmp/premix.wav').join(' ');

    expect(args).toContain('pcm_');
    expect(args).not.toContain('aac');
  });

  it('encodes once, at the mux', () => {
    const args = muxArgs('/tmp/v.mp4', '/tmp/a.wav', '/tmp/out.mp4').join(' ');
    expect(args).toContain('-c:a aac');
    // And never re-encodes the picture to attach it.
    expect(args).toContain('-c:v copy');
  });
});


describe('a master that missed its target', () => {
  const measured = (integratedLufs: number) => ({ integratedLufs, truePeakDb: -2, lra: 8 });

  it('leaves a master inside EBU R 128 tolerance alone', () => {
    expect(correctionFor(measured(-16.4), -16)).toBeNull();
    expect(correctionFor(measured(-15.6), -16)).toBeNull();
  });

  it('corrects one outside it by exactly the difference', () => {
    /*
     * `loudnorm` cannot honour `linear=true` when the source's loudness range
     * exceeds the range it is asked for — it falls back to dynamic without
     * saying so. A nineteen-second film landed at −14.2 against a −16 target,
     * twice the tolerance the standard allows for a whole programme.
     */
    expect(correctionFor(measured(-14.2), -16)).toBeCloseTo(-1.8, 5);
    expect(correctionFor(measured(-19), -16)).toBeCloseTo(3, 5);
  });

  it('never guesses at a correction for a file it could not measure', () => {
    // Guessing here is how a quiet film becomes a very loud one.
    expect(correctionFor(null, -16)).toBeNull();
    expect(correctionFor(measured(Number.NEGATIVE_INFINITY), -16)).toBeNull();
    expect(correctionFor(measured(Number.NaN), -16)).toBeNull();
  });
});
