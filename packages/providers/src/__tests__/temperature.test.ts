import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenAiLlmProvider } from '../llm/openai.ts';

/**
 * A model that refuses any temperature but its own, asked several times at once.
 *
 * The provider learns the refusal and asks again without the field. It used
 * to learn it only for the first request to hear back: the others, already in
 * flight with a temperature, found the model in the set and gave up — which
 * is how five of six scenes written in parallel lost an attempt each.
 */
let server: Server;
let baseUrl = '';
const seen = { withTemperature: 0, without: 0 };

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    request.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      if ('temperature' in body) {
        seen.withTemperature += 1;
        // Held long enough that every concurrent request is sent before any is refused.
        setTimeout(() => {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              error: {
                message: "Unsupported value: 'temperature' does not support 0.4 with this model. Only the default (1) value is supported.",
                type: 'invalid_request_error',
                param: 'temperature',
              },
            }),
          );
        }, 60);
        return;
      }
      seen.without += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 1 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('a temperature the model refuses', () => {
  it('is dropped and retried for every request that carried it, however many were in flight', async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: 'test',
      baseUrl,
      routing: { fast: 'fixed-temperature-model', balanced: 'fixed-temperature-model', deep: 'fixed-temperature-model' },
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        provider.complete([{ role: 'user', content: 'hello' }], { tier: 'fast', temperature: 0.4 }, { organizationId: 'org_test' }),
      ),
    );

    expect(results.map((result) => result.value)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(seen).toEqual({ withTemperature: 4, without: 4 });
  });

  it('is never sent again to a model that refused it', async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: 'test',
      baseUrl,
      routing: { fast: 'fixed-temperature-model', balanced: 'fixed-temperature-model', deep: 'fixed-temperature-model' },
    });
    const before = { ...seen };
    await provider.complete([{ role: 'user', content: 'again' }], { tier: 'fast', temperature: 0.4 }, { organizationId: 'org_test' });
    expect(seen.withTemperature).toBe(before.withTemperature);
    expect(seen.without).toBe(before.without + 1);
  });
});
