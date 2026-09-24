import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * The film's pictures and clips, copied into the render project.
 *
 * The Remotion engine hands Chrome signed URLs and lets it fetch them mid
 * render. Here every file is fetched first, checked, and served from the
 * project directory, for three reasons: the render runs offline behind a
 * content policy that forbids the network; a file is what its bytes say, not
 * what its URL or the storyboard claims, so a clip that turns out to be a
 * still is known before any scene is written around it; and a picture that
 * cannot be fetched is reported by id before the render, not discovered as an
 * empty frame after it.
 */
export type StagedAsset = {
  id: string;
  /** Project-relative path: the only way a scene may refer to this file. */
  path: string;
  kind: 'image' | 'video';
  format: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  bytes: number;
};

export type AssetFailure = { id: string; url: string; reason: string };

export type AssetLimits = {
  maxImageBytes: number;
  maxVideoBytes: number;
  timeoutMs: number;
  concurrency: number;
};

export const DEFAULT_ASSET_LIMITS: AssetLimits = {
  // Captures of whole pages run to tens of megapixels; clips to a few hundred megabytes.
  maxImageBytes: 96 * 1024 * 1024,
  maxVideoBytes: 768 * 1024 * 1024,
  timeoutMs: 180_000,
  concurrency: 4,
};

export type AssetRequest = {
  id: string;
  url: string;
  /**
   * Whether the URL came from our own storage. Only those may point at a
   * private address: the local storage provider serves from 127.0.0.1. A URL
   * read off a customer's site is fetched only from a public address, so a
   * logo address cannot be used to make the worker read its own network.
   */
  trusted: boolean;
};

export type StageResult = { staged: Map<string, StagedAsset>; failed: AssetFailure[] };

export async function stageAssets(
  requests: AssetRequest[],
  projectDir: string,
  options: { ffprobePath: string; limits?: Partial<AssetLimits>; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<StageResult> {
  const limits = { ...DEFAULT_ASSET_LIMITS, ...options.limits };
  const assetsDir = path.join(projectDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const unique = [...new Map(requests.map((request) => [request.id, request])).values()];
  const staged = new Map<string, StagedAsset>();
  const failed: AssetFailure[] = [];

  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const request = unique[next++]!;
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
      try {
        staged.set(request.id, await stageOne(request, assetsDir, limits, options));
      } catch (error) {
        failed.push({ id: request.id, url: redact(request.url), reason: (error as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limits.concurrency, unique.length)) }, worker));
  return { staged, failed: failed.sort((a, b) => a.id.localeCompare(b.id)) };
}

async function stageOne(
  request: AssetRequest,
  assetsDir: string,
  limits: AssetLimits,
  options: { ffprobePath: string; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<StagedAsset> {
  const stem = safeStem(request.id);
  const downloadPath = path.join(assetsDir, `${stem}.download`);
  const cap = Math.max(limits.maxImageBytes, limits.maxVideoBytes);

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new Error('not a URL');
  }

  try {
    if (url.protocol === 'data:') {
      // Self-contained, so nothing is fetched: most sites ship their mark inline, and the brand reader keeps it that way.
      const bytes = decodeDataUrl(request.url, cap);
      await writeFile(downloadPath, bytes, { mode: 0o600 });
    } else if (url.protocol === 'file:') {
      // Only our own storage may hand over a path on this machine.
      if (!request.trusted) throw new Error('refused: a local file named by an untrusted address');
      const source = fileURLToPath(url);
      const size = (await stat(source)).size;
      if (size > cap) throw new Error(`larger than ${formatBytes(cap)}`);
      await copyFile(source, downloadPath);
    } else if (url.protocol === 'http:' || url.protocol === 'https:') {
      await download(url, downloadPath, cap, limits.timeoutMs, request.trusted, options);
    } else {
      throw new Error(`unsupported scheme ${url.protocol}`);
    }

    const bytes = (await stat(downloadPath)).size;
    if (bytes === 0) throw new Error('empty file');
    const sniffed = await sniff(downloadPath);
    if (!sniffed) throw new Error('not a picture or a clip this engine can place');
    const limit = sniffed.kind === 'video' ? limits.maxVideoBytes : limits.maxImageBytes;
    if (bytes > limit) throw new Error(`${sniffed.kind} larger than ${formatBytes(limit)}`);

    const finalName = `${stem}.${sniffed.extension}`;
    const finalPath = path.join(assetsDir, finalName);
    await rename(downloadPath, finalPath);

    const measured =
      sniffed.kind === 'video'
        ? await probeVideo(options.ffprobePath, finalPath)
        : await measureImage(finalPath);

    return {
      id: request.id,
      path: `assets/${finalName}`,
      kind: sniffed.kind,
      format: sniffed.extension,
      width: measured.width,
      height: measured.height,
      durationSeconds: measured.durationSeconds,
      bytes,
    };
  } finally {
    await rm(downloadPath, { force: true });
  }
}

const MAX_REDIRECTS = 5;

async function download(
  url: URL,
  target: string,
  cap: number,
  timeoutMs: number,
  trusted: boolean,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<void> {
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const fetcher = options.fetchImpl ?? fetch;

  /*
   * Redirects are followed by hand for an address we did not issue, because
   * the check that refuses a private address has to see every hop: a public
   * page that answers 302 with a link to the metadata service is the oldest
   * way round a check made only on the first address.
   */
  let current = url;
  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!trusted) await refusePrivateAddress(current);
    response = await fetcher(current, { signal, redirect: trusted ? 'follow' : 'manual' });
    if (trusted || response.status < 300 || response.status > 399) break;
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error(`HTTP ${response.status} without a location`);
    current = new URL(location, current);
    if (current.protocol !== 'http:' && current.protocol !== 'https:') throw new Error(`redirected to ${current.protocol}`);
    response = null;
  }
  if (!response) throw new Error(`more than ${MAX_REDIRECTS} redirects`);
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > cap) throw new Error(`larger than ${formatBytes(cap)}`);

  let received = 0;
  const counted = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
  counted.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received > cap) counted.destroy(new Error(`larger than ${formatBytes(cap)}`));
  });
  await pipeline(counted, createWriteStream(target, { mode: 0o600 }));
}

/**
 * Refuses addresses the worker should never be made to read on a customer's behalf.
 *
 * Checked on every address the name resolves to. It narrows rather than closes
 * the window: a name can resolve differently a moment later. The render itself
 * runs with the network forbidden by content policy, which is the real wall.
 */
async function refusePrivateAddress(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0) throw new Error('host did not resolve');
  for (const address of addresses) {
    if (isPrivateAddress(address)) throw new Error('refused: a private or local address');
  }
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number, number, number];
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice('::ffff:'.length));
  return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('ff');
}

type Sniffed = { kind: 'image' | 'video'; extension: string };

/** What a file is, from its first bytes. */
export async function sniff(file: string): Promise<Sniffed | null> {
  const handle = await open(file, 'r');
  let head: Buffer;
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    head = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  return sniffBytes(head);
}

export function sniffBytes(head: Buffer): Sniffed | null {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { kind: 'image', extension: 'png' };
  if (starts(0xff, 0xd8, 0xff)) return { kind: 'image', extension: 'jpg' };
  if (starts(0x47, 0x49, 0x46, 0x38)) return { kind: 'image', extension: 'gif' };
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { kind: 'image', extension: 'webp' };
  }
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'video', extension: 'webm' };
  if (head.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = head.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', extension: 'avif' };
    if (brand === 'qt  ') return { kind: 'video', extension: 'mov' };
    return { kind: 'video', extension: 'mp4' };
  }
  const text = head.toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)) {
    return { kind: 'image', extension: 'svg' };
  }
  return null;
}

async function measureImage(file: string): Promise<{ width: number | null; height: number | null; durationSeconds: null }> {
  try {
    const meta = await sharp(file, { limitInputPixels: 20_000 * 20_000 }).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null, durationSeconds: null };
  } catch {
    // Placed without its size rather than refused: the scene can still frame it by the box it is given.
    return { width: null, height: null, durationSeconds: null };
  }
}

function probeVideo(ffprobePath: string, file: string): Promise<{ width: number | null; height: number | null; durationSeconds: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      file,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    child.on('error', (error) => reject(new Error(`ffprobe could not start: ${error.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`not a playable clip: ${err.trim().split('\n').pop() ?? `ffprobe exited ${code}`}`));
        return;
      }
      try {
        const parsed = JSON.parse(out) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
        const stream = parsed.streams?.[0];
        if (!stream) {
          reject(new Error('a video container with no picture in it'));
          return;
        }
        const duration = Number(parsed.format?.duration);
        resolve({
          width: stream.width ?? null,
          height: stream.height ?? null,
          durationSeconds: Number.isFinite(duration) ? duration : null,
        });
      } catch {
        reject(new Error('ffprobe answered with something that is not JSON'));
      }
    });
  });
}

/**
 * An id as a file name: never a path, never hidden, never empty, and never
 * the same name for two ids. An id that had to be changed to be safe carries
 * a short digest of itself, so "a/b" and "a_b" cannot land on one file.
 */
export function safeStem(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '').slice(0, 80);
  if (cleaned === id && cleaned.length > 0) return cleaned;
  const digest = createHash('sha256').update(id).digest('hex').slice(0, 10);
  return `${cleaned.length > 0 ? cleaned : 'asset'}-${digest}`;
}

/** The bytes of a `data:` address, refused past the size cap. */
export function decodeDataUrl(address: string, cap: number): Buffer {
  const comma = address.indexOf(',');
  if (!address.startsWith('data:') || comma < 0) throw new Error('not a data address');
  const header = address.slice('data:'.length, comma);
  const payload = address.slice(comma + 1);
  // Base64 is four characters for three bytes; checked before decoding so a huge address is never expanded.
  if (payload.length > Math.ceil((cap * 4) / 3) + 4) throw new Error(`larger than ${formatBytes(cap)}`);
  const bytes = /;base64$/i.test(header)
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  if (bytes.length > cap) throw new Error(`larger than ${formatBytes(cap)}`);
  return bytes;
}

/** Signed URLs carry tokens; a failure report carries only where the file was. */
function redact(url: string): string {
  if (url.startsWith('data:')) return 'data:…';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.split('/').slice(0, 2).join('/')}/…`;
  } catch {
    return '(unparseable)';
  }
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
