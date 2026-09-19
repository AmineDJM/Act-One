import {
  SEVERITY_ORDER,
  newId,
  qaVerdict,
  releaseDecision,
  repairableAutomatically,
  sceneShowsSomething,
  type QaCheck,
  type QaIssue,
  type QaReport,
  type RepairAction,
  type RepairRecord,
  type ReleaseState,
  type Scene,
  type Storyboard,
} from '@act-one/core';

/**
 * Auto-repair planning.
 *
 * Two rules. A repair touches only what broke — re-rendering a whole film
 * because one generated shot came back with a smeared hand costs ten minutes
 * and a few dollars and, worse, produces a *different* film, so the scenes the
 * customer already approved change underneath them. And a repair that has
 * already failed is not tried again in the same form: the second attempt
 * escalates to a different strategy, and the third asks for a person.
 *
 * Without the escalation this was a loop that could only repeat itself. A
 * generated shot that comes back malformed from one provider usually comes
 * back malformed from that provider again; asking twice is how an attempt
 * budget gets spent proving the same thing.
 */

/** A repair aimed at one shot. */
export type SceneRepair = {
  sceneId: string;
  action: RepairAction;
  reason: string;
  /** The finding that asked for it, so the outcome can be attributed. */
  issueId: string;
  check: QaCheck;
  /** True when this is a different strategy because the last one did not work. */
  escalated: boolean;
};

/**
 * A repair aimed at the whole film.
 *
 * Captions, the mix and the tail are not properties of a scene, so a plan that
 * could only name scenes had no way to express them — which is why the timing
 * checks had nowhere to send their findings until now.
 */
export type FilmRepair = {
  action: RepairAction;
  reason: string;
  issueId: string;
  check: QaCheck;
  escalated: boolean;
};

export type RepairPlan = {
  scenes: SceneRepair[];
  film: FilmRepair[];
  /** Repairs that need a person. */
  manual: QaIssue[];
  /** Where this leaves the deliverable. */
  state: ReleaseState;
  /** True when the film can ship as it is. */
  shippable: boolean;
  /** True when nothing can be repaired automatically and it is still broken. */
  deadEnd: boolean;
};

/** Repairs that act on the finished film rather than on a shot. */
const FILM_LEVEL: ReadonlySet<RepairAction> = new Set<RepairAction>([
  'retime_captions',
  'reposition_captions',
  'realign_audio',
  'refade_audio',
  'remix_audio',
  'replan_opening',
]);

/**
 * What to try when the same repair has already failed.
 *
 * A generated shot gets a different provider, then a different archetype —
 * which is to say: stop asking the same model for the same thing, then stop
 * asking for that thing at all. Everything else escalates straight to a
 * person, because the deterministic repairs either work or the finding was
 * about something else.
 */
const ESCALATION: Partial<Record<RepairAction, RepairAction>> = {
  regenerate_shot: 'alternate_provider',
  alternate_provider: 'alternate_archetype',
  alternate_archetype: 'manual_review',
  recapture_product: 'alternate_archetype',
  swap_asset: 'alternate_provider',
};

export function planRepairs(params: {
  report: QaReport;
  attempt: number;
  maxAttempts?: number;
  /** Everything already tried on this render, so a failure escalates. */
  history?: readonly RepairRecord[];
  /** An animatic is the customer's draft, not a deliverable. */
  deliverable?: boolean;
}): RepairPlan {
  const maxAttempts = params.maxAttempts ?? 2;
  const history = params.history ?? [];
  const { repairable } = qaVerdict(params.report.issues);

  const manual = params.report.issues.filter(
    (issue) =>
      SEVERITY_ORDER[issue.severity] >= SEVERITY_ORDER.soft_fail && !repairableAutomatically(issue),
  );

  const decision = releaseDecision({
    issues: params.report.issues,
    attempt: params.attempt,
    maxAttempts,
    ...(params.deliverable === undefined ? {} : { deliverable: params.deliverable }),
  });

  /*
   * A soft fail is repaired before delivery, and never holds the film hostage.
   *
   * The gate and the loop answer different questions, and conflating them was
   * the bug this shape exists to avoid: `releaseDecision` says whether the
   * film may ship, which a soft fail does not prevent — but it must still be
   * repaired first if a repair exists and there is an attempt left to spend.
   * Short-circuiting on "ready" meant every soft fail shipped unrepaired.
   *
   * A draft is the exception and not repaired at all: an animatic is the
   * customer looking at their own cut while they are still changing it, and
   * spending a provider call polishing something they are about to rewrite is
   * money burned on both sides.
   */
  const canStillTry =
    params.deliverable !== false && repairable.length > 0 && params.attempt < maxAttempts;

  if (!canStillTry) {
    if (decision.state === 'ready') {
      return { scenes: [], film: [], manual, state: 'ready', shippable: true, deadEnd: false };
    }
    return {
      scenes: [],
      film: [],
      manual: [...manual, ...repairable],
      state: 'needs_attention',
      shippable: false,
      deadEnd: true,
    };
  }

  /*
   * One repair per scene, most severe wins.
   *
   * Two instructions for the same shot — "recrop" and "regenerate" — would
   * fight each other, and the result would depend on which finding happened to
   * come back first.
   */
  const byScene = new Map<string, SceneRepair & { severity: number }>();
  const film: FilmRepair[] = [];
  const seenFilmActions = new Set<RepairAction>();

  for (const issue of repairable) {
    const action = escalate(issue, history);
    if (action === 'manual_review') {
      manual.push(issue);
      continue;
    }
    const escalated = action !== issue.repair;

    if (FILM_LEVEL.has(action)) {
      // One of each: retiming the captions twice in one pass is the same as
      // retiming them once, and the second one would undo the first.
      if (seenFilmActions.has(action)) continue;
      seenFilmActions.add(action);
      film.push({ action, reason: issue.message, issueId: issue.id, check: issue.check, escalated });
      continue;
    }

    if (!issue.sceneId) continue;
    const severity = SEVERITY_ORDER[issue.severity];
    const existing = byScene.get(issue.sceneId);
    if (!existing || severity > existing.severity) {
      byScene.set(issue.sceneId, {
        sceneId: issue.sceneId,
        action,
        reason: issue.message,
        issueId: issue.id,
        check: issue.check,
        escalated,
        severity,
      });
    }
  }

  const scenes = [...byScene.values()].map(({ severity: _severity, ...repair }) => repair);
  const nothingToDo = scenes.length === 0 && film.length === 0;

  return {
    scenes,
    film,
    manual,
    state: nothingToDo ? 'needs_attention' : 'repairing',
    shippable: false,
    deadEnd: nothingToDo,
  };
}

/**
 * The repair to actually attempt, given what has already been tried.
 *
 * Keyed by the check and the shot rather than by the finding, because a
 * regenerated shot produces a new finding id for the same defect and would
 * otherwise look like a first attempt forever.
 */
function escalate(issue: QaIssue, history: readonly RepairRecord[]): RepairAction {
  const wanted = issue.repair;
  if (!wanted) return 'manual_review';

  const failures = history.filter(
    (record) =>
      record.check === issue.check &&
      record.sceneId === issue.sceneId &&
      (record.outcome === 'unchanged' || record.outcome === 'failed' || record.outcome === 'worse'),
  );
  if (failures.length === 0) return wanted;

  // Walk the ladder once per failure, and stop at the top.
  let action = wanted;
  for (let step = 0; step < failures.length; step += 1) {
    const next = ESCALATION[action];
    if (!next) return 'manual_review';
    action = next;
  }
  return action;
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
  context: { issues?: readonly QaIssue[] } = {},
): { storyboard: Storyboard; needsProvider: { sceneId: string; action: RepairAction }[] } {
  const actions = new Map(plan.scenes.map((entry) => [entry.sceneId, entry]));
  const needsProvider: { sceneId: string; action: RepairAction }[] = [];
  const issues = context.issues ?? [];

  const scenes = storyboard.scenes
    .map((scene): Scene | null => {
      const repair = actions.get(scene.id);
      if (!repair) return scene;

      switch (repair.action) {
        case 'reduce_duration':
          // Grow the scene rather than cut the copy: the words were approved.
          return { ...scene, duration: round3(scene.duration * 1.3), status: 'draft' };

        case 'retime_scene': {
          /*
           * Give the shot the time its line actually needs.
           *
           * The finding carries where the speech ended, so the new duration is
           * measured rather than guessed — a proportional stretch would either
           * miss by a hair or overshoot into the next beat.
           */
          const overrun = overrunFor(issues, scene.id);
          if (overrun === null) return { ...scene, duration: round3(scene.duration * 1.15), status: 'draft' };
          return { ...scene, duration: round3(scene.duration + overrun + 0.15), status: 'draft' };
        }

        case 'trim_hold': {
          /*
           * A shot that stopped moving is shortened to the part that moved.
           *
           * Never below the minimum a shot needs to register: a held frame is
           * a defect, and a shot flashing past is a worse one.
           */
          const held = heldSecondsFor(issues, scene.id);
          if (held === null) return scene;
          const trimmed = Math.max(MIN_SHOT_AFTER_TRIM, round3(scene.duration - held * 0.6));
          return trimmed < scene.duration ? { ...scene, duration: trimmed, status: 'draft' } : scene;
        }

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

        case 'alternate_archetype':
          /*
           * Stop asking for this shot at all.
           *
           * The last escalation before a person: the same brief has now failed
           * twice, so the scene keeps its place and its words and gives up the
           * thing that could not be made.
           */
          needsProvider.push({ sceneId: scene.id, action: repair.action });
          return { ...scene, assetRefs: [], status: 'draft', notes: `${scene.notes} [archetype changed]`.trim() };

        case 'regenerate_shot':
        case 'alternate_provider':
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

/** Opens a record for an attempted repair. The outcome is written after. */
export function beginRepair(params: {
  issueId: string;
  check: QaCheck;
  sceneId: string | null;
  action: RepairAction;
  attempt: number;
}): RepairRecord {
  return {
    id: newId('evt'),
    issueId: params.issueId,
    check: params.check,
    sceneId: params.sceneId,
    action: params.action,
    attempt: params.attempt,
    outcome: 'unchanged',
    costUsd: 0,
    latencyMs: 0,
    note: '',
  };
}

/**
 * What a repair achieved, decided by whether its finding came back.
 *
 * Matched on the check and the shot rather than the finding id, because a
 * re-render produces new ids for the same defect — the first version of this
 * compared ids and therefore reported every repair as a success.
 */
export function settleRepairs(params: {
  attempted: readonly RepairRecord[];
  before: readonly QaIssue[];
  after: readonly QaIssue[];
  costUsd: number;
  latencyMs: number;
}): RepairRecord[] {
  const key = (issue: { check: QaCheck; sceneId: string | null }) => `${issue.check}:${issue.sceneId ?? 'film'}`;
  const stillThere = new Set(params.after.map(key));
  const wasThere = new Set(params.before.map(key));
  const share = params.attempted.length > 0 ? 1 / params.attempted.length : 0;

  // Anything that was not there before and is there now was introduced by this
  // pass, which is worth knowing: a repair that fixes one thing and breaks
  // another is not a success.
  const introduced = params.after.filter((issue) => !wasThere.has(key(issue)));

  return params.attempted.map((record) => {
    const gone = !stillThere.has(key(record));
    const brokeSomething = introduced.length > 0;
    return {
      ...record,
      outcome: gone ? (brokeSomething ? 'worse' : 'fixed') : 'unchanged',
      costUsd: round3(params.costUsd * share),
      latencyMs: Math.round(params.latencyMs * share),
      note: gone
        ? brokeSomething
          ? `Repaired, but the pass introduced ${introduced.length} new finding(s).`
          : ''
        : 'The finding came back.',
    };
  });
}

/** A shot below this reads as a flash rather than a shot. */
const MIN_SHOT_AFTER_TRIM = 0.8;

function overrunFor(issues: readonly QaIssue[], sceneId: string): number | null {
  const drift = issues.find(
    (issue) => issue.sceneId === sceneId && issue.check === 'narration_shot_drift',
  );
  if (!drift || drift.timecodeStart === null || drift.timecodeEnd === null) return null;
  return Math.max(0, drift.timecodeEnd - drift.timecodeStart);
}

function heldSecondsFor(issues: readonly QaIssue[], sceneId: string): number | null {
  const held = issues.find((issue) => issue.sceneId === sceneId && issue.check === 'still_frame_hold');
  if (!held || held.timecodeStart === null || held.timecodeEnd === null) return null;
  return Math.max(0, held.timecodeEnd - held.timecodeStart);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
