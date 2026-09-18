'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reorderEntriesAction } from './actions.ts';
import styles from '../admin.module.css';

type Item = { id: string; company: string; title: string; launchOfTheWeek: boolean; featured: boolean };

/**
 * The public order, as a list to move things in.
 *
 * The launch of the week and featured films always come first on the site
 * whatever the order says; this is the order among equals.
 */
export function ReorderList({ entries }: { entries: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(entries);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    setItems(next);
  };

  const dirty = items.some((item, index) => item.id !== entries[index]?.id);

  return (
    <section className={styles.section} style={{ marginBottom: 'var(--space-5)' }}>
      <h2>Order on the site</h2>
      <ol className={styles.orderList}>
        {items.map((item, index) => (
          <li key={item.id}>
            <span className="mono muted">{String(index + 1).padStart(2, '0')}</span>
            <span>
              <strong>{item.company}</strong> · {item.title}
              {item.launchOfTheWeek ? <span className="badge badge--ok" style={{ marginLeft: 8 }}>Launch of the week</span> : null}
              {item.featured ? <span className="badge" style={{ marginLeft: 8 }}>Featured</span> : null}
            </span>
            <span className={styles.orderTools}>
              <button type="button" className="btn btn--ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">
                ↑
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down">
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
        <button
          type="button"
          className="btn"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const result = await reorderEntriesAction({ ids: items.map((item) => item.id) });
              setMessage(result.error ?? result.message ?? null);
              if (!result.error) router.refresh();
            })
          }
        >
          {pending ? 'Saving…' : 'Save order'}
        </button>
        {message ? <span className="hint">{message}</span> : null}
      </div>
    </section>
  );
}
