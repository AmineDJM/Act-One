import { getPlatformConfig } from '@/server/platform.ts';
import { PlanEditor } from './PlanEditor.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

export default async function PlansPage() {
  const { plans } = await getPlatformConfig();

  return (
    <>
      <header className={styles.head}>
        <h1>Plans & pricing</h1>
        <p className="lede">
          Prices and entitlements are data, not code. Feature checks ask whether an organisation has
          an entitlement, never which plan it is on — so changing what a tier unlocks takes effect
          immediately and cannot strand a customer mid-project.
        </p>
      </header>

      <div className={styles.planGrid}>
        {[...plans].sort((a, b) => a.sortOrder - b.sortOrder).map((plan) => (
          <PlanEditor key={plan.id} plan={plan} />
        ))}
      </div>
    </>
  );
}
