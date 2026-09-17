import { randomUUID, randomBytes } from 'node:crypto';

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
  const rand = randomBytes(8).toString('hex');
  return `${prefix}_${time}${rand}`;
}

export function uuid(): string {
  return randomUUID();
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
