/**
 * The platform's professional standards, written down.
 *
 * Every engine in Act One makes numeric decisions — how much contrast, how long
 * a line, how loud a mix, how fast a cut. Those numbers used to live as
 * unattributed constants next to the code that used them, which has two costs.
 * The first is that nobody can tell a considered threshold from a guess. The
 * second is worse: when two engines disagree about the same rule, neither is
 * obviously wrong, so the disagreement survives.
 *
 * So each rule is a record with a source. Where a published standard exists we
 * cite it and use its number. Where one does not — much of editing and almost
 * all of conversion is craft convention rather than specification — the rule
 * says so in `authority`, and is stated as a house rule with its reasoning
 * rather than dressed up as law. A film that fails a house rule is a film we
 * would not ship; a film that fails a normative one is a film that is wrong.
 */

/** How much weight a rule carries. */
export type Authority =
  /** A published standard with a clause number. Non-negotiable. */
  | 'normative'
  /** Published guidance from a body that does not standardise it. Strong. */
  | 'guidance'
  /** Long-established craft convention, teachable and testable. */
  | 'convention'
  /** Ours. Reasoned, defensible, and open to argument. */
  | 'house';

export type Standard = {
  /** Stable id, used in QA messages so a finding can be looked up. */
  id: string;
  /** What the rule says, in one line. */
  rule: string;
  /** Who says so: standard, body, or the person the convention is named for. */
  source: string;
  /** Clause, section or page, when the source has one. */
  clause?: string;
  authority: Authority;
  /** Why it exists. Not decoration: a rule nobody understands gets waived. */
  because: string;
};

/**
 * Builds the citation a QA message carries.
 *
 * The point of putting this in a finding is that a customer, or an operator,
 * can check whether we are right. "Contrast is 3.1:1" is an assertion;
 * "Contrast is 3.1:1, below the 4.5:1 floor in WCAG 2.2 SC 1.4.3" is checkable.
 */
export function cite(standard: Standard): string {
  const clause = standard.clause ? ` ${standard.clause}` : '';
  return `${standard.source}${clause}`;
}

/** Indexes a set of standards by id, for lookup from a stored QA finding. */
export function indexStandards(...groups: Record<string, Standard>[]): Map<string, Standard> {
  const index = new Map<string, Standard>();
  for (const group of groups) {
    for (const standard of Object.values(group)) index.set(standard.id, standard);
  }
  return index;
}
