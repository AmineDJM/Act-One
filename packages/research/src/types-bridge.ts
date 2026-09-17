/**
 * Re-exports the domain surface this package uses.
 *
 * Keeping the import list in one place makes it obvious, in review, exactly
 * how much of the domain the research agent touches — and keeps that surface
 * from quietly growing.
 */
export {
  derivedId,
  newId,
  claimIsSupported,
  momentStrength,
  topMoments,
  findMoment,
} from '@act-one/core';

export type {
  Claim,
  Evidence,
  EvidenceKind,
  LaunchContext,
  ProductMaturity,
  ProductMoment,
  ProductUnderstanding,
  BrandSystem,
} from '@act-one/core';

export type CallContextLike = { organizationId: string; projectId?: string | null };
