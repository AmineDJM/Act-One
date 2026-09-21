import { describe, expect, it } from 'vitest';
import { dropStrayClosers, readModelJson } from '../model-json.ts';

/**
 * The two replies in here are not invented. They are what the audio critic
 * actually sent on two separate runs, and each of them destroyed a judgement:
 * the first killed the whole run and took the other critic's answer with it,
 * the second survived a repair that broke it in a different way.
 */
describe('readModelJson', () => {
  const realReply =
    '{"scores":{"soundsHuman":8,"toneMatchesClaim":9,"authoredTogether":8,"wouldYouKeepListening":9},' +
    '"worstMoment":{"at":23,"why":"The narrator stumbles slightly on \'safe idea,\' causing a brief distraction from the flow."},' +
    '"tell":"Narration has very consistent pacing and enunciation, lacking small natural pauses typical of conversation."},' +
    '"oneChange":"Introduce subtle pauses and inflections to make the narration sound more conversational."}';

  it('recovers the reply whose stray brace closed the root early', () => {
    const o = readModelJson(realReply) as any;
    // Everything AFTER the stray brace is the part that used to be lost.
    expect(o.oneChange).toContain('Introduce subtle pauses');
    expect(o.scores.soundsHuman).toBe(8);
    expect(o.tell).toContain('consistent pacing');
    expect(o.worstMoment.at).toBe(23);
  });

  it('leaves legitimate nesting alone', () => {
    const valid = '{"scores":{"a":1},"worstMoment":{"at":3,"why":"x"},"tell":"t"}';
    expect(dropStrayClosers(valid)).toBe(valid);
    expect(readModelJson(valid)).toEqual(JSON.parse(valid));
  });

  it('does not treat a brace inside a string as structure', () => {
    const o = readModelJson('{"why":"the cut at 12s reads as } a glitch","a":1}') as any;
    expect(o.why).toBe('the cut at 12s reads as } a glitch');
    expect(o.a).toBe(1);
  });

  it('survives a backslash immediately before the closing quote', () => {
    const o = readModelJson('{"tell":"a path C:\\\\","a":2}') as any;
    expect(o.a).toBe(2);
  });

  it('drops a trailing comma', () => {
    expect(readModelJson('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 });
  });

  it('still refuses a reply with no JSON in it', () => {
    expect(() => readModelJson('I would rather not score this film.')).toThrow(/no JSON/);
  });
});
