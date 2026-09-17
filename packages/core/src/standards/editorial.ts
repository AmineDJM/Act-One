import type { Standard } from './standard.ts';

/**
 * Editorial law.
 *
 * A launch film makes claims about a company, in that company's name, to that
 * company's customers. That is publishing, and the standards that apply to
 * publishing apply here — with the difference that we are writing on somebody
 * else's behalf, so the cost of getting it wrong lands on them.
 */
export const EDITORIAL_STANDARDS = {
  attribution: {
    id: 'editorial.attribution',
    rule: 'Every factual claim on screen traces to something we read on the product.',
    source: 'Basic verification practice (Reuters Handbook; AP Stylebook)',
    authority: 'guidance',
    because:
      'A number in a film reads as fact whoever put it there. If we cannot point at where ' +
      'it came from, we are inventing evidence for a customer who will be held to it.',
  },
  noInvention: {
    id: 'editorial.no_invention',
    rule: 'Nothing is stated that the product does not say about itself.',
    source: 'Act One house rule',
    authority: 'house',
    because:
      'A language model asked for launch copy will supply plausible specifics — customer counts, ' +
      'percentages, funding — because plausible specifics are what launch copy contains. ' +
      'Every one of them would be a fabrication in the customer’s own voice.',
  },
  superlatives: {
    id: 'editorial.superlatives',
    rule: 'No unqualified superlative or first-in-the-world claim.',
    source: 'Advertising standards practice (ASA/CAP Code; FTC endorsement guidance)',
    authority: 'guidance',
    because:
      '"The best" and "the only" are objective claims in advertising law, and they need ' +
      'substantiation the customer usually does not have.',
  },
  numbers: {
    id: 'editorial.numbers',
    rule: 'A statistic on screen carries its basis, or it does not go on screen.',
    source: 'Reuters Handbook, on the use of statistics',
    authority: 'guidance',
    because:
      '"3x faster" means nothing without knowing than what. A number with no basis is ' +
      'either meaningless or misleading, and there is no third case.',
  },
  weasel: {
    id: 'editorial.weasel',
    rule: 'No hedges that imply evidence without providing it.',
    source: 'Plain-language and editorial practice',
    authority: 'convention',
    because:
      '"Studies show", "industry-leading", "up to" and "helps you" are constructions for ' +
      'sounding substantiated while being unfalsifiable.',
  },
  plainLanguage: {
    id: 'editorial.plain_language',
    rule: 'One idea per line, in the words the audience uses.',
    source: 'Plain-language guidance (plainlanguage.gov)',
    authority: 'guidance',
    because:
      'On-screen text is read once, at a pace the viewer does not control. ' +
      'A subordinate clause is a line nobody finishes.',
  },
  consent: {
    id: 'editorial.consent',
    rule: 'No real person is depicted, voiced or imitated without their explicit consent.',
    source: 'Act One house rule; right-of-publicity law in most jurisdictions',
    authority: 'normative',
    because:
      'Cloning a founder’s voice or face for a film they did not approve is both unlawful ' +
      'in most places and the single fastest way to destroy trust in an automated system.',
  },
} as const satisfies Record<string, Standard>;

/**
 * Constructions that assert evidence without carrying any.
 *
 * Matched case-insensitively against copy. Deliberately conservative — these are
 * phrases with no defensible use in a claim, not merely weak writing.
 */
export const WEASEL_PHRASES: readonly string[] = [
  'studies show',
  'research shows',
  'experts agree',
  'industry-leading',
  'industry leading',
  'best-in-class',
  'best in class',
  'world-class',
  'world class',
  'game-changing',
  'game changing',
  'revolutionary',
  'cutting-edge',
  'cutting edge',
  'state-of-the-art',
  'state of the art',
  'seamlessly',
  'effortlessly',
  'unparalleled',
  'unrivalled',
  'unrivaled',
];

/** Superlative and priority claims that need substantiation to be legal. */
export const SUPERLATIVE_PATTERNS: readonly RegExp[] = [
  /\bthe (?:best|fastest|cheapest|easiest|safest|most \w+)\b/i,
  /\b(?:world|industry|market)'?s? (?:first|best|leading|number one|#1)\b/i,
  /\bthe only \w+ that\b/i,
  /\bnumber one\b/i,
  /\b#1\b/,
  /\bguaranteed\b/i,
];

/**
 * Numbers that read as evidence: percentages, multiples, money, counts.
 *
 * The count branch allows a couple of words between the figure and the noun,
 * because that is how these are actually written — "400 finance teams",
 * "12,000 engineering hours" — and requiring the noun to sit against the
 * number misses most of them.
 */
export const STATISTIC_PATTERN = new RegExp(
  [
    String.raw`\b\d[\d,.]*\s?%`,
    String.raw`\b\d+(?:\.\d+)?\s?x\b`,
    String.raw`[$€£]\s?\d`,
    String.raw`\b\d[\d,.]*(?:k|m|bn|b)?\+?\s+(?:\w+\s+){0,2}(?:customers|users|companies|teams|businesses|developers|engineers|hours|days|weeks|months|minutes|seconds)\b`,
  ].join('|'),
  'i',
);

export function containsStatistic(text: string): boolean {
  return STATISTIC_PATTERN.test(text);
}

export function weaselPhrasesIn(text: string): string[] {
  const lower = text.toLowerCase();
  return WEASEL_PHRASES.filter((phrase) => lower.includes(phrase));
}

export function superlativesIn(text: string): string[] {
  return SUPERLATIVE_PATTERNS.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match ? [match[0]] : [];
  });
}
