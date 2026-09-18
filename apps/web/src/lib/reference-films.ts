/**
 * The reference films.
 *
 * Our own demonstration projects, built for fictional companies and
 * labelled as such wherever they appear. Presenting invented work as a
 * real client's launch is the exact dishonesty this product refuses to
 * commit on a customer's behalf; it would be strange to do it on our own
 * site. One list, so the landing page and the work page never disagree.
 */
export const REFERENCE_FILMS = [
  {
    slug: 'northwind',
    company: 'Northwind',
    kind: 'AI agent',
    concept: 'One run',
    idea: 'A week of manual reconciliation collapses into a single automated run.',
    system: 'Cinematic Black',
    duration: '19s',
  },
  {
    slug: 'meridian',
    company: 'Meridian',
    kind: 'SaaS analytics',
    concept: 'Stop asking the data team',
    idea: 'The question you would have queued for a week, answered while you type it.',
    system: 'Kinetic Product',
    duration: '14s',
  },
  {
    slug: 'halyard',
    company: 'Halyard',
    kind: 'Developer tool',
    concept: 'Boring on purpose',
    idea: 'Infrastructure that is uninteresting to operate, argued as a virtue.',
    system: 'Editorial Tech',
    duration: '18s',
  },
] as const;

export type ReferenceFilm = (typeof REFERENCE_FILMS)[number];
