import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BENCHMARK_ANALYZER_VERSION, measuredWith } from '@act-one/core';
import { FORENSICS_DIR } from '../forensics/run.ts';
import { analysisVersion, summarizeFilmIR } from '../library.ts';
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
    expect(summary.counts).toMatchObject({ shots: 5, boundaries: 4 });
  });
});

describe('the analyzer an analysis was measured with', () => {
  it('is the Python analyzer this code runs', () => {
    const common = readFileSync(path.join(FORENSICS_DIR, 'actone_forensics', 'common.py'), 'utf8');
    expect(/^ANALYZER_VERSION = "([^"]+)"$/m.exec(common)?.[1]).toBe(BENCHMARK_ANALYZER_VERSION);
  });

  it('is read back from the version string an analysis carries', () => {
    const { document } = syntheticDocument();
    expect(measuredWith(analysisVersion(document))).toBe(BENCHMARK_ANALYZER_VERSION);
    expect(measuredWith('actone.film-ir 1.0 · forensics 1.2.0 · validator 1.1.0 · model gemini-3.1-pro-preview')).toBe('1.2.0');
    expect(measuredWith(null)).toBeNull();
    expect(measuredWith('actone.film-ir 1.1 · no model')).toBeNull();
  });
});
