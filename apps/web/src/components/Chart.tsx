import { fillDailyGaps, plot } from '@act-one/design';
import styles from './chart.module.css';

export type DailyPoint = { day: string; value: number };

/**
 * A small time series, drawn server-side.
 *
 * No charting library: this is one path and some rectangles, and a dependency
 * that ships a renderer, a tooltip engine and its own theme to draw them would
 * be larger than the whole console. Being SVG in the markup also means it
 * inherits the console's colour tokens and prints correctly.
 */
export function Sparkline({
  data,
  from,
  to,
  label,
  format,
  tone = 'accent',
  height = 72,
}: {
  data: readonly DailyPoint[];
  from: Date;
  to: Date;
  label: string;
  format: (value: number) => string;
  tone?: 'accent' | 'positive' | 'danger';
  height?: number;
}) {
  // Days with no rows are absent from the query, and drawing straight through
  // them would hide exactly the days worth noticing.
  const filled = fillDailyGaps(data, {
    day: (row) => row.day,
    from,
    to,
    empty: (day) => ({ day, value: 0 }),
  });

  const width = 720;
  const figure = plot({
    data: filled,
    value: (row) => row.value,
    label: (row) => row.day,
    width,
    height,
    // Room for the stroke, which would otherwise be clipped at the peak.
    padding: { top: 3, right: 0, bottom: 1, left: 0 },
  });

  const total = filled.reduce((sum, row) => sum + row.value, 0);
  const peak = filled.reduce((best, row) => (row.value > best.value ? row : best), filled[0] ?? { day: '', value: 0 });

  return (
    <figure className={styles.chart} data-tone={tone}>
      <figcaption>
        <span>{label}</span>
        <strong>{format(total)}</strong>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${format(total)} over ${filled.length} days, peaking at ${format(peak.value)} on ${peak.day}`}
      >
        <path className={styles.area} d={figure.area} />
        <path className={styles.line} d={figure.line} />
      </svg>
      <div className={styles.axis} aria-hidden="true">
        <span>{filled[0]?.day.slice(5)}</span>
        <span>{peak.value > 0 ? `peak ${format(peak.value)}` : 'nothing yet'}</span>
        <span>{filled[filled.length - 1]?.day.slice(5)}</span>
      </div>
    </figure>
  );
}

/** A ranked breakdown — where the money went, which operations ran most. */
export function BreakdownBars({
  rows,
  format,
}: {
  rows: readonly { label: string; value: number; note?: string }[];
  format: (value: number) => string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0) || 1;

  return (
    <ul className={styles.breakdown}>
      {rows.map((row) => (
        <li key={row.label}>
          <span>
            <span className={styles.breakdownLabel}>{row.label}</span>
            {row.note ? <span className={styles.breakdownNote}>{row.note}</span> : null}
          </span>
          <span className={styles.breakdownTrack}>
            <span className={styles.breakdownFill} style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span className={styles.breakdownValue}>{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}
