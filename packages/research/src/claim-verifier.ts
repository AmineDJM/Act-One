import type { Claim, Evidence } from '@act-one/core';

/**
 * Grounds claims against captured evidence.
 *
 * The first version of this simply trusted the model's self-reported citations
 * and dropped anything uncited. Against a real site that deleted the entire
 * brief: the model wrote accurate, well-sourced claims and then cited
 * inconsistently, so a correct brief scored zero. Trusting self-reporting and
 * trusting the model are the same thing wearing a different hat.
 *
 * So we verify instead. A claim survives if we can find it in the corpus:
 *
 *   - cited     — the model named evidence ids and they check out.
 *   - grounded  — we located supporting evidence ourselves by content.
 *   - unsupported — nothing in the corpus backs it. Dropped.
 *   - fabricated_number — it states a figure that appears nowhere. Always
 *     dropped, and reported, because an invented metric is the one failure
 *     that can genuinely damage a customer.
 */
export type ClaimStatus = 'cited' | 'grounded' | 'unsupported' | 'fabricated_number';

export type VerifiedClaim = {
  claim: Claim;
  status: ClaimStatus;
  /** 0..1 — how much of the claim we could locate in the evidence. */
  support: number;
};

export type VerifyOptions = {
  /** Fraction of a claim's content words that must appear in one excerpt. */
  minOverlap?: number;
  /** Keep claims we could not ground. Off by default. */
  keepUnsupported?: boolean;
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'our', 'their', 'are',
  'was', 'were', 'have', 'has', 'had', 'can', 'will', 'would', 'into', 'onto', 'over', 'than',
  'then', 'them', 'they', 'its', "it's", 'all', 'any', 'but', 'not', 'out', 'who', 'what',
  'when', 'where', 'which', 'while', 'more', 'most', 'less', 'each', 'every', 'some', 'such',
  'only', 'also', 'just', 'like', 'make', 'makes', 'made', 'get', 'gets', 'one', 'two', 'use',
  'used', 'using', 'without', 'between', 'across', 'about', 'because', 'been', 'being', 'how',
]);

export function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s%$.-]/g, ' ')
      .split(/\s+/)
      .map((word) => word.replace(/^[.-]+|[.-]+$/g, ''))
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}

/**
 * Figures a claim asserts. Deliberately broad — percentages, money, multipliers,
 * counts and durations are all things we must never invent.
 */
export function extractFigures(text: string): string[] {
  const figures = new Set<string>();
  const patterns = [
    /\d+(?:\.\d+)?\s?%/g,
    /[$€£]\s?\d[\d,]*(?:\.\d+)?\s?[kmb]?/gi,
    /\b\d+(?:\.\d+)?\s?x\b/gi,
    /\b\d[\d,]{2,}\b/g,
    /\b\d+(?:\.\d+)?\s?(?:hours?|minutes?|seconds?|days?|weeks?|months?|years?)\b/gi,
    /\b\d+(?:\.\d+)?\s?(?:million|billion|thousand)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      figures.add(normalizeFigure(match[0]));
    }
  }
  return [...figures];
}

function normalizeFigure(figure: string): string {
  return figure.toLowerCase().replace(/[\s,]/g, '');
}

export function verifyClaim(
  claim: Claim,
  evidence: Evidence[],
  options: VerifyOptions = {},
): VerifiedClaim {
  const minOverlap = options.minOverlap ?? 0.5;
  const byId = new Map(evidence.map((e) => [e.id, e]));

  // A figure that appears nowhere in anything we read is disqualifying, no
  // matter how well the surrounding sentence is supported.
  const figures = extractFigures(claim.text);
  if (figures.length > 0) {
    const corpus = normalizeFigure(evidence.map((e) => e.excerpt).join(' '));
    const missing = figures.filter((figure) => !corpus.includes(figure));
    if (missing.length > 0) {
      return { claim: { ...claim, evidenceIds: [] }, status: 'fabricated_number', support: 0 };
    }
  }

  const declared = claim.evidenceIds.filter((id) => byId.has(id));
  if (declared.length > 0) {
    const best = Math.max(
      ...declared.map((id) => overlapRatio(claim.text, byId.get(id)!.excerpt)),
    );
    // Accept a citation the model made, but only if the cited excerpt is
    // actually about the claim. Citing a random id is not a citation.
    if (best >= minOverlap * 0.6) {
      return { claim: { ...claim, evidenceIds: declared }, status: 'cited', support: best };
    }
  }

  let best: { id: string; ratio: number } | null = null;
  for (const item of evidence) {
    const ratio = overlapRatio(claim.text, item.excerpt);
    if (!best || ratio > best.ratio) best = { id: item.id, ratio };
  }

  if (best && best.ratio >= minOverlap) {
    return {
      claim: { ...claim, evidenceIds: [best.id, ...declared.filter((id) => id !== best!.id)] },
      status: 'grounded',
      support: best.ratio,
    };
  }

  return {
    claim: { ...claim, evidenceIds: declared },
    status: 'unsupported',
    support: best?.ratio ?? 0,
  };
}

/** Fraction of the claim's content words present in the excerpt. */
export function overlapRatio(claimText: string, excerpt: string): number {
  const claimWords = contentTokens(claimText);
  if (claimWords.size === 0) return 0;
  const excerptWords = contentTokens(excerpt);
  let shared = 0;
  for (const word of claimWords) {
    if (excerptWords.has(word)) shared += 1;
  }
  return shared / claimWords.size;
}

export type VerificationReport = {
  kept: Claim[];
  rejected: { text: string; status: ClaimStatus }[];
  /** Fabricated figures are reported separately: they are a quality incident. */
  fabricatedFigures: string[];
};

export function verifyClaims(
  claims: Claim[],
  evidence: Evidence[],
  options: VerifyOptions = {},
): VerificationReport {
  const kept: Claim[] = [];
  const rejected: { text: string; status: ClaimStatus }[] = [];
  const fabricatedFigures: string[] = [];

  for (const claim of claims) {
    const verified = verifyClaim(claim, evidence, options);
    if (verified.status === 'cited' || verified.status === 'grounded') {
      kept.push(verified.claim);
      continue;
    }
    if (verified.status === 'fabricated_number') {
      fabricatedFigures.push(...extractFigures(claim.text));
    }
    if (verified.status === 'unsupported' && options.keepUnsupported) {
      kept.push(verified.claim);
      continue;
    }
    rejected.push({ text: claim.text, status: verified.status });
  }

  return { kept, rejected, fabricatedFigures: [...new Set(fabricatedFigures)] };
}
