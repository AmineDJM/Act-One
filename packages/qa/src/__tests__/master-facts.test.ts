import { describe, it, expect } from 'vitest';
import { NEGATIVE_CORPUS, masterFloor, type MasterFacts } from '../master-facts.ts';

/**
 * The floor underneath the creative gate.
 *
 * Every one of these is a film that passed every technical check in this
 * system and was handed to a customer who did not recognise it as what they
 * had bought. They are not matters of taste and no model is asked about them:
 * a film nobody can hear is not a film, and a flat field with words on it for
 * thirty seconds is the words of a film rather than the film.
 */
function facts(over: Partial<MasterFacts> = {}): MasterFacts {
  return {
    durationSeconds: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
    audibleShare: 0.95,
    sampled: 12,
    flatFrames: 3,
    distinctFrames: 9,
    loudness: [],
    ...over,
  };
}

describe('what the measurements alone are enough to refuse', () => {
  it('passes a film with sound, pictures and a cut', () => {
    const floor = masterFloor(facts());
    expect(floor.verdict).toBe('pass');
    expect(floor.reasons).toEqual([]);
  });

  it('refuses a film with no audio track at all', () => {
    const floor = masterFloor(facts({ hasAudio: false, audibleShare: 0 }));
    expect(floor.verdict).toBe('revise');
    expect(floor.reasons.join(' ')).toMatch(/no audio track/);
  });

  it('refuses a track that exists and holds silence', () => {
    // The container cannot tell this apart from a mixed film. The measurement can.
    const floor = masterFloor(facts({ audibleShare: 0.1 }));
    expect(floor.verdict).toBe('revise');
    expect(floor.reasons.join(' ')).toMatch(/silent for 90%/);
  });

  it('does not refuse a film that holds a deliberate silence', () => {
    // A fifth of a film in silence is a choice; two thirds is a defect.
    expect(masterFloor(facts({ audibleShare: 0.8 })).verdict).toBe('pass');
  });

  it('refuses a film where every sampled frame is a flat field with type on it', () => {
    const floor = masterFloor(facts({ flatFrames: 12, distinctFrames: 8 }));
    expect(floor.verdict).toBe('revise');
    expect(floor.reasons.join(' ')).toMatch(/Nothing in this film is a picture/);
  });

  it('allows a film that chose type, when type is the form', () => {
    /*
     * A pitch cut in type is a real form and refusing it would refuse the
     * form. What it may still not be is static, which the next check covers.
     */
    const floor = masterFloor(facts({ flatFrames: 12, distinctFrames: 9 }), {
      typographicByDesign: true,
    });
    expect(floor.verdict).toBe('pass');
  });

  it('refuses a film that holds still, however it was cut', () => {
    const floor = masterFloor(facts({ flatFrames: 12, distinctFrames: 2 }), {
      typographicByDesign: true,
    });
    expect(floor.verdict).toBe('revise');
    expect(floor.reasons.join(' ')).toMatch(/the film holds still/);
  });

  it('says nothing about a film it could not sample', () => {
    // No frames read is not a finding about the film; it is a gap, and the
    // gate above says so rather than inventing a verdict from nothing.
    const floor = masterFloor(facts({ sampled: 0, flatFrames: 0, distinctFrames: 0 }));
    expect(floor.reasons).toEqual([]);
  });

  it('names every reason it has, not the first one', () => {
    const floor = masterFloor(facts({ hasAudio: false, flatFrames: 12, distinctFrames: 1 }));
    expect(floor.reasons).toHaveLength(3);
  });
});

describe('the corpus is a corpus, not a pile of thresholds', () => {
  it('names which failure a film fell into, so it can be counted over time', () => {
    const floor = masterFloor(facts({ hasAudio: false, flatFrames: 12, distinctFrames: 1 }));
    expect(floor.matched).toEqual(['silent_master', 'type_on_a_field', 'the_film_holds_still']);
  });

  it('says why each one is a failure rather than a preference', () => {
    // A corpus an operator cannot read is a set of magic numbers, and the
    // first thing somebody does with a magic number they do not understand is
    // move it.
    for (const pattern of NEGATIVE_CORPUS) {
      expect(pattern.title.length).toBeGreaterThan(8);
      expect(pattern.why.length).toBeGreaterThan(40);
    }
    expect(new Set(NEGATIVE_CORPUS.map((one) => one.id)).size).toBe(NEGATIVE_CORPUS.length);
  });
});
