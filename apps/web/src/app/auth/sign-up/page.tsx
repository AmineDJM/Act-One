import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME, normalizeUrl } from '@act-one/core';
import { getSession } from '@/server/auth.ts';
import { SignUpForm } from './SignUpForm.tsx';
import styles from '../auth.module.css';

export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false, follow: true },
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getSession()) redirect('/app');

  const params = await searchParams;
  const rawWebsite = typeof params['website'] === 'string' ? params['website'] : '';
  const website = normalizeUrl(rawWebsite) ?? '';

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true" />
          {PRODUCT_NAME}
        </Link>
        <SignUpForm website={website} />
        <p className={styles.foot}>
          Already have an account? <Link href="/auth/sign-in">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
