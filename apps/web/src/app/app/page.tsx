import type { Metadata } from 'next';
import { PRODUCT_NAME, STAGE_STATUS, failureStatus, primaryCtaFor, type Project } from '@act-one/core';
import { requireSessionForPage } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { entitlementsFor } from '@/server/platform.ts';
import { DotMatrix } from '@/components/ui/DotMatrix.tsx';
import { Prompt } from '@/components/ui/Prompt.tsx';
import { NewProjectForm } from './NewProjectForm.tsx';
import { ProjectList, type ProjectCard } from './ProjectList.tsx';
import styles from './app.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Productions · Act One' };

/**
 * One production, one launch.
 *
 * The page is the command bar and the list. The bar takes an address and
 * nothing else it does not have to; the list shows each launch as a
 * production with a status in capitals and the one thing to do next.
 */
export default async function ProjectsPage() {
  const session = await requireSessionForPage('/app');
  const store = getStore();
  const [projects, organization] = await Promise.all([
    store.projects.list(session.organizationId),
    store.organizations.get(session.organizationId),
  ]);
  // The form only offers runtimes the plan will render.
  const maxDurationSeconds = organization
    ? (await entitlementsFor(organization)).plan.limits.maxMasterDurationSeconds
    : 60;

  // The step that stopped, for the cards that need attention: one query, not one per card.
  const failedKinds = new Map<string, string>();
  for (const project of projects.filter((candidate) => candidate.stage === 'failed')) {
    const jobs = await store.jobs.listForProject(session.organizationId, project.id);
    const failed = jobs.find((job) => job.state === 'failed');
    failedKinds.set(project.id, failureStatus(failed?.kind ?? null));
  }
  const now = Date.now();
  const cards: ProjectCard[] = projects.map((project) => cardFor(project, failedKinds.get(project.id) ?? null, now));

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <Prompt tone="accent" chevron={false}>
            / Productions
          </Prompt>
          <h1 className={styles.heroTitle}>
            One production.
            <span>One launch.</span>
          </h1>
          <p className={styles.heroLede}>Turn your product into a world-class launch campaign.</p>
          <NewProjectForm maxDurationSeconds={maxDurationSeconds} autoFocus={projects.length === 0} />
        </div>
        <aside className={styles.heroAside} aria-label={`About ${PRODUCT_NAME}`}>
          <div className="dots">
            <DotMatrix seed="act-one-hero" shape="orbit" width={420} height={300} cell={12} opacity={0.5} />
          </div>
          <div className={styles.heroAsideHead}>
            <span>
              <span style={{ color: 'var(--accent)' }}>&gt;</span> {PRODUCT_NAME.toUpperCase()}
            </span>
            <span>v0.1</span>
          </div>
          <blockquote>&ldquo;Ideas become extraordinary when they find their {PRODUCT_NAME}.&rdquo;</blockquote>
          <div className={styles.heroAsideFoot}>
            <span>BUILD. LAUNCH. GROW.</span>
            <ul className={styles.heroAsideList}>
              <li>IDEAS</li>
              <li>STORY</li>
              <li>VISUALS</li>
              <li>IMPACT</li>
            </ul>
          </div>
        </aside>
      </section>

      {projects.length === 0 ? (
        <div className={styles.empty}>
          <div className="dots">
            <DotMatrix seed="no-projects" shape="wave" width={900} height={320} cell={16} opacity={0.35} />
          </div>
          <Prompt tone="text">No productions yet</Prompt>
          <h2>Every launch starts somewhere.</h2>
          <p className="secondary" style={{ maxWidth: '44ch' }}>
            Paste your product&rsquo;s address above. We read it, measure your identity, and come back
            with three creative directions.
          </p>
          <a href="#new" className="btn">
            Start the first production
          </a>
        </div>
      ) : (
        <ProjectList projects={cards} />
      )}
    </>
  );
}

function cardFor(project: Project, failed: string | null, now: number): ProjectCard {
  const status = STAGE_STATUS[project.stage];
  const cta = primaryCtaFor(project.stage);
  return {
    id: project.id,
    name: project.name,
    host: safeHost(project.websiteUrl),
    status: { label: failed ?? status.label, tone: status.tone },
    live: status.tone === 'active',
    updatedLabel: relative(project.updatedAt, now),
    updatedAt: project.updatedAt,
    action:
      project.stage === 'failed'
        ? 'Try again ↵'
        : cta === 'choose_concept'
          ? 'Choose a direction →'
          : cta === 'render_film'
            ? 'Produce the film →'
            : cta === 'create_variants'
              ? 'Open the master →'
              : 'Open production →',
    cover: <DotMatrix seed={project.id} shape={project.stage === 'film_ready' ? 'orbit' : 'wave'} width={120} height={120} cell={10} opacity={0.7} />,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** "just now", "2m ago", "3h ago", "4d ago", then the date: computed once, on the server. */
function relative(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return iso.slice(0, 10);
}
