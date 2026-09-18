import styles from '../../app.module.css';

/** A project before its state is known: the head, the action, two panels. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className={styles.head}>
        <div className={styles.headCopy}>
          <span className="skeleton" style={{ width: 140, height: 12 }} />
          <span className="skeleton" style={{ width: 260, height: 36 }} />
          <span className="skeleton" style={{ width: 160, height: 14 }} />
        </div>
        <span className="skeleton" style={{ width: 120, height: 24 }} />
      </div>
      <div className="skeleton" style={{ height: 120, borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-5)' }} />
      <div className={styles.panels}>
        <div className="skeleton" style={{ height: 260, borderRadius: 'var(--radius-lg)' }} />
        <div className="skeleton" style={{ height: 260, borderRadius: 'var(--radius-lg)' }} />
      </div>
    </div>
  );
}
