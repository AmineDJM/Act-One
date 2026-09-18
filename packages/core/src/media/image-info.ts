/**
 * What an uploaded image is, read from its bytes.
 *
 * A file is what its bytes say, never what its name or the browser's
 * content-type claim: a `.png` that begins with a JPEG marker is a JPEG, and
 * a `.png` that begins with `<html` is not an image at all and is refused.
 * Dimensions come from the same headers, so the library knows the size of
 * every picture without decoding one.
 */
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'svg';

export type ImageInfo = {
  format: ImageFormat;
  contentType: string;
  extension: string;
  width: number | null;
  height: number | null;
};

const CONTENT_TYPES: Record<ImageFormat, { contentType: string; extension: string }> = {
  png: { contentType: 'image/png', extension: 'png' },
  jpeg: { contentType: 'image/jpeg', extension: 'jpg' },
  webp: { contentType: 'image/webp', extension: 'webp' },
  svg: { contentType: 'image/svg+xml', extension: 'svg' },
};

export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const png = readPng(bytes);
  if (png) return png;
  const jpeg = readJpeg(bytes);
  if (jpeg) return jpeg;
  const webp = readWebp(bytes);
  if (webp) return webp;
  return readSvg(bytes);
}

function info(format: ImageFormat, width: number | null, height: number | null): ImageInfo {
  return { format, ...CONTENT_TYPES[format], width, height };
}

function u32be(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
}

function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at]! << 8) + bytes[at + 1]!;
}

function u16le(bytes: Uint8Array, at: number): number {
  return bytes[at]! + (bytes[at + 1]! << 8);
}

function u24le(bytes: Uint8Array, at: number): number {
  return bytes[at]! + (bytes[at + 1]! << 8) + (bytes[at + 2]! << 16);
}

function readPng(bytes: Uint8Array): ImageInfo | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((byte, index) => bytes[index] === byte)) return null;
  // The first chunk is IHDR by specification: length, "IHDR", width, height.
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return info('png', null, null);
  return info('png', u32be(bytes, 16), u32be(bytes, 20));
}

function readJpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Start-of-frame markers carry the dimensions; DHT, JPG and DAC share the range and do not.
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) return info('jpeg', u16be(bytes, at + 7), u16be(bytes, at + 5));
    if (marker === 0xd9 || marker === 0xda) break; // end of image, or the scan: no frame header before it
    if (marker >= 0xd0 && marker <= 0xd7) {
      at += 2; // restart markers carry no length
      continue;
    }
    at += 2 + u16be(bytes, at + 2);
  }
  return info('jpeg', null, null);
}

function readWebp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 30) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') return null;
  const chunk = ascii(12, 16);
  if (chunk === 'VP8 ') return info('webp', u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
  if (chunk === 'VP8L') {
    const bits = bytes[21]! + (bytes[22]! << 8) + (bytes[23]! << 16) + (bytes[24]! << 24);
    return info('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X') return info('webp', u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
  return info('webp', null, null);
}

const SVG_HEAD = /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i;

function readSvg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length === 0) return null;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 4096));
  if (!SVG_HEAD.test(head)) return null;
  const open = head.match(/<svg[^>]*>/i)?.[0] ?? '';
  const size = (attribute: string): number | null => {
    const raw = open.match(new RegExp(`\\s${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    if (!raw) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 && /^[\d.]+(px)?$/.test(raw.trim()) ? Math.round(value) : null;
  };
  let width = size('width');
  let height = size('height');
  if (width === null || height === null) {
    const viewBox = open.match(/\sviewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
    if (viewBox) {
      width ??= Math.round(Number.parseFloat(viewBox[3]!));
      height ??= Math.round(Number.parseFloat(viewBox[4]!));
    }
  }
  return info('svg', width, height);
}

/**
 * Whether an SVG can be served as a picture.
 *
 * An SVG is a document: it can carry script, event handlers, and references
 * to other places. Served from our own origin it would run as us. Anything
 * of the kind is refused at upload rather than stripped — a file rewritten
 * by the uploader is no longer the file the customer chose.
 */
export function svgIsSafe(bytes: Uint8Array): boolean {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const lower = text.toLowerCase();
  if (/<\s*script/.test(lower)) return false;
  if (/<\s*foreignobject/.test(lower)) return false;
  if (/\son[a-z]+\s*=/.test(lower)) return false;
  if (/javascript\s*:/.test(lower)) return false;
  if (/<\s*(iframe|embed|object|meta|link|base)\b/.test(lower)) return false;
  // Anything that reaches out: entities, external references, remote images.
  if (/<!entity/.test(lower)) return false;
  if (/(xlink:href|href)\s*=\s*["']\s*(https?:|\/\/|data:text)/.test(lower)) return false;
  if (/@import|url\(\s*["']?\s*(https?:|\/\/)/.test(lower)) return false;
  return true;
}
