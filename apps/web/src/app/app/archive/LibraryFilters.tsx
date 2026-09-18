'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ASSET_SOURCE_LABELS, AssetSource, LIBRARY_CATEGORY_LABELS, LibraryCategory } from '@act-one/core';
import styles from '../app.module.css';

export type FilterState = {
  q: string;
  category: LibraryCategory | '';
  source: AssetSource | '';
  project: string;
  favorite: boolean;
  approved: boolean;
};

/**
 * The search and the narrowing, kept in the address.
 *
 * Every change is a new URL, so a filtered library can be sent to a
 * colleague and the back button does what it says. The search waits a
 * beat for the person to finish typing.
 */
export function LibraryFilters({ state, projects }: { state: FilterState; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(state.q);
  const first = useRef(true);

  const navigate = (next: Partial<FilterState>) => {
    const merged = { ...state, q, ...next };
    const params = new URLSearchParams();
    if (merged.q) params.set('q', merged.q);
    if (merged.category) params.set('category', merged.category);
    if (merged.source) params.set('source', merged.source);
    if (merged.project) params.set('project', merged.project);
    if (merged.favorite) params.set('favorite', '1');
    if (merged.approved) params.set('approved', '1');
    const query = params.toString();
    start(() => router.replace(query ? `/app/archive?${query}` : '/app/archive', { scroll: false }));
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const handle = setTimeout(() => {
      if (q !== state.q) navigate({ q });
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className={styles.listTools} data-pending={pending || undefined}>
      <input
        type="search"
        className={`input ${styles.search}`}
        placeholder="> search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        aria-label="Search the archive"
      />
      <select className={`input ${styles.filterSelect}`} value={state.category} onChange={(event) => navigate({ category: event.target.value as FilterState['category'] })} aria-label="Category">
        <option value="">All categories</option>
        {LibraryCategory.options.map((value) => (
          <option key={value} value={value}>
            {LIBRARY_CATEGORY_LABELS[value]}
          </option>
        ))}
      </select>
      {projects.length > 0 ? (
        <select className={`input ${styles.filterSelect}`} value={state.project} onChange={(event) => navigate({ project: event.target.value })} aria-label="Production">
          <option value="">All productions</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      ) : null}
      <select className={`input ${styles.filterSelect}`} value={state.source} onChange={(event) => navigate({ source: event.target.value as FilterState['source'] })} aria-label="Source">
        <option value="">Any source</option>
        {AssetSource.options.map((value) => (
          <option key={value} value={value}>
            {ASSET_SOURCE_LABELS[value]}
          </option>
        ))}
      </select>
      <button type="button" className={styles.chip} data-on={state.favorite || undefined} onClick={() => navigate({ favorite: !state.favorite })} aria-pressed={state.favorite}>
        ★ Favourites
      </button>
      <button type="button" className={styles.chip} data-on={state.approved || undefined} onClick={() => navigate({ approved: !state.approved })} aria-pressed={state.approved}>
        ✓ Approved
      </button>
    </div>
  );
}
