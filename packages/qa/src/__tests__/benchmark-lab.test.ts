import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadBenchmarkLab, mechanismsBrief, retrieveMechanisms } from '../benchmark-lab.ts';

function corpus(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lab-'));
  // One film with cut TIMES, one with only a cut COUNT — which is the shape the
  // real cache has, and the shape that silently disabled corroboration.
  writeFileSync(path.join(dir, 'a.profile.json'), JSON.stringify({ durationSeconds: 60, cutTimes: [2.3, 9.0] }));
  writeFileSync(path.join(dir, 'b.profile.json'), JSON.stringify({ durationSeconds: 40, cuts: 12 }));
  writeFileSync(path.join(dir, 'c.profile.json'), JSON.stringify({ durationSeconds: 30, cuts: 4 }));
  writeFileSync(path.join(dir, 'target-readings.json'), JSON.stringify({
    a: {
      boundaries: [
        { at: 2.25, kind: 'creative_beat', mechanism: 'text scales up to fill the screen', evidence: 'orange field' },
        { at: 30.0, kind: 'scene', mechanism: 'hard cut to silence', evidence: 'audio drops out' },
      ],
      typography: [{ at: 12, mechanism: 'one word set at image scale', evidence: 'fills frame' }],
    },
    b: { boundaries: [{ at: 5, kind: 'scene', mechanism: 'camera pans down to new layout', evidence: 'continuous motion' }] },
    c: { boundaries: [], typography: [] },
  }));
  return dir;
}

describe('benchmark lab', () => {
  it('corroborates only where real cut TIMES exist, and says so otherwise', () => {
    const dir = corpus();
    const lab = loadBenchmarkLab(dir, path.join(dir, 'lab.json'));
    const a = lab.films.find((f) => f.id === 'a')!;
    const b = lab.films.find((f) => f.id === 'b')!;

    // 2.25s is within tolerance of the measured cut at 2.3.
    expect(a.mechanisms.find((m) => m.atSeconds === 2.25)!.basis).toBe('corroborated');
    // 30s is nowhere near a measured cut, and the times WERE available.
    expect(a.mechanisms.find((m) => m.atSeconds === 30)!.basis).toBe('interpreted');
    /*
     * b has a cut COUNT and no times. Every mechanism must be 'unchecked' —
     * never 'interpreted', which would claim a check that never happened.
     */
    expect(b.mechanisms.every((m) => m.basis === 'unchecked')).toBe(true);
  });

  it('reports a film that contributes nothing instead of silently shrinking the corpus', () => {
    const dir = corpus();
    const lab = loadBenchmarkLab(dir, path.join(dir, 'lab.json'));
    expect(lab.films).toHaveLength(3);
    expect(lab.empty.map((e) => e.id)).toEqual(['c']);
  });

  it('never lets one film dominate a query', () => {
    const dir = corpus();
    const lab = loadBenchmarkLab(dir, path.join(dir, 'lab.json'));
    const hits = retrieveMechanisms(lab, { question: 'text scales screen layout camera' }, { limit: 6, perFilm: 1 });
    const films = hits.map((h) => h.film);
    expect(new Set(films).size).toBe(films.length);
  });

  it('keeps every mechanism attached to its film and second', () => {
    const dir = corpus();
    const lab = loadBenchmarkLab(dir, path.join(dir, 'lab.json'));
    const hits = retrieveMechanisms(lab, { question: 'text scales up to fill the screen' }, { limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.film).not.toBe('');
      expect(Number.isFinite(h.atSeconds)).toBe(true);
      // The anti-copy split is structural, not advice in a prompt.
      expect(h.doNotCopy).toContain(h.film);
      expect(h.learn).not.toBe(h.doNotCopy);
    }
    expect(mechanismsBrief(hits)).toContain('plagiarism');
  });

  it('says nothing rather than guessing when no mechanism matches', () => {
    const dir = corpus();
    const lab = loadBenchmarkLab(dir, path.join(dir, 'lab.json'));
    expect(retrieveMechanisms(lab, { question: 'zzzz qqqq' })).toEqual([]);
    expect(mechanismsBrief([])).toContain('no reference mechanism matched');
  });
});
