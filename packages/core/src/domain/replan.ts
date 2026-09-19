import { z } from 'zod';

/**
 * The record of a beat being rewritten, kept forever.
 *
 * Every creative replan is a decision a machine made about a customer's film
 * on its own initiative, and the only way that is defensible is if it is
 * legible afterwards: which beat, why, what the director was offered, what was
 * taken, what it cost to think and what it cost to make.
 *
 * Operator-facing. A customer commissioned a film and does not need to watch
 * the production solve its own problems.
 */
export const CreativeReplan = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  renderId: z.string().nullable().default(null),
  fromStoryboardId: z.string().nullable().default(null),
  toStoryboardId: z.string().nullable().default(null),
  sceneIds: z.array(z.string()).default([]),
  check: z.string().max(80).default(''),
  diagnosis: z.string().max(600).default(''),
  strategy: z.string().max(80).default(''),
  reasoning: z.string().max(600).default(''),
  /** Every option offered, including the ones not taken. */
  options: z.array(z.record(z.string(), z.unknown())).default([]),
  /** Options refused, with the reason, so a director that keeps missing is visible. */
  rejected: z.array(z.object({ strategy: z.string(), reason: z.string() })).default([]),
  attempt: z.number().int().min(0).default(0),
  /** What the direction call cost. */
  directionCostUsd: z.number().min(0).default(0),
  /** What the shots it asked for are expected to cost to make. */
  estimatedCostUsd: z.number().min(0).default(0),
  model: z.string().max(120).default(''),
  /** Affected-scope accounting: what survived, what was recomposed, what was bought again. */
  scenesReused: z.number().int().min(0).default(0),
  scenesRecomposed: z.number().int().min(0).default(0),
  scenesRegenerated: z.number().int().min(0).default(0),
  createdAt: z.string(),
});
export type CreativeReplan = z.infer<typeof CreativeReplan>;
