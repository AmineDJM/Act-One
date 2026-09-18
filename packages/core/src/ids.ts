/**
 * Id generation, deliberately isomorphic.
 *
 * These run in the Node worker, in Next.js server code, AND inside the Remotion
 * bundle, which webpack targets at the browser. Importing node:crypto here
 * broke the render bundle outright — so this uses Web Crypto, which is present
 * in Node 18+, in browsers, and in workers alike.
 */
const webCrypto: Crypto = globalThis.crypto;

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  webCrypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type IdPrefix =
  | 'org'
  | 'usr'
  | 'mem'
  | 'prj'
  | 'brd'
  | 'pun'
  | 'cpt'
  | 'sbd'
  | 'scn'
  | 'ast'
  | 'rnd'
  | 'var'
  | 'job'
  | 'cst'
  | 'evt'
  | 'sec'
  | 'cmt'
  | 'aed'
  | 'jev'
  | 'src'
  | 'bvc'
  | 'vcs'
  | 'inv'
  | 'mom'
  | 'cpy';

/**
 * Prefixed, sortable-ish ids. The timestamp prefix keeps ids roughly ordered by
 * creation, which makes debugging production incidents far easier than raw UUIDs.
 */
export function newId(prefix: IdPrefix): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = randomHex(8);
  return `${prefix}_${time}${rand}`;
}

export function uuid(): string {
  return webCrypto.randomUUID();
}

/**
 * A stable id derived from content rather than from the clock.
 *
 * Some records are the same record every time we observe them. A sentence on a
 * customer's pricing page is the same piece of evidence this week as it was
 * last week, and minting a fresh random id for it on every crawl silently
 * breaks every citation pointing at it — which is exactly what happened: a
 * customer who authorised their product to get a better film re-ran research,
 * every storyboard began citing evidence the project no longer held, and QA
 * blocked the film with no way for anybody to fix it.
 *
 * FNV-1a over the identifying parts, twice with different offsets for a
 * 128-bit-shaped id. No cryptographic claim is being made: this needs to be
 * stable and collision-resistant over a few thousand excerpts, not secret.
 * Kept here rather than using node:crypto because core is bundled for the
 * browser by Remotion.
 */
export function derivedId(prefix: IdPrefix, ...parts: string[]): string {
  const input = parts.join('\u0000');
  const time = fnv1a(input, 0x811c9dc5).toString(36).padStart(9, '0').slice(0, 9);
  const rest =
    fnv1a(input, 0x01000193).toString(16).padStart(8, '0') +
    fnv1a(`${input}\u0001`, 0x811c9dc5).toString(16).padStart(8, '0');
  return `${prefix}_${time}${rest.slice(0, 16)}`;
}

function fnv1a(input: string, offset: number): number {
  let hash = offset >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, 16777619, by shift-and-add so it stays in 32 bits.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

export function isId(value: unknown, prefix?: IdPrefix): value is string {
  if (typeof value !== 'string') return false;
  if (!/^[a-z]{3}_[0-9a-z]{9}[0-9a-f]{16}$/.test(value)) return false;
  return prefix ? value.startsWith(`${prefix}_`) : true;
}

/** Deterministic slug for storage keys and scene filenames. */
export function slugify(input: string, maxLength = 48): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'untitled').slice(0, maxLength).replace(/-+$/g, '');
}
