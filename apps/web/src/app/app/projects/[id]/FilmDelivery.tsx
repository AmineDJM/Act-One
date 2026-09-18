import { ATTRIBUTION, pieceLabel, type Render, type Variant } from '@act-one/core';
import styles from '../../app.module.css';

/** What a viewer calls the track in the player's own menu. */
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
};

const VARIANT_LABELS: Record<string, string> = {
  hero_60: 'Homepage hero',
  vertical_30: 'Vertical 30s',
  ad_15_a: 'Paid 15s (A)',
  ad_15_b: 'Paid 15s (B)',
  ad_15_c: 'Paid 15s (C)',
  bumper_6: 'Bumper 6s',
  homepage_loop: 'Homepage loop',
  product_hunt: 'Product Hunt',
  linkedin_cut: 'LinkedIn',
  reel: 'Instagram Reel',
  tiktok: 'TikTok',
  youtube_short: 'YouTube Short',
};

/**
 * The finished film, and every cut made from it.
 *
 * This is the deliverable. Everything before it — the research, the three
 * directions, the storyboard — exists to produce this one file, and until this
 * existed the project page announced a finished film and then offered no way to
 * watch it or take it away.
 *
 * Assets stream through an authenticated route rather than a storage URL, so a
 * link copied out of this page stops working for anybody who is not signed in
 * to this workspace.
 */
export function FilmDelivery({
  render,
  variants,
  posterAssetId,
  projectName,
  language,
}: {
  render: Render;
  variants: Variant[];
  posterAssetId: string | null;
  projectName: string;
  /** What the film is spoken in, for the caption track's own label. */
  language: string | null;
}) {
  const master = render.masterAssetId;
  if (!master) return null;

  const ready = variants.filter((variant) => variant.assetId);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>{projectName}</h3>
        <span className={styles.panelLinks}>
          {/* What the piece is, in the words the credit will carry. */}
          <span className="mono muted">{render.watermarked ? pieceLabel('workprint') : pieceLabel('master', 1)}</span>
          {render.watermarked ? <span className="badge badge--warn">Watermarked preview</span> : null}
        </span>
      </div>

      {/*
        * The caption track, on by default.
        *
        * Most of this is watched in a tab beside four others, and the first
        * play is usually a muted one. A track the viewer has to go and find is
        * a track that does nothing on the only viewing that matters.
        */}
      <video
        className={styles.player}
        src={`/api/assets/${master}`}
        {...(posterAssetId ? { poster: `/api/assets/${posterAssetId}` } : {})}
        controls
        playsInline
        preload="metadata"
      >
        {render.captionsAssetId ? (
          <track
            kind="captions"
            label={LANGUAGE_LABELS[language ?? ''] ?? 'Subtitles'}
            srcLang={language ?? 'en'}
            src={`/api/assets/${render.captionsAssetId}`}
            default
          />
        ) : null}
      </video>

      <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <a className="btn" href={`/api/assets/${master}?download`} download>
          Download the master
        </a>
        {render.captionsAssetId ? (
          <a className="btn btn--secondary" href={`/api/assets/${render.captionsAssetId}?download`} download>
            Download the subtitles
          </a>
        ) : null}
        <span className="hint">
          {render.aspect} · {Math.round(render.durationSeconds)}s · {ATTRIBUTION}
          {render.watermarked ? ' · upgrade to remove the watermark' : ''}
        </span>
      </div>

      {ready.length > 0 ? (
        <>
          <hr className="divider" />
          <div className={styles.panelHead}>
            <h3 style={{ fontSize: '0.95rem' }}>Campaign cuts</h3>
          </div>
          <ul className={styles.variantList}>
            {ready.map((variant) => (
              <li key={variant.id}>
                <span>
                  <strong>{VARIANT_LABELS[variant.purpose] ?? variant.purpose}</strong>
                  <span className={styles.variantMeta}>
                    {variant.aspect} · {Math.round(variant.durationSeconds)}s
                  </span>
                </span>
                <a className="btn btn--secondary" href={`/api/assets/${variant.assetId}?download`} download>
                  Download
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
