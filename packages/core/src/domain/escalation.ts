import { z } from 'zod';
import { CreativeProblem } from './film-shape.ts';
import { QaCheck, RepairAction } from './qa.ts';

/**
 * What the production layer hands back when it cannot solve a problem itself.
 *
 * The render and repair layers are deterministic on purpose: they edit a
 * timeline, they do not author. When a defect turns out not to be a timeline
 * problem — a beat with a second of content in a six-second slot — there is
 * nothing for them to do that would not make the film worse, and the honest
 * move is to stop and say precisely what is wrong.
 *
 * This is that sentence, as a structure rather than as prose. The orchestrator
 * reads it, calls the Creative Director, and the Director gets a diagnosis
 * specific enough to act on: not "the film came out short" but "this beat has
 * 1.4s of information and 6.0s of room".
 */
export const CreativeEscalation = z.object({
  type: z.literal('creative_replan_required'),
  renderId: z.string(),
  storyboardId: z.string(),
  /** The beats that cannot fill their slot. Usually one. */
  sceneIds: z.array(z.string()).min(1),
  /** The finding that led here, so the Director knows what the viewer would see. */
  check: QaCheck,
  /** Plain words, aimed at somebody who can change what the beat says. */
  diagnosis: z.string().max(600),
  /**
   * What is wrong, named rather than described.
   *
   * The prose chooses the repair that runs; these choose the measurement that
   * decides whether the repair helped. Empty on escalations raised by the
   * deterministic layer, where the check itself already says.
   */
  problems: z.array(CreativeProblem).max(3).default([]),
  /** What the film is contracted to run for. */
  requiredSeconds: z.number().min(0),
  /** What the affected beats can currently justify. */
  usableSeconds: z.number().min(0),
  /** What must survive whatever the Director decides. */
  preservedConstraints: z.array(z.string()).default([]),
  /** Everything already tried, so the Director does not propose it again. */
  previousAttempts: z
    .array(
      z.object({
        action: RepairAction,
        outcome: z.string(),
        attempt: z.number().int().min(0),
      }),
    )
    .default([]),
});
export type CreativeEscalation = z.infer<typeof CreativeEscalation>;

/**
 * How much autonomy a production has, and how much is left.
 *
 * Carried on the job rather than read from configuration at each step, so a
 * loop cannot reset its own budget by enqueueing itself: whatever is left
 * travels with the work and only ever goes down.
 */
export const ProductionBudget = z.object({
  /** Timeline repairs inside one render. */
  deterministicPasses: z.number().int().min(0).max(5).default(2),
  /** Times the Creative Director may rewrite a beat. */
  creativeReplans: z.number().int().min(0).max(4).default(2),
  /** Times the Director may restructure the film rather than a beat. */
  structuralReplans: z.number().int().min(0).max(2).default(1),
  /** Provider spend the loop may add on top of the film itself, in dollars. */
  providerCostUsd: z.number().min(0).default(2),
});
export type ProductionBudget = z.infer<typeof ProductionBudget>;

export const DEFAULT_PRODUCTION_BUDGET: ProductionBudget = ProductionBudget.parse({});

/** Whether anything is left to try. */
export function budgetAllowsReplan(budget: ProductionBudget): boolean {
  return budget.creativeReplans > 0;
}

/** Spends one creative replan. Never goes below zero. */
export function spendReplan(budget: ProductionBudget, structural: boolean): ProductionBudget {
  return {
    ...budget,
    creativeReplans: Math.max(0, budget.creativeReplans - 1),
    structuralReplans: structural
      ? Math.max(0, budget.structuralReplans - 1)
      : budget.structuralReplans,
  };
}

/**
 * Where a production actually stands.
 *
 * Five facts rather than one flag, because they were conflated and the film
 * suffered for it: a render that succeeded, a repair transaction that was
 * rolled back, QA that passes on the cut that survived, an escalation nobody
 * has answered, and whether any of that adds up to something deliverable.
 *
 * A rollback to an earlier whole film with its defects still in it is a
 * successful transaction and an unresolved production. It used to report as a
 * pass, because the only question asked afterwards was whether the findings
 * contained a blocker.
 */
export const DeliveryFacts = z.object({
  renderSucceeded: z.boolean(),
  repairTransactionSucceeded: z.boolean(),
  globalQaPassed: z.boolean(),
  /** False while a `creative_replan_required` is outstanding. */
  creativeEscalationResolved: z.boolean(),
  /**
   * Every shot the plan built around a picture has one.
   *
   * Its own fact rather than something to infer from the findings, because it
   * is the one that was silently false: a film whose every capture was missing
   * rendered each of those shots as its line of copy on a black frame, and
   * there was nothing anywhere in this decision that knew the difference
   * between that and a film a director had written to be typographic.
   *
   * Defaulted true so a caller that predates the question is not accidentally
   * told its film is incomplete; the render stage always passes it.
   */
  materialComplete: z.boolean().default(true),
});
export type DeliveryFacts = z.infer<typeof DeliveryFacts>;

/**
 * The delivery decision, derived rather than set.
 *
 * READY means the film that is committed right now passed its final QA,
 * satisfies the contract, and has no escalation waiting on anybody. Everything
 * else that is not an outright failure is NEEDS_ATTENTION, which means Act One
 * has exhausted what it can do on its own or needs a decision only a person
 * can make.
 */
export function deliveryState(facts: DeliveryFacts): 'ready' | 'needs_attention' | 'failed' {
  if (!facts.renderSucceeded) return 'failed';
  // Before the quality of the film, the question of whether it is the film:
  // a master missing the pictures it was written around is not a near miss.
  if (!facts.materialComplete) return 'needs_attention';
  if (!facts.globalQaPassed) return 'needs_attention';
  if (!facts.repairTransactionSucceeded) return 'needs_attention';
  if (!facts.creativeEscalationResolved) return 'needs_attention';
  return 'ready';
}
