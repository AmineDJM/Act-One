import { describe, it, expect } from 'vitest';
import {
  QaIssue,
  SEVERITY_ORDER,
  blocksRelease,
  categoryOf,
  layerOf,
  newId,
  normalizeFindings,
  qaVerdict,
  releaseDecision,
  repairableAutomatically,
  type QaFinding,
  type QaSeverity,
} from '../index.ts';

/**
 * What a finding obliges.
 *
 * The old vocabulary had one level above "not a blocker", so a defect worth
 * repairing and a defect worth mentioning were the same thing and neither was
 * repaired. Each level now says what happens next, and the release gate is the
 * one place that decides whether a film may be delivered.
 */
function finding(over: Partial<QaFinding> = {}): QaFinding {
  return {
    id: newId('evt'),
    check: 'safe_area',
    severity: 'hard_fail',
    message: 'A caption sits below the platform caption bar.',
    repair: 'reposition_captions',
    ...over,
  };
}

describe('severity', () => {
  it('orders from an observation to an invalid output', () => {
    const levels: QaSeverity[] = ['info', 'warning', 'soft_fail', 'hard_fail', 'critical_fail'];
    const ordered = [...levels].sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b]);
    expect(ordered).toEqual(levels);
  });

  it('stops a release at hard, and not before', () => {
    expect(blocksRelease('info')).toBe(false);
    expect(blocksRelease('warning')).toBe(false);
    // A soft fail is repaired, not withheld: if the repair cannot be made and
    // nothing worse is outstanding, the customer gets their film.
    expect(blocksRelease('soft_fail')).toBe(false);
    expect(blocksRelease('hard_fail')).toBe(true);
    expect(blocksRelease('critical_fail')).toBe(true);
  });
});

describe('a finding', () => {
  it('fills what a check did not say, and stamps the layer the check belongs to', () => {
    const [normalised] = normalizeFindings([finding({ check: 'caption_onset' })]);
    expect(normalised).toMatchObject({
      layer: 'cross_modal',
      timecodeStart: null,
      timecodeEnd: null,
      frameStart: null,
      frameEnd: null,
      repairStatus: 'open',
      repairAttempts: 0,
      because: '',
    });
  });

  it('keeps a timecode and a frame range when the check counted them', () => {
    const [normalised] = normalizeFindings([
      finding({ check: 'still_frame_hold', timecodeStart: 4.2, timecodeEnd: 6.8, frameStart: 126, frameEnd: 204 }),
    ]);
    expect(normalised).toMatchObject({ timecodeStart: 4.2, timecodeEnd: 6.8, frameStart: 126, frameEnd: 204 });
  });

  it('knows which family it belongs to, which is the thing worth counting', () => {
    expect(categoryOf('caption_onset')).toBe('sync');
    expect(categoryOf('awkward_hold')).toBe('timing');
    expect(categoryOf('safe_area')).toBe('text');
    expect(categoryOf('abrupt_music_end')).toBe('audio');
    expect(categoryOf('container_integrity')).toBe('delivery');
  });

  it('puts each check in the pass that can actually decide it', () => {
    expect(layerOf('duration_mismatch')).toBe('delivery');
    expect(layerOf('audio_loudness')).toBe('audio');
    expect(layerOf('lip_sync')).toBe('cross_modal');
    expect(layerOf('dead_pacing')).toBe('structural');
  });

  it('is only the loop’s business when a repair exists that is not a person', () => {
    expect(repairableAutomatically({ repair: 'retime_captions' })).toBe(true);
    expect(repairableAutomatically({ repair: null })).toBe(false);
    expect(repairableAutomatically({ repair: 'manual_review' })).toBe(false);
  });
});

describe('the verdict', () => {
  it('separates what blocks from what the loop should act on', () => {
    const issues = normalizeFindings([
      finding({ severity: 'info', check: 'direction', repair: null }),
      finding({ severity: 'warning', check: 'caption_readability', repair: null }),
      finding({ severity: 'soft_fail', check: 'caption_onset', repair: 'retime_captions' }),
      finding({ severity: 'hard_fail', check: 'safe_area', repair: 'reposition_captions' }),
    ]);
    const verdict = qaVerdict(issues);

    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.map((issue) => issue.check)).toEqual(['safe_area']);
    // The soft fail is repaired too, which is the whole reason the level exists.
    expect(verdict.repairable.map((issue) => issue.check)).toEqual(['caption_onset', 'safe_area']);
    expect(verdict.worst).toBe('hard_fail');
  });

  it('passes a film whose only findings are observations', () => {
    const verdict = qaVerdict(normalizeFindings([finding({ severity: 'info', repair: null })]));
    expect(verdict.passed).toBe(true);
    expect(verdict.worst).toBe('info');
  });
});

describe('the release gate', () => {
  it('lets a clean film through', () => {
    const decision = releaseDecision({ issues: [], attempt: 0, maxAttempts: 2 });
    expect(decision.state).toBe('ready');
  });

  it('never reaches ready with a hard fail outstanding', () => {
    const issues = normalizeFindings([finding({ severity: 'hard_fail' })]);
    expect(releaseDecision({ issues, attempt: 0, maxAttempts: 2 }).state).toBe('qa_failed');
  });

  it('never reaches ready with a critical fail outstanding', () => {
    const issues = normalizeFindings([
      finding({ severity: 'critical_fail', check: 'container_integrity', repair: null }),
    ]);
    const decision = releaseDecision({ issues, attempt: 0, maxAttempts: 2 });
    expect(decision.state).toBe('needs_attention');
    expect(decision.blocking).toHaveLength(1);
  });

  it('ships with a warning and a soft fail still on the record', () => {
    const issues = normalizeFindings([
      finding({ severity: 'warning', repair: null }),
      finding({ severity: 'soft_fail', check: 'caption_onset', repair: 'retime_captions' }),
    ]);
    expect(releaseDecision({ issues, attempt: 2, maxAttempts: 2 }).state).toBe('ready');
  });

  it('asks for a person once the attempts are spent', () => {
    const issues = normalizeFindings([finding({ severity: 'hard_fail' })]);
    const decision = releaseDecision({ issues, attempt: 2, maxAttempts: 2 });
    expect(decision.state).toBe('needs_attention');
    expect(decision.reason).toMatch(/after 2 repair attempts/);
  });

  it('asks for a person immediately when nothing here can be repaired', () => {
    const issues = normalizeFindings([finding({ severity: 'hard_fail', repair: 'manual_review' })]);
    const decision = releaseDecision({ issues, attempt: 0, maxAttempts: 2 });
    expect(decision.state).toBe('needs_attention');
    expect(decision.reason).toMatch(/without a person/);
  });

  it('does not hold a draft the customer is still changing to the delivery bar', () => {
    const issues = normalizeFindings([finding({ severity: 'hard_fail' })]);
    const decision = releaseDecision({ issues, attempt: 0, maxAttempts: 2, deliverable: false });
    expect(decision.state).toBe('ready');
  });
});

describe('the schema', () => {
  it('refuses a severity nobody defined', () => {
    expect(() => QaIssue.parse({ ...finding(), severity: 'catastrophic' })).toThrow();
  });

  it('refuses a check nobody defined, so a typo cannot become a category', () => {
    expect(() => QaIssue.parse({ ...finding(), check: 'vibes' })).toThrow();
  });
});
