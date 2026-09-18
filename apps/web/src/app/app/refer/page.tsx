import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PRODUCT_NAME, REFERRAL_STAGE_LABELS } from '@act-one/core';
import { requireSessionForPage } from '@/server/auth.ts';
import { loadReferralOverview } from '@/server/referrals.ts';
import { Prompt, Status } from '@/components/ui/Prompt.tsx';
import { ReferralLink } from './ReferralLink.tsx';
import styles from '../app.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invite a founder' };

/**
 * The customer's referral page.
 *
 * One link, what it pays, and who has used it. No leaderboard, no badges:
 * a founder telling another founder is a recommendation, and the page reads
 * like one.
 */
export default async function ReferPage() {
  const session = await requireSessionForPage('/app/refer');
  const overview = await loadReferralOverview(session);
  if (!overview.program.enabled) notFound();

  const { program, totals } = overview;

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headCopy}>
          <Prompt tone="accent" chevron={false}>
            {PRODUCT_NAME} / Invitations
          </Prompt>
          <h1>{program.headline}</h1>
          <p className={styles.headSub}>{program.terms}</p>
        </div>
      </div>

      <ReferralLink code={overview.code} link={overview.link} />

      <div className={styles.panels}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>What it pays</h3>
          </div>
          <dl className={styles.kv}>
            <div className={styles.kvRow}>
              <dt>You receive</dt>
              <dd>
                {program.inviterCredits} credits when they {program.qualifyOn === 'paid' ? 'start paying' : 'produce their first film'}
                {program.paidBonusCredits > 0 ? `, and ${program.paidBonusCredits} more the first time they pay` : ''}.
              </dd>
            </div>
            <div className={styles.kvRow}>
              <dt>They receive</dt>
              <dd>{program.invitedCredits > 0 ? `${program.invitedCredits} credits, at the same moment.` : 'The usual welcome.'}</dd>
            </div>
            {program.tiers.length > 0 ? (
              <div className={styles.kvRow}>
                <dt>Along the way</dt>
                <dd>
                  {program.tiers
                    .slice()
                    .sort((a, b) => a.at - b.at)
                    .map((tier) => `${tier.label || `${tier.at} founders`}: +${tier.bonusCredits}`)
                    .join(' · ')}
                </dd>
              </div>
            ) : null}
            {program.maxRewardedPerInviter !== null ? (
              <div className={styles.kvRow}>
                <dt>Limit</dt>
                <dd>{program.maxRewardedPerInviter} rewarded invitations.</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>Where they are</h3>
            <span className="badge">{totals.creditsEarned} credits earned</span>
          </div>
          {overview.rows.length === 0 ? (
            <p className="secondary" style={{ fontSize: '0.9rem' }}>
              Nobody has used your link yet. It works anywhere: a reply, a thread, a talk.
            </p>
          ) : (
            <ul className={styles.referList}>
              {overview.rows.map((row) => (
                <li key={row.id}>
                  <Status tone={row.stage === 'paid' ? 'ready' : row.stage === 'qualified' ? 'active' : row.stage === 'refused' ? 'quiet' : 'quiet'}>
                    {REFERRAL_STAGE_LABELS[row.stage as keyof typeof REFERRAL_STAGE_LABELS] ?? row.label}
                  </Status>
                  <span className="mono muted">{row.when.slice(0, 10)}</span>
                  <span>{row.credits > 0 ? `+${row.credits} credits` : '—'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            Credits are counted the moment the person you invited produces a film. See them on{' '}
            <Link href="/app/billing">billing</Link>.
          </p>
        </section>
      </div>
    </>
  );
}
