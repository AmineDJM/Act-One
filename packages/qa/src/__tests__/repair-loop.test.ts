import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  HELD_FRAME_CEILING,
  QaReport,
  Scene,
  Storyboard,
  newId,
  normalizeFindings,
  releaseDecision,
  resequence,
  round3,
  type QaIssue,
} from '@act-one/core';
import { runFfmpeg } from '@act-one/sound';
import { applyRepairs, beginRepair, heldFrameIssues, measureFilm, planRepairs, settleRepairs } from '../index.ts';

/**
 * The loop closed on a real file.
 *
 * Everything else about repair is tested on numbers, which proves the
 * arithmetic and nothing about whether the arithmetic removes the defect. This
 * one measures a file, finds the hold, plans the repair, applies it to the
 * storyboard, renders the film the repaired storyboard describes, and measures
 * again — and the finding has to be gone, in one pass.
 *
 * One pass matters as much as the outcome. A repair that halves a defect looks
 * like progress and is not: the attempt budget is small, and a loop that
 * converges asymptotically spends all of it and delivers the defect anyway.
 * The version this replaced trimmed a fixed proportion of the hold and did
 * exactly that.
 *
 * The picture is built with FFmpeg rather than rendered, because what is under
 * test is the measure → find → repair → measure cycle, not Remotion. The full
 * chain including the real renderer is exercised by hand; this is the part
 * that can run on every commit.
 */
const SEGMENT_COLOURS = ['red', 'navy', 'green'];

/** A clip whose middle shot is a frozen colour field held too long. */
async function buildClip(workDir: string, name: string, durations: number[]): Promise<string> {
  const clipPath = path.join(workDir, `${name}.mp4`);
  const inputs = durations.flatMap((duration, index) =>
    index === 1
      ? ['-f', 'lavfi', '-i', `color=c=${SEGMENT_COLOURS[index]}:size=320x240:rate=30:duration=${duration}`]
      : ['-f', 'lavfi', '-i', `testsrc=size=320x240:rate=30:duration=${duration}`],
  );
  const run = await runFfmpeg(
    [
      '-nostdin', '-y',
      ...inputs,
      '-filter_complex', `${durations.map((_, i) => `[${i}:v]`).join('')}concat=n=${durations.length}:v=1:a=0[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      clipPath,
    ],
    { timeoutMs: 120_000 },
  );
  if (!run.ok) throw new Error(`the fixture clip could not be built: ${run.stderr.slice(-400)}`);
  return clipPath;
}

function boardOf(durations: number[]): Storyboard {
  const storyboardId = 'sbd_loop';
  return resequence(
    Storyboard.parse({
      id: storyboardId, projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
      scenes: durations.map((duration, index) =>
        Scene.parse({
          id: `scn_${index}`, storyboardId, index, startTime: 0, duration,
          purpose: `beat ${index}`, narration: '', onScreenText: [],
          visualType: 'generated_broll', motionRecipe: { name: 'footage' }, cameraRecipe: {},
          voiceOver: false, transition: 'cut',
        }),
      ),
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  );
}

function reportOf(issues: QaIssue[], durations: number[]): QaReport {
  return QaReport.parse({
    id: newId('ast'), renderId: 'rnd_1', projectId: 'prj_1',
    passed: !issues.some((found) => found.severity === 'hard_fail' || found.severity === 'critical_fail'),
    issues, cut: 'feature', durationSeconds: durations.reduce((sum, d) => sum + d, 0),
    createdAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('a defect found on a real file, repaired, and gone on the recheck', () => {
  let workDir = '';

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'act-one-loop-'));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('measures a held shot, trims it, and the recheck comes back clean', async () => {
    const before = [2, 2, 2];
    const firstCut = await buildClip(workDir, 'first', before);

    // Measure. This is the same call the render stage makes.
    const measured = await measureFilm(firstCut, { workDir });
    expect(measured.freezes).toEqual([{ start: 2, end: 4 }]);

    let storyboard = boardOf(before);
    const findings = normalizeFindings(
      heldFrameIssues({ freezes: measured.freezes, scenes: storyboard.scenes, cut: 'feature', fps: 30 }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ check: 'still_frame_hold', sceneId: 'scn_1', repair: 'trim_hold' });

    // Plan, and open a record for what it is about to try.
    const plan = planRepairs({ report: reportOf(findings, before), attempt: 0, maxAttempts: 2 });
    expect(plan.state).toBe('repairing');
    expect(plan.scenes).toEqual([
      expect.objectContaining({ sceneId: 'scn_1', action: 'trim_hold', escalated: false }),
    ]);
    const attempted = plan.scenes.map((repair) => beginRepair({ ...repair, attempt: 0 }));

    // Apply, and render the film the repaired storyboard now describes.
    storyboard = applyRepairs(storyboard, plan, { issues: findings, cut: 'feature' }).storyboard;
    const after = storyboard.scenes.map((scene) => scene.duration);
    // Inside the ceiling, not on it: see HOLD_TRIM_MARGIN.
    expect(after[1]).toBeLessThan(HELD_FRAME_CEILING.feature);
    expect(after).toEqual([2, round3(HELD_FRAME_CEILING.feature - 0.1), 2]);

    const secondCut = await buildClip(workDir, 'second', after);
    const remeasured = await measureFilm(secondCut, { workDir });
    const recheck = normalizeFindings(
      heldFrameIssues({ freezes: remeasured.freezes, scenes: storyboard.scenes, cut: 'feature', fps: 30 }),
    );

    // The hold is inside what the standard allows, so there is no finding —
    // not a smaller one.
    expect(recheck).toEqual([]);

    const settled = settleRepairs({
      attempted, before: findings, after: recheck, costUsd: 0, latencyMs: 4_200,
    });
    expect(settled).toEqual([
      expect.objectContaining({ check: 'still_frame_hold', sceneId: 'scn_1', outcome: 'fixed', costUsd: 0 }),
    ]);

    // And the film may ship.
    expect(releaseDecision({ issues: recheck, attempt: 1, maxAttempts: 2 }).state).toBe('ready');
  }, 180_000);
});
