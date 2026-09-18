import {
  PRODUCTION_PHASES,
  PRODUCTION_PHASE_LABELS,
  PRODUCTION_PHASE_LINES,
  phaseIndex,
  productionPhase,
  type ProjectStage,
} from '@act-one/core';
import styles from '../../app.module.css';

/**
 * Where the production stands, in six words.
 *
 * The nine-step timeline says what a running job is doing right now; this
 * says what the whole thing is, at rest and in motion alike. A customer who
 * opens the page a day later should be able to answer "where are we?" without
 * reading anything.
 *
 * A production that has not started, or that stopped, is not on the rail:
 * putting a broken production somewhere along it would read as progress.
 */
export function PhaseRail({ stage }: { stage: ProjectStage }) {
  const current = productionPhase(stage);
  if (!current) return null;
  const at = phaseIndex(current);

  return (
    <ol className={styles.phaseRail} aria-label="Production phase">
      {PRODUCTION_PHASES.map((phase, index) => (
        <li
          key={phase}
          className={styles.phase}
          data-state={index < at ? 'done' : index === at ? 'current' : 'upcoming'}
          {...(index === at ? { 'aria-current': 'step' as const } : {})}
        >
          <span className={styles.phaseName}>{PRODUCTION_PHASE_LABELS[phase]}</span>
          <span className={styles.phaseLine}>{PRODUCTION_PHASE_LINES[phase]}</span>
        </li>
      ))}
    </ol>
  );
}
