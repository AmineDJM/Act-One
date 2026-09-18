import { describe, it, expect } from 'vitest';
import { VoiceDirection, directVoice, directionForTake, localeFor } from '../index.ts';

/**
 * The direction: what a narrator is told before a word is made, from what
 * the customer chose and what the content is.
 */
describe('directVoice', () => {
  it('directs a launch film as cinematic and restrained by default', () => {
    const direction = directVoice({ context: 'launch_film', language: 'fr' });
    expect(direction).toMatchObject({
      language: 'fr',
      locale: 'fr-FR',
      style: 'cinematic',
      energy: 'medium-low',
      pace: 'natural',
      profile: 'premium',
      stability: 'natural',
    });
    expect(direction.emotionCurve.map((cue) => cue.section)).toEqual(['opening', 'middle', 'ending']);
    expect(direction.avoid).toContain('radio advertising voice');
    expect(direction.voiceProfile).toMatch(/French from France/);
    expect(VoiceDirection.safeParse(direction).success).toBe(true);
  });

  it('takes the style from the brief tone when no voice style was chosen, and the choice when it was', () => {
    expect(directVoice({ context: 'launch_film', language: 'en', tone: 'warm' }).style).toBe('warm');
    expect(directVoice({ context: 'launch_film', language: 'en', tone: 'warm', style: 'calm' })).toMatchObject({
      style: 'calm',
      energy: 'low',
      profile: 'neutral',
    });
  });

  it('is an editorial voice for an audio edition and an energetic one for a social cut', () => {
    expect(directVoice({ context: 'audio_edition', language: 'en' })).toMatchObject({ style: 'editorial', stability: 'robust' });
    expect(directVoice({ context: 'social_cut', language: 'en' })).toMatchObject({ style: 'energetic', energy: 'medium-high' });
    expect(directVoice({ context: 'executive_update', language: 'en' })).toMatchObject({ style: 'calm', energy: 'low' });
  });

  it('turns an accent into a locale only where it makes sense', () => {
    expect(localeFor('en', 'british')).toBe('en-GB');
    expect(localeFor('fr', 'canada')).toBe('fr-CA');
    expect(localeFor('fr', 'british')).toBeNull();
    expect(localeFor('de', 'auto')).toBe('de-DE');
    expect(localeFor('en', 'international')).toBeNull();
    expect(directVoice({ context: 'launch_film', language: 'en', accent: 'british' }).locale).toBe('en-GB');
  });

  it('keeps the gender the customer chose', () => {
    expect(directVoice({ context: 'launch_film', language: 'en', gender: 'female' }).gender).toBe('female');
    expect(directVoice({ context: 'launch_film', language: 'en', gender: 'male' }).gender).toBe('male');
  });

  it('turns takes into the same direction held differently', () => {
    const direction = directVoice({ context: 'launch_film', language: 'en' });
    expect(directionForTake(direction, 'restrained')).toMatchObject({ energy: 'low', stability: 'robust' });
    expect(directionForTake(direction, 'energetic')).toMatchObject({ energy: 'medium', stability: 'creative' });
    expect(directionForTake(direction, 'warmer').profile).toBe('warm');
    expect(directionForTake(direction, 'as_directed')).toEqual(direction);
  });
});
