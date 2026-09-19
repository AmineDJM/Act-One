import {
  SEVERITY_ORDER,
  readingSecondsFor,
  runtimeToleranceFor,
  storyboardDuration,
  type FilmContract,
  type InvariantViolation,
  type QaIssue,
  type RepairScore,
  type Scene,
  type Storyboard,
} from '@act-one/core';

/**
 * What a repair is not allowed to break.
 *
 * The loop used to ask one question — did the defect go away — and a repair
 * that answered yes was a success. A trim that took a ten-second film to four
 * and nine passed that test: the held frames were gone, and so was half the
 * film. The defect was local, the constraint it broke was global, and the
 * local one is never the more important of the two.
 *
 * Two passes, deliberately separated by what they cost. The structural pass
 * reads the candidate storyboard and costs nothing, so a repair that would
 * ruin the film is caught before a render is spent on it. The score is written
 * after the candidate has been rendered and inspected, because whether a
 * repair introduced a new defect is only knowable from the film it produced.
 */

/** A shot below this reads as a flash rather than a shot. Mirrors the repair floor. */
const MIN_SHOT_SECONDS = 0.8;

/** The accepted cut, as the thing the next pass has to hand back. */
export function contractFor(
  storyboard: Storyboard,
  options: { cut: string; requiresPayoff?: boolean },
): FilmContract {
  return {
    approvedSeconds: storyboardDuration(storyboard),
    cut: options.cut,
    requiresPayoff: options.requiresPayoff ?? endsOnPayoff(storyboard),
    shots: storyboard.scenes.map((scene) => ({ id: scene.id, assetRefs: [...scene.assetRefs] })),
  };
}

/** What a repair pass says it means to change, so a deliberate edit is not read as a loss. */
export type RepairIntent = {
  /** Shots the plan removes on purpose. */
  removing?: readonly string[];
  /** Shots whose material the plan clears so it can be fetched again. */
  refetching?: readonly string[];
};

/**
 * Everything decidable from the candidate storyboard alone.
 *
 * Free, so it runs before the render rather than after it: the cheapest
 * moment to reject a repair is the one before it costs anything.
 */
export function checkStructure(
  candidate: Storyboard,
  contract: FilmContract,
  intent: RepairIntent = {},
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const removing = new Set(intent.removing ?? []);
  const refetching = new Set(intent.refetching ?? []);

  const runtime = storyboardDuration(candidate);
  const tolerance = runtimeToleranceFor(contract.approvedSeconds);
  if (Math.abs(runtime - contract.approvedSeconds) > tolerance) {
    violations.push({
      invariant: 'runtime',
      sceneId: null,
      message:
        `The cut is ${runtime.toFixed(2)}s and the film approved at ` +
        `${contract.approvedSeconds.toFixed(2)}s (±${tolerance.toFixed(2)}s).`,
    });
  }

  // Shots do not vanish, and the argument keeps its order. A removal counts
  // only when the plan asked for it; anything else is a shot lost in transit.
  const present = candidate.scenes.map((scene) => scene.id);
  const expected = contract.shots.map((shot) => shot.id).filter((id) => !removing.has(id));
  const missing = expected.filter((id) => !present.includes(id));
  if (missing.length > 0) {
    violations.push({
      invariant: 'structure',
      sceneId: missing[0] ?? null,
      message: `${missing.length} shot(s) left the film without a repair asking for it.`,
    });
  }
  const kept = present.filter((id) => expected.includes(id));
  if (kept.join('|') !== expected.filter((id) => present.includes(id)).join('|')) {
    violations.push({
      invariant: 'structure',
      sceneId: null,
      message: 'The shots came back in a different order than the approved cut.',
    });
  }

  for (const scene of candidate.scenes) {
    if (scene.duration < MIN_SHOT_SECONDS) {
      violations.push({
        invariant: 'minimum_shot',
        sceneId: scene.id,
        message: `A shot runs ${scene.duration.toFixed(2)}s, which reads as a flash rather than a shot.`,
      });
    }
    const copy = scene.onScreenText.join(' ');
    const needed = readingSecondsFor(copy);
    if (needed > 0 && scene.duration < needed) {
      violations.push({
        invariant: 'readability',
        sceneId: scene.id,
        message:
          `A shot runs ${scene.duration.toFixed(2)}s and its copy takes ` +
          `${needed.toFixed(2)}s to read.`,
      });
    }
  }

  if (contract.requiresPayoff && !endsOnPayoff(candidate)) {
    violations.push({
      invariant: 'payoff',
      sceneId: null,
      message: 'The film no longer ends on its closing beat.',
    });
  }

  /*
   * Material that stopped being used without a repair asking for it.
   *
   * A shot the plan removed, and a shot whose material the plan cleared so it
   * can be fetched again, both drop their assets on purpose. Anything else is
   * a commissioned shot quietly falling out of the film.
   */
  const referenced = new Set(candidate.scenes.flatMap((scene) => scene.assetRefs));
  const lost = contract.shots
    .filter((shot) => !removing.has(shot.id) && !refetching.has(shot.id))
    .flatMap((shot) => shot.assetRefs)
    .filter((id) => !referenced.has(id));
  if (lost.length > 0) {
    violations.push({
      invariant: 'assets',
      sceneId: null,
      message: `${lost.length} asset(s) stopped being used without a repair asking for it.`,
    });
  }

  return violations;
}

/**
 * The verdict on a repair pass.
 *
 * Every named flag comes from `violations`, so the summary and the detail
 * cannot disagree — which they would, eventually, if a person had to set both.
 */
export function scoreRepair(params: {
  contract: FilmContract;
  candidate: Storyboard;
  /** Findings on the cut the repairs were planned from. */
  before: readonly QaIssue[];
  /** Findings on the candidate, once it has been rendered and inspected. */
  after: readonly QaIssue[];
  /** What this pass set out to fix. */
  targeted: readonly QaIssue[];
  intent?: RepairIntent;
}): RepairScore {
  const violations = [...checkStructure(params.candidate, params.contract, params.intent ?? {})];

  const key = (issue: { check: string; sceneId: string | null }) => `${issue.check}:${issue.sceneId ?? 'film'}`;
  const still = new Set(params.after.map(key));
  const was = new Set(params.before.map(key));

  const remaining = params.targeted.filter((issue) => still.has(key(issue)));
  const introduced = params.after.filter(
    (issue) => !was.has(key(issue)) && SEVERITY_ORDER[issue.severity] >= SEVERITY_ORDER.soft_fail,
  );
  const newHard = introduced.filter((issue) => SEVERITY_ORDER[issue.severity] >= SEVERITY_ORDER.hard_fail);
  const newSoft = introduced.filter((issue) => SEVERITY_ORDER[issue.severity] === SEVERITY_ORDER.soft_fail);

  if (introduced.length > 0) {
    violations.push({
      invariant: 'new_defects',
      sceneId: introduced[0]?.sceneId ?? null,
      message:
        `The pass introduced ${introduced.length} finding(s) the approved cut did not have, ` +
        `starting with ${introduced[0]?.check}.`,
    });
  }

  const has = (invariant: InvariantViolation['invariant']) =>
    violations.some((violation) => violation.invariant === invariant);

  const runtimeAfter = storyboardDuration(params.candidate);
  return {
    targetDefectsResolved: params.targeted.length - remaining.length,
    targetDefectsRemaining: remaining.length,
    newHardDefects: newHard.length,
    newSoftDefects: newSoft.length,
    runtimeBefore: params.contract.approvedSeconds,
    runtimeAfter,
    runtimeTolerance: runtimeToleranceFor(params.contract.approvedSeconds),
    durationConstraintSatisfied: !has('runtime'),
    readabilitySatisfied: !has('readability') && !has('minimum_shot'),
    narrativeSatisfied: !has('structure') && !has('payoff'),
    assetsSatisfied: !has('assets'),
    noNewDefects: !has('new_defects'),
    violations,
    accepted: violations.length === 0,
    reason: violations[0]?.message ?? '',
  };
}

/**
 * Whether a film ends on something that reads as an ending.
 *
 * Not a general question about structure — only about the last beat, because
 * that is the one a timeline repair can delete without noticing. A film that
 * never had a closing card is not given one here.
 */
export function endsOnPayoff(storyboard: Storyboard): boolean {
  const last = storyboard.scenes.at(-1);
  if (!last) return false;
  return isPayoff(last);
}

function isPayoff(scene: Scene): boolean {
  return (
    scene.visualType === 'logo_reveal' ||
    scene.motionRecipe.name === 'cta_end_card' ||
    scene.motionRecipe.name === 'logo_reveal'
  );
}
