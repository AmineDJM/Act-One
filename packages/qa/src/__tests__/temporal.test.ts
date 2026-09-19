import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HELD_FRAME_CEILING, newId, readingSecondsFor, type CaptionCue, type Scene } from '@act-one/core';
import { runFfmpeg } from '@act-one/sound';
import {
  abruptEndIssue,
  captionOverlapIssues,
  captionSyncIssues,
  deadAirIssues,
  heldFrameIssues,
  levelJumpIssues,
  measureFilm,
  parseFreezes,
  parseShortTermLoudness,
  parseSilences,
  speechDriftIssues,
  type SpokenLine,
} from '../temporal.ts';

/**
 * Time, checked.
 *
 * The arithmetic is tested against the numbers; the parsers are tested against
 * output FFmpeg actually produced, captured verbatim; and the whole chain is
 * tested against a file built on purpose to contain the defects — a two-second
 * freeze, two seconds of silence, and a tail cut at level. A check that only
 * ever ran against its own fixtures proves the fixture.
 */
function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: newId('scn'), storyboardId: 'sbd_1', index: 0, startTime: 0, duration: 4,
    purpose: 'the argument', narration: '', onScreenText: [], visualType: 'kinetic_typography',
    motionRecipe: { name: 'hold' }, cameraRecipe: {}, voiceOver: false, assetRefs: [],
    notes: '', status: 'draft', transition: 'cut', captionEmphasis: null, attentionReset: null,
    soundCue: null, estimatedCostUsd: 0, ...over,
  } as Scene;
}

function cue(start: number, end: number, text = 'A line of narration'): CaptionCue {
  return { start, end, text, lines: [text], emphasis: null };
}

function spoken(startsAt: number, endsAt: number, sceneId: string | null = null): SpokenLine {
  return { sceneId, startsAt, endsAt, text: 'A line of narration' };
}

describe('captions against the speech they caption', () => {
  it('refuses a caption that arrives before the line, at three frames', () => {
    // Netflix states the tolerance in frames; at 30fps three frames is 100ms.
    const clean = captionSyncIssues({ cues: [cue(1.0, 3.0)], spoken: [spoken(1.09, 3.0)], fps: 30 });
    expect(clean).toHaveLength(0);

    const early = captionSyncIssues({ cues: [cue(1.0, 3.0)], spoken: [spoken(1.2, 3.0)], fps: 30 });
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ check: 'caption_onset', severity: 'soft_fail', repair: 'retime_captions' });
    expect(early[0]!.message).toMatch(/200ms before/);
    // A finding nobody can find is a finding nobody can act on.
    expect(early[0]!.frameStart).toBe(30);
  });

  it('gives a late caption until half a second, then calls it', () => {
    expect(captionSyncIssues({ cues: [cue(1.4, 3.0)], spoken: [spoken(1.0, 3.0)], fps: 30 })).toHaveLength(0);
    const late = captionSyncIssues({ cues: [cue(1.7, 3.0)], spoken: [spoken(1.0, 3.0)], fps: 30 });
    expect(late[0]).toMatchObject({ check: 'caption_onset' });
    expect(late[0]!.message).toMatch(/700ms after/);
  });

  it('refuses a caption that leaves before the sentence finishes', () => {
    const cut = captionSyncIssues({ cues: [cue(1.0, 2.0)], spoken: [spoken(1.0, 3.0)], fps: 30 });
    const offset = cut.find((issue) => issue.check === 'caption_offset');
    expect(offset).toMatchObject({ severity: 'soft_fail' });
    expect(offset!.message).toMatch(/never read/);
  });

  it('lets a caption linger a little, and not through the next shot', () => {
    expect(
      captionSyncIssues({ cues: [cue(1.0, 4.0)], spoken: [spoken(1.0, 3.0)], fps: 30 })
        .filter((issue) => issue.check === 'caption_offset'),
    ).toHaveLength(0);
    const lingering = captionSyncIssues({ cues: [cue(1.0, 5.0)], spoken: [spoken(1.0, 3.0)], fps: 30 });
    expect(lingering.find((issue) => issue.check === 'caption_offset')).toMatchObject({ severity: 'warning' });
  });

  it('never lets two captions occupy the same moment', () => {
    const overlapping = captionOverlapIssues([cue(1.0, 3.0), cue(2.5, 4.0)]);
    expect(overlapping).toHaveLength(1);
    // Which one the player draws is its decision rather than ours.
    expect(overlapping[0]).toMatchObject({ check: 'caption_overlap', severity: 'hard_fail' });
    expect(overlapping[0]!.message).toMatch(/500ms/);
  });
});

describe('a line that finishes over the next image', () => {
  it('allows a quarter second of overrun and no more', () => {
    const first = scene({ startTime: 0, duration: 4 });
    expect(speechDriftIssues({ spoken: [spoken(1, 4.2, first.id)], scenes: [first] })).toHaveLength(0);

    const drifting = speechDriftIssues({ spoken: [spoken(1, 4.9, first.id)], scenes: [first] });
    expect(drifting[0]).toMatchObject({
      check: 'narration_shot_drift',
      severity: 'soft_fail',
      repair: 'retime_scene',
    });
    expect(drifting[0]!.timecodeStart).toBe(4);
    expect(drifting[0]!.timecodeEnd).toBe(4.9);
  });
});

describe('what the film is allowed to hold', () => {
  it('holds a frame for a beat in a film and half of one in a short', () => {
    const scenes = [scene({ duration: 6 })];
    const freezes = [{ start: 2, end: 3 }];
    expect(heldFrameIssues({ freezes, scenes, cut: 'feature', fps: 30 })).toHaveLength(0);
    // The same freeze in a reel is a second of a viewer's attention.
    expect(heldFrameIssues({ freezes, scenes, cut: 'short', fps: 30 })).toHaveLength(1);
  });

  it('lets a shot stay still for as long as its copy takes to read', () => {
    const copy = ['Close the books.'];
    const reading = readingSecondsFor(copy.join(' '));
    const scenes = [scene({ duration: 4, onScreenText: copy })];

    // Past the beat ceiling and inside the reading time. The viewer is not
    // waiting, they are reading — and flagging this flags every typographic
    // shot ever made well.
    expect(reading).toBeGreaterThan(HELD_FRAME_CEILING.feature);
    expect(
      heldFrameIssues({ freezes: [{ start: 0.3, end: 0.3 + reading - 0.1 }], scenes, cut: 'feature', fps: 30 }),
    ).toHaveLength(0);

    // Past the reading time it is a hold again, deliberate or not.
    const [held] = heldFrameIssues({
      freezes: [{ start: 0.3, end: 0.3 + reading + 0.5 }], scenes, cut: 'feature', fps: 30,
    });
    expect(held).toMatchObject({ check: 'still_frame_hold', repair: 'trim_hold' });
    expect(held!.message).toMatch(/takes 1.60s to read/);
  });

  it('gives no allowance to a shot with nothing to read', () => {
    const scenes = [scene({ duration: 4, onScreenText: [] })];
    expect(heldFrameIssues({ freezes: [{ start: 1, end: 2.4 }], scenes, cut: 'feature', fps: 30 })).toHaveLength(1);
  });

  it('marks the frames, not only the seconds', () => {
    const [held] = heldFrameIssues({
      freezes: [{ start: 2, end: 4 }],
      scenes: [scene({ duration: 6 })],
      cut: 'feature',
      fps: 30,
    });
    expect(held).toMatchObject({ frameStart: 60, frameEnd: 120, repair: 'trim_hold' });
  });

  it('forgives quiet at the head and the tail, and not in the middle', () => {
    const scenes = [scene({ duration: 10 })];
    const args = { durationSeconds: 10, cut: 'feature' as const, scenes };
    expect(deadAirIssues({ ...args, silences: [{ start: 0, end: 1.5 }] })).toHaveLength(0);
    expect(deadAirIssues({ ...args, silences: [{ start: 8.5, end: 10 }] })).toHaveLength(0);
    expect(deadAirIssues({ ...args, silences: [{ start: 4, end: 5.5 }] })).toHaveLength(1);
  });
});

describe('loudness between windows', () => {
  it('hears a knob turn and ignores a pause', () => {
    const jumping = levelJumpIssues([
      { at: 3.2, lufs: -16 },
      { at: 4.2, lufs: -23 },
    ]);
    expect(jumping[0]).toMatchObject({ check: 'level_jump', severity: 'soft_fail', repair: 'remix_audio' });
    expect(jumping[0]!.message).toMatch(/7\.0 LU/);

    // A window of silence is not a jump; silence has its own check.
    expect(levelJumpIssues([{ at: 3.2, lufs: -16 }, { at: 4.2, lufs: -70 }])).toHaveLength(0);
  });

  it('says nothing about the first three seconds, because the window has not filled', () => {
    // EBU Tech 3341 defines short-term loudness over three seconds; before that
    // the filter reports -120 and every film would look like it jumped.
    expect(levelJumpIssues([{ at: 0, lufs: -120 }, { at: 1, lufs: -16 }])).toHaveLength(0);
  });
});

describe('a film that ends, rather than stops', () => {
  it('passes a faded tail and fails one still at level', () => {
    expect(abruptEndIssue({ tailPeakDb: -55, durationSeconds: 6 })).toHaveLength(0);
    const abrupt = abruptEndIssue({ tailPeakDb: -12, durationSeconds: 6 });
    expect(abrupt[0]).toMatchObject({ check: 'abrupt_music_end', repair: 'refade_audio' });
    expect(abrupt[0]!.timecodeEnd).toBe(6);
  });
});

describe('the parsers, against output FFmpeg actually wrote', () => {
  it('reads freezedetect', () => {
    const stderr = [
      '[freezedetect @ 0x55d5] lavfi.freezedetect.freeze_start: 2',
      '[freezedetect @ 0x55d5] lavfi.freezedetect.freeze_duration: 2',
      '[freezedetect @ 0x55d5] lavfi.freezedetect.freeze_end: 4',
    ].join('\n');
    expect(parseFreezes(stderr)).toEqual([{ start: 2, end: 4 }]);
  });

  it('reads silencedetect, and clamps a start before zero', () => {
    const stderr = [
      '[silencedetect @ 0x1a] silence_start: -0.00306122',
      '[silencedetect @ 0x1a] silence_end: 1.5 | silence_duration: 1.503',
      '[silencedetect @ 0x1a] silence_start: 2',
      '[silencedetect @ 0x1a] silence_end: 4.00002 | silence_duration: 2.00002',
    ].join('\n');
    expect(parseSilences(stderr)).toEqual([
      { start: 0, end: 1.5 },
      { start: 2, end: 4.00002 },
    ]);
  });

  it('reads the short-term loudness metadata, one reading a second', () => {
    // As `ametadata=mode=print` writes it: a frame header, then the value.
    const text = [
      'frame:0    pts:0       pts_time:0',
      'lavfi.r128.S=-120.691',
      'frame:1    pts:4800    pts_time:0.1',
      'lavfi.r128.S=-120.691',
      'frame:37   pts:177600  pts_time:3.7',
      'lavfi.r128.S=-23.142',
      'frame:47   pts:225600  pts_time:4.7',
      'lavfi.r128.S=-25.742',
    ].join('\n');
    const windows = parseShortTermLoudness(text);
    expect(windows).toEqual([
      { at: 0, lufs: -120.691 },
      { at: 3.7, lufs: -23.142 },
      { at: 4.7, lufs: -25.742 },
    ]);
  });

  it('reads -inf as silence rather than as nothing', () => {
    expect(parseShortTermLoudness('pts_time:1\nlavfi.r128.S=-inf')).toEqual([{ at: 1, lufs: -70 }]);
  });
});

/**
 * The whole chain, on a file built to contain the defects.
 *
 * Two seconds of motion, two frozen, two of motion; a tone, two seconds of
 * silence, then a tone that stops at level. Every check below has something
 * real to find, and the measurement is the one the pipeline runs.
 */
describe('a real file with real defects', () => {
  let workDir = '';
  let clipPath = '';
  let built = false;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'act-one-temporal-'));
    clipPath = path.join(workDir, 'defective.mp4');
    const run = await runFfmpeg(
      [
        '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2',
        '-f', 'lavfi', '-i', 'color=c=navy:size=320x240:rate=30:duration=2',
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=48000',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2:sample_rate=48000',
        '-filter_complex',
        '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a][5:a]concat=n=3:v=0:a=1[a]',
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        clipPath,
      ],
      { timeoutMs: 120_000 },
    );
    built = run.ok;
  }, 180_000);

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('measures the freeze, the silence and the tail out of the file itself', async () => {
    expect(built, 'the fixture clip was not built').toBe(true);
    const measured = await measureFilm(clipPath, { workDir });

    // Exactly the segment that was made static.
    expect(measured.freezes).toEqual([{ start: 2, end: 4 }]);
    expect(measured.silences).toHaveLength(1);
    expect(measured.silences[0]!.start).toBeCloseTo(2, 1);
    expect(measured.silences[0]!.end).toBeCloseTo(4, 1);
    // Still at level in the final 200ms: this film stops rather than ends.
    expect(measured.tailPeakDb).toBeGreaterThan(-40);
    expect(measured.windows.length).toBeGreaterThan(0);
  }, 180_000);

  it('turns what it measured into findings a repair can act on', async () => {
    expect(built, 'the fixture clip was not built').toBe(true);
    const measured = await measureFilm(clipPath, { workDir });
    const scenes = [scene({ duration: 6 })];
    const findings = [
      ...heldFrameIssues({ freezes: measured.freezes, scenes, cut: 'feature', fps: 30 }),
      ...deadAirIssues({ silences: measured.silences, durationSeconds: 6, cut: 'feature', scenes }),
      ...abruptEndIssue({ tailPeakDb: measured.tailPeakDb, durationSeconds: 6 }),
    ];

    expect(findings.map((finding) => finding.check).sort()).toEqual([
      'abrupt_music_end',
      'silence_gap',
      'still_frame_hold',
    ]);
    // Every one of them names a repair, which is what makes the loop possible.
    for (const finding of findings) expect(finding.repair).not.toBeNull();
  }, 180_000);
});
