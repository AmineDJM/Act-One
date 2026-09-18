import { describe, it, expect } from 'vitest';
import { collectionSlug, creditLine, orderForPublic, submissionNext } from '../index.ts';

describe('Collections', () => {
  it("names a film's address from its company and keeps it unique", () => {
    expect(collectionSlug('Acme Inc.', () => false)).toBe('acme-inc');
    expect(collectionSlug('Société Générale', () => false)).toBe('societe-generale');
    expect(collectionSlug('Acme', (slug) => slug === 'acme')).toBe('acme-2');
    expect(collectionSlug('!!!', () => false)).toBe('film');
  });

  it('credits the studio, never a generator', () => {
    expect(creditLine({ original: false })).toBe('An Act One Production');
    expect(creditLine({ original: true })).toBe('Act One Original');
  });

  it('puts the launch of the week first, then the featured, then the editorial order', () => {
    const ordered = orderForPublic([
      { id: 'c', launchOfTheWeek: false, featured: false, position: 2, publishedAt: '2026-01-03' },
      { id: 'b', launchOfTheWeek: false, featured: true, position: 9, publishedAt: '2026-01-02' },
      { id: 'a', launchOfTheWeek: true, featured: false, position: 9, publishedAt: '2026-01-01' },
      { id: 'd', launchOfTheWeek: false, featured: false, position: 2, publishedAt: '2026-01-04' },
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('tells the customer what they may do next', () => {
    expect(submissionNext(null)).toBe('submit');
    expect(submissionNext('pending')).toBe('wait');
    expect(submissionNext('published')).toBe('withdraw');
    expect(submissionNext('rejected')).toBe('resubmit');
    expect(submissionNext('withdrawn')).toBe('resubmit');
  });
});
