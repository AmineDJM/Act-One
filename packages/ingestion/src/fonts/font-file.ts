import { brotliDecompressSync, inflateSync } from 'node:zlib';

/**
 * What a font file says about itself.
 *
 * Reads only the three tables that matter here — `name` (who made it, under
 * which licence, what the renderer will call it), `OS/2` (weight, width and
 * the embedding permissions its maker declared) and `fvar` (the axes of a
 * variable font) — from TrueType, OpenType, WOFF and WOFF2, with nothing but
 * the platform's own zlib and Brotli. Every offset is bounds-checked and every
 * decompression is capped: a font is a file from somebody else's server.
 */
export type FontFileFormat = 'woff2' | 'woff' | 'truetype' | 'opentype' | 'collection';

export type FontNames = {
  copyright: string | null;
  family: string | null;
  subfamily: string | null;
  fullName: string | null;
  version: string | null;
  postScriptName: string | null;
  trademark: string | null;
  manufacturer: string | null;
  designer: string | null;
  vendorUrl: string | null;
  designerUrl: string | null;
  licenseDescription: string | null;
  licenseUrl: string | null;
  typographicFamily: string | null;
  typographicSubfamily: string | null;
};

export type FontFileInfo = {
  format: FontFileFormat;
  names: FontNames;
  weightClass: number | null;
  widthClass: number | null;
  /** OS/2 `fsType`: the embedding permissions. Null when the table is absent. */
  fsType: number | null;
  vendorId: string | null;
  axes: { tag: string; min: number; default: number; max: number }[];
};

export class FontFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontFileError';
  }
}

const MAX_TABLE_BYTES = 16 * 1024 * 1024;
const MAX_DECOMPRESSED = 64 * 1024 * 1024;
const WANTED = new Set(['name', 'OS/2', 'fvar']);

/** WOFF2's table of known tags, in the specification's order. */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
] as const;

export function detectFontFormat(data: Uint8Array): FontFileFormat | null {
  if (data.byteLength < 12) return null;
  const signature = Buffer.from(data.buffer, data.byteOffset, 4).toString('latin1');
  if (signature === 'wOF2') return 'woff2';
  if (signature === 'wOFF') return 'woff';
  if (signature === 'OTTO') return 'opentype';
  if (signature === 'ttcf') return 'collection';
  if (signature === 'true' || (data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0)) return 'truetype';
  return null;
}

export function inspectFontFile(data: Uint8Array): FontFileInfo {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const format = detectFontFormat(buffer);
  if (!format) throw new FontFileError('Not a font file this reader knows.');

  let tables = new Map<string, Buffer>();
  let effectiveFormat: FontFileFormat = format;
  switch (format) {
    case 'truetype':
    case 'opentype':
      tables = sfntTables(buffer);
      break;
    case 'woff':
      tables = woffTables(buffer);
      effectiveFormat = 'woff';
      break;
    case 'woff2':
      tables = woff2Tables(buffer);
      break;
    case 'collection':
      // A collection holds several fonts; which one a page uses is not in the file.
      break;
  }

  const names = tables.has('name') ? readNames(tables.get('name')!) : emptyNames();
  const os2 = tables.get('OS/2');
  return {
    format: effectiveFormat,
    names,
    weightClass: os2 && os2.length >= 6 ? os2.readUInt16BE(4) : null,
    widthClass: os2 && os2.length >= 8 ? os2.readUInt16BE(6) : null,
    fsType: os2 && os2.length >= 10 ? os2.readUInt16BE(8) : null,
    vendorId: os2 && os2.length >= 62 ? os2.toString('latin1', 58, 62).replace(/[^\x20-\x7e]/g, '').trim() || null : null,
    axes: tables.has('fvar') ? readAxes(tables.get('fvar')!) : [],
  };
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

function slice(buffer: Buffer, offset: number, length: number, what: string): Buffer {
  if (offset < 0 || length < 0 || length > MAX_TABLE_BYTES || offset + length > buffer.length) {
    throw new FontFileError(`${what} lies outside the file.`);
  }
  return buffer.subarray(offset, offset + length);
}

function sfntTables(buffer: Buffer): Map<string, Buffer> {
  const count = buffer.readUInt16BE(4);
  if (count === 0 || count > 512 || 12 + count * 16 > buffer.length) throw new FontFileError('Implausible table directory.');
  const tables = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const tag = buffer.toString('latin1', record, record + 4);
    if (!WANTED.has(tag)) continue;
    tables.set(tag, slice(buffer, buffer.readUInt32BE(record + 8), buffer.readUInt32BE(record + 12), tag));
  }
  return tables;
}

function woffTables(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < 44) throw new FontFileError('Truncated WOFF header.');
  const count = buffer.readUInt16BE(12);
  if (count === 0 || count > 512 || 44 + count * 20 > buffer.length) throw new FontFileError('Implausible WOFF directory.');
  const tables = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const record = 44 + index * 20;
    const tag = buffer.toString('latin1', record, record + 4);
    if (!WANTED.has(tag)) continue;
    const offset = buffer.readUInt32BE(record + 4);
    const compressed = buffer.readUInt32BE(record + 8);
    const original = buffer.readUInt32BE(record + 12);
    if (original > MAX_TABLE_BYTES || compressed > original) throw new FontFileError(`Implausible ${tag} lengths.`);
    const stored = slice(buffer, offset, compressed, tag);
    const table = compressed < original ? inflateSync(stored, { maxOutputLength: original }) : stored;
    if (table.length !== original) throw new FontFileError(`${tag} did not decompress to its declared length.`);
    tables.set(tag, table);
  }
  return tables;
}

function woff2Tables(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < 48) throw new FontFileError('Truncated WOFF2 header.');
  const flavor = buffer.toString('latin1', 4, 8);
  const count = buffer.readUInt16BE(12);
  const totalSfntSize = buffer.readUInt32BE(16);
  const compressedSize = buffer.readUInt32BE(20);
  if (count === 0 || count > 512) throw new FontFileError('Implausible WOFF2 directory.');
  if (flavor === 'ttcf') return new Map();

  type Entry = { tag: string; length: number };
  const entries: Entry[] = [];
  let cursor = 48;
  for (let index = 0; index < count; index += 1) {
    const flags = buffer[cursor];
    if (flags === undefined) throw new FontFileError('Truncated WOFF2 directory.');
    cursor += 1;
    const tagIndex = flags & 0x3f;
    let tag: string;
    if (tagIndex === 63) {
      tag = slice(buffer, cursor, 4, 'tag').toString('latin1');
      cursor += 4;
    } else {
      const known = WOFF2_TAGS[tagIndex];
      if (!known) throw new FontFileError(`Unknown WOFF2 tag index ${tagIndex}.`);
      tag = known;
    }
    const version = (flags >> 6) & 0x03;
    const [origLength, afterOrig] = readBase128(buffer, cursor);
    cursor = afterOrig;
    // glyf and loca are transformed unless the version says null (3); every
    // other table is transformed unless the version says null (0).
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    let length = origLength;
    if (transformed) {
      const [transformLength, afterTransform] = readBase128(buffer, cursor);
      cursor = afterTransform;
      length = transformLength;
    }
    entries.push({ tag, length });
  }

  const total = entries.reduce((sum, entry) => sum + entry.length, 0);
  if (total > MAX_DECOMPRESSED || totalSfntSize > MAX_DECOMPRESSED * 2) throw new FontFileError('The font is implausibly large.');
  const stream = slice(buffer, cursor, compressedSize, 'compressed data');
  const decompressed = brotliDecompressSync(stream, { maxOutputLength: Math.max(1, total) });
  if (decompressed.length !== total) throw new FontFileError('WOFF2 data did not decompress to its declared length.');

  // Tables sit back to back in the decompressed stream, unpadded, in directory order.
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const entry of entries) {
    if (WANTED.has(entry.tag)) tables.set(entry.tag, slice(decompressed, offset, entry.length, entry.tag));
    offset += entry.length;
  }
  return tables;
}

/** UIntBase128: at most five bytes, no leading zeros, fits in 32 bits. */
export function readBase128(buffer: Buffer, start: number): [number, number] {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    const byte = buffer[start + index];
    if (byte === undefined) throw new FontFileError('Truncated UIntBase128.');
    if (index === 0 && byte === 0x80) throw new FontFileError('UIntBase128 with a leading zero.');
    if (value > 0x01ffffff) throw new FontFileError('UIntBase128 overflows 32 bits.');
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, start + index + 1];
  }
  throw new FontFileError('UIntBase128 longer than five bytes.');
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const NAME_IDS: Record<number, keyof FontNames> = {
  0: 'copyright',
  1: 'family',
  2: 'subfamily',
  4: 'fullName',
  5: 'version',
  6: 'postScriptName',
  7: 'trademark',
  8: 'manufacturer',
  9: 'designer',
  11: 'vendorUrl',
  12: 'designerUrl',
  13: 'licenseDescription',
  14: 'licenseUrl',
  16: 'typographicFamily',
  17: 'typographicSubfamily',
};

function emptyNames(): FontNames {
  return Object.fromEntries(Object.values(NAME_IDS).map((key) => [key, null])) as FontNames;
}

function readNames(table: Buffer): FontNames {
  const names = emptyNames();
  if (table.length < 6) return names;
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  const best = new Map<number, { rank: number; value: string }>();
  for (let index = 0; index < count && 6 + index * 12 + 12 <= table.length; index += 1) {
    const record = 6 + index * 12;
    const platform = table.readUInt16BE(record);
    const encoding = table.readUInt16BE(record + 2);
    const language = table.readUInt16BE(record + 4);
    const nameId = table.readUInt16BE(record + 6);
    const length = table.readUInt16BE(record + 8);
    const offset = storage + table.readUInt16BE(record + 10);
    if (!(nameId in NAME_IDS) || offset + length > table.length) continue;

    let rank: number;
    let value: string;
    const bytes = table.subarray(offset, offset + length);
    if (platform === 3 && (encoding === 1 || encoding === 10)) {
      rank = language === 0x0409 ? 0 : 1;
      value = decodeUtf16be(bytes);
    } else if (platform === 0) {
      rank = 2;
      value = decodeUtf16be(bytes);
    } else if (platform === 1 && encoding === 0) {
      rank = 3;
      value = bytes.toString('latin1');
    } else {
      continue;
    }
    const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 2000);
    if (!clean) continue;
    const current = best.get(nameId);
    if (!current || rank < current.rank) best.set(nameId, { rank, value: clean });
  }
  for (const [id, { value }] of best) names[NAME_IDS[id]!] = value;
  return names;
}

function decodeUtf16be(bytes: Buffer): string {
  const even = bytes.subarray(0, bytes.length - (bytes.length % 2));
  const swapped = Buffer.from(even);
  swapped.swap16();
  return swapped.toString('utf16le');
}

function readAxes(table: Buffer): FontFileInfo['axes'] {
  if (table.length < 16) return [];
  const axesOffset = table.readUInt16BE(4);
  const axisCount = table.readUInt16BE(8);
  const axisSize = table.readUInt16BE(10);
  if (axisSize < 20) return [];
  const axes: FontFileInfo['axes'] = [];
  for (let index = 0; index < axisCount && index < 16; index += 1) {
    const record = axesOffset + index * axisSize;
    if (record + 20 > table.length) break;
    const fixed = (at: number) => Math.round((table.readInt32BE(at) / 65536) * 1000) / 1000;
    axes.push({
      tag: table.toString('latin1', record, record + 4).trim(),
      min: fixed(record + 4),
      default: fixed(record + 8),
      max: fixed(record + 12),
    });
  }
  return axes;
}
