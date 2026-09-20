import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { httpRequest, httpStream, sleep } from '../http.ts';
import { canAuthenticate, credentialIsManaged } from '../managed-credentials.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';
import {
  VideoAnalysis,
  type AnalysisDepth,
  type VideoAnalysisRequest,
  type VideoAnalyst,
} from './types.ts';

/**
 * A model that watches the film.
 *
 * This is not another language provider with a video-shaped argument. Handing
 * a chat model six stills and asking what the film does produces an answer
 * about six stills; the thing that makes a boundary a transformation rather
 * than a cut happens between frames, and a sampler that never saw those frames
 * cannot report it. Gemini reads the file natively, on its own clock, which is
 * the capability — everything else here is in service of not corrupting it.
 *
 * Three rules the rest of the file is built around.
 *
 * MODELS ARE DISCOVERED, NEVER COMPILED IN. The account this runs against has
 * already had a model retired underneath it: `gemini-2.5-pro` now answers 404,
 * "no longer available to new users". A model name written into this file is
 * a name that is wrong the week they change it, and wrong in the direction
 * that fails a production. So the catalogue is fetched, video-capable models
 * are ranked, and the best one for the pass is used. The names below are
 * shapes to prefer, not identifiers to send.
 *
 * TIMESTAMPS ARE THE POINT. Everything the analyst returns is on the film's
 * clock, and the clock is stated to it in the prompt rather than assumed. A
 * reading that has lost its timecodes is a review, and we have no use for a
 * review.
 *
 * UNCERTAINTY SURVIVES. The schema requires a confidence and a piece of
 * evidence on every interpretation, and requires the analyst to say what it
 * could not see. What comes out of here is turned into instructions for a
 * director, and a confident invention is followed exactly as readily as a
 * measurement.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com';

/** The Files API refuses anything larger, and so should we, with a sentence. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** How long to wait for the service to finish processing an uploaded film. */
const PROCESSING_TIMEOUT_MS = 5 * 60_000;

export type GeminiVideoConfig = {
  apiKey?: string;
  baseUrl?: string;
  costSink?: CostSink;
  /** Pins a model for both passes. Set only to reproduce an old reading. */
  model?: string;
  /** Overrides for the two passes, when an operator wants a specific pair. */
  models?: { broad?: string; deep?: string };
};

const FileResource = z.object({
  name: z.string(),
  uri: z.string(),
  state: z.enum(['STATE_UNSPECIFIED', 'PROCESSING', 'ACTIVE', 'FAILED']).default('PROCESSING'),
  mimeType: z.string().optional(),
  error: z.object({ message: z.string().optional() }).nullish(),
});
type FileResource = z.infer<typeof FileResource>;

const ModelResource = z.object({
  name: z.string(),
  supportedGenerationMethods: z.array(z.string()).default([]),
  inputTokenLimit: z.number().optional(),
});

const GenerateResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional() })).default([]) })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .default([]),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});

/**
 * Model families that can read a film, most capable first.
 *
 * Matched against whatever the catalogue actually returns — nothing here is
 * ever sent as a model name on its own. A deep pass wants the reasoning tier
 * because the questions are about why a boundary works; a broad pass wants the
 * fast tier because the question is where things happen and there are ninety
 * seconds of them.
 */
const DEEP_PREFERENCE = [/(^|-)pro(-|$)/, /(^|-)flash(-|$)/];
const BROAD_PREFERENCE = [/(^|-)flash(-|$)/, /(^|-)pro(-|$)/];

/** Catalogue entries that are not general video readers, whatever their tier. */
const NOT_A_VIDEO_READER =
  /(embedding|aqa|tts|image|imagen|veo|lyria|robotics|computer-use|transcribe|live|translate|deep-research|antigravity|gemma)/;

export class GeminiVideoAnalyst implements VideoAnalyst {
  readonly name = 'gemini';
  readonly kind = 'analysis' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly costSink: CostSink | undefined;
  private readonly pinned: { broad?: string; deep?: string };
  private catalogue: string[] | null = null;

  constructor(config: GeminiVideoConfig = {}) {
    this.apiKey = (
      config.apiKey ??
      process.env['GEMINI_API_KEY'] ??
      process.env['GOOGLE_API_KEY'] ??
      ''
    ).trim();
    this.baseUrl = (config.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.costSink = config.costSink;
    this.pinned = {
      ...(config.models?.broad ? { broad: config.models.broad } : {}),
      ...(config.models?.deep ? { deep: config.models.deep } : {}),
      ...(config.model ? { broad: config.model, deep: config.model } : {}),
    };
  }

  isConfigured(): boolean {
    return canAuthenticate('gemini', this.apiKey);
  }

  /**
   * Lists the catalogue and names the model each pass would use.
   *
   * Free, and it proves the two things that actually matter: the credential is
   * accepted, and this account can still reach a model that reads video. A
   * health check that only proved the key would have stayed green through the
   * retirement that took `gemini-2.5-pro` away.
   */
  async health(): Promise<ProviderHealth> {
    const base = {
      provider: this.name,
      kind: 'analysis' as const,
      checkedAt: new Date().toISOString(),
    };
    if (!this.isConfigured()) {
      return { ...base, healthy: false, message: 'No Gemini credential is configured.' };
    }
    const startedAt = Date.now();
    try {
      const models = await this.availableModels();
      if (models.length === 0) {
        return {
          ...base,
          healthy: false,
          latencyMs: Date.now() - startedAt,
          message: 'The Gemini catalogue came back with no model that reads video.',
        };
      }
      return {
        ...base,
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message:
          `${models.length} video-capable models. ` +
          `Deep passes use ${await this.modelFor('deep')}; broad passes use ${await this.modelFor('broad')}.`,
      };
    } catch (error) {
      return {
        ...base,
        healthy: false,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Video-capable models this account can use, best first.
   *
   * Filtered rather than listed: the catalogue mixes in embedding models,
   * speech models, image generators and video *generators*, none of which will
   * read a film, and several of which have names close enough to one that will
   * to be picked by accident.
   */
  async availableModels(): Promise<string[]> {
    if (this.catalogue) return this.catalogue;

    const answer = await this.api(
      z.object({ models: z.array(ModelResource).default([]) }),
      'GET',
      '/v1beta/models?pageSize=200',
    );

    const usable = answer.models
      .map((model) => model.name.replace(/^models\//, ''))
      .filter((name) => !NOT_A_VIDEO_READER.test(name))
      .filter((name) => /^gemini-/.test(name));

    // Newest first, by the version in the name, then by tier. A catalogue is
    // not returned in any documented order and picking the first entry has no
    // meaning.
    this.catalogue = usable.sort((a, b) => versionOf(b) - versionOf(a) || a.length - b.length);
    return this.catalogue;
  }

  async analyse(request: VideoAnalysisRequest, context: CallContext): Promise<VideoAnalysis> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.name, 'No Gemini credential is configured.', {
        retryable: false,
      });
    }
    const depth: AnalysisDepth = request.depth ?? 'broad';
    const model = await this.modelFor(depth);
    const startedAt = Date.now();

    const part = await this.videoPart(request, context);
    const body = {
      contents: [{ parts: [part, { text: instructions(depth, request) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        // A deep pass writes a great deal; a ceiling that truncates the JSON
        // turns a good reading into an unparseable one.
        maxOutputTokens: depth === 'deep' ? 65_536 : 32_768,
        temperature: 0.2,
      },
    };

    const answer = await this.generate(model, body, depth, context);

    const candidate = answer.candidates[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text.trim()) {
      throw new ProviderError(
        this.name,
        `The analyst returned nothing${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}.`,
        { retryable: true },
      );
    }

    await this.costSink?.record({
      provider: this.name,
      model,
      operation: 'llm.vision',
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      costBasis: 'unknown_price',
      quantity: answer.usageMetadata?.totalTokenCount ?? 0,
      unit: 'token',
      succeeded: true,
      metadata: { depth, latencyMs: Date.now() - startedAt },
    });

    return this.parse(text, { request, depth, model, finishReason: candidate?.finishReason });
  }

  /**
   * Asks the model, streamed.
   *
   * A deep pass over a minute of film takes minutes to answer, and a request
   * that sends nothing for minutes is a request every intermediary between
   * here and the model treats as dead. This deployment's egress proxy cuts at
   * about ninety seconds, measured — and it does not answer with a timeout, it
   * answers 502 Bad Gateway, which reads like the vendor being down. The first
   * deep pass written here died exactly that way.
   *
   * Streamed, bytes arrive continuously and nothing in the path has a reason
   * to intervene. So the limit that matters stops being "how long may this
   * take", which for a close reading is legitimately several minutes, and
   * becomes "how long may nothing at all happen".
   */
  private async generate(
    model: string,
    body: Record<string, unknown>,
    depth: AnalysisDepth,
    context: CallContext,
  ): Promise<z.infer<typeof GenerateResponse>> {
    const parts: string[] = [];
    let finishReason: string | undefined;
    let usage: z.infer<typeof GenerateResponse>['usageMetadata'];
    let buffer = '';

    await httpStream(
      this.name,
      `${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        body,
        headers: { ...this.authHeaders(), accept: 'text/event-stream' },
        // A close reading thinks for a long time before it writes; the gap
        // between chunks once it starts is short.
        idleTimeoutMs: depth === 'deep' ? 180_000 : 90_000,
        // Retried only before the first byte, which `httpStream` enforces:
        // after that a retry would discard a partial answer we are paying for.
        attempts: 2,
        ...(context.signal ? { signal: context.signal } : {}),
        onChunk: (chunk) => {
          buffer += chunk;
          /*
           * SSE frames are separated by a blank line, and this service ends its
           * lines with CRLF. Splitting on "\n\n" therefore never matches, the
           * whole answer accumulates in the buffer and the stream completes
           * having emitted nothing — which surfaces as "the analyst returned
           * nothing" and looks exactly like a model that refused.
           */
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            for (const line of frame.split(/\r?\n/)) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              let parsed: unknown;
              try {
                parsed = JSON.parse(payload);
              } catch {
                continue;
              }
              const piece = GenerateResponse.safeParse(parsed);
              if (!piece.success) continue;
              const candidate = piece.data.candidates[0];
              for (const part of candidate?.content?.parts ?? []) {
                if (part.text) parts.push(part.text);
              }
              if (candidate?.finishReason) finishReason = candidate.finishReason;
              if (piece.data.usageMetadata) usage = piece.data.usageMetadata;
            }
          }
        },
      },
    );

    return {
      candidates: [
        {
          content: { parts: [{ text: parts.join('') }] },
          ...(finishReason ? { finishReason } : {}),
        },
      ],
      ...(usage ? { usageMetadata: usage } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Getting the film to the model
  // -------------------------------------------------------------------------

  /**
   * The film, as a part the model can read.
   *
   * A URL the service can fetch itself is passed straight through. A local
   * file is uploaded to the Files API and waited on, because a film handed
   * over inline has to be base64'd into the request body and a ninety-second
   * master does not fit in one.
   */
  private async videoPart(
    request: VideoAnalysisRequest,
    context: CallContext,
  ): Promise<Record<string, unknown>> {
    const metadata: Record<string, unknown> = {};
    if (request.window) {
      metadata['startOffset'] = `${request.window.startSeconds}s`;
      metadata['endOffset'] = `${request.window.endSeconds}s`;
    }
    if (request.fps) metadata['fps'] = request.fps;

    const withMetadata = (fileData: Record<string, unknown>) =>
      Object.keys(metadata).length > 0 ? { fileData, videoMetadata: metadata } : { fileData };

    if (/^https?:\/\//i.test(request.source)) {
      return withMetadata({ fileUri: request.source, mimeType: 'video/*' });
    }

    const uploaded = await this.upload(request.source, context);
    return withMetadata({ fileUri: uploaded.uri, mimeType: uploaded.mimeType ?? 'video/mp4' });
  }

  /** Resumable upload, then wait for the service to finish decoding it. */
  private async upload(filePath: string, context: CallContext): Promise<FileResource> {
    const resolved = path.resolve(filePath);
    const info = await stat(resolved).catch(() => null);
    if (!info?.isFile()) {
      throw new ProviderError(this.name, `No film at ${resolved}.`, { retryable: false });
    }
    if (info.size > MAX_UPLOAD_BYTES) {
      throw new ProviderError(
        this.name,
        `The film is ${(info.size / 1e9).toFixed(2)}GB; the service accepts 2GB.`,
        { retryable: false },
      );
    }

    const mimeType = mimeFor(resolved);
    let uploadUrl = '';
    await httpRequest(this.name, `${this.baseUrl}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(info.size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: { file: { display_name: path.basename(resolved) } },
      timeoutMs: 60_000,
      attempts: 2,
      signal: context.signal,
      onResponse: (response) => {
        uploadUrl = response.headers.get('x-goog-upload-url') ?? '';
      },
    });
    if (!uploadUrl) {
      throw new ProviderError(this.name, 'The upload was started but no upload URL came back.', {
        retryable: true,
      });
    }

    const bytes = await readFile(resolved);
    const finished = await httpRequest<unknown>(this.name, uploadUrl, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
        'Content-Type': mimeType,
      },
      body: bytes,
      // One attempt: a resumable slot that half-accepted a film is not
      // something to replay blind, and the film is still on disk.
      attempts: 1,
      timeoutMs: 15 * 60_000,
      signal: context.signal,
    });

    const parsed = z.object({ file: FileResource }).safeParse(finished);
    const file = parsed.success ? parsed.data.file : FileResource.parse(finished);
    return this.waitForProcessing(file, context);
  }

  /**
   * A film is not readable the moment it is uploaded.
   *
   * Asking for an analysis while the service is still decoding fails with an
   * error about the file not being in the ACTIVE state, which reads like a
   * permissions problem and is not one.
   */
  private async waitForProcessing(file: FileResource, context: CallContext): Promise<FileResource> {
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    let current = file;
    let delay = 1_000;

    while (current.state === 'PROCESSING' && Date.now() < deadline) {
      await sleep(delay);
      delay = Math.min(8_000, Math.round(delay * 1.5));
      current = await this.api(FileResource, 'GET', `/v1beta/${current.name}`, undefined, {
        timeoutMs: 30_000,
        signal: context.signal,
      });
    }

    if (current.state === 'FAILED') {
      throw new ProviderError(
        this.name,
        `The service could not decode the film${current.error?.message ? `: ${current.error.message}` : '.'}`,
        { retryable: false },
      );
    }
    if (current.state !== 'ACTIVE') {
      throw new ProviderError(this.name, 'The film was still being processed after five minutes.', {
        retryable: true,
      });
    }
    return current;
  }

  // -------------------------------------------------------------------------
  // Reading the answer
  // -------------------------------------------------------------------------

  /**
   * The model's JSON, made into an analysis or refused.
   *
   * Parsed leniently at the top and strictly per entry: a reading where one
   * malformed beat costs the other forty is worse than one that drops the
   * beat and says so. What is never done is filling a missing confidence or
   * inventing an evidence string — an entry that cannot say why it believes
   * something does not belong in the output at all.
   */
  private parse(
    text: string,
    meta: {
      request: VideoAnalysisRequest;
      depth: AnalysisDepth;
      model: string;
      finishReason?: string;
    },
  ): VideoAnalysis {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first < 0 || last <= first) {
        throw new ProviderError(this.name, 'The analyst did not return JSON.', { retryable: true });
      }
      try {
        raw = JSON.parse(text.slice(first, last + 1));
      } catch {
        throw new ProviderError(
          this.name,
          meta.finishReason === 'MAX_TOKENS'
            ? 'The reading was cut off before it was valid JSON; narrow the window and try again.'
            : 'The analyst returned malformed JSON.',
          { retryable: true },
        );
      }
    }

    const object = keepReportedWords((raw ?? {}) as Record<string, unknown>);
    const limitations = asStringArray(object['limitations']);
    if (meta.request.fps) {
      limitations.push(
        `Sampled at ${meta.request.fps} fps; nothing shorter than one sampled frame was visible.`,
      );
    }
    if (meta.finishReason === 'MAX_TOKENS') {
      limitations.push('The reading reached the output ceiling and may be incomplete.');
    }

    const candidate = {
      ...object,
      source: {
        reference: meta.request.source,
        durationSeconds:
          typeof (object['source'] as Record<string, unknown>)?.['durationSeconds'] === 'number'
            ? (object['source'] as Record<string, number>)['durationSeconds']
            : null,
      },
      depth: meta.depth,
      model: meta.model,
      analysedAt: new Date().toISOString(),
      limitations,
    };

    const parsed = VideoAnalysis.safeParse(candidate);
    if (parsed.success) return parsed.data;

    // Salvage: keep every list whose entries validate, drop the ones that do
    // not, and record the loss where a reader will see it.
    const salvaged = salvage(candidate, parsed.error);
    const second = VideoAnalysis.safeParse(salvaged);
    if (second.success) return second.data;

    throw new ProviderError(
      this.name,
      `The reading did not match the analysis schema: ${parsed.error.issues[0]?.message ?? 'unknown'}.`,
      { retryable: true },
    );
  }

  // -------------------------------------------------------------------------

  /** The model this pass should use: pinned, else the best the account has. */
  private async modelFor(depth: AnalysisDepth): Promise<string> {
    const pinned = this.pinned[depth];
    if (pinned) return pinned;

    const models = await this.availableModels();
    if (models.length === 0) {
      throw new ProviderError(
        this.name,
        'No video-capable Gemini model is available to this account.',
        {
          retryable: false,
        },
      );
    }
    const preference = depth === 'deep' ? DEEP_PREFERENCE : BROAD_PREFERENCE;
    for (const shape of preference) {
      const match = models.find((name) => shape.test(name));
      if (match) return match;
    }
    return models[0]!;
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey && credentialIsManaged('gemini')) return {};
    return { 'x-goog-api-key': this.apiKey };
  }

  private async api<T>(
    schema: z.ZodType<T>,
    method: 'GET' | 'POST',
    pathname: string,
    body?: unknown,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    const raw = await httpRequest<unknown>(this.name, `${this.baseUrl}${pathname}`, {
      method,
      ...(body === undefined ? {} : { body }),
      headers: { ...this.authHeaders(), accept: 'application/json' },
      timeoutMs: options.timeoutMs ?? 60_000,
      attempts: method === 'GET' ? 3 : 1,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(this.name, `Unexpected answer from ${pathname}.`, {
        retryable: true,
      });
    }
    return parsed.data;
  }
}

// ---------------------------------------------------------------------------

/**
 * What the analyst is asked to do.
 *
 * Written as direction rather than as a schema dump, with the schema named
 * underneath it. A model handed only a shape fills the shape; a model told
 * what the reading is for reports the thing the shape was built to hold.
 *
 * The clock is stated twice on purpose. Losing the timecodes is the single
 * failure that makes a reading worthless, and it is the one a model drifts
 * into whenever the questions get interesting.
 */
function instructions(depth: AnalysisDepth, request: VideoAnalysisRequest): string {
  const window = request.window
    ? `You are being shown ${request.window.startSeconds}s to ${request.window.endSeconds}s of a longer film. ` +
      `Report timecodes on the FILM's clock, not the clip's.`
    : 'Report every timecode in seconds from the first frame of the film.';

  const close =
    depth === 'deep'
      ? [
          'This is a CLOSE pass. Watch for what happens between cuts rather than at them.',
          'Distinguish four kinds of boundary and label every one:',
          '  shot           — the picture is replaced between one frame and the next.',
          '  scene          — the world changes: new field, new place, new register. Often with NO cut.',
          '  creative_beat  — same world, new idea: elements replaced, line changed, layout reorganised.',
          '  transformation — material becomes other material: a morph, a scale handoff, an object carried across.',
          'A film of this class often changes its idea twenty times while cutting three times. If you find',
          'only a handful of boundaries in a minute of film, you are counting cuts and missing the work.',
          'Separate CAMERA movement from OBJECT movement. A frame pushing in on a still image and an object',
          'travelling across a still frame look similar in aggregate and are different decisions.',
        ].join('\n')
      : [
          'This is a BROAD pass. Cover the whole film and get the structure and the timecodes right.',
          'Prefer fewer, well-placed entries over many speculative ones.',
        ].join('\n');

  return [
    'You are analysing a product film as a temporal work. Watch it; do not summarise it.',
    '',
    window,
    '',
    close,
    '',
    request.focus ? `Focus for this pass: ${request.focus}\n` : '',
    'RULES, which matter more than completeness:',
    '1. Every interpretation carries "confidence" — one of "observed" (you saw it happen at that time),',
    '   "inferred" (you concluded it from what you saw), "uncertain" (you may be reading this wrong) —',
    '   and "evidence", a short sentence saying what in the film supports it.',
    '2. Do not report precision you did not observe. If you cannot tell a 200ms stagger from a 400ms one,',
    '   say so in "limitations" and mark the entry "uncertain". A wrong number is followed exactly as',
    '   readily as a right one by whatever reads this.',
    '3. Report verbatim on-screen text only where it is legible. Leave it empty rather than guessing.',
    '4. "limitations" is required and is rarely empty. Say what this pass could not see.',
    '',
    'Answer with a single JSON object, no prose around it, with these keys — all arrays, all optional,',
    'each entry carrying "confidence" and "evidence":',
    '  boundaries[]            { at, kind: shot|scene|creative_beat|transformation, mechanism }',
    '  beats[]                 { span:{start,end}, idea, primaryCognitiveJob }',
    '  narrative               { movements:[{span,claim}], dependency }',
    '  viewerStates[]          { at, knows, openQuestion }',
    '  visualHierarchy[]       { at, order:[] }',
    '  typography[]            { span, text, treatment, role }',
    '  ui[]                    { span, action, liveness: driven|held|decomposed|unclear }',
    '  objectTransformations[] { span, subject, mechanism }',
    '  camera[]                { span, move, attribution: camera|objects|both|unclear }',
    '  motion[]                { span, subject, easing, staggerMs }',
    '  transitions[]           { at, kind, carriedAcross }',
    '  audio[]                 { at, layer: voice|music|sfx|ambience|silence, description }',
    '  voice[]                 { span, text, delivery }',
    '  music[]                 { span, function, change }',
    '  sfx[]                   { at, description, attachedTo }',
    '  sync[]                  { at, visualEvent, audioEvent, offsetMs, relationship }',
    '  cognitiveLoad[]         { span, level, competingFor:[] }',
    '  heroMoments[]           { span, subject, setup }',
    '  memorability            { images:[{at,description}] }',
    '  comprehension           { understoodProposition, confusions:[{at,problem}], clearBy }',
    '  limitations[]           plain strings',
    '  source                  { durationSeconds }',
    '',
    'In "sync", offsetMs is signed: negative means the sound leads the picture (anticipates it),',
    'positive means it follows (resolves it).',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Drops list entries that do not validate, keeping everything that does.
 *
 * The reason travels with the count. "Three beats were dropped" tells an
 * operator that something is wrong and nothing about what; "three beats were
 * dropped: evidence Required at beats.evidence" tells them whether the model
 * is drifting or the schema is too strict, which are opposite fixes.
 */
function salvage(candidate: Record<string, unknown>, error: z.ZodError): Record<string, unknown> {
  const dropped = new Map<string, { count: number; reasons: Set<string> }>();
  const copy = { ...candidate };

  for (const issue of error.issues) {
    const [key, index] = issue.path;
    if (typeof key !== 'string' || typeof index !== 'number') continue;
    const list = copy[key];
    if (!Array.isArray(list)) continue;
    // Marked rather than spliced: the indices in the remaining issues still
    // refer to the original positions.
    const alreadyGone = list[index] === undefined;
    list[index] = undefined;
    const entry = dropped.get(key) ?? { count: 0, reasons: new Set<string>() };
    if (!alreadyGone) entry.count += 1;
    entry.reasons.add(`${issue.path.slice(2).join('.') || '(entry)'}: ${issue.message}`);
    dropped.set(key, entry);
  }

  for (const [key, { count, reasons }] of dropped) {
    const list = copy[key];
    if (Array.isArray(list)) copy[key] = list.filter((entry) => entry !== undefined);
    const limitations = Array.isArray(copy['limitations']) ? (copy['limitations'] as string[]) : [];
    copy['limitations'] = [
      ...limitations,
      `${count} ${key} ${count === 1 ? 'entry was' : 'entries were'} dropped — ` +
        [...reasons].slice(0, 3).join('; '),
    ];
  }

  // A key that is not a list and did not validate is removed outright rather
  // than coerced, so a malformed narrative becomes an absent one.
  for (const issue of error.issues) {
    const [key] = issue.path;
    if (
      typeof key === 'string' &&
      !Array.isArray(copy[key]) &&
      key !== 'source' &&
      key !== 'depth'
    ) {
      copy[key] =
        key === 'narrative' || key === 'memorability' || key === 'comprehension' ? null : copy[key];
    }
  }
  return copy;
}

/**
 * Keeps the analyst's own word for every field that has a closed vocabulary.
 *
 * The vocabularies fall back rather than refuse, which is what stops a
 * synonym costing a whole observation — but a fallback that silently
 * rewrites `zoom` as `other` has quietly lost the most specific thing the
 * analyst said. Copied here, before validation, so the coerced value and the
 * reported one sit side by side and a reader can tell which is which.
 */
function keepReportedWords(object: Record<string, unknown>): Record<string, unknown> {
  const fields: [string, string, string][] = [
    ['boundaries', 'kind', 'reportedKind'],
    ['beats', 'primaryCognitiveJob', 'reportedCognitiveJob'],
    ['typography', 'role', 'reportedRole'],
    ['camera', 'move', 'reportedMove'],
    ['transitions', 'kind', 'reportedKind'],
    ['audio', 'layer', 'reportedLayer'],
    ['cognitiveLoad', 'level', 'reportedLevel'],
  ];
  const copy = { ...object };
  for (const [list, from, to] of fields) {
    const entries = copy[list];
    if (!Array.isArray(entries)) continue;
    copy[list] = entries.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const record = entry as Record<string, unknown>;
      const word = record[from];
      return typeof word === 'string' ? { ...record, [to]: word.slice(0, 80) } : record;
    });
  }
  return copy;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** The version in a model name, so a catalogue can be sorted newest first. */
function versionOf(name: string): number {
  const found = /gemini-(\d+)(?:\.(\d+))?/.exec(name);
  if (!found) return 0;
  return Number(found[1]) * 100 + Number(found[2] ?? 0);
}

function mimeFor(file: string): string {
  const extension = path.extname(file).toLowerCase();
  const known: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.m4v': 'video/x-m4v',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.avi': 'video/x-msvideo',
  };
  return known[extension] ?? 'video/mp4';
}
