import {
  HELD_FRAME_CEILING,
  movesThroughout,
  REPAIR_LEVEL,
  SEVERITY_ORDER,
  newId,
  qaVerdict,
  readingSecondsFor,
  releaseDecision,
  repairableAutomatically,
  sceneShowsSomething,
  type FilmCut,
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
  /*
   * A hold that will not trim is not a timing problem.
   *
   * The trim has a floor — the time the shot's own copy takes to read — and
   * when the floor is the whole shot there is nothing to cut. Asking again is
   * asking the same question; the next question is whether the beat has
   * enough to say for the room it was given, and that is a creative one.
   */
  trim_hold: 'replan_scene',
  retime_scene: 'replan_scene',
  replan_scene: 'manual_review',
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
   * One repair per scene: the most severe finding, and at equal severity the
   * cheapest rung that addresses it.
   *
   * Two instructions for the same shot — "recrop" and "regenerate" — would
   * fight each other, and the result would depend on which finding happened to
   * come back first. Ordering by the ladder as well as by severity means a
   * shot that could be recropped is never regenerated from a provider just
   * because that finding was collected first.
   */
  const byScene = new Map<string, SceneRepair & { severity: number }>();
  const film: FilmRepair[] = [];
  const seenFilmActions = new Set<RepairAction>();

  for (const issue of repairable) {
    const action = escalate(issue, history);
    /*
     * The escalated action decides, not the finding's original one.
     *
     * A hold whose trim was rolled back escalates to `replan_scene`, which is
     * a question for a person however automatic the finding looked when it
     * was collected. Asking `repairableAutomatically` of the action rather
     * than naming `manual_review` here means a new escalation target is
     * routed correctly the day it is added, rather than being planned as a
     * scene repair nothing knows how to carry out.
     */
    if (!repairableAutomatically({ repair: action })) {
      manual.push({ ...issue, repair: action });
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

    /*
     * A shot repair with no shot to aim at.
     *
     * `brand_consistency` is about the film rather than a scene, and its
     * repair is `regenerate_shot` — so it named an action the planner could
     * not place and was dropped on the floor: never repaired, never escalated,
     * and absent from the reason the film was held. A finding that cannot be
     * acted on automatically is a finding for a person, which is the one thing
     * it must never silently stop being.
     */
    if (!issue.sceneId) {
      manual.push(issue);
      continue;
    }
    const severity = SEVERITY_ORDER[issue.severity];
    const existing = byScene.get(issue.sceneId);
    const wins =
      !existing ||
      severity > existing.severity ||
      (severity === existing.severity && REPAIR_LEVEL[action] < REPAIR_LEVEL[existing.action]);
    if (wins) {
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
      /*
       * A rollback is a failure, and the most informative kind.
       *
       * `rejected` means the repair did what it was asked and the film came
       * back worse by a measure the repair could not see. Trying it again
       * produces the same rejection and spends another render proving it.
       */
      (record.outcome === 'unchanged' ||
        record.outcome === 'failed' ||
        record.outcome === 'worse' ||
        record.outcome === 'rejected'),
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
  context: {
    issues?: readonly QaIssue[];
    cut?: FilmCut;
    /**
     * The runtime to hand back.
     *
     * Without it a trim is a deletion: the seconds a dead hold gives back
     * leave the film, and a ten-second cut comes back at five with every
     * local defect resolved. With it, the time is put back into the shots
     * that can carry it, and what cannot be placed is reported rather than
     * quietly dropped.
     */
    preserveSeconds?: number | null;
  } = {},
): ApplyResult {
  const actions = new Map(plan.scenes.map((entry) => [entry.sceneId, entry]));
  const needsProvider: { sceneId: string; action: RepairAction }[] = [];
  const issues = context.issues ?? [];
  const cut = context.cut ?? 'feature';

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
           * A shot that stopped moving is shortened to the part that moved,
           * plus the beat it is allowed to hold afterwards.
           *
           * Measured from where the freeze began rather than scaled off the
           * duration, for the same reason `retime_scene` reads the overrun:
           * a proportional trim leaves a proportion of the hold behind, so
           * the next pass finds the same defect a little smaller and the
           * attempt budget goes on converging instead of on fixing.
           *
           * Floored twice, and the second floor is the one that matters. A
           * shot below `MIN_SHOT_AFTER_TRIM` reads as a flash rather than a
           * shot — but a shot carrying copy has a harder floor than that: the
           * time it takes to read the words on it. Trimming past that trades a
           * soft fail for a hard one, which is what the first version of this
           * did on a typographic film — it cut a held caption to 0.8s and the
           * next pass came back with `text_overflow`, a worse defect than the
           * hold it had just removed.
           *
           * When the floor is already the whole shot there is nothing to trim,
           * and leaving the scene alone is the honest answer: the repair
           * settles as `unchanged`, escalates, and asks for a person rather
           * than shaving frames off a shot that cannot spare them.
           */
          const freeze = heldFindingFor(issues, scene.id);
          if (!freeze || freeze.timecodeStart === null) return scene;
          const reading = readingSecondsFor(scene.onScreenText.join(' '));
          const ceiling = Math.max(HELD_FRAME_CEILING[cut === 'short' ? 'short' : 'feature'], reading);
          const floor = Math.max(MIN_SHOT_AFTER_TRIM, reading);
          const moving = Math.max(0, freeze.timecodeStart - scene.startTime);
          const trimmed = Math.max(floor, round3(moving + ceiling - HOLD_TRIM_MARGIN));
          return trimmed < scene.duration ? { ...scene, duration: round3(trimmed), status: 'draft' } : scene;
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

  /*
   * Put back what the trims took out.
   *
   * Only into shots that keep moving for their whole length: giving seconds
   * to a static shot manufactures the exact defect the trim just removed, so
   * a film made entirely of held typography has nowhere to put them. That is
   * not a failure of the arithmetic — it is the plan telling us it has less
   * content than the slot it was written for, which is a creative question
   * and is reported as one.
   */
  const trimmed = round3(scenes.reduce((total, scene) => total + scene.duration, 0));
  const target = context.preserveSeconds ?? null;
  const recovered = target === null ? 0 : round3(Math.max(0, target - trimmed));
  const { scenes: balanced, placed } = recovered > 0 ? redistribute(scenes, recovered) : { scenes, placed: 0 };

  let cursor = 0;
  const resequenced = balanced.map((scene, index) => {
    const next = { ...scene, index, startTime: round3(cursor) };
    cursor += scene.duration;
    return next;
  });

  return {
    storyboard: { ...storyboard, scenes: resequenced, updatedAt: new Date().toISOString() },
    needsProvider,
    recoveredSeconds: recovered,
    placedSeconds: placed,
    /** Shots with time to give back and nowhere to put it: a plan short of content. */
    starvedSceneIds: recovered - placed > 0.05 ? starved(scenes, issues) : [],
  };
}

export type ApplyResult = {
  storyboard: Storyboard;
  needsProvider: { sceneId: string; action: RepairAction }[];
  /** Seconds the trims took out of the film. */
  recoveredSeconds: number;
  /** How many of them found a shot that could carry them. */
  placedSeconds: number;
  /** The shots whose slot the plan cannot fill. Escalated, not trimmed further. */
  starvedSceneIds: string[];
};

/**
 * How much more time a shot can take without becoming a held frame.
 *
 * A shot that moves for its whole length — real footage, or a camera that is
 * travelling — can hold a viewer longer. A static composition cannot: the
 * still-frame check would find it, correctly, and the loop would trim it
 * again. So a static shot absorbs nothing, however tempting its slot looks.
 *
 * Capped at half its own length, because a two-second cutaway stretched to
 * seven is not the same shot any more, and nobody approved that one.
 */
const MAX_SHOT_GROWTH = 0.5;

function absorbableSeconds(scene: Scene): number {
  if (!movesThroughout(scene)) return 0;
  return round3(scene.duration * MAX_SHOT_GROWTH);
}

/** Gives recovered seconds to the shots that can carry them, largest capacity first. */
function redistribute(scenes: readonly Scene[], seconds: number): { scenes: Scene[]; placed: number } {
  const capacity = scenes.map(absorbableSeconds);
  const total = round3(capacity.reduce((sum, value) => sum + value, 0));
  if (total <= 0) return { scenes: [...scenes], placed: 0 };

  const placing = Math.min(seconds, total);
  const next = scenes.map((scene, index) => {
    const share = capacity[index] ?? 0;
    if (share <= 0) return scene;
    const extra = round3((share / total) * placing);
    return extra > 0 ? { ...scene, duration: round3(scene.duration + extra), status: 'draft' as const } : scene;
  });
  const placed = round3(
    next.reduce((sum, scene) => sum + scene.duration, 0) - scenes.reduce((sum, scene) => sum + scene.duration, 0),
  );
  return { scenes: next, placed };
}

/**
 * The shots that gave time back and left it homeless.
 *
 * Named so the escalation can say which beat is short of content rather than
 * reporting that the film came out the wrong length, which tells nobody what
 * to change.
 */
function starved(scenes: readonly Scene[], issues: readonly QaIssue[]): string[] {
  const held = new Set(
    issues.filter((issue) => issue.check === 'still_frame_hold' && issue.sceneId).map((issue) => issue.sceneId!),
  );
  return scenes.filter((scene) => held.has(scene.id)).map((scene) => scene.id);
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
    level: REPAIR_LEVEL[params.action],
    providerCostUsd: 0,
    computeMs: 0,
    estimatedComputeCostUsd: 0,
    wallClockMs: 0,
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
  /** What providers were paid for this pass. Zero for a deterministic edit. */
  providerCostUsd: number;
  /** Machine time the pass consumed, which is never zero. */
  computeMs: number;
  estimatedComputeCostUsd: number;
  /** What the customer waited, wall clock. */
  wallClockMs: number;
  /** Rejected by the score: the candidate was rolled back, so nothing was achieved. */
  rejected?: boolean;
}): RepairRecord[] {
  const key = (issue: { check: QaCheck; sceneId: string | null }) => `${issue.check}:${issue.sceneId ?? 'film'}`;
  const stillThere = new Set(params.after.map(key));
  const wasThere = new Set(params.before.map(key));
  const share = params.attempted.length > 0 ? 1 / params.attempted.length : 0;

  // Anything that was not there before and is there now was introduced by this
  // pass, which is worth knowing: a repair that fixes one thing and breaks
  // another is not a success.
  const introduced = params.after.filter((issue) => !wasThere.has(key(issue)));

  /*
   * The costs are shares of the pass, not per-repair measurements.
   *
   * Several deterministic repairs go into one candidate and one render, so
   * there is one bill and one wait to attribute. Reporting the pass's whole
   * wall clock against each record would say a two-repair pass took twice as
   * long as it did, which is how "one render" came to read as "two renders".
   */
  return params.attempted.map((record) => {
    const gone = !stillThere.has(key(record));
    const brokeSomething = introduced.length > 0;
    const outcome: RepairRecord['outcome'] = params.rejected
      ? 'rejected'
      : gone
        ? brokeSomething
          ? 'worse'
          : 'fixed'
        : 'unchanged';
    return {
      ...record,
      outcome,
      providerCostUsd: round3(params.providerCostUsd * share),
      computeMs: Math.round(params.computeMs * share),
      estimatedComputeCostUsd: round4(params.estimatedComputeCostUsd * share),
      wallClockMs: Math.round(params.wallClockMs * share),
      note: params.rejected
        ? 'Rolled back: the repaired cut broke a constraint the film has to keep.'
        : gone
          ? brokeSomething
            ? `Repaired, but the pass introduced ${introduced.length} new finding(s).`
            : ''
          : 'The finding came back.',
    };
  });
}

/** A shot below this reads as a flash rather than a shot. */
const MIN_SHOT_AFTER_TRIM = 0.8;

/**
 * How far inside the ceiling a trimmed hold is aimed.
 *
 * Three frames at thirty, two at twenty-four. A repair that lands the shot
 * exactly on the limit has not decided anything: the renderer quantises a
 * duration to whole frames and the detector measures in frames, so either can
 * give the hold a frame back and the recheck finds the same defect by a
 * hair — a second pass spent on rounding, out of a budget of two.
 */
const HOLD_TRIM_MARGIN = 0.1;

function overrunFor(issues: readonly QaIssue[], sceneId: string): number | null {
  const drift = issues.find(
    (issue) => issue.sceneId === sceneId && issue.check === 'narration_shot_drift',
  );
  if (!drift || drift.timecodeStart === null || drift.timecodeEnd === null) return null;
  return Math.max(0, drift.timecodeEnd - drift.timecodeStart);
}

function heldFindingFor(issues: readonly QaIssue[], sceneId: string): QaIssue | null {
  return issues.find((issue) => issue.sceneId === sceneId && issue.check === 'still_frame_hold') ?? null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Compute costs are fractions of a cent, so three places would round them to nothing. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
