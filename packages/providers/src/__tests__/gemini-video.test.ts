import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NullCostSink } from '../index.ts';
import { GeminiVideoProvider, consumeSse } from '../video/gemini.ts';

/**
 * Gemini watching a film, against a fake of the three endpoints it uses: the
 * resumable upload, the file's status, and the streamed answer.
 */
type Handler = (request: IncomingMessage, body: Buffer, response: ServerResponse) => void;

const context = { organizationId: 'org_platform', projectId: null };

function sse(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join('');
}

const ANSWER_EVENTS = [
  { candidates: [{ content: { parts: [{ text: '**Thinking about the cut**', thought: true }] } }] },
  { candidates: [{ content: { parts: [{ text: '{"summary":"A card' }] } }] },
  { candidates: [{ content: { parts: [{ text: ' becomes a chart."}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 150, totalTokenCount: 1200, promptTokensDetails: [{ modality: 'VIDEO', tokenCount: 800 }] }, modelVersion: 'gemini-3.1-pro-preview' },
];

describe('GeminiVideoProvider', () => {
  let server: Server;
  let base: string;
  let requests: { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer }[];
  let handlers: Handler[];

  beforeEach(async () => {
    requests = [];
    handlers = [];
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks);
        requests.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body });
        const handler = handlers.shift();
        if (!handler) {
          response.writeHead(500).end('no handler');
          return;
        }
        handler(request, body, response);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const answer = (events: unknown[]): Handler => (_request, _body, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(sse(events));
  };

  const generate = (provider: GeminiVideoProvider) =>
    provider.generate(
      {
        parts: [
          { kind: 'video', file: { name: 'files/abc', uri: `${base}/files/abc`, mimeType: 'video/mp4', expiresAt: null }, fps: 4, startSeconds: 1, endSeconds: 2.5 },
          { kind: 'text', text: 'What happens?' },
        ],
        system: 'You are a forensic film analyst.',
        schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
        mediaResolution: 'low',
        label: 'film-ir.test',
      },
      context,
    );

  it('uploads once, then waits for the file to be processed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-gemini-'));
    await writeFile(path.join(dir, 'film.mp4'), new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    handlers.push((_request, _body, response) => {
      response.writeHead(200, { 'x-goog-upload-url': `${base}/upload-session/1` }).end();
    });
    handlers.push((_request, _body, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ file: { name: 'files/abc', uri: `${base}/v1beta/files/abc`, mimeType: 'video/mp4', state: 'PROCESSING' } }));
    });
    handlers.push((_request, _body, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name: 'files/abc', uri: `${base}/v1beta/files/abc`, mimeType: 'video/mp4', state: 'ACTIVE', expirationTime: '2026-09-25T00:00:00Z' }));
    });
    const provider = new GeminiVideoProvider({ apiKey: 'test-key', baseUrl: base });
    const file = await provider.uploadVideo(path.join(dir, 'film.mp4'), 'video/mp4', 'bench_1', context);
    expect(file).toEqual({ name: 'files/abc', uri: `${base}/v1beta/files/abc`, mimeType: 'video/mp4', expiresAt: '2026-09-25T00:00:00Z' });
    expect(requests[0]!.headers['x-goog-upload-command']).toBe('start');
    expect(requests[0]!.headers['x-goog-upload-header-content-length']).toBe('8');
    expect(requests[1]!.url).toBe('/upload-session/1');
    expect(requests[1]!.headers['x-goog-upload-command']).toBe('upload, finalize');
    expect(requests[1]!.body.byteLength).toBe(8);
    expect(requests[2]!.url).toBe('/v1beta/files/abc');
  }, 20_000);

  it('streams the answer, keeps only its own parts and records what it cost', async () => {
    handlers.push(answer(ANSWER_EVENTS));
    const sink = new NullCostSink();
    const provider = new GeminiVideoProvider({ apiKey: 'test-key', baseUrl: base, costSink: sink });
    const result = await generate(provider);
    expect(result.json).toEqual({ summary: 'A card becomes a chart.' });
    expect(result.usage).toEqual({ promptTokens: 1000, outputTokens: 200, videoTokens: 800, totalTokens: 1200 });
    // 1000 × $2/M + 200 × $12/M
    expect(result.costUsd).toBeCloseTo(0.0044, 8);
    expect(sink.records[0]).toMatchObject({ provider: 'gemini', operation: 'llm.vision', quantity: 1200, costBasis: 'listed' });

    const request = requests[0]!;
    expect(request.url).toBe('/v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse');
    expect(request.headers['x-goog-api-key']).toBe('test-key');
    const sent = JSON.parse(request.body.toString()) as Record<string, any>;
    expect(sent.generationConfig).toMatchObject({ responseMimeType: 'application/json', mediaResolution: 'MEDIA_RESOLUTION_LOW', thinkingConfig: { includeThoughts: true } });
    expect(sent.contents[0].parts[0]).toEqual({
      fileData: { fileUri: `${base}/files/abc`, mimeType: 'video/mp4' },
      videoMetadata: { fps: 4, startOffset: '1.000s', endOffset: '2.500s' },
    });
    expect(sent.systemInstruction).toEqual({ parts: [{ text: 'You are a forensic film analyst.' }] });
  });

  it('retries a gateway failure, and a cut stream from scratch rather than appending to it', async () => {
    handlers.push((_request, _body, response) => response.writeHead(503).end('busy'));
    handlers.push((_request, _body, response) => {
      // Half an answer, then the connection drops.
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(sse([ANSWER_EVENTS[1]]));
      setTimeout(() => response.destroy(), 20);
    });
    handlers.push(answer(ANSWER_EVENTS));
    const provider = new GeminiVideoProvider({ apiKey: 'test-key', baseUrl: base });
    const result = await generate(provider);
    expect(requests).toHaveLength(3);
    expect(result.json).toEqual({ summary: 'A card becomes a chart.' });
  }, 30_000);

  it('never presents a truncated answer as an answer', async () => {
    handlers.push(answer([{ candidates: [{ content: { parts: [{ text: '{"summary":"A ca' }] }, finishReason: 'MAX_TOKENS' }] }]));
    handlers.push(answer([{ candidates: [{ content: { parts: [{ text: '{"summary":"A ca' }] }, finishReason: 'MAX_TOKENS' }] }]));
    const provider = new GeminiVideoProvider({ apiKey: 'test-key', baseUrl: base });
    await expect(generate(provider)).rejects.toThrow(/did not finish \(MAX_TOKENS\)/);
  });

  it('does not retry a refusal', async () => {
    handlers.push(answer([{ promptFeedback: { blockReason: 'SAFETY' } }]));
    const provider = new GeminiVideoProvider({ apiKey: 'test-key', baseUrl: base });
    await expect(generate(provider)).rejects.toThrow(/refused \(SAFETY\)/);
    expect(requests).toHaveLength(1);
  });

  it('does not retry a request the service calls invalid', async () => {
    handlers.push((_request, _body, response) => {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } }));
    });
    const provider = new GeminiVideoProvider({ apiKey: 'test-key', baseUrl: base });
    await expect(generate(provider)).rejects.toThrow(/HTTP 400/);
    expect(requests).toHaveLength(1);
  });
});

describe('consumeSse', () => {
  const collector = (): Parameters<typeof consumeSse>[2] => ({ pending: '', text: '', thoughtParts: 0, finishReason: null, blockReason: null, usage: null, modelVersion: null });

  it('assembles events split anywhere across chunks, in either line ending', () => {
    const stream = sse(ANSWER_EVENTS);
    const into = collector();
    for (let i = 0; i < stream.length; i += 7) consumeSse('gemini', stream.slice(i, i + 7), into);
    expect(into.text).toBe('{"summary":"A card becomes a chart."}');
    expect(into.thoughtParts).toBe(1);
    expect(into.finishReason).toBe('STOP');
    expect(into.usage?.totalTokenCount).toBe(1200);

    const unix = collector();
    consumeSse('gemini', sse(ANSWER_EVENTS).replace(/\r\n/g, '\n'), unix);
    expect(unix.text).toBe(into.text);
  });

  it('raises an error the service sends mid-stream', () => {
    expect(() => consumeSse('gemini', sse([{ error: { code: 500, status: 'INTERNAL', message: 'An internal error has occurred.' } }]), collector())).toThrow(/INTERNAL An internal error/);
  });
});
