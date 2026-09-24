import { existsSync } from 'node:fs';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeDataUrl, isPrivateAddress, safeStem, sniffBytes, stageAssets } from '../assets.ts';

/**
 * Bringing a film's pictures into the render project.
 *
 * Every file is fetched before the render, identified by its bytes rather
 * than its name, and measured. The addresses come from two places — our own
 * storage, trusted, and a customer's site, not — and only ours may point at
 * this machine.
 */
const ffprobe = [
  process.env.ACT_ONE_FFPROBE_PATH,
  path.resolve('node_modules/@remotion/compositor-linux-x64-gnu/ffprobe'),
  path.resolve('node_modules/@remotion/compositor-darwin-arm64/ffprobe'),
].find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!)) ?? 'ffprobe';

let server: Server;
let base = '';
let png: Buffer;

beforeAll(async () => {
  png = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#224466' } }).png().toBuffer();
  server = createServer((request, response) => {
    switch (request.url) {
      case '/shot.png':
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end(png);
        return;
      case '/lies.png':
        response.writeHead(200, { 'content-type': 'image/png' });
        response.end('<html>not a picture</html>');
        return;
      case '/huge.png':
        response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(50 * 1024 * 1024) });
        response.end(png);
        return;
      default:
        response.writeHead(404);
        response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function project(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'act-one-hf-assets-'));
}

describe('a file is what its bytes say', () => {
  const head = (text: string) => Buffer.from(text, 'latin1');
  it('recognises the pictures and clips a film places', () => {
    expect(sniffBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toEqual({ kind: 'image', extension: 'png' });
    expect(sniffBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ kind: 'image', extension: 'jpg' });
    expect(sniffBytes(head('GIF89a'))).toEqual({ kind: 'image', extension: 'gif' });
    expect(sniffBytes(head('RIFF\0\0\0\0WEBPVP8 '))).toEqual({ kind: 'image', extension: 'webp' });
    expect(sniffBytes(head('\0\0\0\x1cftypavif'))).toEqual({ kind: 'image', extension: 'avif' });
    expect(sniffBytes(head('\0\0\0\x18ftypmp42'))).toEqual({ kind: 'video', extension: 'mp4' });
    expect(sniffBytes(head('\0\0\0\x14ftypqt  '))).toEqual({ kind: 'video', extension: 'mov' });
    expect(sniffBytes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toEqual({ kind: 'video', extension: 'webm' });
    expect(sniffBytes(head('<?xml version="1.0"?>\n<!-- mark -->\n<svg xmlns="http://www.w3.org/2000/svg">'))).toEqual({ kind: 'image', extension: 'svg' });
  });

  it('refuses what is not', () => {
    expect(sniffBytes(head('<!doctype html><html>'))).toBeNull();
    expect(sniffBytes(head('%PDF-1.7'))).toBeNull();
    expect(sniffBytes(Buffer.alloc(0))).toBeNull();
  });
});

describe('addresses the worker must not be made to read', () => {
  it('are the private, local and reserved ones', () => {
    for (const address of ['10.0.0.1', '127.0.0.1', '0.0.0.0', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe('file names', () => {
  it('are never paths, never hidden, and never shared by two ids', () => {
    expect(safeStem('ast_01HX')).toBe('ast_01HX');
    expect(safeStem('../../etc/passwd')).toMatch(/^etc_passwd-[a-f0-9]{10}$/);
    expect(safeStem('.hidden')).toMatch(/^hidden-[a-f0-9]{10}$/);
    expect(safeStem('a/b')).not.toBe(safeStem('a_b'));
    expect(safeStem('')).toMatch(/^asset-[a-f0-9]{10}$/);
  });
});

describe('an inline logo', () => {
  it('is decoded, base64 or not, within the size cap', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(decodeDataUrl(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, 1024).toString()).toBe(svg);
    expect(decodeDataUrl(`data:image/svg+xml,${encodeURIComponent(svg)}`, 1024).toString()).toBe(svg);
    expect(() => decodeDataUrl(`data:image/png;base64,${'A'.repeat(4000)}`, 1024)).toThrow(/larger than/);
    expect(() => decodeDataUrl('data:nothing', 1024)).toThrow(/not a data address/);
  });
});

describe('staging a film’s files', () => {
  it('fetches, identifies and measures what our own storage serves, even on this machine', async () => {
    const dir = await project();
    const { staged, failed } = await stageAssets([{ id: 'ast_shot', url: `${base}/shot.png`, trusted: true }], dir, { ffprobePath: ffprobe });
    expect(failed).toEqual([]);
    expect(staged.get('ast_shot')).toMatchObject({ path: 'assets/ast_shot.png', kind: 'image', format: 'png', width: 64, height: 40, bytes: png.length });
    expect(await readdir(path.join(dir, 'assets'))).toEqual(['ast_shot.png']);
  });

  it('refuses an address from a customer’s site that points at this machine', async () => {
    const { staged, failed } = await stageAssets([{ id: 'brand-logo', url: `${base}/shot.png`, trusted: false }], await project(), { ffprobePath: ffprobe });
    expect(staged.size).toBe(0);
    expect(failed[0]!.reason).toMatch(/private or local address/);
    // The failure names where the file was, never the token a signed address carries.
    expect(failed[0]!.url).not.toContain('shot.png?');
  });

  it('refuses a public address that redirects to a private one', async () => {
    const hops: string[] = [];
    const fetchImpl = (async (input: URL | string) => {
      const url = String(input);
      hops.push(url);
      if (url.startsWith('http://93.184.216.34/')) return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
      return new Response(new Uint8Array(png), { status: 200 });
    }) as typeof fetch;
    const { failed } = await stageAssets([{ id: 'brand-logo', url: 'http://93.184.216.34/logo.png', trusted: false }], await project(), { ffprobePath: ffprobe, fetchImpl });
    expect(failed[0]!.reason).toMatch(/private or local address/);
    expect(hops).toEqual(['http://93.184.216.34/logo.png']);
  });

  it('follows a public redirect to a public address', async () => {
    const fetchImpl = (async (input: URL | string) =>
      String(input).endsWith('/old.png')
        ? new Response(null, { status: 301, headers: { location: '/new.png' } })
        : new Response(new Uint8Array(png), { status: 200 })) as typeof fetch;
    const { staged } = await stageAssets([{ id: 'brand-logo', url: 'http://93.184.216.34/old.png', trusted: false }], await project(), { ffprobePath: ffprobe, fetchImpl });
    expect(staged.get('brand-logo')?.kind).toBe('image');
  });

  it('refuses a local file unless our own storage named it', async () => {
    const dir = await project();
    const file = path.join(dir, 'local.png');
    await writeFile(file, png);
    const untrusted = await stageAssets([{ id: 'x', url: pathToFileURL(file).href, trusted: false }], await project(), { ffprobePath: ffprobe });
    expect(untrusted.failed[0]!.reason).toMatch(/untrusted/);
    const trusted = await stageAssets([{ id: 'x', url: pathToFileURL(file).href, trusted: true }], await project(), { ffprobePath: ffprobe });
    expect(trusted.staged.get('x')?.kind).toBe('image');
  });

  it('refuses a file that is not a picture, whatever it is called, and one past the size cap', async () => {
    const { failed } = await stageAssets(
      [
        { id: 'ast_lies', url: `${base}/lies.png`, trusted: true },
        { id: 'ast_huge', url: `${base}/huge.png`, trusted: true },
        { id: 'ast_gone', url: `${base}/gone.png`, trusted: true },
        { id: 'ast_ftp', url: 'ftp://example.com/x.png', trusted: true },
      ],
      await project(),
      { ffprobePath: ffprobe, limits: { maxImageBytes: 1024 * 1024, maxVideoBytes: 1024 * 1024 } },
    );
    expect(Object.fromEntries(failed.map((failure) => [failure.id, failure.reason]))).toEqual({
      ast_ftp: 'unsupported scheme ftp:',
      ast_gone: 'HTTP 404',
      ast_huge: 'larger than 1 MB',
      ast_lies: 'not a picture or a clip this engine can place',
    });
  });

  it('stages an inline SVG logo without fetching anything', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100"/></svg>';
    const { staged } = await stageAssets(
      [{ id: 'brand-logo', url: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, trusted: false }],
      await project(),
      { ffprobePath: ffprobe, fetchImpl: (() => { throw new Error('nothing may be fetched'); }) as unknown as typeof fetch },
    );
    expect(staged.get('brand-logo')).toMatchObject({ path: 'assets/brand-logo.svg', kind: 'image', width: 300, height: 100 });
  });
});
