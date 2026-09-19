'use client';

import { useActionState } from 'react';
import { GRANTABLE_LIMITS } from '../limits.ts';
import {
  grantCreditsAction,
  setOrganizationInternalAction,
  setOrganizationLimitsAction,
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
  internal,
  limitOverrides,
  planLimits,
}: {
  organizationId: string;
  name: string;
  planId: string;
  plans: { id: string; name: string }[];
  suspended: boolean;
  internal: boolean;
  /** What has been lifted by hand. Blank means "whatever the plan says". */
  limitOverrides: Partial<Record<string, number>>;
  /** What the plan says, shown as the placeholder so the grant has a baseline. */
  planLimits: Record<string, number>;
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
  const [limitResult, setLimits, settingLimits] = useActionState<ActionResult | null, FormData>(
    setOrganizationLimitsAction,
    null,
  );
  const [internalResult, setInternal, settingInternal] = useActionState<ActionResult | null, FormData>(
    setOrganizationInternalAction,
    null,
  );

  const result = planResult ?? creditResult ?? suspendResult ?? limitResult ?? internalResult;
  const lifted = Object.keys(limitOverrides).length;

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
            {granting ? 'Adding…' : 'Add credits'}
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

      {/*
        Lifting a limit for one workspace.
        *
        * Blank means "whatever the plan says", and the plan's own number is
        * the placeholder — so an operator can see what they are changing from
        * without looking it up, and can undo a grant by emptying the box.
        */}
      <form action={setLimits} className={styles.limitGrant}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <div className={styles.limitGrantHead}>
          <span className="hint">
            Lifted limits{lifted > 0 ? ` · ${lifted} in force` : ''}
          </span>
          {/* Named for what it does: two buttons reading "Grant" in one
              drawer is how an operator adds credits meaning to lift a limit. */}
          <button className="btn btn--secondary" type="submit" disabled={settingLimits || internal}>
            {settingLimits ? 'Saving…' : 'Lift limits'}
          </button>
        </div>
        <div className={styles.limitGrantFields}>
          {GRANTABLE_LIMITS.map((field) => (
            <label key={field.name} className={styles.limitField}>
              <span>{field.label}</span>
              <input
                name={field.name}
                className="input"
                type="number"
                step="1"
                min="-1"
                max={field.ceiling}
                disabled={internal}
                placeholder={unlimited(planLimits[field.name])}
                defaultValue={limitOverrides[field.name] ?? ''}
              />
            </label>
          ))}
        </div>
        <p className="hint">
          Blank takes it back to the plan. −1 is unlimited. Credits are granted above, where the
          balance is kept.
        </p>
      </form>

      <form action={setInternal} className={styles.customerControlRow}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="internal" value={internal ? 'false' : 'true'} />
        <span className="hint">
          {internal
            ? 'Internal: not billed, not limited, not counted as revenue.'
            : 'A customer, on its plan.'}
        </span>
        <button className="btn btn--ghost" type="submit" disabled={settingInternal}>
          {settingInternal ? '…' : internal ? 'Make it a customer' : 'Make it internal'}
        </button>
      </form>

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

/** A plan's own number, as a placeholder. −1 reads as what it means. */
function unlimited(value: number | undefined): string {
  if (value === undefined) return '';
  return value === -1 ? 'unlimited' : String(value);
}
