import { describe, expect, it } from 'vitest';
import { summarizeFilmIR } from '../library.ts';
import { validateFilmIR } from '../validate.ts';
import { syntheticDocument } from './helpers.ts';

describe('summarizeFilmIR', () => {
  it('counts one population, values, for the bar, the known share and the confidence alike', () => {
    const { document } = syntheticDocument();
    const { report } = validateFilmIR(document);
    const summary = summarizeFilmIR(document, report);
    const values = Object.values(summary.evidenceMix).reduce((sum, count) => sum + count, 0);
    // What the bar shows as unknown is exactly what the known share leaves out.
    expect(summary.knownShare).toBeCloseTo(1 - (summary.evidenceMix['UNKNOWN'] ?? 0) / values, 3);
    // The validator counts the provenance of every measured series as well: more records, fewer of them unknown.
    const records = Object.values(report.evidenceMix).reduce((sum, count) => sum + count, 0);
    expect(records).toBeGreaterThan(values);
    expect((report.evidenceMix['UNKNOWN'] ?? 0) / records).toBeLessThan((summary.evidenceMix['UNKNOWN'] ?? 0) / values);
    expect(summary.counts).toMatchObject({ shots: 3, boundaries: 2 });
  });
});
