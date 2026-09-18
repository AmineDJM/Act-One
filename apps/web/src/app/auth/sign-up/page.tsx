import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { normalizeInviteCode, normalizeUrl } from '@act-one/core';
import { getSignUpPolicy } from '@/server/product.ts';
import { getSession } from '@/server/auth.ts';
import { SignUpForm } from './SignUpForm.tsx';
import { Wordmark } from '@/components/ui/Wordmark.tsx';
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
  const params = await searchParams;
  const rawWebsite = typeof params['website'] === 'string' ? params['website'] : '';
  const website = normalizeUrl(rawWebsite) ?? '';
  const raw = typeof params['next'] === 'string' ? params['next'] : '';
  // Same rule as the actions: within this app only, never protocol-relative.
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '';

  // Somebody already signed in who followed an invitation should land on the
  // invitation, not be bounced to their existing workspace.
  if (await getSession()) redirect(next || '/app');

  const policy = await getSignUpPolicy();
  const code = normalizeInviteCode(typeof params['code'] === 'string' ? params['code'] : '');

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <Wordmark tag={policy.tag ?? undefined} />
        <SignUpForm website={website} next={next} policy={policy} code={code} />
        <p className={styles.foot}>
          Already have an account?{' '}
          <Link href={next ? `/auth/sign-in?next=${encodeURIComponent(next)}` : '/auth/sign-in'}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
