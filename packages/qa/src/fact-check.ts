import { newId, type Evidence, type ProductUnderstanding, type QaFinding, type Storyboard } from '@act-one/core';

/**
 * Fact check.
 *
 * The last gate before a film ships. It re-verifies every word that will appear
 * on screen or be spoken against the evidence we actually captured, rather than
 * trusting that the copy was written correctly several stages ago.
 *
 * Numbers get the harshest treatment because they are the only thing here that
 * can genuinely harm a customer: a film that overstates a benefit is a
 * marketing problem, and a film that invents "40% faster" is a legal one.
 */
export type FactCheckInput = {
  storyboard: Storyboard;
  understanding: ProductUnderstanding;
  /** Claims the customer has told us never to make. */
  excludedClaims?: string[];
};

export function factCheck(input: FactCheckInput): QaFinding[] {
  const issues: QaFinding[] = [];
  const corpus = buildCorpus(input.understanding.evidence);
  const excluded = (input.excludedClaims ?? []).map((claim) => claim.toLowerCase().trim()).filter(Boolean);

  for (const scene of input.storyboard.scenes) {
    const surfaces = [...scene.onScreenText, scene.narration].filter((text) => text.trim().length > 0);

    for (const surface of surfaces) {
      for (const figure of extractFigures(surface)) {
        if (!corpus.figures.has(figure)) {
          issues.push({
            id: newId('evt'),
            check: 'unsupported_claim',
            severity: 'hard_fail',
            sceneId: scene.id,
            timecodeStart: scene.startTime,
            message: `"${figure}" does not appear anywhere in the material we read. We do not put numbers on screen that the customer has not published.`,
            evidenceAssetId: null,
            confidence: 1,
            repair: 'rewrite_copy',
            detectedBy: 'fact_check',
          });
        }
      }

      for (const claim of excluded) {
        if (surface.toLowerCase().includes(claim)) {
          issues.push({
            id: newId('evt'),
            check: 'unsupported_claim',
            severity: 'hard_fail',
            sceneId: scene.id,
            timecodeStart: scene.startTime,
            message: `This scene makes a claim the customer excluded: "${claim}".`,
            evidenceAssetId: null,
            confidence: 1,
            repair: 'rewrite_copy',
            detectedBy: 'fact_check',
          });
        }
      }

      // Named entities that are neither the product nor anything we read are
      // almost always an invented customer logo or a competitor we should not
      // be naming.
      for (const name of extractProperNouns(surface)) {
        if (
          name.toLowerCase() === input.understanding.name.toLowerCase() ||
          corpus.text.includes(name.toLowerCase())
        ) {
          continue;
        }
        issues.push({
          id: newId('evt'),
          check: 'unsupported_claim',
          severity: 'soft_fail',
          sceneId: scene.id,
          timecodeStart: scene.startTime,
          message: `"${name}" is named on screen but appears nowhere in the customer's own material.`,
          evidenceAssetId: null,
          confidence: 0.7,
          repair: 'rewrite_copy',
          detectedBy: 'fact_check',
        });
      }
    }
  }

  return issues;
}

function buildCorpus(evidence: Evidence[]): { text: string; figures: Set<string> } {
  const text = evidence.map((item) => item.excerpt).join(' ').toLowerCase();
  const figures = new Set<string>();
  for (const figure of extractFigures(text)) figures.add(figure);
  return { text, figures };
}

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
      figures.add(match[0].toLowerCase().replace(/[\s,]/g, ''));
    }
  }
  return [...figures];
}

const COMMON_STARTERS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'Your', 'Our', 'Their', 'It', 'We', 'You',
  'One', 'Two', 'Three', 'Every', 'No', 'Now', 'Then', 'When', 'What', 'Why', 'How', 'Just',
  'Stop', 'Start', 'Meet', 'Built', 'Made', 'Work', 'Ask', 'Close', 'Forty', 'Zero',
]);

/**
 * Capitalised words that are not sentence starters.
 *
 * Crude on purpose: a false positive costs a reviewer ten seconds, and a false
 * negative puts a customer logo on screen that the customer does not have.
 */
export function extractProperNouns(text: string): string[] {
  const names = new Set<string>();
  const words = text.split(/\s+/);

  for (let i = 0; i < words.length; i += 1) {
    const raw = words[i]!;
    const word = raw.replace(/[^A-Za-z0-9&.-]/g, '');
    if (word.length < 3) continue;
    if (!/^[A-Z][a-zA-Z]/.test(word)) continue;
    // A capitalised word at the start of a sentence is just a sentence.
    const startsSentence = i === 0 || /[.!?]$/.test(words[i - 1] ?? '');
    if (startsSentence || COMMON_STARTERS.has(word)) continue;
    names.add(word);
  }

  return [...names];
}
