import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { resequence, type Scene, type Storyboard } from '@act-one/core';
import { buildMix, directSound, mixArgs, muxArgs, runFfmpeg, wavDurationSeconds } from '../index.ts';

/**
 * The film is as long as its picture, whatever the sound does.
 *
 * An ending that takes the music out before the last frame — held silence
 * under the mark — used to end the mix early; a trim cannot lengthen
 * anything, and the mux stops at the shorter stream, so the delivered film
 * lost its close: 45.7 seconds of picture went out as 44.2. Proved here
 * against real FFmpeg, on a picture and a bed whose lengths are known.
 */
let dir = '';

const QUIET = { musicCharacter: 'Sub-heavy, sparse, tonal.', openOnMusic: true, uiSoundDensity: 'sparse' as const, impactsOnCuts: false, endWithSting: false };

async function ffmpeg(args: string[]): Promise<void> {
  const result = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  if (!result.ok) throw new Error(result.stderr);
}

/** A file's length as FFmpeg reads its header. */
async function durationOf(file: string): Promise<number> {
  const result = await runFfmpeg(['-hide_banner', '-i', file]);
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(result.stderr);
  if (!match) throw new Error(`no duration in ${result.stderr.slice(-300)}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Frames in a file's video stream, decoded and counted. */
async function frameCount(file: string): Promise<number> {
  const result = await runFfmpeg(['-hide_banner', '-i', file, '-map', '0:v:0', '-f', 'null', '-']);
  const matches = [...result.stderr.matchAll(/frame=\s*(\d+)/g)];
  if (matches.length === 0) throw new Error(`no frame count in ${result.stderr.slice(-300)}`);
  return Number(matches[matches.length - 1]![1]);
}

function board(seconds: number): Storyboard {
  const scene = {
    id: 'scn_1', storyboardId: 'sbd_1', index: 0, startTime: 0, duration: seconds, purpose: 'the mark',
    narration: '', onScreenText: [], visualType: 'logo', assetRefs: [], momentIds: [],
    motionRecipe: { name: 'logo_reveal', easing: 'out_quint', delay: 0, stagger: 0.05, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'none', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0, depthOfField: 0, easing: 'linear' },
    uiSequence: null, soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft', claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
  } as unknown as Scene;
  return resequence({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: null, handovers: {}, version: 1, scenes: [scene],
    voiceStrategy: 'none', language: 'en', heroShot: null, musicDirection: 'a quiet bed', status: 'draft',
    parentStoryboardId: null, revisionReason: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Storyboard);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'act-one-film-length-'));
});

describe('a film whose music leaves before its last frame', () => {
  it('is mixed to the film’s full length, the rest silence', async () => {
    const bed = path.join(dir, 'bed.wav');
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=6', '-ac', '2', '-c:a', 'pcm_s16le', bed]);
    const design = directSound({ storyboard: board(4), behaviour: QUIET, channel: 'web', hasVoiceOver: false });
    expect(design.music).not.toBeNull();
    // The ending takes the bed out at 1.5 s of a 4-second film.
    design.music = { ...design.music!, enterAtSeconds: 0, startOffsetSeconds: 0, exitAtSeconds: 1.5, fadeInSeconds: 0, fadeOutSeconds: 0.2 };
    design.cues = [];
    const plan = buildMix({ design, resolvedPaths: { [design.music.storageKey]: bed }, durationSeconds: 4 });
    const premix = path.join(dir, 'premix.wav');
    await ffmpeg(mixArgs(plan, premix).slice(4));
    expect(wavDurationSeconds(await readFile(premix))).toBeCloseTo(4, 2);
  });

  it('keeps every frame of its picture when the sound it is given is shorter', async () => {
    const picture = path.join(dir, 'picture.mp4');
    await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x204060:s=320x180:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', picture]);
    const short = path.join(dir, 'short.wav');
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.5', '-ac', '2', '-c:a', 'pcm_s16le', short]);
    const master = path.join(dir, 'master.mp4');
    await ffmpeg(muxArgs(picture, short, master, 4).slice(4));
    expect(await durationOf(master)).toBeGreaterThanOrEqual(3.99);
    expect(await durationOf(master)).toBeLessThan(4.1);
    expect(await frameCount(master)).toBe(120);
  });
});
