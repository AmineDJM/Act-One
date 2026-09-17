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
  const params = await searchParams;
  const raw = typeof params['next'] === 'string' ? params['next'] : '';
  // Same rule as the actions: within this app only, never protocol-relative.
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/app';

  // Somebody already signed in who followed an invitation should land on the
  // invitation, not be bounced to their existing workspace.
  if (await getSession()) redirect(next);

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true" />
          {PRODUCT_NAME}
        </Link>
        <SignInForm next={next} />
        <p className={styles.foot}>
          No account yet?{' '}
          <Link href={next === '/app' ? '/auth/sign-up' : `/auth/sign-up?next=${encodeURIComponent(next)}`}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
