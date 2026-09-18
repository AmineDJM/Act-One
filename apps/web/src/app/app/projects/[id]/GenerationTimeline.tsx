'use client';

import { GENERATION_STATUS_LABELS, PRODUCT_NAME, type GenerationTimeline as Timeline } from '@act-one/core';
import { Index } from '@/components/ui/Prompt.tsx';
import styles from '../../app.module.css';

/**
 * The generation, as nine steps.
 *
 * `01  Product research  COMPLETE` down to `09  Final composition  WAITING`.
 * The step in progress carries the live lines the worker wrote — a page
 * read, a scene rendered — and a finished step opens to what it did. Only
 * curated activity, never a log line: the console has those.
 */
export function GenerationTimeline({ timeline, message }: { timeline: Timeline; message?: string | null }) {
  return (
    <div className={styles.timeline}>
      <div className={styles.timelineHead}>
        <span style={{ color: 'var(--accent)' }}>&gt;</span> {PRODUCT_NAME.toUpperCase()} / GENERATION
      </div>
      <ol className={styles.timelineSteps}>
        {timeline.steps.map((step) => {
          const open = step.status === 'building' || (step.status === 'failed' && step.activity.length > 0);
          const expandable = step.details.length > 0 && step.status !== 'building';
          return (
            <li key={step.key} data-status={step.status}>
              {expandable ? (
                <details className={styles.timelineRow}>
                  <summary>
                    <Index value={step.index + 1} />
                    <span className={styles.timelineLabel}>{step.label}</span>
                    <span className={styles.timelineStatus}>{GENERATION_STATUS_LABELS[step.status]}</span>
                  </summary>
                  <ul className={styles.timelineDetails}>
                    {step.details.map((detail, index) => (
                      <li key={index}>→ {detail}</li>
                    ))}
                  </ul>
                </details>
              ) : (
                <div className={styles.timelineRow}>
                  <div className={styles.timelineLine}>
                    <Index value={step.index + 1} />
                    <span className={styles.timelineLabel}>{step.label}</span>
                    <span className={styles.timelineStatus}>
                      {step.status === 'building' ? <span className="status__dot" aria-hidden="true" /> : null}
                      {GENERATION_STATUS_LABELS[step.status]}
                    </span>
                  </div>
                  {open ? (
                    <ul className={styles.timelineActivity} aria-live="polite">
                      {step.activity.map((event) => (
                        <li key={event.id} data-kind={event.kind} data-state={event.status}>
                          {event.kind === 'page' || event.kind === 'scene' || event.kind === 'passage' ? (
                            <>
                              <Index value={(event.index ?? 0) + 1} />
                              <span className={styles.activityLabel}>{event.label}</span>
                              <span className={styles.activityTick}>{event.status === 'failed' ? '✕' : event.status === 'active' ? '…' : '✓'}</span>
                            </>
                          ) : (
                            <>
                              <span className={styles.activityPrompt}>&gt;</span>
                              <span className={styles.activityLabel}>
                                {event.label}
                                {event.detail ? <span className="muted"> · {event.detail}</span> : null}
                              </span>
                              <span className={styles.activityTick}>{event.status === 'done' ? '✓' : event.status === 'failed' ? '✕' : ''}</span>
                            </>
                          )}
                        </li>
                      ))}
                      {message &&
                      !/^read /i.test(message) &&
                      !step.activity.some((event) => event.status === 'active' && event.label === message.toLowerCase()) ? (
                        <li data-kind="message">
                          <span className={styles.activityPrompt}>&gt;</span>
                          <span className={styles.activityLabel}>{message.toLowerCase()}</span>
                          <span className={styles.activityTick} aria-hidden="true">
                            <span className={styles.cursor} />
                          </span>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
