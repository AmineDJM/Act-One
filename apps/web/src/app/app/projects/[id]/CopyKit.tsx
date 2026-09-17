'use client';

import { useState } from 'react';
import { COPY_LABELS, groupCopy, type CopyLine } from '@act-one/core';
import styles from '../../app.module.css';

/**
 * The launch copy that goes around the film.
 *
 * Every line is one click from the clipboard, because this is copy somebody is
 * about to paste into four different boxes and retyping it is where a verified
 * claim quietly becomes an unverified one.
 */
export function CopyKitPanel({ lines }: { lines: CopyLine[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const groups = groupCopy(lines);
  if (groups.length === 0) return null;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Launch copy</h3>
        <span className="badge">{lines.length} lines</span>
      </div>

      {groups.map((group) => (
        <div key={group.surface} className={styles.copyGroup}>
          <h4>{COPY_LABELS[group.surface]}</h4>
          <ul>
            {group.lines.map((line, index) => {
              const key = `${group.surface}-${index}`;
              return (
                <li key={key}>
                  <p>{line.text}</p>
                  <div className={styles.copyFoot}>
                    {line.claim ? (
                      <span className={styles.cite} title={`Rests on: ${line.claim}`}>
                        cited
                      </span>
                    ) : (
                      <span />
                    )}
                    <button
                      className="btn btn--ghost"
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(line.text)
                          .then(() => setCopied(key))
                          .catch(() => undefined);
                      }}
                    >
                      {copied === key ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <p className="hint">
        Anything asserting a figure carries the claim it rests on. Lines resting on something we
        could not verify were not written.
      </p>
    </section>
  );
}
