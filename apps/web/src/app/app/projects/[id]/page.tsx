import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  CTA_LABELS,
  can,
  primaryCtaFor,
  stageReached,
  storyboardDuration,
  toAppError,
  type PrimaryCta,
  PRODUCT_NAME,
  STAGE_STATUS,
  failureStatus,
} from '@act-one/core';
import { requireSessionForPage } from '@/server/auth.ts';
import { loadProjectView, renderPermission, revisionAllowance } from '@/server/projects.ts';
import { ProjectCta } from './ProjectCta.tsx';
import { ConceptChoice } from './ConceptChoice.tsx';
import { BrandConfirm } from './BrandConfirm.tsx';
import { StoryboardPanel } from './StoryboardPanel.tsx';
import { FilmDelivery } from './FilmDelivery.tsx';
import { CopyKitPanel } from './CopyKit.tsx';
import { ProductAccess } from './ProductAccess.tsx';
import { Notes } from './Notes.tsx';
import { BriefPanel } from './BriefPanel.tsx';
import { Prompt, Status } from '@/components/ui/Prompt.tsx';
import { AudioEditionPanel } from './AudioEditionPanel.tsx';
import { ResearchSources } from './ResearchSources.tsx';
import { ProjectAssets } from './ProjectAssets.tsx';
import { loadProjectAssets } from '@/server/library.ts';
import { CONSENT_STATEMENT, loadSubmission } from '@/server/collections.ts';
import { CollectionsSubmit } from './CollectionsSubmit.tsx';
import { CorrectWebsite } from './CorrectWebsite.tsx';
import styles from '../../app.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Project · Act One' };

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
    run,
    exchanges,
    latestRender,
    animatic,
    animaticJob,
    audioEdition,
    audioJob,
    sources,
    timeline,
    variants,
    poster,
    copyKit,
    access,
    notes,
    failure,
    plan,
    entitlements,
    jobs,
  } = view;

  /*
   * A running job wins over the stage.
   *
   * Cutting a campaign leaves the project at film_ready, so the CTA stayed
   * pressable while the cuts were rendering and a second click queued a second
   * campaign. Anything in flight is a reason to watch, whatever the stage says.
   */
  const cta = activeJob ? 'watch_progress' : primaryCtaFor(project.stage);
  const [permission, revisions, library, submission] = await Promise.all([
    renderPermission(session, project),
    revisionAllowance(session, project),
    loadProjectAssets(session, project.id),
    latestRender ? loadSubmission(session, project) : null,
  ]);

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headCopy}>
          <Prompt tone="accent" chevron={false}>
            {PRODUCT_NAME} / Project
          </Prompt>
          <h1>{project.name}</h1>
          <p className={styles.projectHost}>{safeHost(project.websiteUrl)}</p>
        </div>
        <Status tone={STAGE_STATUS[project.stage].tone} live={Boolean(activeJob) || STAGE_STATUS[project.stage].tone === 'active'}>
          {project.stage === 'failed'
            ? failureStatus(jobs.find((job) => job.state === 'failed')?.kind ?? null)
            : activeJob
              ? STAGE_STATUS[project.stage].label
              : STAGE_STATUS[project.stage].label}
        </Status>
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
        headline={headlineFor(cta, project.name, failure)}
        body={bodyFor(cta, permission.watermarked, permission.reason, failure)}
        run={run}
        timeline={timeline}
        disabled={!permission.allowed && cta === 'render_film'}
        remedy={permission.remedy}
      />

      {/* Offered only on a stopped project: see CorrectWebsite. */}
      {project.stage === 'failed' ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h3>The address</h3>
          </div>
          <CorrectWebsite projectId={project.id} current={project.websiteUrl} />
        </section>
      ) : null}

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
          <AudioEditionPanel
            projectId={project.id}
            edition={audioEdition}
            progress={audioJob ? audioJob.progress : null}
            may={entitlements.has('audio.editions')}
            planName={plan?.name ?? 'your plan'}
            canProduce={can(session.actor, 'project:update')}
            hasStoryboard={Boolean(project.activeStoryboardId)}
          />
          {/* The film may be put forward for the public gallery; a person selects. */}
          {submission ? (
            <CollectionsSubmit
              projectId={project.id}
              card={{
                status: submission.entry?.status ?? null,
                label: submission.label,
                next: submission.next,
                eligible: submission.eligible,
                reason: submission.reason,
                publicPath: submission.publicPath,
                canSubmit: submission.canSubmit,
                consentStatement: CONSENT_STATEMENT,
              }}
            />
          ) : null}
        </div>
      ) : null}

      {/* What the research read, kept with the project for good. */}
      {sources.length > 0 ? (
        <div className={styles.panels} style={{ marginBottom: 'var(--space-5)' }}>
          <ResearchSources sources={sources} />
        </div>
      ) : null}

      {/* What the film can use: the library, seen from this project. */}
      <div className={styles.panels} style={{ marginBottom: 'var(--space-5)' }}>
        <ProjectAssets projectId={project.id} cards={library.cards} total={library.total} />
      </div>

      {/* Notes sit with the work, wherever the project has got to. */}
      <div className={styles.panels}>
        <Notes
          projectId={project.id}
          canComment={can(session.actor, 'comment:write')}
          filmSeconds={latestRender?.durationSeconds ?? null}
          notes={notes.map((note) => ({
            id: note.id,
            body: note.body,
            atSeconds: note.atSeconds,
            authorName: note.authorName,
            createdAt: note.createdAt,
            resolvedAt: note.resolvedAt,
          }))}
        />
      </div>

      <div className={styles.panels}>
        <BriefPanel
          projectId={project.id}
          brief={{
            durationSeconds: project.brief.durationSeconds ?? null,
            language: project.brief.language ?? null,
            tone: project.brief.tone ?? null,
            voice:
              project.brief.voiceStrategy === 'none'
                ? 'none'
                : (project.brief.voiceGender ?? null),
            voiceAccent: project.brief.voiceAccent ?? null,
            voiceStyle: project.brief.voiceStyle ?? null,
            voicePace: project.brief.voicePace ?? null,
          }}
          maxDurationSeconds={permission.maxDurationSeconds}
          editable={can(session.actor, 'project:update') && !stageReached(project.stage, 'rendering')}
        />
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
              <div className={styles.kvRow}>
                <dt>On screen</dt>
                <dd>{describeCaptures(understanding.productMoments)}</dd>
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
          <StoryboardPanel
            projectId={project.id}
            storyboard={storyboard}
            animaticAssetId={animatic?.masterAssetId ?? null}
            animaticPosterAssetId={animatic?.posterAssetId ?? null}
            animaticProgress={animaticJob ? animaticJob.progress : null}
            revisions={{ used: revisions.used, limit: revisions.limit, reason: revisions.reason }}
            exchanges={exchanges}
          />
        </section>
      ) : null}
    </>
  );
}

function headlineFor(cta: PrimaryCta, projectName: string, failure: string | null): string {
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
      /*
       * "Something went wrong" over a body that says exactly what went wrong
       * reads as a system that does not know. When we do know, the headline
       * says the state and the body carries the reason.
       */
      return failure ? 'This project stopped.' : 'Something went wrong.';
    default:
      return 'Working on it.';
  }
}

function bodyFor(
  cta: PrimaryCta,
  watermarked: boolean,
  reason: string,
  failure: string | null,
): string {
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
      /*
       * What actually failed, when the worker wrote down something a customer
       * can act on. A founder whose domain had a typo was told "Something went
       * wrong" and offered a retry that would fail identically forever.
       */
      return failure
        ? `${failure} We kept everything else. Fix the address or try again.`
        : 'We kept everything we had. Retrying picks up where it stopped.';
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


/**
 * What the film can actually show, in one line.
 *
 * The brief used to say nothing about this, and a founder found out what the
 * film showed by watching it. In-product captures, the product imagery they
 * published, and their pages are different things, and the line says which.
 */
function describeCaptures(moments: { screenshots: string[]; captureKind: string | null }[]): string {
  const shown = moments.filter((moment) => moment.screenshots.length > 0);
  if (moments.length === 0) return 'Nothing yet.';
  if (shown.length === 0) return 'Nothing captured yet — the film would be typography alone.';
  const count = (kind: string) => shown.filter((moment) => moment.captureKind === kind).length;
  const parts = [
    [count('in_app'), 'captured inside your product'],
    [count('product_image'), 'product image', 'product images'],
    [count('public_page'), 'page of your site', 'pages of your site'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, one, many]) => `${n} ${n === 1 || !many ? one : many}`);
  return `${shown.length} of ${moments.length} moments have real captures: ${parts.join(', ')}.`;
}
