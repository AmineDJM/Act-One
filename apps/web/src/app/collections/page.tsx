import type { Metadata } from 'next';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { listPublicFilms } from '@/server/collections.ts';
import { site, absoluteUrl } from '@/lib/site.ts';
import { pageMetadata } from '@/lib/seo.ts';
import { CollectionsIndex } from './CollectionsIndex.tsx';

/*
 * Rendered per request, because a build has no database.
 *
 * This page reads published rows, and the machine that runs `next build` is
 * not the machine that runs the migrations: on a fresh environment the table
 * does not exist yet and prerendering fails the whole build. Even where it
 * succeeds it bakes in whatever was published at build time, so a film
 * selected an hour after a deploy would not appear until something else
 * triggered a rebuild.
 */
export const dynamic = 'force-dynamic';


export const metadata: Metadata = pageMetadata({
  title: 'Collections',
  description: `Real product launch films, made by ${site.name} and selected by a person. SaaS, AI, developer tools and more, each with the product behind it.`,
  path: '/collections',
});

export default async function CollectionsPage() {
  const [films, policy, config] = await Promise.all([listPublicFilms(), getSignUpPolicy(), getProductConfig()]);
  return <CollectionsIndex films={films} category={null} policy={policy} cta={config.landing.ctaLabel} />;
}
