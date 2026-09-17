import type { OperationalEvent } from '@act-one/core';
import styles from '../admin.module.css';

/**
 * One line of the log, with its detail folded away.
 *
 * A cause chain is what an operator actually needs when something broke, and
 * it is also four lines of stack trace that would make the list unreadable if
 * every row showed it. `<details>` rather than client-side state: the log view
 * stays a server component, so opening a row costs nothing and the page works
 * with JavaScript still loading.
 */
export function LogRow({ event }: { event: OperationalEvent }) {
  const hasDetail = Object.keys(event.detail).length > 0;
  const time = new Date(event.at);

  return (
    <li className={styles.logItem} data-level={event.level}>
      <details>
        <summary>
          <time dateTime={event.at} title={time.toISOString()}>
            {time.toLocaleTimeString('en-GB', { hour12: false })}
          </time>
          <span className={styles.logLevel} data-level={event.level}>
            {event.level}
          </span>
          <span className={styles.logSource}>{event.source}</span>
          <code className={styles.logEvent}>{event.event}</code>
          <span className={styles.logMessage}>{event.message}</span>
          {event.durationMs !== null ? (
            <span className={styles.logDuration}>{formatDuration(event.durationMs)}</span>
          ) : null}
        </summary>

        <div className={styles.logDetail}>
          <dl>
            <dt>When</dt>
            <dd>{time.toISOString()}</dd>
            {event.organizationId ? (
              <>
                <dt>Organisation</dt>
                <dd>
                  <code>{event.organizationId}</code>
                </dd>
              </>
            ) : null}
            {event.projectId ? (
              <>
                <dt>Project</dt>
                <dd>
                  <code>{event.projectId}</code>
                </dd>
              </>
            ) : null}
            {event.jobId ? (
              <>
                <dt>Job</dt>
                <dd>
                  <code>{event.jobId}</code>
                </dd>
              </>
            ) : null}
            {event.actorUserId ? (
              <>
                <dt>Actor</dt>
                <dd>
                  <code>{event.actorUserId}</code>
                </dd>
              </>
            ) : null}
          </dl>
          {hasDetail ? <pre>{JSON.stringify(event.detail, null, 2)}</pre> : null}
        </div>
      </details>
    </li>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
