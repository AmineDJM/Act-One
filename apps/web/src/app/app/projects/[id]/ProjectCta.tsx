'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { PrimaryCta } from '@act-one/core';
import {
  createCampaignAction,
  retryProjectAction,
  startRenderAction,
  type FormState,
} from '../../actions.ts';
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
  progress: number | null;
  status: string | null;
  disabled: boolean;
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

  return (
    <section className={styles.cta}>
      <div className={styles.ctaCopy}>
        <h2>{props.headline}</h2>
        <p>{props.status && working ? props.status : props.body}</p>
        {working ? (
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuenow={Math.round((props.progress ?? 0) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className={styles.progressBar} style={{ width: `${(props.progress ?? 0.05) * 100}%` }} />
          </div>
        ) : null}
        {result ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>
            {result}
          </p>
        ) : null}
      </div>

      {action ? (
        <form action={action}>
          <input type="hidden" name="projectId" value={props.projectId} />
          <button className="btn btn--lg" type="submit" disabled={pending || props.disabled}>
            {pending ? 'Starting…' : props.label}
          </button>
        </form>
      ) : working ? (
        <span className="badge">Working…</span>
      ) : null}
    </section>
  );
}
