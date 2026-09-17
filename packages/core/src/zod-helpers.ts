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
