'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  FILM_LANGUAGES,
  NARRATION_CONTEXT_LABELS,
  NarrationContext,
  VOICE_PACE_LABELS,
  VOICE_STYLE_LABELS,
  VoicePace,
  VoiceStyle,
  languageName,
  type BrandVoice,
  type VoiceConsentRecord,
} from '@act-one/core';
import {
  adoptVoiceAction,
  cloneVoiceAction,
  removeVoiceAction,
  savePronunciationsAction,
  searchVoicesAction,
  setDefaultVoiceAction,
  type VoiceCandidate,
  type VoiceFormState,
} from './actions.ts';
import styles from '../app.module.css';

/**
 * The brand's voice: one narrator kept across everything, chosen by ear.
 *
 * Nothing here names a vendor or a model. A voice is a name, a language, an
 * accent and a short sample; cloning a person is a separate act with the
 * consent stated in plain words and recorded before anything is made.
 */
export function BrandVoicePanel({
  voices,
  consents,
  pronunciations,
  may,
  library,
  planName,
  canEdit,
}: {
  voices: BrandVoice[];
  consents: VoiceConsentRecord[];
  pronunciations: string;
  may: { brand: boolean; clone: boolean; editions: boolean };
  library: boolean;
  planName: string;
  canEdit: boolean;
}) {
  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h3>Brand voice</h3>
          {voices.length > 0 ? <span className="badge badge--ok">{voices.length} on file</span> : null}
        </div>
        <p className="secondary" style={{ fontSize: '0.9rem' }}>
          One narrator across every film, cut and audio version. Chosen once, by ear, for the language
          your films are in.
        </p>
        {voices.length > 0 ? <VoiceList voices={voices} consents={consents} canEdit={canEdit} /> : null}
        {!may.brand ? (
          <p className="hint">
            A brand voice comes with the plans above {planName}. <Link href="/app/billing">See plans</Link>.
          </p>
        ) : canEdit ? (
          <Casting library={library} />
        ) : null}
      </section>

      {may.clone && canEdit ? <CloneForm /> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h3>How we say your names</h3>
        </div>
        <p className="secondary" style={{ fontSize: '0.9rem' }}>
          Your company, your product, your people: one per line, said the way you say it. Add a
          language in brackets when it differs.
        </p>
        <PronunciationForm initial={pronunciations} canEdit={canEdit} />
      </section>
    </>
  );
}

function VoiceList({ voices, consents, canEdit }: { voices: BrandVoice[]; consents: VoiceConsentRecord[]; canEdit: boolean }) {
  const [state, act, pending] = useActionState<VoiceFormState, FormData>(
    async (previous, formData) =>
      formData.get('intent') === 'remove' ? removeVoiceAction(previous, formData) : setDefaultVoiceAction(previous, formData),
    { error: null },
  );
  return (
    <ul className={styles.variantList}>
      {voices.map((voice) => {
        const consent = voice.consentId ? consents.find((entry) => entry.id === voice.consentId) : null;
        return (
          <li key={voice.id}>
            <span>
              <strong>{voice.name}</strong>
              {voice.isDefault ? <span className="badge badge--ok" style={{ marginLeft: 8 }}>Default</span> : null}
              <span className={styles.variantMeta}>
                {languageName(voice.language) ?? voice.language}
                {voice.locale ? ` · ${voice.locale}` : ''} · {voice.gender === 'female' ? 'a woman’s voice' : 'a man’s voice'}
                {voice.style ? ` · ${VOICE_STYLE_LABELS[voice.style].split(' — ')[0]}` : ''}
                {consent ? ` · cloned from ${consent.subjectName}, consent recorded ${consent.grantedAt.slice(0, 10)}` : ''}
              </span>
            </span>
            {canEdit ? (
              <form action={act} className="row" style={{ gap: 'var(--space-2)' }}>
                <input type="hidden" name="brandVoiceId" value={voice.id} />
                {!voice.isDefault ? (
                  <button className="btn btn--secondary" name="intent" value="default" disabled={pending}>
                    Use by default
                  </button>
                ) : null}
                <button className="btn btn--ghost" name="intent" value="remove" disabled={pending}>
                  {consent ? 'Revoke & delete' : 'Remove'}
                </button>
              </form>
            ) : null}
          </li>
        );
      })}
      {state.error ? <li className="error">{state.error}</li> : null}
    </ul>
  );
}

function Casting({ library }: { library: boolean }) {
  const [search, runSearch, searching] = useActionState<VoiceFormState, FormData>(searchVoicesAction, { error: null });
  const [adopt, runAdopt, adopting] = useActionState<VoiceFormState, FormData>(adoptVoiceAction, { error: null });
  const [chosen, setChosen] = useState<VoiceCandidate | null>(null);

  return (
    <div className="stack" style={{ gap: 'var(--space-3)' }}>
      <form action={runSearch} className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="voice-language">Language</label>
          <select id="voice-language" name="language" className="input" defaultValue="en">
            {FILM_LANGUAGES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="voice-gender">Voice</label>
          <select id="voice-gender" name="gender" className="input" defaultValue="">
            <option value="">Either</option>
            <option value="female">A woman&rsquo;s voice</option>
            <option value="male">A man&rsquo;s voice</option>
          </select>
        </div>
        <button className="btn" type="submit" disabled={searching}>
          {searching ? 'Listening…' : 'Find voices'}
        </button>
      </form>
      {!library ? (
        <p className="hint">
          The engine reading finals has no library on this platform, so the six directed voices are
          offered; each speaks your language natively.
        </p>
      ) : null}
      {search.error ? <p className="error">{search.error}</p> : null}
      {search.message ? <p className="hint">{search.message}</p> : null}

      {search.candidates && search.candidates.length > 0 ? (
        <ul className={styles.variantList}>
          {search.candidates.map((candidate) => (
            <li key={candidate.id}>
              <span>
                <strong>{candidate.name}</strong>
                <span className={styles.variantMeta}>
                  {[candidate.accent, candidate.age?.replace(/_/g, ' '), candidate.useCase?.replace(/_/g, ' ')]
                    .filter(Boolean)
                    .join(' · ') || candidate.description}
                </span>
                {candidate.previewUrl ? (
                  <audio controls preload="none" src={candidate.previewUrl} style={{ display: 'block', marginTop: 6, height: 32 }} />
                ) : null}
              </span>
              <button
                className={chosen?.id === candidate.id ? 'btn' : 'btn btn--secondary'}
                type="button"
                onClick={() => setChosen(candidate)}
              >
                {chosen?.id === candidate.id ? 'Chosen' : 'Choose'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {chosen && search.query ? (
        <form action={runAdopt} className="stack" style={{ gap: 'var(--space-3)' }}>
          <input type="hidden" name="voiceId" value={chosen.id} />
          <input type="hidden" name="publicOwnerId" value={chosen.publicOwnerId ?? ''} />
          <input type="hidden" name="language" value={search.query.language} />
          <input type="hidden" name="locale" value={chosen.locale ?? ''} />
          <input type="hidden" name="gender" value={chosen.gender ?? search.query.gender ?? 'female'} />
          <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 2, minWidth: 160 }}>
              <label htmlFor="adopt-name">Call it</label>
              <input id="adopt-name" name="name" className="input" defaultValue={chosen.name} maxLength={80} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="adopt-style">Style</label>
              <select id="adopt-style" name="style" className="input" defaultValue="">
                <option value="">Auto</option>
                {VoiceStyle.options.map((style) => (
                  <option key={style} value={style}>
                    {VOICE_STYLE_LABELS[style].split(' — ')[0]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 120 }}>
              <label htmlFor="adopt-pace">Pace</label>
              <select id="adopt-pace" name="pace" className="input" defaultValue="">
                <option value="">Auto</option>
                {VoicePace.options.map((pace) => (
                  <option key={pace} value={pace}>
                    {VOICE_PACE_LABELS[pace]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0 }}>
            <legend className="hint">Reads (leave all unticked for everything)</legend>
            <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              {NarrationContext.options.map((context) => (
                <label key={context} className="row" style={{ gap: 6, fontSize: '0.85rem' }}>
                  <input type="checkbox" name="useCases" value={context} /> {NARRATION_CONTEXT_LABELS[context]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="row" style={{ gap: 8, fontSize: '0.9rem' }}>
            <input type="checkbox" name="makeDefault" defaultChecked /> Read every new film with it
          </label>
          <div className="row" style={{ gap: 'var(--space-3)' }}>
            <button className="btn" type="submit" disabled={adopting}>
              {adopting ? 'Saving…' : `Make ${chosen.name} our voice`}
            </button>
            {adopt.error ? <span className="error">{adopt.error}</span> : null}
            {adopt.message ? <span className="hint">{adopt.message}</span> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

function CloneForm() {
  const [state, act, pending] = useActionState<VoiceFormState, FormData>(cloneVoiceAction, { error: null });
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>A founder&rsquo;s voice</h3>
      </div>
      <p className="secondary" style={{ fontSize: '0.9rem' }}>
        Clone a real person&rsquo;s voice from one to three minutes of clean recording. We record
        who agreed, who granted it and when, before anything is made; revoking deletes the voice.
      </p>
      <form action={act} className="stack" style={{ gap: 'var(--space-3)' }} encType="multipart/form-data">
        <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="clone-subject">Whose voice</label>
            <input id="clone-subject" name="subjectName" className="input" placeholder="Their full name" required maxLength={160} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="clone-name">Call it</label>
            <input id="clone-name" name="name" className="input" placeholder="e.g. Amine, founder" maxLength={80} />
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="clone-language">Language</label>
            <select id="clone-language" name="language" className="input" defaultValue="en">
              {FILM_LANGUAGES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="clone-gender">Voice</label>
            <select id="clone-gender" name="gender" className="input" defaultValue="female">
              <option value="female">A woman&rsquo;s voice</option>
              <option value="male">A man&rsquo;s voice</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="clone-samples">Recordings</label>
          <input id="clone-samples" name="samples" className="input" type="file" accept="audio/*" multiple required />
          <span className="hint">One to three minutes in total, no music, one voice.</span>
        </div>
        <input type="hidden" name="scope" value="organization" />
        <label className="row" style={{ gap: 8, fontSize: '0.9rem', alignItems: 'flex-start' }}>
          <input type="checkbox" name="confirmed" required style={{ marginTop: 4 }} />
          <span>
            The person named above has agreed, in writing, to have their voice cloned and used in
            this workspace&rsquo;s films, and can withdraw that at any time. I am recording that
            consent on their behalf.
          </span>
        </label>
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Cloning…' : 'Clone under this consent'}
          </button>
          {state.error ? <span className="error">{state.error}</span> : null}
          {state.message ? <span className="hint">{state.message}</span> : null}
        </div>
      </form>
    </section>
  );
}

function PronunciationForm({ initial, canEdit }: { initial: string; canEdit: boolean }) {
  const [state, act, pending] = useActionState<VoiceFormState, FormData>(savePronunciationsAction, { error: null });
  return (
    <form action={act} className="stack" style={{ gap: 'var(--space-3)' }}>
      <textarea
        name="pronunciations"
        className="input"
        rows={4}
        defaultValue={initial}
        placeholder={'Ornikar = Or-nee-car\nAmine = Ah-meen [fr]'}
        readOnly={!canEdit}
        style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem', minHeight: 96 }}
      />
      {canEdit ? (
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <button className="btn btn--secondary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          {state.error ? <span className="error">{state.error}</span> : null}
          {state.message ? <span className="hint">{state.message}</span> : null}
        </div>
      ) : null}
    </form>
  );
}
