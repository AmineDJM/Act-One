import { z } from 'zod';
import { nonEmpty } from '../zod-helpers.ts';

export const CopySurface = z.enum([
  'headline',
  'subheadline',
  'product_hunt_tagline',
  'x_post',
  'linkedin_post',
  'email_subject',
  'email_preview',
  'app_store_blurb',
]);
export type CopySurface = z.infer<typeof CopySurface>;

/** How long each surface is allowed to be, where the platform decides for us. */
export const COPY_LIMITS: Record<CopySurface, number> = {
  headline: 70,
  subheadline: 160,
  product_hunt_tagline: 60,
  x_post: 280,
  linkedin_post: 700,
  email_subject: 60,
  email_preview: 110,
  app_store_blurb: 170,
};

export const CopyLine = z.object({
  surface: CopySurface,
  text: nonEmpty(800),
  /**
   * The claim this line rests on, copied verbatim from a verified claim, or
   * empty when the line asserts nothing checkable.
   *
   * A launch post inventing a number is worse than a film doing it: the film is
   * watched once, the post is quoted back at the company forever.
   */
  claim: z.string().max(400).default(''),
});
export type CopyLine = z.infer<typeof CopyLine>;

export const CopyKit = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string(),
  conceptId: z.string(),
  lines: z.array(CopyLine),
  createdAt: z.string(),
});
export type CopyKit = z.infer<typeof CopyKit>;

/** True when a line fits the surface it was written for. */
export function copyFitsSurface(line: CopyLine): boolean {
  return line.text.length <= COPY_LIMITS[line.surface];
}

/**
 * Drops anything that does not belong in a launch kit.
 *
 * Two rules. A line longer than its surface allows is not usable copy — a
 * 400-character "email subject" is a line somebody has to rewrite, which is
 * worse than not offering one. And a line claiming something no verified claim
 * supports is removed outright rather than softened: the whole discipline of
 * this product is that it never says anything the customer did not publish.
 */
export function usableCopy(lines: CopyLine[], supportedClaims: readonly string[]): CopyLine[] {
  const supported = new Set(supportedClaims.map((claim) => claim.trim().toLowerCase()));
  return lines.filter((line) => {
    if (!copyFitsSurface(line)) return false;
    if (!line.claim.trim()) return true;
    return supported.has(line.claim.trim().toLowerCase());
  });
}

/** Groups a kit for display, keeping surfaces in a deliberate order. */
export const COPY_ORDER: readonly CopySurface[] = [
  'headline',
  'subheadline',
  'product_hunt_tagline',
  'x_post',
  'linkedin_post',
  'email_subject',
  'email_preview',
  'app_store_blurb',
];

export const COPY_LABELS: Record<CopySurface, string> = {
  headline: 'Headline',
  subheadline: 'Subheadline',
  product_hunt_tagline: 'Product Hunt tagline',
  x_post: 'Post for X',
  linkedin_post: 'Post for LinkedIn',
  email_subject: 'Email subject',
  email_preview: 'Email preview text',
  app_store_blurb: 'App store blurb',
};

export function groupCopy(lines: CopyLine[]): { surface: CopySurface; lines: CopyLine[] }[] {
  return COPY_ORDER.map((surface) => ({
    surface,
    lines: lines.filter((line) => line.surface === surface),
  })).filter((group) => group.lines.length > 0);
}
