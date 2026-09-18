import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { inviteRefusal } from '@act-one/core';
import { getCurrentUser, hashToken } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { referralCodeByCode } from '@/server/referrals.ts';
import { AcceptInvite } from './AcceptInvite.tsx';
import { Wordmark } from '@/components/ui/Wordmark.tsx';
import styles from '../../auth/auth.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Join a workspace',
  // An invitation link is a credential. It must never be indexed, and a
  // referrer must not carry the token to whatever the invitee clicks next.
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const store = getStore();

  const invitation = await store.invitations.findByTokenHash(hashToken(token));

  /*
   * The same address serves two invitations.
   *
   * A workspace invitation is a long random token; a referral code is a
   * person's name. When the token is not a workspace invitation but is
   * somebody's live referral code, this is /invite/AMINE — the public link a
   * customer shares — and it belongs on the sign-up page with the code
   * already filled in.
   */
  if (!invitation) {
    const referral = await referralCodeByCode(token);
    if (referral) redirect(`/auth/sign-up?code=${encodeURIComponent(referral.code.code)}&from=${encodeURIComponent(referral.inviterName)}`);
  }
  const refusal = inviteRefusal(invitation);
  const organization = invitation ? await store.organizations.get(invitation.organizationId) : null;
  const user = await getCurrentUser();

  // Somebody who is not signed in needs an account first; the token rides
  // through so they land back here rather than in an empty workspace.
  if (!refusal && !user) {
    redirect(`/auth/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <Wordmark />

        <div className={styles.card}>
          {refusal ? (
            <>
              <h1>This link does not work</h1>
              <p className="secondary">{refusal}</p>
              <Link className="btn btn--secondary" href="/app">
                Go to your workspace
              </Link>
            </>
          ) : (
            <>
              <h1>Join {organization?.name ?? 'this workspace'}</h1>
              <p className="secondary">
                You were invited as <strong>{invitation?.role}</strong>. You are signed in as{' '}
                {user?.email}.
              </p>
              <AcceptInvite token={token} organizationName={organization?.name ?? 'the workspace'} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
