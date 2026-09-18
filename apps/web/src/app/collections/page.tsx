import type { Metadata } from 'next';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { listPublicFilms } from '@/server/collections.ts';
import { site, absoluteUrl } from '@/lib/site.ts';
import { CollectionsIndex } from './CollectionsIndex.tsx';

/*
 * Rendered ahead of time and refreshed when an entry is published, unpublished
 * or edited; a slow gallery page is the worst place to be slow, because this
 * is the page that gets shared.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Collections',
  description: `Real product launch films, made by ${site.name} and selected by a person. SaaS, AI, developer tools and more, each with the product behind it.`,
  alternates: { canonical: '/collections' },
  openGraph: {
    title: `Collections · ${site.name}`,
    description: `Real product launch films, made by ${site.name} and selected by a person.`,
    url: absoluteUrl('/collections'),
    type: 'website',
  },
};

export default async function CollectionsPage() {
  const [films, policy, config] = await Promise.all([listPublicFilms(), getSignUpPolicy(), getProductConfig()]);
  return <CollectionsIndex films={films} category={null} policy={policy} cta={config.landing.ctaLabel} />;
}
