import { describe, it, expect } from 'vitest';
import { consumeSse, finishCollector, newCollector } from '../llm/openai.ts';

/**
 * Reassembling a completion from its stream.
 *
 * The switch to streaming was not a feature, it was survival: a deep-tier
 * answer takes ninety seconds or more and a silent request that long is cut
 * by every intermediary between this process and the model — measured at
 * 92.2s in one sandbox, and the symptom is an HTTP 502 that survives all
 * three retries, because a deterministic timeout is not a transient failure.
 *
 * What that buys has to be paid for in care here. A stream arrives in chunks
 * that do not respect event boundaries, and the failure that produces is a
 * JSON parse error on perfectly good output, occasionally, under load.
 */
function stream(chunks: string[]) {
  const collector = newCollector();
  for (const chunk of chunks) consumeSse(chunk, collector);
  return finishCollector(collector);
}

const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n`;
const delta = (content: string) => event({ choices: [{ delta: { content } }] });

describe('a completion, reassembled from its stream', () => {
  it('joins the deltas in order', () => {
    const result = stream([delta('{"a"'), delta(': 1'), delta('}'), 'data: [DONE]\n']);
    expect(result.content).toBe('{"a": 1}');
  });

  /*
   * The one that matters. A chunk boundary inside a `data:` line is routine,
   * and a parser that treats every chunk as whole events drops the tail of
   * one and the head of the next.
   */
  it('holds back an event split across two chunks', () => {
    const whole = delta('hello');
    const cut = Math.floor(whole.length / 2);
    const result = stream([whole.slice(0, cut), whole.slice(cut)]);
    expect(result.content).toBe('hello');
  });

  it('survives a chunk that ends mid-line, repeatedly', () => {
    const wire = [delta('one '), delta('two '), delta('three')].join('');
    // Three bytes at a time: every boundary lands somewhere awkward.
    const chunks: string[] = [];
    for (let at = 0; at < wire.length; at += 3) chunks.push(wire.slice(at, at + 3));
    expect(stream(chunks).content).toBe('one two three');
  });

  it('takes the token counts from the final usage event', () => {
    const result = stream([
      delta('x'),
      event({ model: 'gpt-5.4-2026-03-05', choices: [], usage: { prompt_tokens: 120, completion_tokens: 8 } }),
      'data: [DONE]\n',
    ]);
    expect(result).toMatchObject({ model: 'gpt-5.4-2026-03-05', inputTokens: 120, outputTokens: 8 });
  });

  it('leaves the counts unknown when no gateway sent them', () => {
    // Estimated by the caller, exactly as it was when responses came back whole.
    const result = stream([delta('x'), 'data: [DONE]\n']);
    expect(result.inputTokens).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
  });

  it('drops a malformed event rather than losing the answer', () => {
    const result = stream([delta('good '), 'data: {not json\n', delta('answer')]);
    expect(result.content).toBe('good answer');
  });

  it('ignores keep-alive comments and blank data lines', () => {
    const result = stream([': ping\n', 'data:\n', delta('still here'), '\n']);
    expect(result.content).toBe('still here');
  });

  it('is unbothered by a null content delta', () => {
    const result = stream([event({ choices: [{ delta: { content: null } }] }), delta('text')]);
    expect(result.content).toBe('text');
  });
});
