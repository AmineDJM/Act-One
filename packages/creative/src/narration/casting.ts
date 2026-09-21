import type { VoiceDirection } from '@act-one/core';

/**
 * Casting: the step between a direction and a voice.
 *
 * `VoiceDirection` already says everything a casting director needs — language,
 * gender, age impression, register, energy, pace, the emotional arc, what to
 * avoid. What it never said was WHO reads it. That was a constant in a provider
 * file, which meant every film this system made was narrated by the same person
 * regardless of what the film was, and the direction was decoration.
 *
 * WHY THE CATALOGUE IS MEASURED RATHER THAN DECLARED. The vendor ships 49 preset
 * voices and publishes nothing about any of them: no gender, no age, no register.
 * They surface only inside a validation error. So the catalogue this casts from
 * was built by having every voice read the same lines and a critic describe each
 * take (`scripts/film/cast-voices.ts`). It is evidence, not opinion, and it is
 * refreshed when the vendor's roster changes.
 *
 * WHY A SHORTLIST AND NOT A WINNER. Scoring picks the voices that fit the
 * direction; it cannot tell you which one is right for THIS film, because that
 * depends on how the read sits against the cut — where the pauses fall, whether
 * the emphasis lands on the same frame as the typography, whether it survives
 * the music. None of that is audible in an isolated WAV. So this returns a small
 * number of MATERIALLY DIFFERENT candidates, and the decision is made by
 * auditioning them against the picture.
 */

/** One voice, as a critic heard it. The shape `voice-catalogue.json` holds. */
export type VoiceCard = {
  voiceId: string;
  gender: 'male' | 'female' | 'ambiguous';
  ageImpression: string;
  /** 0–10. How much the voice sounds like it knows what it is talking about. */
  authority: number;
  warmth: number;
  /** Close and confiding at 10, broadcast at 0. */
  intimacy: number;
  energy: number;
  accent: string;
  texture: string;
  /** 0–10, where 10 is obviously synthetic. Heavily penalised. */
  soundsLikeTts: number;
  bestFor: string;
};

/** What the direction is asking for, on the catalogue's scales. */
export type CastingTarget = {
  gender: 'male' | 'female' | null;
  authority: number;
  warmth: number;
  intimacy: number;
  energy: number;
  /** Substring the accent should contain, when the direction implies one. */
  accent: string | null;
};

const ENERGY_SCALE: Record<VoiceDirection['energy'], number> = {
  low: 2,
  'medium-low': 4,
  medium: 5,
  'medium-high': 7,
  high: 9,
};

/**
 * The direction, read onto the scales the catalogue is written in.
 *
 * `profile` is the load-bearing field: premium is the studio read — authoritative
 * and deliberately not intimate; warm trades authority for closeness; neutral is
 * the flat register that internal work wants and that advertising does not.
 */
export function castingTarget(direction: VoiceDirection): CastingTarget {
  const byProfile: Record<VoiceDirection['profile'], { authority: number; warmth: number; intimacy: number }> = {
    premium: { authority: 8, warmth: 5, intimacy: 6 },
    warm: { authority: 6, warmth: 8, intimacy: 8 },
    neutral: { authority: 6, warmth: 5, intimacy: 4 },
  };
  const base = byProfile[direction.profile];
  return {
    gender: direction.gender,
    ...base,
    energy: ENERGY_SCALE[direction.energy],
    accent: accentFrom(direction),
  };
}

/**
 * The locale is the only reliable statement of accent.
 *
 * `voiceProfile` is prose a model wrote and matching on it would be matching on
 * phrasing; the locale is a code somebody chose.
 */
function accentFrom(direction: VoiceDirection): string | null {
  const locale = direction.locale ?? '';
  if (/^en-GB/i.test(locale)) return 'British';
  if (/^en-AU/i.test(locale)) return 'Australian';
  if (/^en-US/i.test(locale)) return 'American';
  if (/^fr/i.test(locale)) return 'French';
  return null;
}

/** How far a card is from the target. Lower is better; `null` means ruled out. */
export function castingDistance(card: VoiceCard, target: CastingTarget): number | null {
  // Gender is a casting instruction, not a preference to be traded off.
  if (target.gender && card.gender !== target.gender && card.gender !== 'ambiguous') return null;
  if (target.accent && !card.accent.toLowerCase().includes(target.accent.toLowerCase())) return null;

  const gap =
    Math.abs(card.authority - target.authority) * 1.2 +
    Math.abs(card.warmth - target.warmth) +
    Math.abs(card.intimacy - target.intimacy) +
    Math.abs(card.energy - target.energy) * 1.1;

  /*
   * Sounding synthetic is weighted far above any of the fit scores.
   *
   * A voice that is a perfect match on every scale and audibly a machine makes
   * the whole film read as generated, which is the one impression this system
   * cannot afford. Two points of TTS-ness costs more than two points of warmth.
   */
  return gap + card.soundsLikeTts * 2.5;
}

/**
 * A shortlist of candidates that are materially different from each other.
 *
 * Taking the top N by score returns near-duplicates — the catalogue has clusters
 * of similar voices, and auditioning four of the same read against the picture
 * learns nothing. So each pick after the first must be some distance from every
 * voice already chosen, and the separation is relaxed only if that would leave
 * the list short.
 */
export function shortlist(
  cards: readonly VoiceCard[],
  target: CastingTarget,
  count = 4,
  minSeparation = 4,
): VoiceCard[] {
  const ranked = cards
    .map((card) => ({ card, distance: castingDistance(card, target) }))
    .filter((entry): entry is { card: VoiceCard; distance: number } => entry.distance !== null)
    .sort((a, b) => a.distance - b.distance);

  for (let separation = minSeparation; separation >= 0; separation -= 1) {
    const picked: VoiceCard[] = [];
    for (const { card } of ranked) {
      if (picked.length >= count) break;
      if (picked.every((chosen) => difference(chosen, card) >= separation)) picked.push(card);
    }
    if (picked.length >= count || separation === 0) return picked;
  }
  return ranked.slice(0, count).map((entry) => entry.card);
}

/** How unlike each other two voices are, on the scales that a listener notices. */
export function difference(a: VoiceCard, b: VoiceCard): number {
  return (
    Math.abs(a.authority - b.authority) +
    Math.abs(a.warmth - b.warmth) +
    Math.abs(a.intimacy - b.intimacy) +
    Math.abs(a.energy - b.energy) +
    (a.gender === b.gender ? 0 : 3) +
    (a.accent === b.accent ? 0 : 2)
  );
}

/**
 * The performance instructions that go with the casting, in the vendor's units.
 *
 * `eleven_v3` is not directed in prose — it has no field for it. It reads
 * `speed`, `stability` and `style`, so the direction has to be translated rather
 * than handed over. Lower stability is a FREER read, which is why an energetic
 * brief lowers it rather than raising it.
 */
export function performanceInstructions(direction: VoiceDirection): {
  speed: number;
  stability: number;
  style: number;
  useSpeakerBoost: boolean;
} {
  const paceSpeed = { slow: 0.92, natural: 1, fast: 1.08 }[direction.pace];
  const stability = { creative: 0.3, natural: 0.5, robust: 0.7 }[direction.stability];
  const energy = ENERGY_SCALE[direction.energy];
  return {
    speed: clamp(paceSpeed, 0.7, 1.2),
    stability,
    // Style exaggerates the speaker's own manner; too much of it is where a
    // read starts sounding like an advertisement rather than a person.
    style: clamp((energy - 3) / 12, 0, 0.5),
    useSpeakerBoost: true,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
