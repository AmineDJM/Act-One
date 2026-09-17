import { derivedId, type Evidence, type EvidenceKind } from '@act-one/core';
import type { PageCapture } from '@act-one/providers';
import type { PageIntent } from './crawl-plan.ts';

/**
 * Turns a captured page into citable evidence.
 *
 * Evidence excerpts are verbatim, never paraphrased, because the fact checker
 * compares generated copy against them character by character. If we softened
 * excerpts here, the check downstream would be checking our own paraphrase
 * rather than what the customer actually published.
 */
export type ExtractOptions = {
  intent: PageIntent;
  maxSegments?: number;
};

export function extractEvidence(capture: PageCapture, options: ExtractOptions): Evidence[] {
  const evidence: Evidence[] = [];
  const capturedAt = capture.capturedAt;
  const push = (kind: EvidenceKind, excerpt: string, confidence = 1) => {
    const text = excerpt.trim().replace(/\s+/g, ' ');
    if (text.length < 12 || text.length > 1200) return;
    evidence.push({
      /*
       * Derived from what the evidence is, not from when we found it. The same
       * sentence on the same page is the same evidence next month, and a fresh
       * random id every crawl silently invalidates every citation pointing at
       * it — which turns "re-read my product" into "break my storyboard".
       */
      id: derivedId('evt', kind, capture.url, text),
      kind,
      sourceUrl: capture.url,
      excerpt: text,
      capturedAt,
      confidence,
    });
  };

  const meta = extractMeta(capture.html);
  if (meta.description) push('meta_tag', meta.description);
  if (meta.ogTitle && meta.ogTitle !== capture.title) push('meta_tag', meta.ogTitle);
  if (capture.title) push('meta_tag', capture.title, 0.9);

  const lines = capture.text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const maxSegments = options.maxSegments ?? 40;
  let pushed = 0;

  for (let i = 0; i < lines.length && pushed < maxSegments; i += 1) {
    const line = lines[i]!;

    if (options.intent === 'pricing' && looksLikePricing(line)) {
      // Pricing lines are the single most dangerous thing to get wrong in a
      // film, so they are captured with the line that follows for context.
      const next = lines[i + 1];
      push('pricing_row', next ? `${line} — ${next}` : line);
      pushed += 1;
      continue;
    }

    if (isHeadingLike(line)) {
      push('heading', line);
      pushed += 1;
      continue;
    }

    if (line.length >= 60 && line.length <= 600 && /[.!?]/.test(line)) {
      push('page_text', line, options.intent === 'blog' ? 0.7 : 0.9);
      pushed += 1;
    }
  }

  return evidence;
}

/** Headline-shaped: short, no terminal period, meaningful words. */
function isHeadingLike(line: string): boolean {
  if (line.length < 14 || line.length > 120) return false;
  if (/[.;:]$/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 14) return false;
  return /[A-Za-z]/.test(line);
}

function looksLikePricing(line: string): boolean {
  return /(\$|€|£)\s?\d|\bper (month|seat|user|year)\b|\/(mo|month|yr|year|seat)\b|\bfree\b|\bcustom\b/i.test(
    line,
  );
}

export function extractMeta(html: string): {
  description: string | null;
  ogTitle: string | null;
  ogImage: string | null;
  themeColor: string | null;
} {
  const attr = (pattern: RegExp): string | null => {
    const match = html.match(pattern);
    return match?.[1]?.trim() ?? null;
  };
  return {
    description:
      attr(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      attr(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    ogTitle: attr(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
    ogImage: attr(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
    themeColor: attr(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i),
  };
}

/**
 * Compacts evidence for a prompt while keeping ids intact.
 *
 * The model is shown ids and excerpts only, which is what forces every claim
 * it returns to name the evidence that supports it. It never sees raw HTML,
 * so it cannot quietly invent a fact from a script tag or a hidden element.
 */
export function evidenceForPrompt(evidence: Evidence[], maxChars = 28_000): string {
  const lines: string[] = [];
  let used = 0;
  // Highest-confidence first: when we run out of budget, the least reliable
  // material is what gets dropped.
  for (const item of [...evidence].sort((a, b) => b.confidence - a.confidence)) {
    const line = `[${item.id}] (${item.kind} @ ${item.sourceUrl}) ${item.excerpt}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

/** Drops near-duplicate excerpts, which marketing sites produce in volume. */
export function dedupeEvidence(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const kept: Evidence[] = [];
  for (const item of evidence) {
    const key = item.excerpt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}
