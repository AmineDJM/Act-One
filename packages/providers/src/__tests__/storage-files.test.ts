import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFsStorageProvider, SupabaseStorageProvider, sha256File } from '../index.ts';

/**
 * Films are stored as files, never as one buffer: the contract both storage
 * providers keep for anything too large to hold in memory.
 */
const FILM = new Uint8Array(Array.from({ length: 300_000 }, (_, i) => (i * 31 + 7) % 251));
const DIGEST = createHash('sha256').update(FILM).digest('hex');

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'act-one-storage-files-'));
}

describe('sha256File', () => {
  it('reports the digest put() reports for the same bytes', async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, 'film.mp4'), FILM);
    expect(await sha256File(path.join(dir, 'film.mp4'))).toBe(DIGEST);
  });
});

describe('LocalFsStorageProvider files', () => {
  it('stores a file and writes it back out unchanged', async () => {
    const dir = await scratch();
    const storage = new LocalFsStorageProvider({ root: path.join(dir, 'store') });
    await writeFile(path.join(dir, 'in.mp4'), FILM);
    const stored = await storage.putFile('benchmarks/b1/source.mp4', path.join(dir, 'in.mp4'), { contentType: 'video/mp4' });
    expect(stored).toMatchObject({ key: 'benchmarks/b1/source.mp4', bytes: FILM.byteLength, contentType: 'video/mp4', checksum: DIGEST });
    await storage.getToFile('benchmarks/b1/source.mp4', path.join(dir, 'out', 'film.mp4'));
    expect(new Uint8Array(await readFile(path.join(dir, 'out', 'film.mp4')))).toEqual(FILM);
  });

  it('refuses a key that escapes the root, for files as for bytes', async () => {
    const dir = await scratch();
    const storage = new LocalFsStorageProvider({ root: path.join(dir, 'store') });
    await writeFile(path.join(dir, 'in.mp4'), FILM);
    await expect(storage.putFile('../outside.mp4', path.join(dir, 'in.mp4'))).rejects.toThrow(/escapes the storage root/);
    await expect(storage.getToFile('../../etc/passwd', path.join(dir, 'x'))).rejects.toThrow(/escapes the storage root/);
  });
});

type Received = { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer };

describe('SupabaseStorageProvider files', () => {
  let server: Server;
  let url: string;
  let received: Received[];
  /** What the fake store answers, in order; the last one repeats. */
  let script: { status: number; body?: Uint8Array | string; truncate?: boolean }[];

  beforeEach(async () => {
    received = [];
    script = [{ status: 200, body: '{"Key":"ok"}' }];
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: Buffer.concat(chunks) });
        const next = script.length > 1 ? script.shift()! : script[0]!;
        if (next.truncate) {
          // Promise more than is sent, then drop the connection: a download cut halfway.
          response.writeHead(next.status, { 'content-length': String(FILM.byteLength) });
          response.write(Buffer.from(FILM.subarray(0, 1000)));
          response.destroy();
          return;
        }
        response.writeHead(next.status, { 'content-type': 'application/octet-stream' });
        response.end(next.body === undefined ? '' : Buffer.from(next.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const provider = () => new SupabaseStorageProvider({ url, serviceKey: 'service-key', bucket: 'films' });

  it('streams the file with its length, and reports the digest of what was sent', async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, 'in.mp4'), FILM);
    const stored = await provider().putFile('benchmarks/b1/source.mp4', path.join(dir, 'in.mp4'), { contentType: 'video/mp4' });
    expect(stored).toMatchObject({ bytes: FILM.byteLength, checksum: DIGEST, url: null });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/storage/v1/object/films/benchmarks/b1/source.mp4' });
    expect(received[0]!.headers['content-length']).toBe(String(FILM.byteLength));
    expect(received[0]!.headers['x-upsert']).toBe('true');
    expect(received[0]!.headers['authorization']).toBe('Bearer service-key');
    expect(new Uint8Array(received[0]!.body)).toEqual(FILM);
  });

  it('retries a transient failure by reopening the file, so the second attempt sends everything', async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, 'in.mp4'), FILM);
    script = [{ status: 503, body: 'busy' }, { status: 200, body: '{}' }];
    await provider().putFile('k.mp4', path.join(dir, 'in.mp4'));
    expect(received).toHaveLength(2);
    expect(new Uint8Array(received[1]!.body)).toEqual(FILM);
  });

  it('does not retry a refusal', async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, 'in.mp4'), FILM);
    script = [{ status: 413, body: 'Payload too large' }];
    await expect(provider().putFile('k.mp4', path.join(dir, 'in.mp4'))).rejects.toThrow(/HTTP 413 Payload too large/);
    expect(received).toHaveLength(1);
  });

  it('streams an object to a file', async () => {
    const dir = await scratch();
    script = [{ status: 200, body: FILM }];
    await provider().getToFile('benchmarks/b1/source.mp4', path.join(dir, 'nested', 'film.mp4'));
    expect(new Uint8Array(await readFile(path.join(dir, 'nested', 'film.mp4')))).toEqual(FILM);
    expect(received[0]).toMatchObject({ method: 'GET', url: '/storage/v1/object/films/benchmarks/b1/source.mp4' });
  });

  it('never leaves half a film behind when a download is cut, and gets it whole on the retry', async () => {
    const dir = await scratch();
    script = [{ status: 200, truncate: true }, { status: 200, body: FILM }];
    await provider().getToFile('k.mp4', path.join(dir, 'film.mp4'));
    expect(received).toHaveLength(2);
    expect(new Uint8Array(await readFile(path.join(dir, 'film.mp4')))).toEqual(FILM);
  });

  it('fails on a missing object without writing anything', async () => {
    const dir = await scratch();
    script = [{ status: 404, body: '{"error":"not_found"}' }];
    await expect(provider().getToFile('missing.mp4', path.join(dir, 'film.mp4'))).rejects.toThrow(/HTTP 404/);
    expect(existsSync(path.join(dir, 'film.mp4'))).toBe(false);
    expect(received).toHaveLength(1);
  });
});
