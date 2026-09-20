import { describe, it, expect, vi, afterEach } from 'vitest';
import { readVoicePage } from '../speech/elevenlabs.ts';

/**
 * A voice library read as far as it can be read.
 *
 * A live account answered this with something the whole-page schema refused,
 * and the error said only that it was "unexpected" — so the one thing needed
 * to fix it, what actually came back, was the one thing missing. Two hundred
 * usable voices were thrown away because one entry had a field we did not
 * know, and nobody could tell which entry.
 */
const good = { voice_id: 'v1', name: 'Marguerite', category: 'premade' };

afterEach(() => vi.restoreAllMocks());

describe('one odd entry does not cost the whole library', () => {
  it('keeps the voices it can read and counts the ones it cannot', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const page = readVoicePage({
      voices: [good, { voice_id: 'v2', labels: { accent: 42 } }, { ...good, voice_id: 'v3' }],
    });
    expect(page.voices.map((voice) => voice.voice_id)).toEqual(['v1', 'v3']);
    expect(page.skipped).toBe(1);
    expect(page.reason).toBeUndefined();
  });

  it('accepts a voice carrying fields we have never seen', () => {
    // Additive changes to a vendor's API are the normal case and must not be
    // an outage.
    const page = readVoicePage({ voices: [{ ...good, something_new: { nested: true } }] });
    expect(page.voices).toHaveLength(1);
    expect(page.skipped).toBe(0);
  });

  it('follows the pages only while the vendor says there are more', () => {
    expect(readVoicePage({ voices: [good], has_more: true }).hasMore).toBe(true);
    expect(readVoicePage({ voices: [good] }).hasMore).toBe(false);
  });
});

describe('when nothing can be read, the reason says what came back', () => {
  it('names the entry and the field, not just that it failed', () => {
    const page = readVoicePage({ voices: [{ voice_id: 'v1', name: 'Marguerite', labels: { accent: 42 } }] });
    expect(page.voices).toHaveLength(0);
    expect(page.reason).toMatch(/Marguerite/);
    expect(page.reason).toMatch(/labels/);
  });

  it('says so when there is no list of voices at all, and lists what there was', () => {
    const page = readVoicePage({ detail: 'Unauthorized', status: 401 });
    expect(page.reason).toMatch(/no list of voices/);
    expect(page.reason).toMatch(/detail, status/);
  });

  it('says so when the answer is not an object', () => {
    expect(readVoicePage('nope').reason).toMatch(/string rather than an object/);
    expect(readVoicePage(null).reason).toMatch(/rather than an object/);
  });

  it('distinguishes an empty library from an unreadable one', () => {
    expect(readVoicePage({ voices: [] }).reason).toMatch(/empty list/);
  });
});
