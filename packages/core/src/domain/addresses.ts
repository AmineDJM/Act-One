/**
 * Addresses a public page used to have.
 *
 * Renaming a page is an editorial act. Breaking every link anyone made to it
 * is not, and it is what happens by default: the old address answers 404, the
 * search engine drops the page, and whoever posted the link looks careless.
 *
 * So an address that is left behind is remembered, and the page answers it
 * with a permanent redirect. The history is bounded — twenty moves back is
 * already more than any link needs — and the page never remembers the address
 * it currently holds, which would be a redirect to itself.
 */
export function rememberAddress(previous: readonly string[], leaving: string, taking: string, limit = 20): string[] {
  const kept = previous.filter((slug) => slug !== taking && slug !== leaving);
  const next = leaving && leaving !== taking ? [leaving, ...kept] : kept;
  return next.slice(0, Math.max(limit, 0));
}
