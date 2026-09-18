import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { COLLECTION_CATEGORY_LABELS, CollectionCategory } from '@act-one/core';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { listPublicFilms } from '@/server/collections.ts';
import { site, absoluteUrl } from '@/lib/site.ts';
import { CollectionsIndex } from '../../CollectionsIndex.tsx';

export const revalidate = 300;

export function generateStaticParams() {
  return CollectionCategory.options.map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const parsed = CollectionCategory.safeParse((await params).category);
  if (!parsed.success) return {};
  const label = COLLECTION_CATEGORY_LABELS[parsed.data];
  return {
    title: `${label} launch films · Collections`,
    description: `${label} products launched with a film made by ${site.name}, selected by a person.`,
    alternates: { canonical: `/collections/category/${parsed.data}` },
    openGraph: { title: `${label} launch films · ${site.name}`, url: absoluteUrl(`/collections/category/${parsed.data}`), type: 'website' },
  };
}

export default async function CollectionsCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const parsed = CollectionCategory.safeParse((await params).category);
  if (!parsed.success) notFound();
  const [films, policy, config] = await Promise.all([listPublicFilms({ category: parsed.data }), getSignUpPolicy(), getProductConfig()]);
  return <CollectionsIndex films={films} category={parsed.data} policy={policy} cta={config.landing.ctaLabel} />;
}
