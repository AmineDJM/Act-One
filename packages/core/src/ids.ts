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
  | 'inv'
  | 'mom';

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
