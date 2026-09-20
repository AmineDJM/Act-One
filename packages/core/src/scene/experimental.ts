import { z } from 'zod';
import { SceneGraph } from './language.ts';
import { CapabilityRegistry, routeScene, type Capability } from './capabilities.ts';

/**
 * What happens when the Director imagines something the studio cannot make.
 *
 * "Make eighty interface cards behave like a magnetic field and collapse into
 * the logo." There is no macro for that and there should not be one. The wrong
 * answers are to refuse, to silently render the nearest template, or to let a
 * model write rendering code and run it.
 *
 * THE DISTINCTION THIS FILE IS BUILT ON. There are two very different things
 * called "a new capability", and conflating them is how a studio acquires a
 * remote-code-execution hole.
 *
 *   A NEW COMPOSITION is a new arrangement of primitives that already exist.
 *   Eighty cards on curves that converge, a mask on the logo, a bass hit on
 *   the collapse — every one of those is an object the renderer already
 *   draws. It is DATA: a scene graph, validated by a schema, executed by
 *   trusted code. There is nothing to sandbox, because nothing new runs.
 *
 *   A NEW EXECUTOR is new code — a shader, a Blender script, a filter. That
 *   is a different proposition entirely, and this package does not do it.
 *
 * The existing security posture for geometry states the principle: a model
 * never writes Blender Python; it chooses a rig by name and fills in validated
 * numbers, because "let the model write a short script and run it" is remote
 * code execution with extra steps and no amount of prompt instruction closes
 * that. The same holds here.
 *
 * So: compositions are proposed, test-rendered, reviewed and promoted. Code is
 * REFUSED, with a written account of what a real sandbox would have to provide
 * before that changes. The gate below is deliberately the part that is built,
 * because a promotion path that cannot say no is not a gate.
 */

export const ExperimentKind = z.enum([
  /** A new arrangement of existing primitives. Data; executable today. */
  'composition',
  /** New executable code. Not executed by this package. */
  'executor',
]);
export type ExperimentKind = z.infer<typeof ExperimentKind>;

export const ExperimentRequest = z.object({
  id: z.string().min(1).max(64),
  kind: ExperimentKind,
  /** What the Director was trying to make, in their words. */
  intent: z.string().max(600),
  /** For a composition: the graph itself. Absent for an executor request. */
  proposal: SceneGraph.nullable().default(null),
  /** For an executor: what it would need to do. Never code. */
  executorBrief: z.string().max(1000).default(''),
  requestedAt: z.string(),
});
export type ExperimentRequest = z.infer<typeof ExperimentRequest>;

export type ExperimentVerdict =
  | { status: 'executable'; capability: Capability; notes: string[] }
  | { status: 'rejected'; reason: string; notes: string[] }
  | { status: 'needs_sandbox'; reason: string; requirements: string[] };

/**
 * What a sandbox would have to guarantee before generated code could run.
 *
 * Written down rather than implemented, and written down precisely so that
 * nobody can mistake the absence for an oversight. Each line is a property the
 * current worker does not have; implementing four of six would not make this
 * safe, which is why the answer today is no rather than nearly.
 */
export const SANDBOX_REQUIREMENTS: readonly string[] = [
  'A process boundary the render worker does not share: separate user, separate namespace, no ambient credentials.',
  'No network egress at all, enforced outside the process rather than by the code inside it.',
  'A read-only filesystem apart from one declared output path, with the inputs mounted explicitly.',
  'Hard CPU, memory and wall-clock limits enforced by the kernel, not by a timer in the parent.',
  'No access to the provider registry, the vault, the database, or the object store.',
  'A test render whose output is compared against a declared expectation before any customer film can reach the code.',
];

/**
 * Decides what to do with something the studio does not yet know how to make.
 *
 * A composition is checked against the capability registry — if every object in
 * it can be drawn by a production-ready capability, it is not experimental at
 * all, it is simply a shot nobody had composed before, and that is the whole
 * point of having a scene language. It comes back executable.
 *
 * A composition that needs something no capability provides is rejected with
 * the specific object that cannot be drawn, which is a far more useful answer
 * than "unsupported".
 *
 * An executor request is never executed here.
 */
export function assessExperiment(
  request: ExperimentRequest,
  registry: CapabilityRegistry = new CapabilityRegistry(),
): ExperimentVerdict {
  if (request.kind === 'executor') {
    return {
      status: 'needs_sandbox',
      reason:
        'This asks for new executable code. Act One does not run model-written rendering code: the geometry ' +
        'executor has never done it, and the reason is that a script with filesystem, process and network ' +
        'reach is remote code execution however carefully it is prompted.',
      requirements: [...SANDBOX_REQUIREMENTS],
    };
  }

  const proposal = request.proposal;
  if (!proposal) {
    return {
      status: 'rejected',
      reason: 'A composition experiment carries a scene graph, and this one carries none.',
      notes: [],
    };
  }

  const routing = routeScene(proposal, registry);
  if (routing.problems.length > 0) {
    return {
      status: 'rejected',
      reason: routing.problems.map((problem) => problem.message).join(' '),
      notes: [
        'Every object in a composition has to be drawable by a capability that is already trusted.',
        'A composition is data; it cannot add a way of drawing, only new arrangements of existing ways.',
      ],
    };
  }

  /*
   * Executable, and therefore not really an experiment.
   *
   * This is the outcome the scene language exists to produce: a shot nobody
   * wrote a template for, made entirely of primitives that were already
   * trusted, needing no new code and no review. It is registered so the studio
   * can see which compositions are being invented and how often — a
   * composition reached for repeatedly is a macro waiting to be named.
   */
  const capability = registry.registerExperimental({
    id: `composition.${request.id}`,
    category: 'deterministic.motion',
    executor: 'experimental',
    accepts: [...new Set(proposal.objects.map((object) => object.kind))],
    animates: [],
    constraints: { aspects: [], cannot: [] },
    cost: {
      usdPerSecond: routing.estimatedCostUsd / Math.max(1, proposal.durationSeconds),
      renderSecondsPerSecond: 1.4,
    },
    productionReady: false,
    notes: `Composed for: ${request.intent.slice(0, 200)}`,
  } as Capability);

  return {
    status: 'executable',
    capability,
    notes: [
      'Every object routes to a production-ready capability, so this needs no new code.',
      'Registered unready: it still has to be test-rendered and looked at before a customer film uses it.',
      `Estimated ${routing.estimatedRenderSeconds}s to render, $${routing.estimatedCostUsd.toFixed(3)}.`,
    ],
  };
}

/**
 * Promotes a composition once somebody has watched the test render.
 *
 * Takes the path to the file that was watched and the name of whoever watched
 * it. Both are recorded on the capability. A promotion with no test render is
 * not a promotion, and the signature is what makes that inexpressible rather
 * than merely discouraged.
 */
export function promoteExperiment(
  registry: CapabilityRegistry,
  id: string,
  evidence: { testRenderPath: string; reviewedBy: string },
): Capability | null {
  if (!evidence.testRenderPath || !evidence.reviewedBy) return null;
  return registry.promote(id, evidence);
}
