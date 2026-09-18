'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Index, Prompt, Status } from '@/components/ui/Prompt.tsx';
import styles from './app.module.css';

/**
 * The projects, as productions: a cover, a name, an address, a status in
 * capitals, when it last moved, and the one thing to do next. Search and
 * sort happen here, on what the page already sent, so nothing round-trips.
 */
export type ProjectCard = {
  id: string;
  name: string;
  host: string;
  status: { label: string; tone: 'quiet' | 'active' | 'ready' | 'attention' };
  live: boolean;
  /** Already relative, computed on the server so it never disagrees with itself. */
  updatedLabel: string;
  updatedAt: string;
  action: string;
  cover: React.ReactNode;
};

export function ProjectList({ projects }: { projects: ProjectCard[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? projects.filter((project) => project.name.toLowerCase().includes(needle) || project.host.toLowerCase().includes(needle))
      : projects;
    return [...filtered].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [projects, query, sort]);

  return (
    <section aria-label="Your productions">
      <div className={styles.listHead}>
        <Prompt as="h2" tone="text">
          Your productions <span className="muted">({projects.length})</span>
        </Prompt>
        <hr className="divider" />
        <div className={styles.listTools}>
          <input
            className={`input ${styles.search}`}
            type="search"
            placeholder="Search productions…"
            aria-label="Search productions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="input"
            aria-label="Sort productions"
            value={sort}
            onChange={(event) => setSort(event.target.value as 'updated' | 'name')}
            style={{ width: 150 }}
          >
            <option value="updated">Last updated</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      <div className={styles.projects}>
        {shown.map((project, position) => (
          <article key={project.id} className={styles.project}>
            <Index value={position + 1} className={styles.projectIndex} />
            <div className={styles.projectCover} aria-hidden="true">
              {project.cover}
            </div>
            <div className={styles.projectBody}>
              <h3 className={styles.projectName}>
                <Link href={`/app/projects/${project.id}`}>{project.name}</Link>
              </h3>
              <div className={styles.projectHost}>{project.host}</div>
              <div className={styles.projectMeta}>
                <Status tone={project.status.tone} live={project.live}>
                  {project.status.label}
                </Status>
                <span className={styles.projectTime}>{project.updatedLabel}</span>
                <Link href={`/app/projects/${project.id}`} className={styles.projectAction} data-tone={project.status.tone}>
                  {project.action}
                </Link>
              </div>
            </div>
          </article>
        ))}
        {query.trim() && shown.length === 0 ? (
          <p className="hint" style={{ gridColumn: '1 / -1', padding: 'var(--space-4) 0' }}>
            Nothing called &ldquo;{query.trim()}&rdquo; here.
          </p>
        ) : null}
        <a href="#new" className={styles.newProject}>
          <span className={styles.newProjectPlus} aria-hidden="true">
            +
          </span>
          <strong>Start a new project</strong>
          <span>A new launch, a new story.</span>
        </a>
      </div>
    </section>
  );
}
