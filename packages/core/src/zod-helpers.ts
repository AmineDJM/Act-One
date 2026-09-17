import { z } from 'zod';

/**
 * Deliberately lenient URL handling: research inputs come from founders pasting
 * whatever is in their address bar, and LLM output is not to be trusted to be
 * well-formed. We normalise rather than reject wherever it is safe to do so.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export const urlString = z
  .string()
  .transform((value, ctx) => {
    const normalized = normalizeUrl(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: `Not a usable URL: ${value}` });
      return z.NEVER;
    }
    return normalized;
  });

/** A 0..1 score. LLMs like to emit 0-100; we accept both and clamp. */
export const score01 = z
  .number()
  .transform((n) => (n > 1 ? n / 100 : n))
  .pipe(z.number().min(0).max(1));

export const hexColor = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Expected a hex colour like #0B0B0F')
  .transform(expandHex);

export function expandHex(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.length === 4) return `#${v[1]!}${v[1]!}${v[2]!}${v[2]!}${v[3]!}${v[3]!}`;
  return v;
}

export const nonEmpty = (max = 500) => z.string().trim().min(1).max(max);

/**
 * An enum array that degrades instead of failing.
 *
 * Models return plausible-but-unlisted values for taxonomy fields —
 * "website" for a channel, "social" for a platform. Rejecting those fails the
 * whole response over a field that is advisory, which is how a concept worth
 * keeping gets thrown away for naming a channel we did not enumerate.
 *
 * Known synonyms are mapped, unrecognised values are dropped, and an empty
 * result falls back rather than erroring. Critical fields must NOT use this —
 * a visual type or a repair action silently becoming a default would hide a
 * real disagreement about what the film should do.
 */
export function lenientEnumArray<T extends string>(
  allowed: readonly T[],
  options: { synonyms?: Record<string, T>; fallback: T[]; max?: number },
) {
  const valid = new Set<string>(allowed);
  const synonyms = options.synonyms ?? {};

  return z
    .array(z.union([z.string(), z.number(), z.boolean()]))
    .default([])
    .transform((values) => {
      const mapped = values
        .map((value) => String(value).toLowerCase().trim().replace(/[\s-]+/g, '_'))
        .map((value) => (valid.has(value) ? (value as T) : synonyms[value]))
        .filter((value): value is T => value !== undefined);

      const unique = [...new Set(mapped)];
      const kept = options.max ? unique.slice(0, options.max) : unique;
      return kept.length > 0 ? kept : options.fallback;
    });
}
