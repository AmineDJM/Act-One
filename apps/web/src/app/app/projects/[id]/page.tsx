import { notFound } from 'next/navigation';
import {
  CTA_LABELS,
  can,
  primaryCtaFor,
  storyboardDuration,
  toAppError,
  type PrimaryCta,
} from '@act-one/core';
import { requireSessionForPage } from '@/server/auth.ts';
import { loadProjectView, renderPermission } from '@/server/projects.ts';
import { ProjectCta } from './ProjectCta.tsx';
import { ConceptChoice } from './ConceptChoice.tsx';
import { BrandConfirm } from './BrandConfirm.tsx';
import { StoryboardPanel } from './StoryboardPanel.tsx';
import { FilmDelivery } from './FilmDelivery.tsx';
import { CopyKitPanel } from './CopyKit.tsx';
import { ProductAccess } from './ProductAccess.tsx';
import styles from '../../app.module.css';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSessionForPage(`/app/projects/${id}`);

  let view: Awaited<ReturnType<typeof loadProjectView>>;
  try {
    view = await loadProjectView(session, id);
  } catch (error) {
    if (toAppError(error).code === 'not_found') notFound();
    throw error;
  }

  const {
    project,
    understanding,
    brand,
    concepts,
    storyboard,
    activeJob,
    latestRender,
    variants,
    poster,
    copyKit,
    access,
  } = view;

  /*
   * A running job wins over the stage.
   *
   * Cutting a campaign leaves the project at film_ready, so the CTA stayed
   * pressable while the cuts were rendering and a second click queued a second
   * campaign. Anything in flight is a reason to watch, whatever the stage says.
   */
  const cta = activeJob ? 'watch_progress' : primaryCtaFor(project.stage);
  const permission = await renderPermission(session, project);

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1>{project.name}</h1>
          <p className={styles.projectHost} style={{ marginTop: 'var(--space-2)' }}>
            {safeHost(project.websiteUrl)}
          </p>
        </div>
        <span className="badge">{project.stage.replace(/_/g, ' ')}</span>
      </div>

      {/*
        Exactly one primary action, derived from pipeline stage. Showing the
        customer four buttons of equal weight is how a simple product starts
        feeling like a control panel.
      */}
      <ProjectCta
        projectId={project.id}
        cta={cta}
        label={CTA_LABELS[cta]}
        headline={headlineFor(cta, project.name)}
        body={bodyFor(cta, permission.watermarked, permission.reason)}
        progress={activeJob ? activeJob.progress : null}
        status={activeJob?.statusMessage ?? null}
        disabled={!permission.allowed && cta === 'render_film'}
      />

      {/* The film comes first once it exists: it is what everything else was for. */}
      {latestRender ? (
        <div className={styles.panels}>
          <FilmDelivery
            render={latestRender}
            variants={variants}
            posterAssetId={poster?.id ?? null}
            projectName={project.name}
          />
          {copyKit && copyKit.lines.length > 0 ? <CopyKitPanel lines={copyKit.lines} /> : null}
        </div>
      ) : null}

      <div className={styles.panels}>
        <ProductAccess
          projectId={project.id}
          productHost={safeHost(project.websiteUrl)}
          canManage={can(session.actor, 'credentials:manage')}
          access={
            access.credential
              ? {
                  loginUrl: access.credential.loginUrl,
                  username: access.credential.username,
                  kind: access.credential.kind,
                  authorizedAt: access.credential.authorizedAt,
                  lastUsedAt: access.credential.lastUsedAt,
                  allowedPaths: access.credential.allowedPaths,
                  deniedPaths: access.credential.deniedPaths,
                  audit: access.audit.map((event) => ({
                    action: event.action,
                    detail: event.detail,
                    createdAt: event.createdAt,
                  })),
                }
              : null
          }
        />

        {understanding ? (
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h3>What we understand</h3>
              <span className="badge">{understanding.evidence.length} sources cited</span>
            </div>

            <dl className={styles.kv}>
              <div className={styles.kvRow}>
                <dt>Product</dt>
                <dd>{understanding.name}</dd>
              </div>
              <div className={styles.kvRow}>
                <dt>In one line</dt>
                <dd>{understanding.oneLiner}</dd>
              </div>
              <div className={styles.kvRow}>
                <dt>Category</dt>
                <dd>{understanding.category}</dd>
              </div>
              <div className={styles.kvRow}>
                <dt>Audience</dt>
                <dd>{understanding.targetAudience.slice(0, 2).join(', ') || '—'}</dd>
              </div>
            </dl>

            {understanding.keyBenefits.length > 0 ? (
              <div>
                <p className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
                  What it does
                </p>
                <ul className={styles.claims}>
                  {understanding.keyBenefits.slice(0, 4).map((claim) => (
                    <li key={claim.text}>
                      <span className={styles.cite} title="Traced to your own material">
                        [{claim.evidenceIds.length}]
                      </span>
                      {claim.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {understanding.gaps.length > 0 ? (
              <div className={styles.gaps}>
                <strong>What we could not establish</strong>
                <ul>
                  {understanding.gaps.slice(0, 4).map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {brand ? (
          <BrandConfirm projectId={project.id} brand={brand} />
        ) : null}
      </div>

      {concepts.length > 0 ? (
        <section style={{ marginTop: 'var(--space-7)' }}>
          <div className={styles.head}>
            <div>
              <h2 style={{ fontSize: '1.3rem', letterSpacing: '-0.03em' }}>Three directions</h2>
              <p className="secondary" style={{ marginTop: 'var(--space-2)', maxWidth: '62ch' }}>
                Genuinely different arguments, not one idea in three fonts. Each has its own
                narrative structure and its own creative language.
              </p>
            </div>
          </div>
          <ConceptChoice projectId={project.id} concepts={concepts} />
        </section>
      ) : null}

      {storyboard ? (
        <section style={{ marginTop: 'var(--space-7)' }}>
          <div className={styles.head}>
            <div>
              <h2 style={{ fontSize: '1.3rem', letterSpacing: '-0.03em' }}>Storyboard</h2>
              <p className="secondary" style={{ marginTop: 'var(--space-2)' }}>
                {storyboard.scenes.length} scenes · {storyboardDuration(storyboard).toFixed(1)}s ·
                version {storyboard.version}
              </p>
            </div>
          </div>
          <StoryboardPanel projectId={project.id} storyboard={storyboard} />
        </section>
      ) : null}
    </>
  );
}

function headlineFor(cta: PrimaryCta, projectName: string): string {
  switch (cta) {
    case 'understand_product':
      return 'Let us read your product.';
    case 'choose_concept':
      return 'Three directions are ready.';
    case 'render_film':
      return 'Your storyboard is ready to argue with.';
    case 'create_variants':
      return `${projectName} is finished.`;
    case 'retry':
      return 'Something went wrong.';
    default:
      return 'Working on it.';
  }
}

function bodyFor(cta: PrimaryCta, watermarked: boolean, reason: string): string {
  switch (cta) {
    case 'choose_concept':
      return 'Pick one, combine two, or ask for three new directions. Nothing is charged yet.';
    case 'render_film':
      return watermarked
        ? reason || 'Your plan renders a watermarked preview.'
        : 'Change anything above before we render — a revision at this stage costs nothing. ' +
          'Rendering covers scene rendering, product cinematography, sound design and the master export.';
    case 'create_variants':
      return 'Your film is above. Cut it for every channel you are launching on, and we will write the launch copy to go with it.';
    case 'watch_progress':
      return 'This runs in the background. You can close the tab.';
    case 'retry':
      return 'We kept everything we had. Retrying picks up where it stopped.';
    default:
      return 'Free until you render.';
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
