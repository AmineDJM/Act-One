import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { COLLECTION_CATEGORY_LABELS, CollectionCategory } from '@act-one/core';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { listPublicFilms } from '@/server/collections.ts';
import { site } from '@/lib/site.ts';
import { pageMetadata } from '@/lib/seo.ts';
import { CollectionsIndex } from '../../CollectionsIndex.tsx';

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


export function generateStaticParams() {
  return CollectionCategory.options.map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const parsed = CollectionCategory.safeParse((await params).category);
  if (!parsed.success) return { title: 'Not found', robots: { index: false, follow: true } };
  const label = COLLECTION_CATEGORY_LABELS[parsed.data];
  return pageMetadata({
    title: `${label} launch films · Collections`,
    description: `${label} products launched with a film made by ${site.name} and selected by a person. Watch the launch, then see how your own product would be directed.`,
    path: `/collections/category/${parsed.data}`,
  });
}

export default async function CollectionsCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const parsed = CollectionCategory.safeParse((await params).category);
  if (!parsed.success) notFound();
  const [films, policy, config] = await Promise.all([listPublicFilms({ category: parsed.data }), getSignUpPolicy(), getProductConfig()]);
  return <CollectionsIndex films={films} category={parsed.data} policy={policy} cta={config.landing.ctaLabel} />;
}
