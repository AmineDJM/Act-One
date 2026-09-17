import { z } from 'zod';
import { urlString, score01 } from '../zod-helpers.ts';

/**
 * Every factual claim the system makes about a customer's product must be
 * traceable to something we actually observed. This is the anti-hallucination
 * backbone: the fact checker (see @act-one/qa) refuses to ship copy whose claims
 * cannot be resolved to an Evidence record.
 */
export const EvidenceKind = z.enum([
  'page_text',
  'meta_tag',
  'heading',
  'pricing_row',
  'screenshot',
  'dom_snapshot',
  'external_profile',
  'doc_page',
  'changelog',
  'user_supplied',
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const Evidence = z.object({
  id: z.string(),
  kind: EvidenceKind,
  sourceUrl: urlString,
  /** Verbatim excerpt. Never paraphrased — the fact checker compares against it. */
  excerpt: z.string().max(4000),
  selector: z.string().optional(),
  capturedAt: z.string(),
  confidence: score01.default(1),
});
export type Evidence = z.infer<typeof Evidence>;

/** A claim plus the evidence ids that support it. */
export const Claim = z.object({
  text: z.string().trim().min(1).max(600),
  evidenceIds: z.array(z.string()).default([]),
});
export type Claim = z.infer<typeof Claim>;

export function claimIsSupported(claim: Claim, evidence: Evidence[]): boolean {
  if (claim.evidenceIds.length === 0) return false;
  const ids = new Set(evidence.map((e) => e.id));
  return claim.evidenceIds.every((id) => ids.has(id));
}
