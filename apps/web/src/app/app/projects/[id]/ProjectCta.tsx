'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FailureNotice, GenerationTimeline as Timeline, PrimaryCta, RunView } from '@act-one/core';
import { GenerationTimeline } from './GenerationTimeline.tsx';
import {
  createCampaignAction,
  retryProjectAction,
  startRenderAction,
  type FormState,
} from '../../actions.ts';
import { site } from '@/lib/site.ts';
import styles from '../../app.module.css';

/**
 * The single strong call to action.
 *
 * While work is in flight this becomes a progress panel and polls — a customer
 * who has to refresh to find out whether their film is done does not believe
 * the film is being made.
 */
export function ProjectCta(props: {
  projectId: string;
  cta: PrimaryCta;
  label: string;
  headline: string;
  body: string;
  /** The work in flight, as steps with timing. Null when nothing is running. */
  run: RunView | null;
  /** The production as nine steps, read off the jobs and their activity. */
  timeline: Timeline | null;
  disabled: boolean;
  /** What to do about it when the action is blocked by the plan. */
  remedy?: 'none' | 'upgrade' | 'wait' | 'billing' | 'contact';
  /**
   * What to say when the production is not going to plan. A notice that is
   * still work — a shot being rebuilt or refined — sits quietly under the
   * progress; one that needs a person takes over the headline, because that
   * is the only thing on this page worth reading at that moment.
   */
  notice?: FailureNotice | null;
}) {
  const router = useRouter();
  const working = props.cta === 'watch_progress';

  const [renderState, render, rendering] = useActionState<FormState, FormData>(startRenderAction, {
    error: null,
  });
  const [campaignState, campaign, cutting] = useActionState<FormState, FormData>(
    createCampaignAction,
    { error: null },
  );
  const [retryState, retry, retrying] = useActionState<FormState, FormData>(retryProjectAction, {
    error: null,
  });

  useEffect(() => {
    if (!working) return;
    // Server-rendered state, refreshed on an interval. Long enough not to
    // hammer the database, short enough that a finished stage appears while
    // the customer is still looking at the page.
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [working, router]);

  /*
   * Every CTA that is not a progress state must resolve to something the
   * customer can press. A CTA with no action renders no button at all, which is
   * how "render the film" and "try again" both became dead ends on the two
   * pages where somebody most needs a way forward.
   */
  const action =
    props.cta === 'render_film'
      ? render
      : props.cta === 'create_variants'
        ? campaign
        : // A project that never started, and a failed one, both resume from the
          // furthest stage that has what it needs.
          props.cta === 'retry' || props.cta === 'understand_product'
          ? retry
          : null;
  const pending = rendering || cutting || retrying;
  const result = renderState.error ?? campaignState.error ?? retryState.error;

  /*
   * Where the notice goes depends on whether anything is running, not on how
   * serious it is. With work in flight it sits quietly under the progress;
   * with nothing running it is the only thing on the page worth reading, so
   * it takes the headline — including a production paused on somebody else's
   * outage, which used to have nowhere to appear at all.
   */
  const showingProgress = working && props.run !== null;
  const stopped = !showingProgress ? (props.notice ?? null) : null;
  const inFlight = showingProgress ? (props.notice ?? null) : null;
  const headline = stopped?.title ?? props.headline;
  const body = stopped?.body ?? props.body;
  // The primary action is the notice's own when there is one: "Continue
  // discovery" and "Resume mastering" say what pressing it does, where
  // "Try again" says only that something went wrong.
  const primary = stopped?.action ?? null;
  const label = primary && primary.action !== 'billing' ? primary.label : props.label;

  return (
    <section className={styles.cta} data-stopped={stopped?.tone === 'attention' ? 'true' : undefined}>
      <div className={styles.ctaCopy}>
        <h2>{headline}</h2>
        {working && props.run ? (
          <>
            <RunProgress run={props.run} timeline={props.timeline} />
            {inFlight ? (
              <p className={styles.ctaNotice}>
                <strong>{inFlight.title}.</strong> {inFlight.body}
              </p>
            ) : null}
          </>
        ) : (
          <p>{body}</p>
        )}
        {stopped?.detail ? <p className={styles.ctaDetail}>{stopped.detail}</p> : null}
        {result ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>
            {result}
          </p>
        ) : null}
      </div>

      {/*
       * A blocked action offers the way out rather than a dead button.
       *
       * Hitting a plan ceiling used to leave a greyed-out control beside a
       * sentence explaining why, and nothing to press — which is the one
       * moment a customer has decided they want the thing badly enough to
       * pay for it.
       */}
      {action && props.disabled && props.remedy === 'upgrade' ? (
        <Link href="/app/billing" className="btn btn--lg">
          See plans
        </Link>
      ) : action && props.disabled && props.remedy === 'contact' && site.supportEmail ? (
        <a href={`mailto:${site.supportEmail}`} className="btn btn--lg btn--secondary">
          Talk to us
        </a>
      ) : action && props.disabled && props.remedy === 'contact' ? null : primary?.action === 'billing' ? (
        <Link href="/app/billing" className="btn btn--lg">
          {primary.label}
        </Link>
      ) : action ? (
        <form action={action}>
          <input type="hidden" name="projectId" value={props.projectId} />
          <button className="btn btn--lg" type="submit" disabled={pending || props.disabled}>
            {pending ? 'Starting…' : label}
          </button>
        </form>
      ) : working ? (
        <span className="badge">Working…</span>
      ) : null}
    </section>
  );
}

/**
 * The wait, as steps.
 *
 * A single bar that filled and snapped back at every stage told the customer
 * nothing except that something moved. This names the steps, ticks the clock
 * on the one in progress, and estimates what is left from how long the same
 * steps have taken on this platform before — or says plainly that there is
 * no history yet. The bar never goes backwards: it is the whole run, and it
 * only ever climbs.
 */
function RunProgress({ run, timeline }: { run: RunView; timeline: Timeline | null }) {
  // The clock starts at the moment the server computed the view, so the first
  // client render matches the server's markup to the second; it ticks from there.
  const [now, setNow] = useState(() => Date.parse(run.asOf));
  // The furthest the bar has been for this run. A refresh that computes a
  // slightly lower figure — a step's weight revised, a worker restart —
  // must not be seen as the work undoing itself.
  const peak = useRef<{ id: string; overall: number }>({ id: run.id, overall: run.overall });
  if (peak.current.id !== run.id) peak.current = { id: run.id, overall: run.overall };
  else peak.current.overall = Math.max(peak.current.overall, run.overall);
  const overall = peak.current.overall;

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.asOf]);

  const sinceView = Math.max(0, now - Date.parse(run.asOf));
  const elapsed = run.elapsedMs + sinceView;
  const remaining = run.remainingMs === null ? null : Math.max(0, run.remainingMs - sinceView);
  const current = run.steps.find((step) => step.state === 'current');

  return (
    <div className={styles.run}>
      {timeline ? <GenerationTimeline timeline={timeline} message={run.waiting ? 'waiting for a free worker' : run.message} /> : null}
      <ol className={styles.runSteps} data-hidden={Boolean(timeline)} style={timeline ? { display: 'none' } : undefined}>
        {run.steps.map((step) => (
          <li key={step.key} data-state={step.state}>
            <span className={styles.runTick} aria-hidden="true">
              {step.state === 'done' ? '✓' : step.state === 'current' ? '●' : '○'}
            </span>
            <span className={styles.runLabel}>{step.label}</span>
            <span className={styles.runTime}>
              {step.state === 'done' && step.elapsedMs !== null
                ? formatClock(step.elapsedMs)
                : step.state === 'current'
                  ? run.waiting
                    ? 'queued'
                    : formatClock((step.elapsedMs ?? 0) + sinceView) +
                      (step.typicalMs ? ` · usually ${formatAbout(step.typicalMs)}` : '')
                  : step.typicalMs
                    ? `usually ${formatAbout(step.typicalMs)}`
                    : ''}
            </span>
          </li>
        ))}
      </ol>
      {timeline ? null : run.message ? (
        <p className={styles.runMessage}>{run.message}</p>
      ) : current ? (
        <p className={styles.runMessage}>{current.label}…</p>
      ) : null}
      <div
        className={styles.progress}
        role="progressbar"
        aria-valuenow={Math.round(overall * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={styles.progressBar} style={{ width: `${Math.max(2, overall * 100)}%` }} />
      </div>
      <p className={styles.runTiming}>
        {`Started ${formatClock(elapsed)} ago`}
        {remaining === null
          ? ' · no estimate yet: this is the first run of its kind here.'
          : remaining < 15_000
            ? ' · any moment now.'
            : ` · ${formatAbout(remaining)} left.`}{' '}
        You can close the tab.
      </p>
    </div>
  );
}

/** 0:07, 1:40, 12:05 — a clock, because it ticks. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "about 3 min", "under a minute" — an estimate, so never to the second. */
function formatAbout(ms: number): string {
  if (ms < 45_000) return 'under a minute';
  const minutes = Math.round(ms / 60_000);
  return minutes <= 1 ? 'about a minute' : `about ${minutes} min`;
}
