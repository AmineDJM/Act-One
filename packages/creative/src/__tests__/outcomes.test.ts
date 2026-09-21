import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OutcomeMemory, movement } from '../council/outcomes.ts';

const file = () => path.join(mkdtempSync(path.join(tmpdir(), 'oc-')), 'outcomes.json');

describe('outcome memory', () => {
  it('keeps raw scores, because a delta forgets where it started', () => {
    const m = new OutcomeMemory(file());
    const r = m.record({
      context: 'loop 3', observedProblem: 'captions unreadable', intervention: 'gave them a band',
      before: { typography: 3, colour: 8 }, after: { typography: 4, colour: 9 }, result: 'improved',
    });
    // Both moved by one, and the record can still tell them apart.
    expect(movement(r)).toEqual([
      { criterion: 'typography', from: 3, to: 4 },
      { criterion: 'colour', from: 8, to: 9 },
    ]);
  });

  it('surfaces a prior that made the film worse', () => {
    const m = new OutcomeMemory(file());
    m.record({
      context: 'loop 4', observedProblem: 'the opening shot is generic stock footage',
      intervention: 'commissioned a different generated opening shot',
      before: { visualInvention: 4 }, after: { visualInvention: 3 },
      result: 'reverted', confounded: true, costUsd: 1.85,
      note: 'Swapping one stock image for another is not a fix for a generic opening.',
    });
    const brief = m.priorsBrief('opening feels generic, propose a new opening shot');
    expect(brief).toContain('reverted');
    expect(brief).toContain('CONFOUNDED');
    expect(brief).toContain('visualInvention 4->3');
  });

  it('admits when nothing comparable has been measured', () => {
    expect(new OutcomeMemory(file()).priorsBrief('colour grading')).toContain('nothing comparable');
  });

  it('survives a reload, because memory that dies with the process is not memory', () => {
    const f = file();
    new OutcomeMemory(f).record({ context: 'c', observedProblem: 'p', intervention: 'i' });
    expect(new OutcomeMemory(f).all()).toHaveLength(1);
    // And the honest default is 'unclear', not 'improved'.
    expect(new OutcomeMemory(f).all()[0]!.result).toBe('unclear');
  });
});
