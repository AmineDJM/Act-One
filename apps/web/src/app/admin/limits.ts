import type { PlanLimitGrants } from '@act-one/core';

/**
 * The limits an operator may lift by hand, for one workspace.
 *
 * In its own module rather than beside the action that reads it, because a
 * `'use server'` file may only export async functions: everything else in one
 * becomes `undefined` on the client, with no type error and no build failure —
 * the page simply throws when it renders. This list is read by both the action
 * and the form, so it lives where both can have it.
 *
 * Deliberately not every field of `PlanLimits`. `monthlyCredits` is granted
 * through the credit control, which has its own audit trail and its own
 * balance arithmetic; lifting it here would give a workspace credits that
 * nothing ever added.
 */
export const GRANTABLE_LIMITS = [
  { name: 'maxMasterDurationSeconds', label: 'Longest film (s)', ceiling: 1800 },
  { name: 'projectsPerMonth', label: 'Productions a month', ceiling: 1000 },
  { name: 'rendersPerProject', label: 'Masters per production', ceiling: 100 },
  { name: 'revisionsPerProject', label: 'Revisions per production', ceiling: 100 },
  { name: 'maxSeats', label: 'Seats', ceiling: 500 },
  { name: 'maxBrands', label: 'Identities', ceiling: 200 },
  { name: 'maxGenerativeSecondsPerFilm', label: 'Generated seconds a film', ceiling: 600 },
] as const satisfies readonly { name: keyof PlanLimitGrants; label: string; ceiling: number }[];
