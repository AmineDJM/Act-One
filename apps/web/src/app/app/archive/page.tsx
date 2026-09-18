import type { Metadata } from 'next';
import { AssetSource, LibraryCategory } from '@act-one/core';
import type { LibraryFilter } from '@act-one/db';
import { requireSessionForPage } from '@/server/auth.ts';
import { loadLibrary } from '@/server/library.ts';
import { DotMatrix } from '@/components/ui/DotMatrix.tsx';
import { Prompt } from '@/components/ui/Prompt.tsx';
import { AssetCard } from './AssetCard.tsx';
import { LibraryFilters, type FilterState } from './LibraryFilters.tsx';
import { LibraryUploader } from './LibraryUploader.tsx';
import styles from '../app.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Archive · Act One' };

type Search = Record<string, string | string[] | undefined>;

/**
 * The archive.
 *
 * One place for every picture the workspace owns, and it keeps them: a
 * production ends, the material stays. The page is the drop zone and the
 * grid — drop what you have, and it is named, sorted and available to every
 * production. Nothing is asked at upload that can be inferred.
 */
export default async function ArchivePage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSessionForPage('/app/archive');
  const params = await searchParams;
  const state = filterFrom(params);
  const view = await loadLibrary(session, toFilter(state));
  const filtered = Boolean(state.q || state.category || state.source || state.project || state.favorite || state.approved);
  const defaultProject = state.project && view.projects.some((project) => project.id === state.project) ? [state.project] : [];

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headCopy}>
          <Prompt tone="accent" chevron={false}>
            / Archive
          </Prompt>
          <h1>Every picture you own. Kept.</h1>
          <p className={styles.headSub}>
            Drop what you have: product shots, your team, your office, your logo. We look at each
            one, sort it, and put real material in your films before we imagine anything.
          </p>
        </div>
      </div>

      <LibraryUploader projects={view.projects} defaultProjectIds={defaultProject} />

      {view.total > 0 ? (
        <>
          <div className={styles.listHead} style={{ marginTop: 'var(--space-6)' }}>
            <Prompt tone="text">
              Archive ({view.total})
              {filtered ? <span className="muted"> · showing {view.cards.length}</span> : null}
            </Prompt>
            <hr />
            <LibraryFilters state={state} projects={view.projects} />
          </div>

          {view.cards.length > 0 ? (
            <div className={styles.assetGrid}>
              {view.cards.map((card) => (
                <AssetCard key={card.id} card={card} projects={view.projects} />
              ))}
            </div>
          ) : (
            <div className={styles.empty} style={{ padding: 'var(--space-7) var(--space-6)' }}>
              <Prompt tone="text">No match</Prompt>
              <p className="secondary">Nothing in the archive matches that.</p>
              <a href="/app/archive" className="btn btn--secondary">
                Clear filters
              </a>
            </div>
          )}
        </>
      ) : (
        <div className={styles.empty} style={{ marginTop: 'var(--space-6)' }}>
          <div className="dots">
            <DotMatrix seed="archive-empty" shape="radial" width={900} height={320} cell={16} opacity={0.35} />
          </div>
          <Prompt tone="text">Archive empty</Prompt>
          <h2>Nothing here yet.</h2>
          <p className="secondary" style={{ maxWidth: '46ch' }}>
            What discovery reads lands here on its own. Add your own pictures above and every
            production can use them.
          </p>
        </div>
      )}
    </>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function filterFrom(params: Search): FilterState {
  const category = one(params['category']);
  const source = one(params['source']);
  return {
    q: one(params['q']).slice(0, 120),
    category: LibraryCategory.options.includes(category as LibraryCategory) ? (category as LibraryCategory) : '',
    source: AssetSource.options.includes(source as AssetSource) ? (source as AssetSource) : '',
    project: one(params['project']).slice(0, 60),
    favorite: one(params['favorite']) === '1',
    approved: one(params['approved']) === '1',
  };
}

function toFilter(state: FilterState): LibraryFilter {
  return {
    ...(state.q ? { query: state.q } : {}),
    ...(state.category ? { category: state.category } : {}),
    ...(state.source ? { source: state.source } : {}),
    ...(state.project ? { projectId: state.project } : {}),
    ...(state.favorite ? { favorite: true } : {}),
    ...(state.approved ? { approved: true } : {}),
  };
}
