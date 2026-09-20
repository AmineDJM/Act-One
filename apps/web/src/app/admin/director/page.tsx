import Link from 'next/link';
import {
  BRAND_DIMENSIONS,
  AudienceModel,
  BrandGenome,
  CreativeBrief,
  type CreativeVerdict,
  type CriticReview,
  type DirectorDecision,
} from '@act-one/core';
import { getStore } from '@/server/store.ts';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * The Director Lab.
 *
 * Everything the creative layer decided about one production, in the order it
 * decided it, so somebody can find out whether Act One genuinely thinks or
 * merely generates. That question has one honest answer and it is not in a
 * summary: it is in the twenty directions it explored, the fifteen it threw
 * away, the reason each one died, which of its specialists disagreed, and what
 * the director did about it.
 *
 * Internal. A customer is shown none of this and should not be — what they
 * bought is a film, and the machinery behind it is our problem. But without a
 * surface like this the machinery is unfalsifiable, and an unfalsifiable
 * creative system is indistinguishable from a random one that got lucky.
 */
export default async function DirectorLabPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const store = getStore();
  const { project: requested } = await searchParams;

  const organizations = await store.organizations.list(200);
  const byOrg = new Map(organizations.map((organization) => [organization.id, organization]));

  /*
   * Productions that actually have a director's reasoning behind them.
   *
   * Listed from the decisions rather than from the projects, because a project
   * that predates the Director Brain has nothing to show here and a page
   * listing it would be a page of empty rows.
   */
  const directed: { projectId: string; organizationId: string; at: string }[] = [];
  for (const organization of organizations) {
    const projects = await store.projects.list(organization.id);
    for (const project of projects) {
      const decisions = await store.creative.listDecisions(organization.id, project.id);
      if (decisions.length === 0) continue;
      directed.push({
        projectId: project.id,
        organizationId: organization.id,
        at: decisions[decisions.length - 1]!.createdAt,
      });
    }
  }
  directed.sort((a, b) => b.at.localeCompare(a.at));

  const selected = directed.find((entry) => entry.projectId === requested) ?? directed[0] ?? null;
  if (!selected) {
    return (
      <div className={styles.page}>
        <header className={styles.pageHead}>
          <h1>Director Lab</h1>
          <p className="muted">
            Nothing has been directed yet. A production shows up here once the Director Brain has
            run for it.
          </p>
        </header>
      </div>
    );
  }

  const { organizationId, projectId } = selected;
  const [project, territories, reviews, decisions, briefRow, audienceRow, genomeRow, signatures] =
    await Promise.all([
      store.projects.get(organizationId, projectId),
      store.creative.listTerritories(organizationId, projectId),
      store.creative.listReviews(organizationId, projectId),
      store.creative.listDecisions(organizationId, projectId),
      store.creative.latestModel(organizationId, projectId, 'brief'),
      store.creative.latestModel(organizationId, projectId, 'audience'),
      store.creative.latestModel(organizationId, projectId, 'genome'),
      store.creative.recentSignatures(organizationId, 40),
    ]);

  const brief = CreativeBrief.safeParse(briefRow);
  const audience = AudienceModel.safeParse(audienceRow);
  const genome = BrandGenome.safeParse(genomeRow);

  const chosen = territories.find((row) => row.selected) ?? null;
  const rejected = territories.filter((row) => !row.selected);

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1>Director Lab</h1>
        <p className="muted">
          {project?.name ?? projectId} · {byOrg.get(organizationId)?.name ?? organizationId} ·{' '}
          {territories.length} directions explored, {rejected.length} rejected
        </p>
      </header>

      {directed.length > 1 ? (
        <nav className={styles.chips}>
          {directed.slice(0, 12).map((entry) => (
            <Link
              key={entry.projectId}
              href={`/admin/director?project=${entry.projectId}`}
              className={entry.projectId === projectId ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            >
              {entry.projectId.slice(-6)}
            </Link>
          ))}
        </nav>
      ) : null}

      {/* --- What it understood ------------------------------------------- */}
      <section className={styles.panel}>
        <h2>The assignment</h2>
        {brief.success ? (
          <dl className={styles.definitions}>
            <div>
              <dt>Business objective</dt>
              <dd>
                {brief.data.goal.business.replace(/_/g, ' ')} · {brief.data.goal.ctaStrength} call to
                action · {brief.data.goal.awarenessStage.replace(/_/g, ' ')}
              </dd>
            </div>
            <div>
              <dt>Creative objective</dt>
              <dd>{brief.data.creativeObjective}</dd>
            </div>
            <div>
              <dt>Walks in believing</dt>
              <dd>{brief.data.transformation.before}</dd>
            </div>
            <div>
              <dt>Should walk out believing</dt>
              <dd>{brief.data.transformation.after}</dd>
            </div>
            <div>
              <dt>The thing that has to land</dt>
              <dd>{brief.data.transformation.pivot}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted">No brief was recorded for this production.</p>
        )}
      </section>

      {audience.success ? (
        <section className={styles.panel}>
          <h2>The viewer</h2>
          <p>
            <strong>{audience.data.who}</strong> · {audience.data.sophistication} · risk{' '}
            {audience.data.riskTolerance}
          </p>
          {audience.data.attentionContext ? <p className="muted">{audience.data.attentionContext}</p> : null}
          <div className={styles.columns}>
            <List title="Does not know" items={audience.data.doesNotKnow} />
            <List title="Will object" items={audience.data.objections} />
            <List title="Instead, today" items={audience.data.statusQuo ? [audience.data.statusQuo] : []} />
          </div>
        </section>
      ) : null}

      {genome.success ? (
        <section className={styles.panel}>
          <h2>The brand, as behaviour</h2>
          <p className="mono muted">{genome.data.archetype.replace(/_/g, ' ')}</p>
          <div className={styles.bars}>
            {BRAND_DIMENSIONS.map((dimension) => {
              const value = genome.data.dimensions[dimension] ?? 0;
              return (
                <div key={dimension} className={styles.bar}>
                  <span className={styles.barLabel}>{dimension.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                  <span className={styles.barTrack}>
                    <span className={styles.barFill} style={{ width: `${Math.round(value * 100)}%` }} />
                  </span>
                  <span className="mono muted">{value.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
          {genome.data.taboos.length > 0 ? (
            <p className="muted">Never: {genome.data.taboos.join(' · ')}</p>
          ) : null}
        </section>
      ) : null}

      {/* --- What it explored --------------------------------------------- */}
      <section className={styles.panel}>
        <h2>Directions explored</h2>
        <p className="muted">
          A rejected direction is kept whole, with the reason it died. It is the negative half of a
          preference dataset, and nobody keeps those.
        </p>
        <ul className={styles.list}>
          {territories.map((row) => (
            <li key={row.territory.id} className={row.selected ? styles.listItemOn : styles.listItem}>
              <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'baseline' }}>
                <strong>{row.territory.name}</strong>
                <span className="mono muted">
                  {row.territory.mechanism.replace(/_/g, ' ')} · product {row.territory.productRole}
                </span>
                {row.selected ? <span className="badge">directed</span> : null}
                {row.rejectionReason ? (
                  <span className="badge badge--warn">{row.rejectionReason.replace(/_/g, ' ')}</span>
                ) : null}
              </div>
              <p>{row.territory.premise}</p>
              <p className="muted">
                Opens on {row.territory.opening} · could fail because {row.territory.risk}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* --- Who said what ------------------------------------------------ */}
      <section className={styles.panel}>
        <h2>The panel</h2>
        <p className="muted">
          Run apart and never shown each other&rsquo;s opinions, so they can disagree. A panel that
          converges has said nothing you did not already believe.
        </p>
        <CriticTable reviews={reviews} />
      </section>

      {/* --- What it decided ---------------------------------------------- */}
      <section className={styles.panel}>
        <h2>Decisions</h2>
        <ul className={styles.list}>
          {decisions.map((decision) => (
            <li key={decision.id} className={styles.listItem}>
              <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'baseline' }}>
                <span className="mono muted">{decision.stage}</span>
                <strong>{decision.decision}</strong>
              </div>
              <p>{decision.reason}</p>
              {decision.arbitrations.map((arbitration, index) => (
                <p key={index} className="muted">
                  <strong>{arbitration.between.join(' vs ')}</strong> — {arbitration.conflict}{' '}
                  <em>Settled:</em> {arbitration.resolution}
                </p>
              ))}
              {decision.rejected.length > 0 ? (
                <p className="mono muted">passed over {decision.rejected.length}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {/* --- What the studio keeps repeating ------------------------------ */}
      <section className={styles.panel}>
        <h2>This workspace&rsquo;s devices</h2>
        <p className="muted">
          What Act One has reached for lately, here and nowhere wider. A warning to the search, not
          a ban: a studio has a voice.
        </p>
        <ul className={styles.list}>
          {Object.entries(
            signatures.reduce<Record<string, number>>((counts, signature) => {
              counts[signature.device] = (counts[signature.device] ?? 0) + 1;
              return counts;
            }, {}),
          )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([device, count]) => (
              <li key={device} className={styles.listItem}>
                <span>{device}</span>{' '}
                <span className="mono muted">
                  {count}×{count >= 3 ? ' — getting to be a habit' : ''}
                </span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 style={{ fontSize: '0.85rem' }}>{title}</h3>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const VERDICT_CLASS: Record<CreativeVerdict, string> = {
  pass: 'badge',
  pass_with_concerns: 'badge',
  revise: 'badge badge--warn',
  block: 'badge badge--bad',
};

function CriticTable({ reviews }: { reviews: readonly CriticReview[] }) {
  if (reviews.length === 0) return <p className="muted">No reviews were recorded.</p>;

  const byArtifact = new Map<string, CriticReview[]>();
  for (const review of reviews) {
    byArtifact.set(review.artifactId, [...(byArtifact.get(review.artifactId) ?? []), review]);
  }

  return (
    <>
      {[...byArtifact.entries()].map(([artifactId, panel]) => (
        <div key={artifactId} style={{ marginBottom: 'var(--space-4)' }}>
          <p className="mono muted">
            {panel[0]?.artifactKind} · {artifactId}
          </p>
          <ul className={styles.list}>
            {panel.map((review) => (
              <li key={review.id} className={styles.listItem}>
                <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'baseline' }}>
                  <strong>{review.critic.replace(/_/g, ' ')}</strong>
                  <span className={VERDICT_CLASS[review.verdict]}>
                    {review.verdict.replace(/_/g, ' ')}
                  </span>
                  <span className="mono muted">{review.model}</span>
                </div>
                {review.findings.map((finding, index) => (
                  <p key={index}>
                    <span className="mono muted">[{finding.severity}]</span> {finding.observation}
                    {finding.evidence.length > 0 ? (
                      <span className="mono muted"> ({finding.evidence.join(', ')})</span>
                    ) : null}
                    {finding.recommendation ? <em> → {finding.recommendation}</em> : null}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
