import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * What the customer reads while a film is being made.
 *
 * Every one of these lines is shown on the production page, in the words of
 * the work. Two rules, and both were broken by the repair loop before this
 * existed.
 *
 * A line never names the repair. "Repairing the timing" said once sounds like
 * craft; said on every small technical defect of every film it sounds like an
 * engine struggling, and it invites a question the customer cannot act on and
 * whose honest answer is "nothing you will ever see". The check, the severity,
 * the action and the pass number are all real and all belong on the console,
 * in the report and in the logs, where somebody acts on them.
 *
 * And a line never counts attempts. "Directing the refined shots again" tells
 * a customer there was a first attempt they were not shown and that it was not
 * good enough.
 *
 * This is a lint rather than a unit test on purpose: the rule is about every
 * line in the stage, including the one somebody adds next year, and there is
 * no function to call that would catch that.
 */
const STAGES = path.resolve(import.meta.dirname, '../stages');

/** Words that name the machinery rather than the work. */
const FORBIDDEN = [
  /repair/i,
  /\bQA\b/,
  /\bdefect/i,
  /\bfail/i,
  /\bissue/i,
  /\bcheck(er|ing)? (found|failed)/i,
  /\bagain\b/i,
  /\battempt/i,
  /\bpass \d/i,
  /\bretry/i,
  /soft|hard_fail|critical/i,
  /trim|retime|recrop|regenerate|relayout|remix/i,
];

async function progressLines(): Promise<{ file: string; line: string }[]> {
  const files = (await readdir(STAGES)).filter((name) => name.endsWith('.ts'));
  const found: { file: string; line: string }[] = [];
  for (const file of files) {
    const source = await readFile(path.join(STAGES, file), 'utf8');
    // context.progress(<fraction>, <message>) — the message is the second argument.
    for (const match of source.matchAll(/context\.progress\(\s*[^,]+,\s*(['"`])([^'"`]*)\1/g)) {
      found.push({ file, line: match[2] ?? '' });
    }
  }
  return found;
}

describe('the words a customer reads', () => {
  it('finds the progress lines it is meant to be checking', async () => {
    const lines = await progressLines();
    // A regex that silently matches nothing would pass every assertion below.
    expect(lines.length).toBeGreaterThan(8);
    expect(lines.map((entry) => entry.line)).toContain('Polishing the final cut');
  });

  it('never names the repair, the check or the attempt', async () => {
    const offending = (await progressLines()).filter(({ line }) =>
      FORBIDDEN.some((pattern) => pattern.test(line)),
    );
    expect(offending.map((entry) => `${entry.file}: ${entry.line}`)).toEqual([]);
  });

  it('never hands the repair headline straight to the customer', async () => {
    const source = await readFile(path.join(STAGES, 'render.ts'), 'utf8');
    // It exists, and it is for the activity feed an operator reads.
    expect(source).toMatch(/function repairHeadline/);
    expect(source).not.toMatch(/context\.progress\([^)]*repairHeadline/);
  });
});
