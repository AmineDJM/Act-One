import styles from '../app.module.css';

/** The library before its pictures: the drop zone and six cards in outline. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className={styles.head}>
        <div className={styles.headCopy}>
          <span className="skeleton" style={{ width: 80, height: 12 }} />
          <span className="skeleton" style={{ width: 420, height: 36 }} />
          <span className="skeleton" style={{ width: 520, height: 16 }} />
        </div>
      </div>
      <div className="skeleton" style={{ height: 150, borderRadius: 'var(--radius-lg)' }} />
      <div className={styles.assetGrid} style={{ marginTop: 'var(--space-6)' }}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="skeleton" style={{ height: 300, borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    </div>
  );
}
