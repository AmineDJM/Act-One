import Link from 'next/link';
import type { LibraryCard } from '@/server/library.ts';
import { Prompt } from '@/components/ui/Prompt.tsx';
import styles from '../../app.module.css';

/**
 * What this project can use.
 *
 * A view over the library — what is attached to this project and what is
 * shared with every project — never a second copy. The pictures the
 * research kept arrive here on their own; a person adds the rest in the
 * library, with this project already ticked.
 */
export function ProjectAssets({ projectId, cards, total }: { projectId: string; cards: LibraryCard[]; total: number }) {
  const here = `/app/library?project=${encodeURIComponent(projectId)}`;
  return (
    <section className={styles.panel} style={{ gridColumn: '1 / -1' }}>
      <div className={styles.panelHead}>
        <Prompt as="h3" tone="text">
          Assets <span className="muted">({total})</span>
        </Prompt>
        <span className={styles.panelLinks}>
          <Link href={`${here}#upload`}>Add pictures</Link>
          {total > cards.length ? <Link href={here}>All {total} →</Link> : <Link href={here}>Open library →</Link>}
        </span>
      </div>
      {cards.length === 0 ? (
        <p className="secondary" style={{ maxWidth: '54ch' }}>
          Nothing yet. Research screenshots land here as the product is read; your own pictures,
          added in the library, appear the moment they are shared with this project.
        </p>
      ) : (
        <ul className={styles.assetStrip}>
          {cards.map((card) => (
            <li key={card.id} className={styles.assetStripItem} data-approved={card.approved || undefined}>
              <a href={card.url} target="_blank" rel="noreferrer" title={card.description || card.name} data-vector={card.contentType.includes('svg') || undefined}>
                <img src={card.thumbUrl} alt={card.name} loading="lazy" decoding="async" />
              </a>
              <span className={styles.assetStripName}>{card.name}</span>
              <span className={styles.assetStripMeta}>
                {card.categoryLabel.toUpperCase()}
                {card.approved ? ' · ✓' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
