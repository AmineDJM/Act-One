import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { normalizeUrl } from '@act-one/core';
import { getSession } from '@/server/auth.ts';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { Wordmark } from '@/components/ui/Wordmark.tsx';
import { RequestAccessForm } from './RequestAccessForm.tsx';
import styles from '../auth/auth.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Request access',
  robots: { index: false, follow: true },
};

/**
 * The door, while the product is by invitation.
 *
 * A short form — who you are, what you are launching — and a plain answer:
 * a person will read it. It exists only in a private beta; in any other
 * phase it sends people to the account they can simply create.
 */
export default async function RequestAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const website = normalizeUrl(typeof params['website'] === 'string' ? params['website'] : '') ?? '';
  if (await getSession()) redirect('/app');
  const [policy, config] = await Promise.all([getSignUpPolicy(), getProductConfig()]);
  if (!policy.applications) redirect(policy.open ? `/auth/sign-up${website ? `?website=${encodeURIComponent(website)}` : ''}` : '/');

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <Wordmark tag={policy.tag ?? undefined} />
        <RequestAccessForm website={website} prompt={config.invites.applicationPrompt} phaseLine={policy.phaseLine} />
        <p className={styles.foot}>
          Already invited? <Link href="/auth/sign-up">Create your account</Link>
        </p>
      </div>
    </div>
  );
}
