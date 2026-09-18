import { describe, it, expect } from 'vitest';
import {
  Article,
  EditorialSchedule,
  articleReadingMinutes,
  articleSlug,
  articleWordCount,
  editorialFindings,
  editorialRunDue,
  articleReadyToPublish,
} from '@act-one/core';

/**
 * The standards an article is held to, and the clock the journal runs on.
 *
 * These are the rules that stop a machine-written piece reaching the public:
 * length, the fields search engines read, a picture somebody can hear, and
 * the two ways a generated article lies — inventing figures, and saying
 * nothing at all.
 */
function article(over: Partial<Article> = {}): Article {
  const at = '2026-01-01T00:00:00.000Z';
  const body = 'A paragraph that says something specific about launching software. '.repeat(24);
  return Article.parse({
    id: 'art_1',
    slug: 'a-launch-film-in-ten-seconds',
    title: 'What a launch film has to do in ten seconds',
    dek: 'The first ten seconds decide whether anybody watches the rest, and most launch videos spend them on a logo.',
    sections: [
      { id: 's1', heading: 'The first three seconds', body, intent: '' },
      { id: 's2', heading: 'What a demo cannot do', body, intent: '' },
      { id: 's3', heading: 'Cutting for the feed', body, intent: '' },
    ],
    closing: 'Act One produces launch films for software products.',
    createdAt: at,
    updatedAt: at,
    ...over,
  });
}

describe('an article', () => {
  it('measures itself the way the page reports it', () => {
    const piece = article();
    expect(articleWordCount(piece)).toBeGreaterThan(300);
    expect(articleReadingMinutes(piece)).toBeGreaterThanOrEqual(1);
    // An empty piece still reads as a minute rather than zero.
    expect(articleReadingMinutes(article({ sections: [], closing: '', dek: '' }))).toBe(1);
  });

  it("takes an address from its title, and never somebody else's", () => {
    expect(articleSlug('What a launch film has to do', () => false)).toBe('what-a-launch-film-has-to-do');
    expect(articleSlug('Zoé on launch day', () => false)).toBe('zoe-on-launch-day');
    expect(articleSlug('Launch', (candidate) => candidate === 'launch')).toBe('launch-2');
  });

  it('is stopped by its own standards', () => {
    expect(articleReadyToPublish(article())).toBe(true);

    const thin = article({ sections: article().sections.slice(0, 1) });
    const thinFindings = editorialFindings(thin).filter((finding) => finding.severity === 'blocking');
    expect(thinFindings.some((finding) => finding.message.includes('three sections'))).toBe(true);
    expect(articleReadyToPublish(thin)).toBe(false);

    // A figure with nothing behind it is the failure mode that matters.
    const invented = article({
      sections: [
        { id: 's1', heading: 'Numbers', body: 'Launch films lift conversion by 43% for every product. '.repeat(20), intent: '' },
        ...article().sections.slice(1),
      ],
    });
    expect(editorialFindings(invented).some((finding) => finding.severity === 'blocking' && finding.message.includes('cites nothing'))).toBe(true);

    // A picture nobody can hear.
    const mute = article({ heroAssetId: 'org_1/ast_1', heroAlt: '' });
    expect(editorialFindings(mute).some((finding) => finding.severity === 'blocking' && finding.message.includes('cannot see'))).toBe(true);
    expect(articleReadyToPublish(article({ slug: 'taken' }), { existingSlug: true })).toBe(false);
  });

  it('warns without blocking on the things a person may judge', () => {
    const warnings = editorialFindings(article({ closing: 'Nothing about the product.' })).filter((finding) => finding.severity === 'warning');
    expect(warnings.some((finding) => finding.message.includes('never mentions the product'))).toBe(true);
    expect(articleReadyToPublish(article({ closing: 'Nothing about the product.' }))).toBe(true);
  });
});

describe("the journal's clock", () => {
  const at = (iso: string) => new Date(iso);

  it('does nothing unless somebody turned it on', () => {
    const off = EditorialSchedule.parse({ autoDraft: false, cadence: 'weekly' });
    expect(editorialRunDue(off, at('2030-01-01T00:00:00.000Z'))).toBe(false);
    const manual = EditorialSchedule.parse({ autoDraft: true, cadence: 'manual' });
    expect(editorialRunDue(manual, at('2030-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('honours the cadence from the last run', () => {
    const every2 = EditorialSchedule.parse({ autoDraft: true, cadence: 'every_2_days', lastRunAt: '2026-01-01T00:00:00.000Z' });
    expect(editorialRunDue(every2, at('2026-01-02T12:00:00.000Z'))).toBe(false);
    expect(editorialRunDue(every2, at('2026-01-03T00:00:00.000Z'))).toBe(true);

    const weekly = EditorialSchedule.parse({ autoDraft: true, cadence: 'weekly', lastRunAt: '2026-01-01T00:00:00.000Z' });
    expect(editorialRunDue(weekly, at('2026-01-07T00:00:00.000Z'))).toBe(false);
    expect(editorialRunDue(weekly, at('2026-01-08T00:00:01.000Z'))).toBe(true);

    // Never run: due immediately once it is on.
    const fresh = EditorialSchedule.parse({ autoDraft: true, cadence: 'weekly' });
    expect(editorialRunDue(fresh, at('2026-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('keeps drafting and publishing as separate permissions', () => {
    const schedule = EditorialSchedule.parse({ autoDraft: true });
    expect(schedule.autoPublish).toBe(false);
  });
});
