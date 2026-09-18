import type { Standard } from './standard.ts';

/**
 * Conversion law.
 *
 * The least standardised area here and the one with the most folklore, so it is
 * the one to be most careful about. What follows is limited to findings that are
 * repeatedly measured across independent sources, or that are structural rather
 * than empirical. Anything that amounts to "this worked for one campaign" is
 * not a standard and is not in this file.
 */
export const CONVERSION_STANDARDS = {
  oneIdea: {
    id: 'conversion.one_idea',
    rule: 'A film carries one idea. Everything in it serves that idea.',
    source: 'Ogilvy, Confessions of an Advertising Man; standard positioning practice',
    authority: 'convention',
    // Not checkable by arithmetic: whether every scene serves one idea is a
    // judgement about meaning, not a measurement. It is enforced where
    // judgement happens — the treatment is written around a single idea and
    // the customer approves exactly one concept — and it stays documented so
    // the console does not claim a check that does not exist.
    enforcement: 'documented',
    because:
      'A viewer retains one thing. A film that says four things is a film that says nothing, ' +
      'and listing features is the default an automated system falls into. This is the one rule ' +
      'here no check can decide: it is held by the treatment, which argues one idea, and by the ' +
      'customer, who approves one concept.',
  },
  hook: {
    id: 'conversion.hook',
    rule: 'The first three seconds establish the problem or the product, not the brand.',
    source: 'Platform creative guidance (Meta, TikTok, YouTube)',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'It is where viewers leave, consistently, across every platform that publishes retention ' +
      'data. A logo sting in the opening seconds spends the only attention you are given.',
  },
  soundOff: {
    id: 'conversion.sound_off',
    rule: 'A film for social reads with the sound off.',
    source: 'Platform creative guidance (Meta, TikTok)',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Most feed playback starts muted. A film whose meaning is carried by narration is a ' +
      'film most of its audience will not understand.',
  },
  singleCta: {
    id: 'conversion.single_cta',
    rule: 'One call to action, specific, at the end.',
    source: 'Standard direct-response practice',
    authority: 'convention',
    enforcement: 'checked',
    because:
      'Two actions compete and neither gets taken. "Learn more" is not an action; ' +
      'it is what you write when nobody decided what the viewer should do.',
  },
  proofPlacement: {
    id: 'conversion.proof_placement',
    rule: 'Evidence goes after the claim it supports, not at the end in a block.',
    source: 'Standard narrative and direct-response practice',
    authority: 'convention',
    enforcement: 'checked',
    because:
      'A claim carries doubt until it is answered. Collecting all proof into a logo wall ' +
      'at the end answers doubts the viewer stopped holding two scenes ago.',
  },
  durationByChannel: {
    id: 'conversion.duration_by_channel',
    rule: 'Cut to the length the channel actually plays.',
    source: 'Platform specifications',
    authority: 'guidance',
    enforcement: 'designed_in',
    because:
      'A 60-second hero film posted as a 6-second bumper is a 60-second film with 54 ' +
      'seconds missing. Each length is a different edit, not a different trim.',
  },
  noFakeUrgency: {
    id: 'conversion.no_fake_urgency',
    rule: 'No invented scarcity, countdowns or deadlines.',
    source: 'Advertising standards practice (ASA/CAP Code; FTC)',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Fabricated urgency is a regulated deceptive practice, and it is the first thing an ' +
      'automated copywriter reaches for.',
  },
} as const satisfies Record<string, Standard>;

/** Seconds. The window in which a film has to earn the rest of itself. */
export const HOOK_SECONDS = 3;

/** Calls to action that say nothing. A CTA should name what happens next. */
export const VAGUE_CTAS: readonly string[] = [
  'learn more',
  'find out more',
  'discover more',
  'click here',
  'get started today',
  'see more',
  'read more',
];

/** Channel lengths, in seconds, that platforms actually serve. */
export const CHANNEL_DURATIONS = {
  hero_60: 60,
  vertical_30: 30,
  ad_15_a: 15,
  ad_15_b: 15,
  ad_15_c: 15,
  bumper_6: 6,
  homepage_loop: 12,
  product_hunt: 30,
  linkedin_cut: 30,
  reel: 30,
  tiktok: 30,
  youtube_short: 30,
} as const;

export function ctaIsVague(cta: string): boolean {
  const normalized = cta.trim().toLowerCase().replace(/[.!]+$/, '');
  return VAGUE_CTAS.includes(normalized);
}

/**
 * Whether a film opens on its subject rather than on its logo.
 *
 * Takes the visual types of the opening scenes and the seconds they occupy: a
 * logo reveal is allowed to open a film only if it is over inside the hook.
 */
export function opensOnSubject(
  scenes: readonly { visualType: string; duration: number }[],
): boolean {
  let elapsed = 0;
  for (const scene of scenes) {
    if (scene.visualType !== 'logo_reveal' && scene.visualType !== 'transition') return true;
    elapsed += scene.duration;
    if (elapsed >= HOOK_SECONDS) return false;
  }
  return true;
}

/**
 * The vocabulary of invented urgency.
 *
 * Matched against on-screen copy and narration. A real deadline a customer
 * supplies as a claim is not caught by this — it has evidence behind it; this
 * catches the reflex an automated copywriter reaches for when it has none.
 */
export const FAKE_URGENCY_PATTERNS: readonly RegExp[] = [
  /\b(?:only|just)\s+today\b/i,
  /\btoday\s+only\b/i,
  /\bhurry\b/i,
  /\blimited[\s-]+(?:time|offer|spots?|seats?|places?)\b/i,
  /\bends?\s+(?:soon|tonight|today|friday|this\s+week)\b/i,
  /\blast\s+chance\b/i,
  /\bdon'?t\s+miss\s+out\b/i,
  /\bbefore\s+it'?s\s+(?:gone|too\s+late)\b/i,
  /\boffer\s+expires\b/i,
  /\bact\s+now\b/i,
  /\bwhile\s+(?:supplies|stocks?|spots?)\s+last\b/i,
  /\b(?:only\s+)?\d+\s+(?:spots?|seats?|licen[cs]es?|places?)\s+(?:left|remaining)\b/i,
  /\bcountdown\b/i,
  /\bselling\s+(?:out\s+)?fast\b/i,
];

export function urgencyPhrasesIn(text: string): string[] {
  return FAKE_URGENCY_PATTERNS.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match ? [match[0]] : [];
  });
}

/**
 * Where a block of proof at the end of a film begins, as a fraction of its
 * runtime. Proof is meant to follow the claim it supports; two or more proof
 * scenes in a row this late are a logo wall by another name.
 */
export const PROOF_BLOCK_START = 0.7;
