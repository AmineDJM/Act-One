import type { Metadata } from 'next';
import Link from 'next/link';
import { PRODUCT_NAME, can } from '@act-one/core';
import { requireSessionForPage } from '@/server/auth.ts';
import { loadBrandOverview } from '@/server/brand.ts';
import { formatPronunciations, loadVoiceOverview } from '@/server/voice.ts';
import { DotMatrix } from '@/components/ui/DotMatrix.tsx';
import { Prompt, Status } from '@/components/ui/Prompt.tsx';
import { BrandDna } from './BrandDna.tsx';
import { BrandSignals } from './BrandSignals.tsx';
import { BrandVoicePanel } from './BrandVoicePanel.tsx';
import styles from '../app.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Identity · Act One' };

/**
 * Brand DNA, per project.
 *
 * Measured from the project's own site, shown as eight components a person
 * can read, edit and confirm. A later project starts from a confirmed
 * brand; a later reading proposes, never overwrites. The voice below is the
 * workspace's: one narrator across every film.
 */
export default async function BrandPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSessionForPage('/app/identity');
  const params = await searchParams;
  const requested = (Array.isArray(params['project']) ? params['project'][0] : params['project'])?.trim() || null;
  const [overview, voice] = await Promise.all([loadBrandOverview(session, requested), loadVoiceOverview(session)]);
  const canEdit = can(session.actor, 'brand:edit');
  const selected = overview.selected;

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headCopy}>
          <Prompt tone="accent" chevron={false}>
            {PRODUCT_NAME} / Identity
          </Prompt>
          <h1>Brand DNA</h1>
          <p className={styles.headSub}>
            Measured from each production&rsquo;s own site, never filled in by hand. Confirm it once; the
            next production starts from it, and anything we read differently later is a question, not a change.
          </p>
        </div>
      </div>

      {overview.projects.length > 0 ? (
        <nav className={styles.brandProjects} aria-label="Productions">
          {overview.projects.map((row) => (
            <Link key={row.id} href={`/app/identity?project=${encodeURIComponent(row.id)}`} data-active={selected?.project.id === row.id || undefined} className={styles.brandProject}>
              <span className={styles.brandProjectName}>{row.name}</span>
              <span className={styles.brandProjectHost}>{row.host}</span>
              <Status tone={row.tone}>{row.status}</Status>
            </Link>
          ))}
        </nav>
      ) : null}

      {selected ? (
        <>
          {selected.signals.length > 0 ? (
            <BrandSignals brandId={selected.brand.id} signals={selected.signals} canEdit={canEdit} />
          ) : null}
          <BrandDna
            brand={selected.brand}
            components={selected.components}
            projectName={selected.project.name}
            inheritedFrom={selected.inheritedFrom}
            canEdit={canEdit}
          />
        </>
      ) : (
        <div className={styles.empty}>
          <div className="dots">
            <DotMatrix seed="brand-empty" shape="drift" width={900} height={320} cell={16} opacity={0.35} />
          </div>
          <Prompt tone="text">Brand not measured</Prompt>
          <h2>Nothing measured yet.</h2>
          <p className="secondary" style={{ maxWidth: '46ch' }}>
            Start a production and we will read the site and measure the brand from what it actually paints.
          </p>
          <Link href="/app" className="btn">
            Start a production
          </Link>
        </div>
      )}

      <div className={styles.panels} style={{ marginTop: 'var(--space-6)' }}>
        <BrandVoicePanel
          voices={voice.voices}
          consents={voice.consents}
          pronunciations={formatPronunciations(voice.settings?.pronunciations ?? [])}
          may={voice.may}
          library={voice.library}
          planName={voice.planName}
          canEdit={canEdit}
        />
      </div>
    </>
  );
}
