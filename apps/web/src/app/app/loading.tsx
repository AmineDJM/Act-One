import styles from './app.module.css';

/** The projects page, before its data: the bar and three productions in outline. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="skeleton" style={{ width: 90, height: 12 }} />
          <span className="skeleton" style={{ width: 320, height: 44 }} />
          <span className="skeleton" style={{ width: 380, height: 16 }} />
          <span className="skeleton" style={{ width: '100%', height: 56, marginTop: 'var(--space-3)' }} />
        </div>
        <div className="skeleton" style={{ height: 300, borderRadius: 'var(--radius-lg)' }} />
      </div>
      <div className={styles.projects}>
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton" style={{ height: 170, borderRadius: 'var(--radius-lg)' }} />
        ))}
      </div>
    </div>
  );
}
