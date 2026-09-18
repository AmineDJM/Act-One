import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { COLLECTION_CATEGORY_LABELS, CollectionCategory } from '@act-one/core';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { listPublicFilms } from '@/server/collections.ts';
import { site } from '@/lib/site.ts';
import { pageMetadata } from '@/lib/seo.ts';
import { CollectionsIndex } from '../../CollectionsIndex.tsx';

export const revalidate = 300;

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
