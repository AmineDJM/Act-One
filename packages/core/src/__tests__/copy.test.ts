import { describe, it, expect } from 'vitest';
import { COPY_LIMITS, copyFitsSurface, groupCopy, usableCopy, type CopyLine } from '../domain/copy.ts';

const line = (over: Partial<CopyLine> = {}): CopyLine => ({
  surface: 'headline',
  text: 'Ship the way you meant to.',
  claim: '',
  ...over,
});

describe('copy limits', () => {
  it('rejects a line longer than the surface allows', () => {
    // A 400-character "email subject" is not copy, it is something somebody has
    // to rewrite — which is worse than offering nothing for that surface.
    expect(copyFitsSurface(line({ surface: 'email_subject', text: 'x'.repeat(200) }))).toBe(false);
    expect(copyFitsSurface(line({ surface: 'email_subject', text: 'Your launch film is ready' }))).toBe(true);
  });

  it('gives every surface a limit its platform actually imposes', () => {
    expect(COPY_LIMITS.x_post).toBe(280);
    expect(COPY_LIMITS.product_hunt_tagline).toBeLessThan(COPY_LIMITS.headline);
  });
});

describe('usableCopy', () => {
  const claims = ['52% faster bug resolution', '40,000+ organisations'];

  it('keeps a line resting on a verified claim', () => {
    const kept = usableCopy([line({ surface: 'x_post', text: 'Bugs resolved 52% faster.', claim: claims[0]! })], claims);
    expect(kept).toHaveLength(1);
  });

  it('keeps a line that asserts nothing checkable', () => {
    expect(usableCopy([line()], claims)).toHaveLength(1);
  });

  it('drops a line resting on a claim nobody verified', () => {
    // A film inventing a number is watched once. A launch post inventing one is
    // quoted back at the company forever.
    const invented = line({ surface: 'x_post', text: 'Now 10x faster.', claim: '10x faster than before' });
    expect(usableCopy([invented], claims)).toHaveLength(0);
  });

  it('matches claims regardless of case and surrounding space', () => {
    const spaced = line({ claim: '  52% FASTER BUG RESOLUTION  ' });
    expect(usableCopy([spaced], claims)).toHaveLength(1);
  });

  it('drops an over-long line even when its claim is verified', () => {
    const long = line({ surface: 'email_subject', text: 'x'.repeat(300), claim: claims[0]! });
    expect(usableCopy([long], claims)).toHaveLength(0);
  });
});

describe('groupCopy', () => {
  it('orders surfaces deliberately and omits empty ones', () => {
    const grouped = groupCopy([
      line({ surface: 'x_post', text: 'A post.' }),
      line({ surface: 'headline', text: 'A headline.' }),
    ]);
    expect(grouped.map((group) => group.surface)).toEqual(['headline', 'x_post']);
  });
});
