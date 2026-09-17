'use client';

import { useActionState } from 'react';
import {
  grantCreditsAction,
  setOrganizationPlanAction,
  setOrganizationSuspendedAction,
  type ActionResult,
} from '../actions.ts';
import styles from '../admin.module.css';

/**
 * The operator's controls for one workspace.
 *
 * Folded away by default: this table is read far more often than it is acted
 * on, and a row of live controls beside every customer is how somebody
 * suspends the wrong one.
 */
export function CustomerControls({
  organizationId,
  name,
  planId,
  plans,
  suspended,
}: {
  organizationId: string;
  name: string;
  planId: string;
  plans: { id: string; name: string }[];
  suspended: boolean;
}) {
  const [planResult, setPlan, settingPlan] = useActionState<ActionResult | null, FormData>(
    setOrganizationPlanAction,
    null,
  );
  const [creditResult, grant, granting] = useActionState<ActionResult | null, FormData>(
    grantCreditsAction,
    null,
  );
  const [suspendResult, suspend, suspending] = useActionState<ActionResult | null, FormData>(
    setOrganizationSuspendedAction,
    null,
  );

  const result = planResult ?? creditResult ?? suspendResult;

  return (
    <details className={styles.customerControls}>
      <summary>Manage</summary>

      <div className={styles.customerControlRow}>
        <form action={setPlan}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <label htmlFor={`plan-${organizationId}`} className="hint">
            Plan
          </label>
          <select id={`plan-${organizationId}`} name="planId" className="input" defaultValue={planId}>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <button className="btn btn--secondary" type="submit" disabled={settingPlan}>
            {settingPlan ? 'Saving…' : 'Set plan'}
          </button>
        </form>

        <form action={grant}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <label htmlFor={`credits-${organizationId}`} className="hint">
            Credits
          </label>
          <input
            id={`credits-${organizationId}`}
            name="credits"
            className="input"
            type="number"
            step="100"
            placeholder="500"
            // Negative takes credits back, which is the same control and the
            // same audit trail as giving them.
            defaultValue={500}
          />
          <button className="btn btn--secondary" type="submit" disabled={granting}>
            {granting ? 'Adding…' : 'Grant'}
          </button>
        </form>

        <form action={suspend}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="suspend" value={suspended ? 'false' : 'true'} />
          <span className="hint">{suspended ? 'Suspended' : 'Active'}</span>
          <button className="btn btn--ghost" type="submit" disabled={suspending}>
            {suspending ? '…' : suspended ? 'Restore' : 'Suspend'}
          </button>
        </form>
      </div>

      {result ? (
        <p className={styles.verdict} data-ok={result.ok} role="status">
          {result.message}
        </p>
      ) : (
        <p className="hint">
          Suspending stops new work starting. It never deletes anything {name} has already made.
        </p>
      )}
    </details>
  );
}
