import { describe, it, expect } from 'vitest';
import { newId, type Claim, type Evidence } from '@act-one/core';
import { verifyClaim, verifyClaims, extractFigures, overlapRatio } from '../index.ts';

function evidence(excerpt: string): Evidence {
  return {
    id: newId('evt'),
    kind: 'page_text',
    sourceUrl: 'https://acme.com/',
    excerpt,
    capturedAt: new Date().toISOString(),
    confidence: 1,
  };
}

const corpus = [
  evidence('Acme replaces the spreadsheet your finance team uses to reconcile invoices every month.'),
  evidence('Teams close their books 3x faster with automated reconciliation.'),
  evidence('Built for controllers at mid-market companies running NetSuite.'),
  evidence('Trusted by 400 finance teams including Northwind and Globex.'),
];

const claim = (text: string, evidenceIds: string[] = []): Claim => ({ text, evidenceIds });

describe('extractFigures', () => {
  it('finds the figures that must never be invented', () => {
    expect(extractFigures('Cuts close time by 40%')).toContain('40%');
    expect(extractFigures('Saves $1,200 per month')).toContain('$1200');
    expect(extractFigures('3x faster')).toContain('3x');
    expect(extractFigures('Trusted by 400 teams')).toContain('400');
    expect(extractFigures('Closes in 2 hours')).toContain('2hours');
    expect(extractFigures('Simply better software')).toEqual([]);
  });
});

describe('verifyClaim', () => {
  it('accepts a correct citation', () => {
    const target = corpus[1]!;
    const result = verifyClaim(claim('Teams close their books 3x faster', [target.id]), corpus);
    expect(result.status).toBe('cited');
    expect(result.claim.evidenceIds).toContain(target.id);
  });

  it('grounds an accurate claim the model forgot to cite', () => {
    // This is the failure that emptied a real brief: good claims, sloppy citing.
    const result = verifyClaim(claim('Replaces the spreadsheet finance teams use to reconcile invoices'), corpus);
    expect(result.status).toBe('grounded');
    expect(result.claim.evidenceIds).toHaveLength(1);
    expect(result.support).toBeGreaterThan(0.5);
  });

  it('rejects a citation that points at unrelated evidence', () => {
    const unrelated = corpus[2]!;
    const result = verifyClaim(
      claim('Integrates with Salesforce and HubSpot out of the box', [unrelated.id]),
      corpus,
    );
    expect(result.status).not.toBe('cited');
  });

  it('always rejects an invented figure, however well the sentence reads', () => {
    const result = verifyClaim(
      claim('Teams close their books 87% faster with automated reconciliation', [corpus[1]!.id]),
      corpus,
    );
    expect(result.status).toBe('fabricated_number');
    expect(result.claim.evidenceIds).toEqual([]);
  });

  it('accepts a figure that does appear in the evidence', () => {
    const result = verifyClaim(claim('Trusted by 400 finance teams'), corpus);
    expect(result.status).toBe('grounded');
  });

  it('drops a claim with no support anywhere in the corpus', () => {
    const result = verifyClaim(claim('Includes a native mobile application for iOS and Android'), corpus);
    expect(result.status).toBe('unsupported');
  });
});

describe('verifyClaims', () => {
  it('keeps the supportable and reports fabricated figures separately', () => {
    const report = verifyClaims(
      [
        claim('Replaces the spreadsheet finance teams use to reconcile invoices'),
        claim('Teams close their books 3x faster'),
        claim('Reduces audit findings by 62%'),
        claim('Ships with a native mobile application'),
      ],
      corpus,
    );

    expect(report.kept).toHaveLength(2);
    expect(report.fabricatedFigures).toEqual(['62%']);
    expect(report.rejected.map((r) => r.status)).toEqual(
      expect.arrayContaining(['fabricated_number', 'unsupported']),
    );
  });

  it('can keep unsupported claims when a caller explicitly opts in', () => {
    const report = verifyClaims([claim('Ships with a native mobile application')], corpus, {
      keepUnsupported: true,
    });
    expect(report.kept).toHaveLength(1);
  });

  it('never keeps a fabricated figure even when unsupported claims are allowed', () => {
    const report = verifyClaims([claim('Reduces audit findings by 62%')], corpus, {
      keepUnsupported: true,
    });
    expect(report.kept).toEqual([]);
    expect(report.fabricatedFigures).toEqual(['62%']);
  });
});

describe('overlapRatio', () => {
  it('ignores stopwords so common English does not fake a match', () => {
    expect(overlapRatio('the and for with that this', 'completely unrelated text')).toBe(0);
  });

  it('scores a restatement highly', () => {
    expect(
      overlapRatio('automated reconciliation closes books faster', corpus[1]!.excerpt),
    ).toBeGreaterThan(0.6);
  });
});
