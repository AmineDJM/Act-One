import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME } from '@act-one/core';
import { getSession } from '@/server/auth.ts';
import { SignInForm } from './SignInForm.tsx';
import styles from '../auth.module.css';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getSession()) redirect('/app');

  const params = await searchParams;
  const next = typeof params['next'] === 'string' ? params['next'] : '/app';

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true" />
          {PRODUCT_NAME}
        </Link>
        <SignInForm next={next} />
        <p className={styles.foot}>
          No account yet? <Link href="/auth/sign-up">Create one</Link>
        </p>
      </div>
    </div>
  );
}
