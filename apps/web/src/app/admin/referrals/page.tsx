import { REFERRAL_STAGE_LABELS, ReferralStage } from '@act-one/core';
import { getReferralProgram, listReferralsForConsole } from '@/server/referrals.ts';
import { ProgramForm } from './ProgramForm.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * The referral programme, for the operator.
 *
 * The rules first, then what they produced: who brought whom, how far each
 * one got, what it paid, and — the question an operator actually asks — why
 * one earned nothing.
 */
export default async function ReferralsAdminPage() {
  const [program, { rows, counts }] = await Promise.all([getReferralProgram(), listReferralsForConsole(300)]);
  const granted = rows.reduce((sum, row) => sum + row.referral.inviterCreditsGranted + row.referral.invitedCreditsGranted, 0);

  return (
    <>
      <header className={styles.head}>
        <h1>Referrals</h1>
        <p className="lede">
          {program.enabled ? 'Running' : 'Off'} ·{' '}
          {ReferralStage.options.map((stage) => `${counts[stage] ?? 0} ${REFERRAL_STAGE_LABELS[stage].toLowerCase()}`).join(' · ')} · {granted} credits granted
        </p>
      </header>

      <ProgramForm program={program} />

      <section className={styles.section}>
        <h2>Who brought whom</h2>
        {rows.length === 0 ? (
          <p className={styles.empty}>Nobody has used a referral link yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Inviter</th>
                  <th>Invited</th>
                  <th>Workspace</th>
                  <th>Code</th>
                  <th>Stage</th>
                  <th className={styles.num}>Inviter</th>
                  <th className={styles.num}>Invited</th>
                  <th>Signed up</th>
                  <th>Why not counted</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ referral, inviterEmail, invitedEmail, organizationName }) => (
                  <tr key={referral.id}>
                    <td>{inviterEmail}</td>
                    <td>{invitedEmail}</td>
                    <td>{organizationName}</td>
                    <td className="mono">{referral.code}</td>
                    <td>{REFERRAL_STAGE_LABELS[referral.stage]}</td>
                    <td className={styles.num}>{referral.inviterCreditsGranted}</td>
                    <td className={styles.num}>{referral.invitedCreditsGranted}</td>
                    <td className="mono">{referral.signedUpAt.slice(0, 10)}</td>
                    <td className="muted">{referral.refusedReason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
