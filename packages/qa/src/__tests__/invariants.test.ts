import { describe, it, expect } from 'vitest';
import {
  QaIssue,
  newId,
  readingSecondsFor,
  resequence,
  runtimeToleranceFor,
  storyboardDuration,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import { applyRepairs, checkStructure, contractFor, planRepairs, scoreRepair } from '../index.ts';
import { QaReport } from '@act-one/core';

/**
 * The repair that fixed the defect and broke the film.
 *
 * A ten-second cut whose middle shot held one word for six seconds. The trim
 * removed every held frame and the film came out at four and nine — every
 * local check green, half the runtime gone, and the loop called it ready.
 *
 * That is the regression these guard. A repair is a success only when the
 * defect goes AND nothing new arrives AND the film still satisfies what the
 * customer approved. Where the recovered time has nowhere to go, the honest
 * answer is that the plan is short of content, which is a creative question
 * and is escalated as one — never a film quietly delivered at half length.
 */
function shot(over: Partial<Scene> & Pick<Scene, 'id' | 'duration'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, purpose: 'a beat', narration: '',
    onScreenText: [], assetRefs: [], momentIds: [], visualType: 'kinetic_typography',
    motionRecipe: { name: 'hold', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
    cameraRecipe: {
      move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0,
      motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart',
    },
    uiSequence: null,
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
    ...over,
  };
}

function board(scenes: Scene[]): Storyboard {
  return resequence({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
    scenes, voiceStrategy: 'none', language: null, musicDirection: '', parentStoryboardId: null, revisionReason: '', status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

function held(sceneId: string, start: number, end: number): QaIssue {
  return QaIssue.parse({
    id: newId('evt'), check: 'still_frame_hold', severity: 'soft_fail', layer: 'visual',
    sceneId, timecodeStart: start, timecodeEnd: end, message: 'nothing moves',
    confidence: 0.9, repair: 'trim_hold', detectedBy: 'temporal',
  });
}

/** The film from the failure: 2s / 6s / 2s of held typography, approved at 10s. */
function theFailingFilm() {
  return board([
    shot({ id: 's1', duration: 2, onScreenText: ['Close the books.'] }),
    shot({ id: 's2', duration: 6, onScreenText: ['Once.'] }),
    shot({ id: 's3', duration: 2, onScreenText: ['Northwind.'] }),
  ]);
}

const trimPlan = (sceneIds: string[]) => ({
  scenes: sceneIds.map((sceneId) => ({
    sceneId, action: 'trim_hold' as const, reason: 'held', issueId: 'evt_1',
    check: 'still_frame_hold' as const, escalated: false,
  })),
  film: [], manual: [], state: 'repairing' as const, shippable: false, deadEnd: false,
});

describe('a repair that fixes the shot and breaks the film', () => {
  it('does not let a ten-second film come back at five', () => {
    const approved = theFailingFilm();
    const contract = contractFor(approved, { cut: 'feature' });
    expect(contract.approvedSeconds).toBe(10);

    const issues = [held('s2', 2.333, 7.933), held('s3', 8.367, 9.767)];
    const applied = applyRepairs(approved, trimPlan(['s2', 's3']), {
      issues,
      cut: 'feature',
      preserveSeconds: contract.approvedSeconds,
    });

    // The trims work. Nothing can carry the seconds they give back, because
    // every shot in this film is a static composition — so the runtime falls.
    expect(applied.recoveredSeconds).toBeGreaterThan(4);
    expect(applied.placedSeconds).toBe(0);
    expect(applied.starvedSceneIds).toEqual(['s2', 's3']);

    const violations = checkStructure(applied.storyboard, contract);
    expect(violations.map((violation) => violation.invariant)).toContain('runtime');
    expect(violations[0]!.message).toMatch(/approved at 10.00s/);
  });

  it('refuses the candidate even though every targeted defect is gone', () => {
    const approved = theFailingFilm();
    const contract = contractFor(approved, { cut: 'feature' });
    const targeted = [held('s2', 2.333, 7.933), held('s3', 8.367, 9.767)];
    const candidate = applyRepairs(approved, trimPlan(['s2', 's3']), {
      issues: targeted,
      cut: 'feature',
      preserveSeconds: contract.approvedSeconds,
    }).storyboard;

    const score = scoreRepair({
      contract,
      candidate,
      before: targeted,
      // The recheck is clean: this is exactly the run that was called ready.
      after: [],
      targeted,
    });

    expect(score.targetDefectsResolved).toBe(2);
    expect(score.targetDefectsRemaining).toBe(0);
    expect(score.newHardDefects).toBe(0);
    expect(score.newSoftDefects).toBe(0);
    expect(score.runtimeBefore).toBe(10);
    expect(score.runtimeAfter).toBeLessThan(6);
    expect(score.durationConstraintSatisfied).toBe(false);
    // Two defects resolved, nothing new, and the answer is still no.
    expect(score.accepted).toBe(false);
    expect(score.reason).toMatch(/approved at 10.00s/);
  });

  it('escalates the beat rather than trimming it again', () => {
    // The trim came back unchanged or was rolled back, so the ladder moves on
    // — and the next rung is not another edit to the timeline.
    const report = QaReport.parse({
      id: 'qa_1', renderId: 'rnd_1', projectId: 'prj_1', passed: true,
      issues: [held('s2', 2.333, 7.933)], createdAt: '2026-01-01T00:00:00.000Z',
    });
    const plan = planRepairs({
      report,
      attempt: 1,
      maxAttempts: 2,
      history: [
        {
          id: 'evt_h', issueId: 'evt_old', check: 'still_frame_hold', sceneId: 's2',
          action: 'trim_hold', attempt: 0, outcome: 'rejected', level: 1,
          providerCostUsd: 0, computeMs: 0, estimatedComputeCostUsd: 0, wallClockMs: 0, note: '',
        },
      ],
    });

    expect(plan.scenes).toEqual([]);
    expect(plan.manual.map((issue) => issue.check)).toEqual(['still_frame_hold']);
    expect(plan.state).toBe('needs_attention');
  });
});

describe('a repair that keeps the film whole', () => {
  it('puts the recovered time into the shots that can carry it', () => {
    const approved = board([
      shot({ id: 's1', duration: 2, onScreenText: ['Close the books.'] }),
      shot({ id: 's2', duration: 6, onScreenText: ['Once.'] }),
      // Real footage. This shot keeps moving for its whole length, so it can
      // hold a viewer longer without becoming a held frame — and it is long
      // enough to absorb everything the trim gives back.
      shot({
        id: 's3', duration: 10, visualType: 'generated_broll', assetRefs: ['ast_1'],
        motionRecipe: { name: 'footage', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
      }),
    ]);
    const contract = contractFor(approved, { cut: 'feature' });
    const issues = [held('s2', 2.333, 7.933)];

    const applied = applyRepairs(approved, trimPlan(['s2']), {
      issues, cut: 'feature', preserveSeconds: contract.approvedSeconds,
    });

    expect(applied.recoveredSeconds).toBeGreaterThan(0);
    expect(applied.placedSeconds).toBeGreaterThan(0);
    // It went to the footage, not to the held typography.
    const after = new Map(applied.storyboard.scenes.map((scene) => [scene.id, scene.duration]));
    expect(after.get('s1')).toBe(2);
    expect(after.get('s3')).toBeGreaterThan(10);
    // And the film is the length it was approved at.
    expect(storyboardDuration(applied.storyboard)).toBeCloseTo(contract.approvedSeconds, 1);

    const score = scoreRepair({
      contract, candidate: applied.storyboard, before: issues, after: [], targeted: issues,
    });
    expect(score.targetDefectsResolved).toBe(1);
    expect(score.accepted).toBe(true);
  });

  it('refuses the pass when the shots that move cannot absorb it all', () => {
    // Four and a half seconds to place and two seconds of capacity. Placing
    // what fits and shipping the rest of the hole is the failure this whole
    // layer exists to refuse.
    const approved = board([
      shot({ id: 's1', duration: 2, onScreenText: ['Close the books.'] }),
      shot({ id: 's2', duration: 6, onScreenText: ['Once.'] }),
      shot({
        id: 's3', duration: 4, visualType: 'generated_broll', assetRefs: ['ast_1'],
        motionRecipe: { name: 'footage', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
      }),
    ]);
    const contract = contractFor(approved, { cut: 'feature' });
    const issues = [held('s2', 2.333, 7.933)];
    const applied = applyRepairs(approved, trimPlan(['s2']), {
      issues, cut: 'feature', preserveSeconds: contract.approvedSeconds,
    });

    expect(applied.placedSeconds).toBeGreaterThan(0);
    expect(applied.placedSeconds).toBeLessThan(applied.recoveredSeconds);
    const score = scoreRepair({
      contract, candidate: applied.storyboard, before: issues, after: [], targeted: issues,
    });
    expect(score.durationConstraintSatisfied).toBe(false);
    expect(score.accepted).toBe(false);
  });

  it('never grows a shot past half its own length again', () => {
    const approved = board([
      shot({ id: 's1', duration: 20, onScreenText: ['Twenty seconds of nothing at all'] }),
      shot({
        id: 's2', duration: 2, visualType: 'generated_broll', assetRefs: ['ast_1'],
        motionRecipe: { name: 'footage', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
      }),
    ]);
    const contract = contractFor(approved, { cut: 'feature' });
    const applied = applyRepairs(approved, trimPlan(['s1']), {
      issues: [held('s1', 0.5, 20)], cut: 'feature', preserveSeconds: contract.approvedSeconds,
    });

    // A two-second cutaway stretched to seven is not the same shot, and
    // nobody approved that one.
    expect(applied.storyboard.scenes[1]!.duration).toBeLessThanOrEqual(3);
  });
});

describe('the constraints themselves', () => {
  const approved = board([
    shot({ id: 's1', duration: 4, onScreenText: ['Four words go here'], assetRefs: ['ast_1'] }),
    shot({ id: 's2', duration: 4, visualType: 'logo_reveal' }),
  ]);
  const contract = contractFor(approved, { cut: 'feature' });

  it('takes the runtime the customer approved, within five per cent', () => {
    expect(runtimeToleranceFor(10)).toBe(0.5);
    // With a floor, so a short film is not held to a precision nobody can see.
    expect(runtimeToleranceFor(4)).toBe(0.4);

    const nudged = board([shot({ id: 's1', duration: 4.3, onScreenText: ['Four words go here'], assetRefs: ['ast_1'] }), shot({ id: 's2', duration: 4, visualType: 'logo_reveal' })]);
    expect(checkStructure(nudged, contract)).toEqual([]);
  });

  it('catches a shot trimmed under the time its copy needs', () => {
    const copy = 'Four words go here';
    const tight = board([
      shot({ id: 's1', duration: 1, onScreenText: [copy], assetRefs: ['ast_1'] }),
      shot({ id: 's2', duration: 7, visualType: 'logo_reveal' }),
    ]);
    expect(readingSecondsFor(copy)).toBeGreaterThan(1);
    const found = checkStructure(tight, contract).map((violation) => violation.invariant);
    expect(found).toContain('readability');
  });

  it('catches a shot cut so short it reads as a flash', () => {
    const flashed = board([
      shot({ id: 's1', duration: 0.4 }),
      shot({ id: 's2', duration: 7.6, visualType: 'logo_reveal' }),
    ]);
    expect(checkStructure(flashed, contract).map((v) => v.invariant)).toContain('minimum_shot');
  });

  it('catches the closing beat being deleted, and allows a removal that was asked for', () => {
    const noEnding = board([shot({ id: 's1', duration: 8, onScreenText: ['Four words go here'], assetRefs: ['ast_1'] })]);
    const blind = checkStructure(noEnding, contract).map((v) => v.invariant);
    expect(blind).toContain('structure');
    expect(blind).toContain('payoff');

    // Asked for: the shot is allowed to go, and the payoff is still owed.
    const asked = checkStructure(noEnding, contract, { removing: ['s2'] }).map((v) => v.invariant);
    expect(asked).not.toContain('structure');
    expect(asked).toContain('payoff');
  });

  it('catches material quietly falling out of the film', () => {
    const stripped = board([
      shot({ id: 's1', duration: 4, onScreenText: ['Four words go here'], assetRefs: [] }),
      shot({ id: 's2', duration: 4, visualType: 'logo_reveal' }),
    ]);
    expect(checkStructure(stripped, contract).map((v) => v.invariant)).toContain('assets');
    // Unless a repair cleared it on purpose so new material can be fetched.
    expect(checkStructure(stripped, contract, { refetching: ['s1'] }).map((v) => v.invariant)).not.toContain('assets');
  });

  it('catches the shots coming back in a different order', () => {
    const shuffled = board([
      shot({ id: 's2', duration: 4, visualType: 'logo_reveal' }),
      shot({ id: 's1', duration: 4, onScreenText: ['Four words go here'], assetRefs: ['ast_1'] }),
    ]);
    const found = checkStructure(shuffled, contract).map((v) => v.invariant);
    expect(found).toContain('structure');
  });

  it('refuses a candidate that traded one defect for another', () => {
    const candidate = board([
      shot({ id: 's1', duration: 4, onScreenText: ['Four words go here'], assetRefs: ['ast_1'] }),
      shot({ id: 's2', duration: 4, visualType: 'logo_reveal' }),
    ]);
    const before = [held('s1', 0.5, 3)];
    const after = [QaIssue.parse({
      id: newId('evt'), check: 'text_overflow', severity: 'hard_fail', sceneId: 's1',
      message: 'the copy no longer fits', confidence: 1, repair: 'reduce_duration',
    })];

    const score = scoreRepair({ contract, candidate, before, after, targeted: before });
    expect(score.targetDefectsResolved).toBe(1);
    expect(score.newHardDefects).toBe(1);
    expect(score.noNewDefects).toBe(false);
    expect(score.accepted).toBe(false);
  });

  it('accepts a clean repair, and says so in every flag', () => {
    const before = [held('s1', 0.5, 3)];
    const score = scoreRepair({ contract, candidate: approved, before, after: [], targeted: before });
    expect(score).toMatchObject({
      targetDefectsResolved: 1,
      targetDefectsRemaining: 0,
      newHardDefects: 0,
      newSoftDefects: 0,
      runtimeBefore: 8,
      runtimeAfter: 8,
      durationConstraintSatisfied: true,
      readabilitySatisfied: true,
      narrativeSatisfied: true,
      assetsSatisfied: true,
      noNewDefects: true,
      accepted: true,
    });
    expect(storyboardDuration(approved)).toBe(score.runtimeAfter);
  });
});

describe('findings the planner cannot place', () => {
  it('escalates a shot repair that names no shot rather than dropping it', () => {
    // `brand_consistency` is about the film and its repair is `regenerate_shot`.
    // The planner has no shot to aim at, so it used to skip the finding
    // entirely: never repaired, never escalated, absent from the reason the
    // film was held. A real render surfaced it.
    const report = QaReport.parse({
      id: 'qa_1', renderId: 'rnd_1', projectId: 'prj_1', passed: true,
      issues: [
        QaIssue.parse({
          id: newId('evt'), check: 'brand_consistency', severity: 'soft_fail', sceneId: null,
          message: 'the film drifts off the brand', confidence: 0.8, repair: 'regenerate_shot',
        }),
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const plan = planRepairs({ report, attempt: 0, maxAttempts: 2 });
    expect(plan.scenes).toEqual([]);
    expect(plan.manual.map((issue) => issue.check)).toEqual(['brand_consistency']);
  });
});
