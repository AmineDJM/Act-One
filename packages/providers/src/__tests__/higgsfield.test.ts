import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HiggsfieldProvider, NullCostSink, ProviderError } from '../index.ts';

/**
 * Higgsfield's documented surface, on loopback.
 *
 * The provider submits through the vendor's SDK and reads status, price,
 * uploads and cancellation from the REST endpoints the SDK does not wrap.
 * This is that surface, as the vendor documents it: the request object with
 * its six states, `Authorization: Key ID:SECRET`, the estimate that answers
 * in credits and dollars, the presigned upload, the cancel that only works
 * while queued. What the tests prove is that the provider speaks it exactly,
 * which is the part a unit test with a mocked client would not.
 */
type Status = {
  status: string;
  error?: string | null;
  video?: { url: string };
  images?: { url: string }[];
};

type Call = { method: string; path: string; headers: IncomingMessage['headers']; body: unknown };

const MODELS = new Set([
  'bytedance/seedance-2.5/text-to-video',
  'bytedance/seedance-2.5/image-to-video',
  'higgsfield-ai/soul/v2/standard',
]);

/** A PNG header: enough for the provider to know what it is uploading. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

class FakeHiggsfield {
  readonly credentials = 'key_id:key_secret';
  calls: Call[] = [];
  uploads: { headers: IncomingMessage['headers']; bytes: Buffer }[] = [];
  /** The states the next accepted request goes through after `queued`. */
  script: Status[] = [];
  estimate: { credits: string; usd: string } = { credits: '1.500', usd: '0.094' };
  rejectSubmission: { status: number; detail: string } | null = null;
  url = '';
  private timelines = new Map<string, Status[]>();
  private server: Server | null = null;
  private counter = 0;

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  reset(): void {
    this.calls = [];
    this.uploads = [];
    this.script = [];
    this.estimate = { credits: '1.500', usd: '0.094' };
    this.rejectSubmission = null;
    this.timelines.clear();
    this.counter = 0;
  }

  submissions(): Call[] {
    return this.calls.filter((call) => call.method === 'POST' && MODELS.has(call.path.slice(1)));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const path = new URL(request.url ?? '/', this.url).pathname;
    const method = request.method ?? 'GET';

    // Our own storage on this box: reachable from here, not from the vendor.
    if (method === 'GET' && path === '/local/ref.png') return send(response, 200, PNG, 'image/png');
    // The presigned slot: the vendor's headers, the bytes, and nothing else.
    if (method === 'PUT' && path.startsWith('/upload/')) {
      this.uploads.push({ headers: request.headers, bytes: raw });
      return send(response, 200, '');
    }

    const body: unknown = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : undefined;
    this.calls.push({ method, path, headers: request.headers, body });
    if (request.headers.authorization !== `Key ${this.credentials}`) {
      return json(response, 401, { detail: 'Invalid credentials' });
    }

    if (method === 'POST' && path === '/files/generate-upload-url') {
      const id = ++this.counter;
      return json(response, 200, {
        upload_url: `${this.url}/upload/${id}`,
        public_url: `https://cdn.higgsfield.example/${id}.png`,
        upload_headers: { 'X-Upload-Token': 'presigned' },
        content_type: (body as { content_type: string }).content_type,
      });
    }
    if (method === 'POST' && path.startsWith('/estimate/')) {
      return MODELS.has(path.slice('/estimate/'.length))
        ? json(response, 200, this.estimate)
        : json(response, 404, { detail: 'Model not found' });
    }

    const status = path.match(/^\/requests\/([^/]+)\/status$/);
    if (method === 'GET' && status?.[1]) {
      const timeline = this.timelines.get(status[1]);
      if (!timeline) return json(response, 404, { detail: 'Request not found' });
      const current = timeline.length > 1 ? timeline.shift()! : timeline[0]!;
      return json(response, 200, { request_id: status[1], ...current });
    }
    const cancel = path.match(/^\/requests\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancel?.[1]) {
      const timeline = this.timelines.get(cancel[1]);
      if (!timeline) return json(response, 404, { detail: 'Request not found' });
      if (timeline[0]?.status !== 'queued') {
        return json(response, 400, { detail: 'Request already started' });
      }
      this.timelines.set(cancel[1], [{ status: 'canceled' }]);
      return send(response, 202, '');
    }

    if (method === 'POST' && MODELS.has(path.slice(1))) {
      if (this.rejectSubmission) {
        return json(response, this.rejectSubmission.status, {
          detail: this.rejectSubmission.detail,
        });
      }
      const id = `req_${++this.counter}`;
      const rest =
        this.script.length > 0
          ? this.script
          : [
              { status: 'in_progress' },
              { status: 'completed', video: { url: `https://cdn.higgsfield.example/${id}.mp4` } },
            ];
      this.script = [];
      this.timelines.set(id, [{ status: 'queued' }, ...rest]);
      return json(response, 200, {
        status: 'queued',
        request_id: id,
        status_url: `${this.url}/requests/${id}/status`,
        cancel_url: `${this.url}/requests/${id}/cancel`,
      });
    }
    return json(response, 404, { detail: 'Model not found' });
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  send(response, status, JSON.stringify(body), 'application/json');
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  type = 'text/plain',
): void {
  response.writeHead(status, { 'content-type': type });
  response.end(body);
}

const ENV = ['HF_CREDENTIALS', 'HF_KEY', 'HF_API_KEY', 'HF_API_SECRET'] as const;
const fake = new FakeHiggsfield();
const call = { organizationId: 'org_1', projectId: 'prj_1', sceneId: 'scn_1' };
let saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

function provider(
  overrides: ConstructorParameters<typeof HiggsfieldProvider>[0] = {},
): HiggsfieldProvider {
  return new HiggsfieldProvider({
    credentials: fake.credentials,
    baseUrl: fake.url,
    polling: { initialMs: 5, maxMs: 10 },
    ...overrides,
  });
}

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  for (const name of ENV) delete process.env[name];
  await fake.start();
});

afterAll(async () => {
  await fake.stop();
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

beforeEach(() => fake.reset());

describe('Higgsfield through the official SDK', () => {
  it('submits a Seedance text-to-video request in the documented shape, signed with the key', async () => {
    const job = await provider().generateVideo(
      { prompt: 'Dawn over a harbour', aspect: '4:5', tier: 'studio', durationSeconds: 2.6 },
      call,
    );

    const [submission] = fake.submissions();
    expect(submission?.path).toBe('/bytedance/seedance-2.5/text-to-video');
    expect(submission?.headers.authorization).toBe('Key key_id:key_secret');
    expect(submission?.body).toEqual({
      prompt: 'Dawn over a harbour',
      // Under the model's four-second floor, and 4:5 is not a frame it has.
      duration: 4,
      resolution: '720p',
      aspect_ratio: '3:4',
      output_format: 'mp4',
      generate_audio: false,
    });
    expect(job).toMatchObject({ status: 'queued', model: 'bytedance/seedance-2.5/text-to-video' });
    expect(job.id).toMatch(/^req_/);
  });

  it('drives image-to-video from a public reference, which sets the frame', async () => {
    await provider().generateVideo(
      {
        prompt: 'The dashboard, slow push in',
        aspect: '16:9',
        tier: 'cinematic',
        durationSeconds: 6,
        initImageUrl: 'https://assets.example.com/ref.png',
      },
      call,
    );

    const [submission] = fake.submissions();
    expect(submission?.path).toBe('/bytedance/seedance-2.5/image-to-video');
    expect(submission?.body).toMatchObject({
      image_url: 'https://assets.example.com/ref.png',
      duration: 6,
    });
    expect(submission?.body).not.toHaveProperty('aspect_ratio');
    expect(fake.uploads).toHaveLength(0);
  });

  it('puts a reference our storage serves on loopback on the vendor CDN first', async () => {
    await provider().generateVideo(
      {
        prompt: 'The dashboard, slow push in',
        aspect: '16:9',
        tier: 'studio',
        durationSeconds: 5,
        initImageUrl: `${fake.url}/local/ref.png`,
      },
      call,
    );

    const grant = fake.calls.find((entry) => entry.path === '/files/generate-upload-url');
    expect(grant?.body).toEqual({ content_type: 'image/png' });
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.bytes.equals(PNG)).toBe(true);
    expect(fake.uploads[0]?.headers['x-upload-token']).toBe('presigned');
    expect(fake.uploads[0]?.headers['content-type']).toBe('image/png');
    // The vendor is explicit: credentials never go to the presigned URL.
    expect(fake.uploads[0]?.headers.authorization).toBeUndefined();
    expect(fake.submissions()[0]?.body).toMatchObject({
      image_url: 'https://cdn.higgsfield.example/1.png',
    });
  });

  it("prices a request with the vendor's estimate of that exact request", async () => {
    const usd = await provider().estimateCost({
      prompt: 'Dawn over a harbour',
      aspect: '16:9',
      tier: 'studio',
      durationSeconds: 8,
    });
    expect(usd).toBeCloseTo(0.094);
    const estimate = fake.calls.find((entry) => entry.path.startsWith('/estimate/'));
    expect(estimate?.path).toBe('/estimate/bytedance/seedance-2.5/text-to-video');
    expect(estimate?.body).toMatchObject({ prompt: 'Dawn over a harbour', duration: 8 });
  });

  it('refuses a request the vendor prices above the ceiling before sending it', async () => {
    fake.estimate = { credits: '150.000', usd: '9.400' };
    await expect(
      provider({ maxCostPerRequestUsd: 6 }).generateVideo(
        { prompt: 'x', aspect: '16:9', tier: 'cinematic', durationSeconds: 30 },
        call,
      ),
    ).rejects.toThrow(/ceiling/);
    expect(fake.submissions()).toHaveLength(0);
  });

  it("waits for completion and records the vendor's price once, when it is charged", async () => {
    const sink = new NullCostSink();
    const media = provider({ costSink: sink });
    const job = await media.generateVideo(
      { prompt: 'x', aspect: '16:9', tier: 'studio', durationSeconds: 5 },
      call,
    );
    expect(sink.records).toHaveLength(0);

    const finished = await media.waitForJob(job.id, call, 5_000);
    expect(finished.status).toBe('succeeded');
    expect(finished.outputUrls).toEqual([`https://cdn.higgsfield.example/${job.id}.mp4`]);
    expect(finished.contentType).toBe('video/mp4');
    expect(finished.costUsd).toBeCloseTo(0.094);

    const polls = fake.calls.filter((entry) => entry.path === `/requests/${job.id}/status`);
    expect(polls.length).toBeGreaterThanOrEqual(3);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({
      provider: 'higgsfield',
      model: 'bytedance/seedance-2.5/text-to-video',
      operation: 'media.video',
      estimatedCostUsd: 0.094,
      actualCostUsd: 0.094,
      succeeded: true,
      metadata: { requestId: job.id, projectId: 'prj_1', sceneId: 'scn_1' },
    });
  });

  it('reports moderation as a failure that cost nothing, not as a success', async () => {
    const sink = new NullCostSink();
    const media = provider({ costSink: sink });
    fake.script = [{ status: 'nsfw' }];
    const job = await media.generateVideo(
      { prompt: 'x', aspect: '16:9', tier: 'studio', durationSeconds: 5 },
      call,
    );
    const finished = await media.waitForJob(job.id, call, 5_000);
    expect(finished.status).toBe('failed');
    expect(finished.error).toMatch(/moderation/);
    expect(finished.outputUrls).toEqual([]);
    expect(sink.records).toEqual([expect.objectContaining({ actualCostUsd: 0, succeeded: false })]);
  });

  it("carries the vendor's reason when generation fails", async () => {
    const media = provider();
    fake.script = [{ status: 'in_progress' }, { status: 'failed', error: 'Generation failed' }];
    const job = await media.generateVideo(
      { prompt: 'x', aspect: '16:9', tier: 'studio', durationSeconds: 5 },
      call,
    );
    const finished = await media.waitForJob(job.id, call, 5_000);
    expect(finished.status).toBe('failed');
    expect(finished.error).toBe('Generation failed: Generation failed');
  });

  it('cancels a queued request when the render is aborted', async () => {
    const sink = new NullCostSink();
    const media = provider({ costSink: sink });
    const job = await media.generateVideo(
      { prompt: 'x', aspect: '16:9', tier: 'studio', durationSeconds: 5 },
      call,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      media.waitForJob(job.id, { ...call, signal: controller.signal }, 5_000),
    ).rejects.toThrow(/cancelled/);
    expect(fake.calls.some((entry) => entry.path === `/requests/${job.id}/cancel`)).toBe(true);
    expect(sink.records).toEqual([expect.objectContaining({ actualCostUsd: 0, succeeded: false })]);
  });

  it('rejects bad credentials in words that do not contain them', async () => {
    const media = provider({ credentials: 'key_id:wrong_secret' });
    const attempt = media.generateVideo(
      { prompt: 'x', aspect: '16:9', tier: 'studio', durationSeconds: 5 },
      call,
    );
    await expect(attempt).rejects.toBeInstanceOf(ProviderError);
    await expect(attempt).rejects.toMatchObject({ retryable: false });
    await expect(attempt).rejects.toThrow(/credentials/);
    await expect(attempt).rejects.not.toThrow(/wrong_secret/);

    const health = await media.health();
    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/credentials/);
    expect(health.message).not.toContain('wrong_secret');
  });

  it('treats a full queue as something to retry, and bad input as something not to', async () => {
    fake.rejectSubmission = { status: 400, detail: 'Maximum concurrent requests reached' };
    await expect(
      provider().generateVideo(
        { prompt: 'x', aspect: '16:9', tier: 'studio', durationSeconds: 5 },
        call,
      ),
    ).rejects.toMatchObject({ retryable: true });

    fake.rejectSubmission = { status: 422, detail: 'prompt: field required' };
    await expect(
      provider().generateVideo(
        { prompt: 'x', aspect: '16:9', tier: 'studio', durationSeconds: 5 },
        call,
      ),
    ).rejects.toMatchObject({ retryable: false });
  });

  it('proves the credentials by pricing a four-second shot, without generating one', async () => {
    const health = await provider().health();
    expect(health.healthy).toBe(true);
    expect(health.message).toContain('$0.094');
    expect(fake.submissions()).toHaveLength(0);
  });

  it("asks Soul for one still at the tier's resolution, from the prompt as written", async () => {
    await provider().generateImage(
      { prompt: 'A brass key on linen', aspect: '16:9', tier: 'cinematic', seed: 12 },
      call,
    );
    const [submission] = fake.submissions();
    expect(submission?.path).toBe('/higgsfield-ai/soul/v2/standard');
    expect(submission?.body).toEqual({
      prompt: 'A brass key on linen',
      aspect_ratio: '16:9',
      resolution: '1080p',
      batch_size: 1,
      enhance_prompt: false,
      seed: 12,
    });
  });

  it('does not pretend to edit images', async () => {
    await expect(
      provider().editImage({ imageUrl: 'https://a/b.png', instruction: 'x', tier: 'studio' }, call),
    ).rejects.toThrow(/not available/);
    expect(fake.calls).toHaveLength(0);
  });

  it('is unconfigured without credentials, and says what the credential looks like', async () => {
    const media = new HiggsfieldProvider({ baseUrl: fake.url });
    expect(media.isConfigured()).toBe(false);
    await expect(
      media.generateVideo(
        { prompt: 'x', aspect: '16:9', tier: 'studio', durationSeconds: 5 },
        call,
      ),
    ).rejects.toThrow(/not configured/);
    const health = await media.health();
    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/KEY_ID:KEY_SECRET/);

    // A console entry that is only half a credential is a problem to report,
    // not a reason to use whatever the environment holds.
    const half = new HiggsfieldProvider({ apiKey: 'key_id', baseUrl: fake.url });
    expect(half.isConfigured()).toBe(false);
    expect((await half.health()).message).toMatch(/KEY_ID:KEY_SECRET/);

    process.env.HF_CREDENTIALS = fake.credentials;
    try {
      expect(new HiggsfieldProvider({ baseUrl: fake.url }).isConfigured()).toBe(true);
    } finally {
      delete process.env.HF_CREDENTIALS;
    }
  });
});
