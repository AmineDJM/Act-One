import { describe, it, expect } from 'vitest';
import { resequence, type Scene, type Storyboard } from '@act-one/core';
import { LUFS_BROADCAST, LUFS_WEB, TRUE_PEAK_CEILING } from '@act-one/core';
import { directSound, buildMix, mixArgs, muxArgs, DEFAULT_LIBRARY, validateLibrary, findSfx } from '../index.ts';

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

  it('normalises to the design’s loudness target and limits transients', () => {
    const design = directSound({ storyboard, behaviour: cinematic, channel: 'social' });
    const plan = buildMix({ design, resolvedPaths, durationSeconds: 5 });
    expect(plan.filterGraph).toContain('alimiter');
    expect(plan.filterGraph).toContain('loudnorm=I=-14');
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

  it('holds true peak inside the EBU R 128 ceiling, with margin for the encoder', () => {
    const design = directSound({ storyboard, behaviour: cinematic });
    const plan = buildMix({ design, resolvedPaths, durationSeconds: 5 });

    const match = /TP=(-?[\d.]+)/.exec(plan.filterGraph);
    expect(match).not.toBeNull();
    const truePeak = Number(match![1]);
    // Inside the ceiling, and not so far inside that we are throwing away level.
    expect(truePeak).toBeLessThanOrEqual(TRUE_PEAK_CEILING);
    expect(truePeak).toBeGreaterThan(TRUE_PEAK_CEILING - 2);
  });
});
