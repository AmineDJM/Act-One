import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth.ts';
import { SignInForm } from './SignInForm.tsx';
import { Wordmark } from '@/components/ui/Wordmark.tsx';
import styles from '../auth.module.css';

/*
 * Rendered per request, because a build has no database.
 *
 * The machine that runs the build is not the machine that runs the migrations,
 * so on a fresh environment the tables this reads do not exist yet and
 * prerendering fails the whole deploy. It also reads settings an operator can
 * change from the console, which a page baked at build time would not notice.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  alternates: { canonical: '/auth/sign-in' },
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
        <Wordmark />
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
