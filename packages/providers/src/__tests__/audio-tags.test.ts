import { describe, expect, it } from 'vitest';
import { wordsFrom } from '@act-one/providers';
function align(text: string) {
  const characters = text.split('');
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * 0.1),
    character_end_times_seconds: characters.map((_, i) => i * 0.1 + 0.09),
  };
}
describe('wordsFrom', () => {
  it('drops the control tokens we inserted ourselves', () => {
    const words = wordsFrom(align('[slowly] Every company has a film... [short pause] not made yet.'))!;
    expect(words.map((w) => w.word).join(' ')).toBe('Every company has a film... not made yet.');
  });
  it('keeps real words and their timings', () => {
    const words = wordsFrom(align('Take the waiting out.'))!;
    expect(words.map((w) => w.word)).toEqual(['Take', 'the', 'waiting', 'out.']);
    expect(words[0]!.startSeconds).toBe(0);
  });
});
