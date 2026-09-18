'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CornerStyle,
  Iconography,
  ImageTreatment,
  ImageryStyle,
  LayoutDensity,
  MotionStyle,
  VisualStyle,
  fontFor,
  motionPersonalityFor,
  type BrandComponentKey,
  type BrandSystem,
} from '@act-one/core';
import type { BrandComponentView } from '@/server/brand.ts';
import { confirmBrandDnaAction, saveBrandComponentAction } from './dna-actions.ts';
import styles from '../app.module.css';

/**
 * BRAND DNA — measured automatically from 14 sources.
 *
 * Eight components, each a row: what we measured, whether a person changed
 * it, and an editor that opens in place. One button confirms the whole.
 * Everything a person types is validated on the server; the form is only
 * the form.
 */
export function BrandDna({
  brand,
  components,
  projectName,
  inheritedFrom,
  canEdit,
}: {
  brand: BrandSystem;
  components: BrandComponentView[];
  projectName: string;
  inheritedFrom: { name: string; projectName: string | null } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<BrandComponentKey | null>(null);
  const [notice, setNotice] = useState<{ error: string | null; message?: string }>({ error: null });

  const save = (patch: Record<string, unknown>) =>
    start(async () => {
      const result = await saveBrandComponentAction({ brandId: brand.id, patch });
      setNotice(result);
      if (!result.error) {
        setOpen(null);
        router.refresh();
      }
    });

  const confirm = () =>
    start(async () => {
      const result = await confirmBrandDnaAction({ brandId: brand.id });
      setNotice(result);
      if (!result.error) router.refresh();
    });

  const edited = components.filter((component) => component.state === 'edited').length;

  return (
    <section className={styles.dna} data-pending={pending || undefined}>
      <div className={styles.dnaHead}>
        <div>
          <span className="prompt" data-tone="text">
            <span className="prompt__chevron" aria-hidden="true">&gt;</span> BRAND DNA
          </span>
          <p className={styles.dnaSub}>
            {projectName} · measured automatically from {brand.sources.length} source{brand.sources.length === 1 ? '' : 's'}
            {inheritedFrom ? ` · inherited from ${inheritedFrom.projectName ?? inheritedFrom.name}` : ''}
            {edited > 0 ? ` · ${edited} component${edited === 1 ? '' : 's'} set by you` : ''}
          </p>
        </div>
        <div className={styles.dnaStatus}>
          {brand.confirmedByUser ? (
            <span className="status" data-tone="ready">
              CONFIRMED{brand.confirmedAt ? ` · ${brand.confirmedAt.slice(0, 10)}` : ''}
            </span>
          ) : (
            <span className="status" data-tone="active">
              AWAITING CONFIRMATION
            </span>
          )}
        </div>
      </div>

      <ol className={styles.dnaList}>
        {components.map((component, index) => {
          const isOpen = open === component.key;
          return (
            <li key={component.key} className={styles.dnaRow} data-open={isOpen || undefined} data-state={component.state}>
              <span className={styles.dnaTick} aria-hidden="true">
                {component.state === 'measured' && !brand.confirmedByUser ? '○' : '✓'}
              </span>
              <span className="index">{String(index + 1).padStart(2, '0')}</span>
              <div className={styles.dnaBody}>
                <div className={styles.dnaTop}>
                  <span className={styles.dnaLabel}>{component.label}</span>
                  <span className={styles.dnaState}>
                    {component.state === 'edited' ? 'SET BY YOU' : component.state === 'confirmed' ? 'CONFIRMED' : 'MEASURED'}
                    {component.pending > 0 ? ` · ${component.pending} SIGNAL${component.pending === 1 ? '' : 'S'}` : ''}
                  </span>
                </div>
                {isOpen ? <Editor brand={brand} component={component.key} onSave={save} onCancel={() => setOpen(null)} pending={pending} /> : <Summary brand={brand} component={component.key} fallback={component.summary} />}
              </div>
              {canEdit && !isOpen ? (
                <button type="button" className={styles.dnaEdit} onClick={() => setOpen(component.key)}>
                  Edit
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className={styles.dnaFoot}>
        {notice.error ? (
          <span className="error" role="alert">
            {notice.error}
          </span>
        ) : notice.message ? (
          <span className="hint" role="status">
            {notice.message}
          </span>
        ) : (
          <span className="hint">Every component can be edited; the film is set in what is here.</span>
        )}
        {canEdit ? (
          <button type="button" className="btn" onClick={confirm} disabled={pending}>
            {brand.confirmedByUser ? '[ Confirm again ]' : '[ Confirm brand ]'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

// --- what each component shows ------------------------------------------------

function Summary({ brand, component, fallback }: { brand: BrandSystem; component: BrandComponentKey; fallback: string }) {
  switch (component) {
    case 'logo':
      return (
        <div className={styles.dnaLogos}>
          {brand.logo?.url ? (
            <span className={styles.dnaLogo} data-on={brand.logo.background === 'dark' ? 'dark' : 'light'}>
              <img src={brand.logo.url} alt={`${brand.name} mark`} />
            </span>
          ) : (
            <span className="muted">No mark found on the pages.</span>
          )}
          {brand.faviconUrl ? (
            <span className={styles.dnaFavicon}>
              <img src={brand.faviconUrl} alt="" />
              <span className="muted">favicon</span>
            </span>
          ) : null}
        </div>
      );
    case 'colors':
      return (
        <div className={styles.swatches}>
          {[brand.primaryColor, brand.secondaryColor, ...brand.accentColors.slice(0, 4)].map((color, index) => (
            <span key={`${color}-${index}`} className={styles.dnaSwatch} title={color}>
              <span style={{ background: color }} />
              <span>{color}</span>
            </span>
          ))}
          <span className={styles.dnaNote}>
            {brand.allowsGradient ? 'gradients' : 'no gradients'} · {brand.allowsGlow ? 'glow' : 'no glow'}
          </span>
        </div>
      );
    case 'typography':
      return (
        <dl className={styles.dnaFacts}>
          <div>
            <dt>Display</dt>
            <dd style={{ fontFamily: `'${fontFor(brand, 'display').renderFamily}', system-ui` }}>{fontFor(brand, 'display').family}</dd>
          </div>
          <div>
            <dt>Body</dt>
            <dd>{fontFor(brand, 'body').family}</dd>
          </div>
          <div>
            <dt>Mono</dt>
            <dd>{fontFor(brand, 'mono').family}</dd>
          </div>
        </dl>
      );
    case 'layout':
      return (
        <dl className={styles.dnaFacts}>
          <div>
            <dt>Density</dt>
            <dd>{brand.layoutDensity}</dd>
          </div>
          <div>
            <dt>Corners</dt>
            <dd>
              {brand.cornerRadiusPx}px · {brand.cornerStyle}
            </dd>
          </div>
          <div>
            <dt>Visual language</dt>
            <dd>{brand.visualStyle}</dd>
          </div>
        </dl>
      );
    case 'iconography':
      return <p className={styles.dnaText}>{brand.iconography === 'none' ? 'Not established from the pages.' : `${cap(brand.iconography)} icons.`}</p>;
    case 'imagery':
      return (
        <p className={styles.dnaText}>
          {brand.imageryStyle === 'none' ? 'Not established from the pages.' : `${cap(brand.imageryStyle.replace('_', ' '))}${brand.imageTreatment !== 'none' ? `, ${brand.imageTreatment.replace('_', ' ')}` : ''}.`}
          {brand.imagerySubjects.length > 0 ? <span className="muted"> {brand.imagerySubjects.slice(0, 4).join(' · ')}</span> : null}
        </p>
      );
    case 'communication': {
      const words = brand.communication;
      return (
        <dl className={styles.dnaFacts}>
          {words.tagline ? (
            <div>
              <dt>Tagline</dt>
              <dd>&ldquo;{words.tagline}&rdquo;</dd>
            </div>
          ) : null}
          <div>
            <dt>Tone</dt>
            <dd>{brand.tone}</dd>
          </div>
          {words.language ? (
            <div>
              <dt>Language</dt>
              <dd>{words.language}</dd>
            </div>
          ) : null}
          {words.positioning ? (
            <div>
              <dt>Positioning</dt>
              <dd>{words.positioning}</dd>
            </div>
          ) : null}
          {words.naming ? (
            <div>
              <dt>Naming</dt>
              <dd>{words.naming}</dd>
            </div>
          ) : null}
          {words.vocabulary.length > 0 ? (
            <div>
              <dt>Vocabulary</dt>
              <dd>{words.vocabulary.join(', ')}</dd>
            </div>
          ) : null}
          {words.claims.length > 0 ? (
            <div>
              <dt>Claims</dt>
              <dd>{words.claims.slice(0, 4).join(' · ')}</dd>
            </div>
          ) : null}
          {words.wordsToAvoid.length > 0 ? (
            <div>
              <dt>Never</dt>
              <dd>{words.wordsToAvoid.join(', ')}</dd>
            </div>
          ) : null}
        </dl>
      );
    }
    case 'motion':
      return (
        <p className={styles.dnaText}>
          <strong>{cap(brand.motionStyle)}.</strong> {brand.motionPersonality || motionPersonalityFor(brand.motionStyle) || fallback}
        </p>
      );
  }
}

// --- editing ---------------------------------------------------------------------

type EditorProps = { brand: BrandSystem; component: BrandComponentKey; onSave: (patch: Record<string, unknown>) => void; onCancel: () => void; pending: boolean };

function Editor({ brand, component, onSave, onCancel, pending }: EditorProps) {
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave(patchFrom(component, data, brand));
  };
  return (
    <form onSubmit={submit} className={styles.dnaForm}>
      <Fields brand={brand} component={component} />
      <div className={styles.dnaFormFoot}>
        <button type="submit" className="btn btn--secondary" disabled={pending}>
          Save
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Fields({ brand, component }: { brand: BrandSystem; component: BrandComponentKey }) {
  const words = brand.communication;
  switch (component) {
    case 'logo':
      return (
        <>
          {brand.logoVariants.length > 0 ? (
            <fieldset className={styles.dnaChoice}>
              <legend className="hint">Which mark</legend>
              {brand.logoVariants.map((variant, index) => (
                <label key={`${variant.url}-${index}`} className={styles.dnaLogo} data-on={variant.background === 'dark' ? 'dark' : 'light'} data-choice>
                  <input type="radio" name="logoUrl" value={variant.url ?? ''} defaultChecked={variant.url === brand.logo?.url} className="sr-only" />
                  {variant.url ? <img src={variant.url} alt={`Mark ${index + 1}`} /> : null}
                </label>
              ))}
            </fieldset>
          ) : null}
          <Text name="faviconUrl" label="Favicon address" value={brand.faviconUrl ?? ''} placeholder="https://…/favicon.svg" />
        </>
      );
    case 'colors':
      return (
        <>
          <div className={styles.dnaGrid}>
            <Text name="primaryColor" label="Primary" value={brand.primaryColor} mono />
            <Text name="secondaryColor" label="Secondary" value={brand.secondaryColor} mono />
            <Text name="accentColors" label="Accents (comma separated)" value={brand.accentColors.join(', ')} mono />
          </div>
          {brand.primaryCandidates.length > 1 ? (
            <p className="hint">Also seen on the pages: {brand.primaryCandidates.join(', ')}</p>
          ) : null}
          <div className={styles.dnaChecks}>
            <label>
              <input type="checkbox" name="allowsGradient" defaultChecked={brand.allowsGradient} /> The brand uses gradients
            </label>
            <label>
              <input type="checkbox" name="allowsGlow" defaultChecked={brand.allowsGlow} /> The brand uses glow
            </label>
          </div>
        </>
      );
    case 'typography':
      return (
        <div className={styles.dnaGrid}>
          <Text name="display" label="Display" value={fontFor(brand, 'display').family} />
          <Text name="body" label="Body" value={fontFor(brand, 'body').family} />
          <Text name="mono" label="Mono" value={fontFor(brand, 'mono').family} />
        </div>
      );
    case 'layout':
      return (
        <div className={styles.dnaGrid}>
          <Select name="layoutDensity" label="Density" value={brand.layoutDensity} options={LayoutDensity.options} />
          <Select name="cornerStyle" label="Corners" value={brand.cornerStyle} options={CornerStyle.options} />
          <Text name="cornerRadiusPx" label="Radius (px)" value={String(brand.cornerRadiusPx)} mono type="number" />
          <Select name="visualStyle" label="Visual language" value={brand.visualStyle} options={VisualStyle.options} />
        </div>
      );
    case 'iconography':
      return <Select name="iconography" label="Icons" value={brand.iconography} options={Iconography.options} />;
    case 'imagery':
      return (
        <div className={styles.dnaGrid}>
          <Select name="imageryStyle" label="Pictures" value={brand.imageryStyle} options={ImageryStyle.options} />
          <Select name="imageTreatment" label="Treatment" value={brand.imageTreatment} options={ImageTreatment.options} />
          <Text name="imagerySubjects" label="Subjects (comma separated)" value={brand.imagerySubjects.join(', ')} />
        </div>
      );
    case 'communication':
      return (
        <div className={styles.dnaGrid} data-wide>
          <Text name="tagline" label="Tagline" value={words.tagline} />
          <Text name="tone" label="Tone" value={brand.tone} />
          <Text name="language" label="Language (ISO code)" value={words.language} mono placeholder="en" />
          <Text name="naming" label="Naming" value={words.naming} placeholder="“Acme”, never “the Acme app”" />
          <Text name="positioning" label="Positioning" value={words.positioning} />
          <Text name="vocabulary" label="Vocabulary (comma separated)" value={words.vocabulary.join(', ')} />
          <Text name="claims" label="Claims (one per line)" value={words.claims.join('\n')} multiline />
          <Text name="wordsToAvoid" label="Words to avoid (comma separated)" value={words.wordsToAvoid.join(', ')} />
        </div>
      );
    case 'motion':
      return (
        <div className={styles.dnaGrid}>
          <Select name="motionStyle" label="Motion" value={brand.motionStyle} options={MotionStyle.options} />
          <Text name="motionPersonality" label="In a sentence" value={brand.motionPersonality} />
        </div>
      );
  }
}

/** The form's fields as the server's patch. Lists split on commas or lines; numbers become numbers. */
function patchFrom(component: BrandComponentKey, data: FormData, brand: BrandSystem): Record<string, unknown> {
  const text = (name: string) => String(data.get(name) ?? '').trim();
  const list = (name: string, splitOn: RegExp = /[,\n]/) =>
    text(name)
      .split(splitOn)
      .map((item) => item.trim())
      .filter(Boolean);
  switch (component) {
    case 'logo':
      return { component, logoUrl: text('logoUrl') || (brand.logo?.url ?? null), faviconUrl: text('faviconUrl') || null };
    case 'colors':
      return {
        component,
        primaryColor: text('primaryColor').toLowerCase(),
        secondaryColor: text('secondaryColor').toLowerCase(),
        accentColors: list('accentColors').map((color) => color.toLowerCase()),
        allowsGradient: data.get('allowsGradient') === 'on',
        allowsGlow: data.get('allowsGlow') === 'on',
      };
    case 'typography':
      return { component, display: text('display'), body: text('body'), mono: text('mono') };
    case 'layout':
      return { component, layoutDensity: text('layoutDensity'), cornerStyle: text('cornerStyle'), cornerRadiusPx: Number(text('cornerRadiusPx')), visualStyle: text('visualStyle') };
    case 'iconography':
      return { component, iconography: text('iconography') };
    case 'imagery':
      return { component, imageryStyle: text('imageryStyle'), imageTreatment: text('imageTreatment'), imagerySubjects: list('imagerySubjects') };
    case 'communication':
      return {
        component,
        tagline: text('tagline'),
        tone: text('tone') || brand.tone,
        language: text('language').toLowerCase(),
        naming: text('naming'),
        positioning: text('positioning'),
        vocabulary: list('vocabulary'),
        claims: list('claims', /\n/),
        wordsToAvoid: list('wordsToAvoid'),
      };
    case 'motion':
      return { component, motionStyle: text('motionStyle'), motionPersonality: text('motionPersonality') };
  }
}

function Text({ name, label, value, mono, type = 'text', placeholder, multiline }: { name: string; label: string; value: string; mono?: boolean; type?: string; placeholder?: string; multiline?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea name={name} defaultValue={value} className="input" rows={3} placeholder={placeholder} />
      ) : (
        <input name={name} type={type} defaultValue={value} className="input" placeholder={placeholder} style={mono ? { fontFamily: 'var(--font-mono)' } : undefined} />
      )}
    </label>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value: string; options: readonly string[] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={value} className="input">
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
