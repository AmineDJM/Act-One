import {
  qaVerdict,
  sceneShowsSomething,
  type QaIssue,
  type QaReport,
  type RepairAction,
  type Scene,
  type Storyboard,
} from '@act-one/core';

/**
 * Auto-repair planning.
 *
 * The rule is that a repair touches only what broke. Re-rendering a whole film
 * because one generated shot came back with a smeared hand costs ten minutes
 * and a few dollars, and — worse — produces a *different* film, so the scenes
 * the customer already approved change underneath them.
 */
export type RepairPlan = {
  /** Scenes to re-render, and what to do to each. */
  scenes: { sceneId: string; action: RepairAction; reason: string }[];
  /** Repairs that need a person. */
  manual: QaIssue[];
  /** True when the film can ship as-is. */
  shippable: boolean;
  /** True when nothing can be repaired automatically and it is still broken. */
  deadEnd: boolean;
};

export function planRepairs(report: QaReport, attempt: number, maxAttempts = 2): RepairPlan {
  const { passed, repairable } = qaVerdict(report.issues);

  const manual = report.issues.filter(
    (issue) =>
      (issue.severity === 'hard_fail' || issue.severity === 'soft_fail') &&
      (!issue.repair || issue.repair === 'manual_review'),
  );

  if (passed && repairable.length === 0) {
    return { scenes: [], manual, shippable: true, deadEnd: false };
  }

  // Past the attempt budget we stop rather than looping: a repair that has
  // failed twice is not going to succeed on the third identical try, and an
  // unbounded repair loop is the most expensive bug this system could have.
  if (attempt >= maxAttempts) {
    return {
      scenes: [],
      manual: [...manual, ...repairable],
      shippable: false,
      deadEnd: true,
    };
  }

  // One repair per scene, most severe wins. Two conflicting instructions for
  // the same scene ("recrop" and "regenerate") would fight each other.
  const bySc = new Map<string, { action: RepairAction; reason: string; severity: number }>();
  for (const issue of repairable) {
    if (!issue.sceneId || !issue.repair) continue;
    const severity = issue.severity === 'hard_fail' ? 2 : 1;
    const existing = bySc.get(issue.sceneId);
    if (!existing || severity > existing.severity) {
      bySc.set(issue.sceneId, { action: issue.repair, reason: issue.message, severity });
    }
  }

  return {
    scenes: [...bySc.entries()].map(([sceneId, value]) => ({
      sceneId,
      action: value.action,
      reason: value.reason,
    })),
    manual,
    shippable: false,
    deadEnd: bySc.size === 0 && manual.length > 0,
  };
}

/**
 * Applies the structural half of a repair to the storyboard.
 *
 * The parts that need a provider (regenerate a shot, recapture a screen) are
 * carried out by the pipeline; everything that is a pure storyboard edit
 * happens here so it is deterministic and testable.
 */
export function applyRepairs(
  storyboard: Storyboard,
  plan: RepairPlan,
): { storyboard: Storyboard; needsProvider: { sceneId: string; action: RepairAction }[] } {
  const actions = new Map(plan.scenes.map((entry) => [entry.sceneId, entry]));
  const needsProvider: { sceneId: string; action: RepairAction }[] = [];

  const scenes = storyboard.scenes
    .map((scene): Scene | null => {
      const repair = actions.get(scene.id);
      if (!repair) return scene;

      switch (repair.action) {
        case 'reduce_duration':
          // Grow the scene rather than cut the copy: the words were approved.
          return { ...scene, duration: round3(scene.duration * 1.3), status: 'draft' };

        case 'relayout_text':
          return {
            ...scene,
            onScreenText: scene.onScreenText.slice(0, Math.max(1, scene.onScreenText.length - 1)),
            status: 'draft',
          };

        case 'rewrite_copy': {
          /*
           * Taking the words off a typographic scene leaves a black frame for
           * its whole duration — the repair loop was manufacturing exactly the
           * defect everything else here exists to catch. If the scene has
           * nothing else to show, it goes; if it has a capture or a generated
           * shot behind it, it stays and plays without the copy.
           */
          const stripped: Scene = {
            ...scene,
            onScreenText: [],
            narration: '',
            voiceOver: false,
            status: 'draft',
          };
          return sceneShowsSomething(stripped) ? stripped : null;
        }

        case 'remove_scene':
          return null;

        case 'adjust_contrast':
          return { ...scene, status: 'draft', notes: `${scene.notes} [contrast corrected]`.trim() };

        case 'regenerate_shot':
        case 'recapture_product':
        case 'swap_asset':
        case 'recrop':
          needsProvider.push({ sceneId: scene.id, action: repair.action });
          return { ...scene, assetRefs: [], status: 'assets_pending' };

        default:
          return scene;
      }
    })
    .filter((scene): scene is Scene => scene !== null);

  let cursor = 0;
  const resequenced = scenes.map((scene, index) => {
    const next = { ...scene, index, startTime: round3(cursor) };
    cursor += scene.duration;
    return next;
  });

  return {
    storyboard: { ...storyboard, scenes: resequenced, updatedAt: new Date().toISOString() },
    needsProvider,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
