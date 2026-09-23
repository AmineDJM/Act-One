import { readFile, stat } from 'node:fs/promises';
import { httpRequest, sleep } from '../http.ts';
import { ProviderError, type CallContext, type CostSink, type ProviderHealth } from '../types.ts';

/**
 * Gemini, watching and listening to a film.
 *
 * Used for what software cannot measure — what a film means, why a cut
 * works — and never for what it can. The video goes up once through the Files
 * API and every pass refers to it by its URI; a pass can narrow the film to a
 * window and choose how densely it is sampled, or be handed exact frames as
 * images when a question needs the film's own frame grid.
 *
 * Every response is structured JSON against a schema the caller supplies, and
 * a response the model truncated, refused or left empty is an error rather
 * than an empty answer: the caller decides whether that makes its analysis
 * partial, and it must never look like the model had nothing to say.
 */
export type GeminiConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  costSink?: CostSink;
};

export type GeminiFile = { name: string; uri: string; mimeType: string; expiresAt: string | null };

export type VideoPart = {
  kind: 'video';
  file: GeminiFile;
  /** Frames per second the model samples; its default is one. */
  fps?: number;
  startSeconds?: number;
  endSeconds?: number;
};
export type ImagePart = { kind: 'image'; mimeType: 'image/jpeg' | 'image/png'; data: Uint8Array };
export type TextPart = { kind: 'text'; text: string };
export type Part = VideoPart | ImagePart | TextPart;

export type GenerateRequest = {
  parts: Part[];
  system?: string;
  /** JSON Schema the answer must follow. */
  schema: Record<string, unknown>;
  temperature?: number;
  mediaResolution?: 'low' | 'medium' | 'high';
  maxOutputTokens?: number;
  model?: string;
  /** For the ledger: which pass this was. */
  label: string;
};

export type GenerateResult = {
  json: unknown;
  text: string;
  model: string;
  usage: { promptTokens: number; outputTokens: number; videoTokens: number; totalTokens: number };
  costUsd: number;
  finishReason: string | null;
};

/** USD per million tokens, input and output, at up to 200k prompt tokens. */
const RATES: Record<string, { input: number; output: number }> = {
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
  'gemini-3.5-flash': { input: 0.3, output: 2.5 },
};
const DEFAULT_MODEL = 'gemini-3.1-pro-preview';

export class GeminiVideoProvider {
  readonly name = 'gemini';
  readonly kind = 'llm' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  readonly model: string;
  private readonly costSink: CostSink | undefined;

  constructor(config: GeminiConfig = {}) {
    // The key may be empty: an egress proxy that injects it is a supported deployment.
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
    this.baseUrl = (config.baseUrl ?? process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    this.model = config.model ?? process.env.ACT_ONE_GEMINI_MODEL ?? DEFAULT_MODEL;
    this.costSink = config.costSink;
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      await httpRequest(this.name, `${this.baseUrl}/v1beta/models?pageSize=1`, { headers: this.headers(), timeoutMs: 15_000, attempts: 1 });
      return { provider: this.name, kind: 'llm', healthy: true, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
    } catch (error) {
      return { provider: this.name, kind: 'llm', healthy: false, checkedAt: new Date().toISOString(), message: (error as Error).message.slice(0, 300) };
    }
  }

  /**
   * One film, uploaded once. Resumable protocol: announce, then send the bytes
   * in a single finalising request, then wait until the service has processed
   * the video — a file that is still PROCESSING cannot be watched.
   */
  async uploadVideo(path: string, mimeType: string, displayName: string, context: CallContext): Promise<GeminiFile> {
    const size = (await stat(path)).size;
    let uploadUrl = '';
    await httpRequest(this.name, `${this.baseUrl}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: { file: { display_name: displayName.slice(0, 120) } },
      timeoutMs: 60_000,
      attempts: 3,
      expect: 'text',
      onResponse: (response) => {
        uploadUrl = response.headers.get('x-goog-upload-url') ?? '';
      },
      ...(context.signal ? { signal: context.signal } : {}),
    });
    if (!uploadUrl) throw new ProviderError(this.name, 'The upload was not given an address to send the film to.', { retryable: true });
    const bytes = new Uint8Array(await readFile(path));
    const uploaded = await httpRequest<{ file?: RawFile }>(this.name, uploadUrl, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
      body: bytes,
      timeoutMs: 15 * 60_000,
      attempts: 1,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const file = uploaded?.file;
    if (!file?.name || !file.uri) throw new ProviderError(this.name, 'The upload finished without naming the file.', { retryable: true });
    return this.waitUntilActive(file, context);
  }

  /** A file uploaded earlier, if it still exists and is usable. Files expire after two days. */
  async fileStatus(name: string, context: CallContext): Promise<GeminiFile | null> {
    try {
      const file = await httpRequest<RawFile>(this.name, `${this.baseUrl}/v1beta/${name}`, {
        headers: this.headers(),
        timeoutMs: 30_000,
        attempts: 2,
        ...(context.signal ? { signal: context.signal } : {}),
      });
      if (!file || file.state === 'FAILED') return null;
      if (file.state !== 'ACTIVE') return this.waitUntilActive(file, context);
      return toFile(file);
    } catch (error) {
      if (error instanceof ProviderError && (error.status === 404 || error.status === 403)) return null;
      throw error;
    }
  }

  private async waitUntilActive(file: RawFile, context: CallContext): Promise<GeminiFile> {
    let current = file;
    const deadline = Date.now() + 10 * 60_000;
    while (current.state === 'PROCESSING') {
      if (Date.now() > deadline) throw new ProviderError(this.name, 'The film was still being processed after ten minutes.', { retryable: true });
      if (context.signal?.aborted) throw new ProviderError(this.name, 'Cancelled.', { retryable: false });
      await sleep(3_000);
      current = await httpRequest<RawFile>(this.name, `${this.baseUrl}/v1beta/${current.name}`, {
        headers: this.headers(),
        timeoutMs: 30_000,
        attempts: 3,
        ...(context.signal ? { signal: context.signal } : {}),
      });
    }
    if (current.state !== 'ACTIVE') {
      throw new ProviderError(this.name, `The film could not be processed (${current.state ?? 'no state'}).`, { retryable: false });
    }
    return toFile(current);
  }

  async generate(request: GenerateRequest, context: CallContext): Promise<GenerateResult> {
    const model = request.model ?? this.model;
    const body = {
      contents: [{ role: 'user', parts: request.parts.map(toPart) }],
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: request.schema,
        temperature: request.temperature ?? 0.2,
        ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
        ...(request.mediaResolution ? { mediaResolution: `MEDIA_RESOLUTION_${request.mediaResolution.toUpperCase()}` } : {}),
      },
    };
    const response = await httpRequest<RawResponse>(this.name, `${this.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: this.headers(),
      body,
      timeoutMs: 10 * 60_000,
      attempts: 3,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const usage = {
      promptTokens: response?.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: (response?.usageMetadata?.candidatesTokenCount ?? 0) + (response?.usageMetadata?.thoughtsTokenCount ?? 0),
      videoTokens: (response?.usageMetadata?.promptTokensDetails ?? []).filter((d) => d.modality === 'VIDEO').reduce((sum, d) => sum + (d.tokenCount ?? 0), 0),
      totalTokens: response?.usageMetadata?.totalTokenCount ?? 0,
    };
    const rate = RATES[model] ?? RATES[DEFAULT_MODEL]!;
    const costUsd = (usage.promptTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
    await this.costSink?.record({
      provider: this.name,
      model,
      operation: 'llm.vision',
      estimatedCostUsd: costUsd,
      actualCostUsd: costUsd,
      quantity: usage.totalTokens,
      unit: 'token',
      costBasis: RATES[model] ? 'listed' : 'unknown_price',
      metadata: { projectId: context.projectId ?? null, label: request.label, videoTokens: usage.videoTokens },
    });
    const candidate = response?.candidates?.[0];
    const finishReason = candidate?.finishReason ?? null;
    if (response?.promptFeedback?.blockReason) {
      throw new ProviderError(this.name, `The request was refused (${response.promptFeedback.blockReason}).`, { retryable: false });
    }
    if (finishReason && finishReason !== 'STOP') {
      throw new ProviderError(this.name, `The answer did not finish (${finishReason}) and cannot be used as a complete answer.`, {
        retryable: finishReason === 'MAX_TOKENS' || finishReason === 'OTHER',
      });
    }
    const text = (candidate?.content?.parts ?? []).filter((part) => typeof part.text === 'string' && !part.thought).map((part) => part.text).join('');
    if (!text.trim()) throw new ProviderError(this.name, 'The model returned no answer.', { retryable: true });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError(this.name, 'The answer was not the JSON that was asked for.', { retryable: true });
    }
    return { json, text, model: response?.modelVersion ?? model, usage, costUsd, finishReason };
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { 'x-goog-api-key': this.apiKey } : {};
  }
}

type RawFile = { name: string; uri: string; mimeType?: string; state?: string; expirationTime?: string };
type RawResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
    promptTokensDetails?: { modality?: string; tokenCount?: number }[];
  };
  modelVersion?: string;
};

function toFile(file: RawFile): GeminiFile {
  return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? 'video/mp4', expiresAt: file.expirationTime ?? null };
}

function toPart(part: Part): Record<string, unknown> {
  if (part.kind === 'text') return { text: part.text };
  if (part.kind === 'image') return { inlineData: { mimeType: part.mimeType, data: Buffer.from(part.data).toString('base64') } };
  const metadata: Record<string, unknown> = {};
  if (part.fps !== undefined) metadata['fps'] = part.fps;
  if (part.startSeconds !== undefined) metadata['startOffset'] = `${part.startSeconds.toFixed(3)}s`;
  if (part.endSeconds !== undefined) metadata['endOffset'] = `${part.endSeconds.toFixed(3)}s`;
  return {
    fileData: { fileUri: part.file.uri, mimeType: part.file.mimeType },
    ...(Object.keys(metadata).length > 0 ? { videoMetadata: metadata } : {}),
  };
}
