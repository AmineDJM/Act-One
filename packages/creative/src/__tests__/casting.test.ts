import { describe, expect, it } from 'vitest';
import { castingDistance, castingTarget, difference, shortlist, performanceInstructions, type VoiceCard } from '../narration/casting.ts';

const card = (over: Partial<VoiceCard>): VoiceCard => ({
  voiceId: 'x', gender: 'male', ageImpression: '30s', authority: 8, warmth: 5,
  intimacy: 6, energy: 8, accent: 'General American', texture: 'crisp',
  soundsLikeTts: 2, bestFor: 'launch films', ...over,
});

const direction = {
  language: 'en', locale: 'en-US', gender: 'male' as const, voiceProfile: 'assured male',
  profile: 'premium' as const, tone: '', energy: 'high' as const, pace: 'fast' as const,
  style: 'professional' as const, context: 'launch_film' as const,
  emotionCurve: [], avoid: [], stability: 'natural' as const,
};

describe('casting', () => {
  it('rules out a voice of the wrong gender rather than scoring it lower', () => {
    const target = castingTarget(direction as never);
    expect(castingDistance(card({ gender: 'female' }), target)).toBeNull();
    // Ambiguous is not wrong, so it stays in contention.
    expect(castingDistance(card({ gender: 'ambiguous' }), target)).not.toBeNull();
  });

  it('rules out an accent the direction did not ask for', () => {
    const target = castingTarget(direction as never);
    expect(castingDistance(card({ accent: 'British RP' }), target)).toBeNull();
  });

  it('weighs sounding synthetic above any single fit score', () => {
    const target = castingTarget(direction as never);
    // A perfect match that sounds like a machine must lose to a worse match
    // that sounds like a person — this is the whole reason the weight exists.
    const machine = castingDistance(card({ soundsLikeTts: 8 }), target)!;
    const human = castingDistance(card({ warmth: 8, intimacy: 2, soundsLikeTts: 0 }), target)!;
    expect(human).toBeLessThan(machine);
  });

  it('returns candidates that differ from each other, not the top N near-duplicates', () => {
    const cards = [
      card({ voiceId: 'a', authority: 8, warmth: 5, intimacy: 6, energy: 9 }),
      card({ voiceId: 'a-clone', authority: 8, warmth: 5, intimacy: 6, energy: 9 }),
      card({ voiceId: 'a-clone2', authority: 8, warmth: 5, intimacy: 6, energy: 9 }),
      card({ voiceId: 'different', authority: 9, warmth: 2, intimacy: 1, energy: 4 }),
    ];
    const picked = shortlist(cards, castingTarget(direction as never), 2, 4);
    expect(picked).toHaveLength(2);
    // The near-duplicates score best, but auditioning two identical reads
    // against the picture learns nothing.
    expect(picked.map((c) => c.voiceId)).toContain('different');
  });

  it('relaxes the separation rather than returning a short list', () => {
    const clones = [card({ voiceId: 'a' }), card({ voiceId: 'b' }), card({ voiceId: 'c' })];
    expect(shortlist(clones, castingTarget(direction as never), 3, 5)).toHaveLength(3);
  });

  it('counts a gender or accent change as a real difference', () => {
    expect(difference(card({}), card({ gender: 'female' }))).toBeGreaterThan(0);
    expect(difference(card({}), card({ accent: 'British RP' }))).toBeGreaterThan(0);
  });

  it('keeps the vendor speed inside the range it accepts', () => {
    for (const pace of ['slow', 'natural', 'fast'] as const) {
      const { speed } = performanceInstructions({ ...direction, pace } as never);
      expect(speed).toBeGreaterThanOrEqual(0.7);
      expect(speed).toBeLessThanOrEqual(1.2);
    }
  });

  it('reads a freer performance as LOWER stability, which is the vendor sense', () => {
    const creative = performanceInstructions({ ...direction, stability: 'creative' } as never);
    const robust = performanceInstructions({ ...direction, stability: 'robust' } as never);
    expect(creative.stability).toBeLessThan(robust.stability);
  });
});
