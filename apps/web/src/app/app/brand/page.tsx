import Link from 'next/link';
import { requireSession } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import styles from '../app.module.css';

export const dynamic = 'force-dynamic';

export default async function BrandPage() {
  const session = await requireSession();
  const brands = await getStore().brands.list(session.organizationId);

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1>Brand</h1>
          <p className="secondary" style={{ marginTop: 'var(--space-2)', maxWidth: '64ch' }}>
            Measured from your own site rather than filled in by hand. Confirm it once and every
            film in this workspace is set in it.
          </p>
        </div>
      </div>

      {brands.length === 0 ? (
        <div className={styles.empty}>
          <h2 style={{ fontSize: '1.2rem' }}>Nothing measured yet.</h2>
          <p className="secondary" style={{ maxWidth: '46ch' }}>
            Start a project and we will read your site and extract the brand automatically.
          </p>
          <Link href="/app" className="btn">
            Start a project
          </Link>
        </div>
      ) : (
        <div className={styles.panels}>
          {brands.map((brand) => (
            <section key={brand.id} className={styles.panel}>
              <div className={styles.panelHead}>
                <h3>{brand.name}</h3>
                {brand.confirmedByUser ? (
                  <span className="badge badge--ok">Confirmed</span>
                ) : (
                  <span className="badge badge--warn">Unconfirmed</span>
                )}
              </div>

              <div className={styles.swatches}>
                {[brand.primaryColor, brand.secondaryColor, ...brand.accentColors]
                  .slice(0, 6)
                  .map((color) => (
                    <span
                      key={color}
                      className={styles.swatch}
                      style={{ background: color }}
                      title={color}
                    />
                  ))}
              </div>

              <dl className={styles.kv}>
                <div className={styles.kvRow}>
                  <dt>Display type</dt>
                  <dd>
                    {brand.typography.find((font) => font.role === 'display')?.family ?? 'System'}
                  </dd>
                </div>
                <div className={styles.kvRow}>
                  <dt>Rendered as</dt>
                  <dd>
                    {brand.typography.find((font) => font.role === 'display')?.renderFamily ?? 'Inter'}
                  </dd>
                </div>
                <div className={styles.kvRow}>
                  <dt>Corner radius</dt>
                  <dd>{brand.cornerRadiusPx}px</dd>
                </div>
                <div className={styles.kvRow}>
                  <dt>Visual language</dt>
                  <dd>{brand.visualStyle}</dd>
                </div>
                <div className={styles.kvRow}>
                  <dt>Motion</dt>
                  <dd>{brand.motionStyle}</dd>
                </div>
                <div className={styles.kvRow}>
                  <dt>Measured from</dt>
                  <dd>{brand.sources.length} pages</dd>
                </div>
              </dl>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
