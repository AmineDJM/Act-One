'use client';

import { useActionState } from 'react';
import { EditorialCadence, type EditorialSchedule } from '@act-one/core';
import { saveScheduleAction, type BlogActionState } from './actions.ts';
import styles from '../admin.module.css';

const CADENCE_LABELS: Record<string, string> = {
  manual: 'only when asked',
  every_2_days: 'every two days',
  every_3_days: 'every three days',
  weekly: 'once a week',
};

/**
 * The journal's rules.
 *
 * Drafting and publishing are separate switches on purpose: drafting costs a
 * few model calls, publishing spends the product's reputation. The default
 * is a machine that writes and a person who decides.
 */
export function ScheduleForm({ schedule }: { schedule: EditorialSchedule }) {
  const [state, save, saving] = useActionState<BlogActionState, FormData>(saveScheduleAction, { error: null });

  return (
    <form action={save} className={styles.section}>
      <h2>The rules</h2>
      <label className={styles.checkRow}>
        <input type="checkbox" name="autoDraft" defaultChecked={schedule.autoDraft} />
        <span>Let the editor draft articles on a schedule. They arrive as drafts, waiting for a person.</span>
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" name="autoPublish" defaultChecked={schedule.autoPublish} />
        <span>
          <strong>Publish them without a person.</strong> Off unless you mean it: a drafted article that passes its own
          checks still says things in the product&apos;s name.
        </span>
      </label>
      <label className="field">
        <span>How often</span>
        <select name="cadence" className="input" defaultValue={schedule.cadence}>
          {EditorialCadence.options.map((option) => (
            <option key={option} value={option}>
              {CADENCE_LABELS[option] ?? option}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>The editorial line every article is written against</span>
        <textarea name="brief" className="input" rows={4} defaultValue={schedule.brief} maxLength={1200} />
      </label>
      <label className="field">
        <span>Topics you want covered, one per line</span>
        <textarea name="topics" className="input" rows={4} defaultValue={schedule.topics.join('\n')} />
      </label>
      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {state.error ? <span className="error">{state.error}</span> : state.message ? <span className="hint">{state.message}</span> : null}
        {schedule.lastRunAt ? <span className="muted" style={{ fontSize: '0.84rem' }}>Last drafted {schedule.lastRunAt.slice(0, 16).replace('T', ' ')}.</span> : null}
      </div>
    </form>
  );
}
