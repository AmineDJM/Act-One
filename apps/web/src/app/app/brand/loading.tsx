import styles from '../app.module.css';

/** The brand page before its DNA: the rows in outline. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className={styles.head}>
        <div className={styles.headCopy}>
          <span className="skeleton" style={{ width: 120, height: 12 }} />
          <span className="skeleton" style={{ width: 240, height: 36 }} />
          <span className="skeleton" style={{ width: 520, height: 16 }} />
        </div>
      </div>
      <div className={styles.brandProjects}>
        {[0, 1].map((index) => (
          <span key={index} className="skeleton" style={{ width: 200, height: 58, borderRadius: 'var(--radius)' }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 640, borderRadius: 'var(--radius-lg)' }} />
    </div>
  );
}
