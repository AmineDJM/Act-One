import Link from 'next/link';
import { CTA_LABELS, primaryCtaFor } from '@act-one/core';
import { requireSession } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { NewProjectForm } from './NewProjectForm.tsx';
import styles from './app.module.css';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await requireSession();
  const projects = await getStore().projects.list(session.organizationId);

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1>Projects</h1>
          <p className="secondary" style={{ marginTop: 'var(--space-2)' }}>
            One project is one launch. Every cut for that launch lives inside it.
          </p>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className={styles.empty}>
          <h2 style={{ fontSize: '1.3rem' }}>Start with a URL.</h2>
          <p className="secondary" style={{ maxWidth: '48ch' }}>
            Paste your product website. We will read it, learn your brand, and come back with three
            creative directions.
          </p>
          <div style={{ width: '100%', maxWidth: 520, marginTop: 'var(--space-3)' }}>
            <NewProjectForm />
          </div>
        </div>
      ) : (
        <>
          <div style={{ maxWidth: 620, marginBottom: 'var(--space-7)' }}>
            <NewProjectForm />
          </div>
          <div className={styles.projects}>
            {projects.map((project) => {
              const cta = primaryCtaFor(project.stage);
              return (
                <Link key={project.id} href={`/app/projects/${project.id}`} className={styles.project}>
                  <div>
                    <div className={styles.projectName}>{project.name}</div>
                    <div className={styles.projectHost}>
                      {safeHost(project.websiteUrl)}
                    </div>
                  </div>
                  <div className={styles.projectFoot}>
                    <span className="badge">{project.stage.replace(/_/g, ' ')}</span>
                    <span className="muted" style={{ fontSize: '0.82rem' }}>
                      {CTA_LABELS[cta]}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
