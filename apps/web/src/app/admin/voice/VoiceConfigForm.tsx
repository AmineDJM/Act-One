'use client';

import { useActionState } from 'react';
import { FILM_LANGUAGES, languageName } from '@act-one/core';
import type { ActionResult } from '../actions.ts';
import {
  benchmarkVoicesAction,
  curateVoiceAction,
  saveVoiceConfigAction,
  searchLibraryAction,
  uncurateVoiceAction,
  type BenchmarkResult,
  type CurateResult,
} from './actions.ts';
import styles from '../admin.module.css';

export type CuratedRow = { key: string; gender: 'female' | 'male'; profile: string; voiceId: string; name: string };

export function VoiceConfigForm({
  speech,
  curated,
  library,
}: {
  speech: {
    primary: string;
    preview: string;
    recognizer: string;
    cloning: boolean;
    takes: number;
    maxRegenerations: number;
    maxCostPerProjectUsd: number;
  };
  curated: CuratedRow[];
  library: boolean;
}) {
  const [saved, save, saving] = useActionState<ActionResult | null, FormData>(saveVoiceConfigAction, null);

  return (
    <>
      <section className={styles.provider}>
        <div className={styles.providerHead}>
          <div>
            <div className={styles.providerTitle}>Engines</div>
            <p className={styles.providerPurpose}>
              Who reads finals, who reads previews, and who listens back. The ear is chosen apart from
              the voice so no engine grades its own work.
            </p>
          </div>
        </div>
        <form action={save}>
          <div className={styles.providerBody}>
            <div className="field">
              <label htmlFor="v-primary">Finals</label>
              <select id="v-primary" name="speech.primary" className="input" defaultValue={speech.primary}>
                <option value="elevenlabs">ElevenLabs v3</option>
                <option value="openai-speech">OpenAI</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-preview">Previews</label>
              <select id="v-preview" name="speech.preview" className="input" defaultValue={speech.preview}>
                <option value="same">Same engine, fast model</option>
                <option value="openai-speech">OpenAI</option>
                <option value="elevenlabs">ElevenLabs</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-recognizer">Listens back with</label>
              <select id="v-recognizer" name="speech.recognizer" className="input" defaultValue={speech.recognizer}>
                <option value="openai-speech">OpenAI (Whisper)</option>
                <option value="elevenlabs">ElevenLabs (Scribe)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-takes">Takes per passage</label>
              <input id="v-takes" name="speech.takes" className="input" type="number" min="1" max="3" defaultValue={speech.takes} />
              <span className="hint">On plans that carry takes. QA picks; the rest are kept for the customer.</span>
            </div>
            <div className="field">
              <label htmlFor="v-regen">Regenerations on a failed read</label>
              <input id="v-regen" name="speech.maxRegenerations" className="input" type="number" min="0" max="3" defaultValue={speech.maxRegenerations} />
            </div>
            <div className="field">
              <label htmlFor="v-cost">Voice cost ceiling per project ($)</label>
              <input id="v-cost" name="speech.maxCostPerProjectUsd" className="input" type="number" min="0" step="0.5" defaultValue={speech.maxCostPerProjectUsd} />
              <span className="hint">0 is no ceiling.</span>
            </div>
            <div className="field">
              <label htmlFor="v-cloning">Voice cloning</label>
              <label className="row" style={{ gap: 'var(--space-3)', height: 44 }}>
                <input id="v-cloning" name="speech.cloning" type="checkbox" defaultChecked={speech.cloning} />
                <span className="secondary" style={{ fontSize: '0.9rem' }}>
                  Customers on plans with cloning may clone a voice, under recorded consent
                </span>
              </label>
            </div>
          </div>
          <div className={styles.providerActions}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved ? (
              <span className={styles.verdict} data-ok={saved.ok}>
                {saved.message}
              </span>
            ) : null}
          </div>
        </form>
      </section>

      <Curation curated={curated} library={library} />
      <Benchmark />
    </>
  );
}

function Curation({ curated, library }: { curated: CuratedRow[]; library: boolean }) {
  const [search, runSearch, searching] = useActionState<CurateResult | null, FormData>(searchLibraryAction, null);
  const [curate, runCurate, curating] = useActionState<ActionResult | null, FormData>(curateVoiceAction, null);
  const [uncurate, runUncurate, uncurating] = useActionState<ActionResult | null, FormData>(uncurateVoiceAction, null);

  return (
    <section className={styles.provider}>
      <div className={styles.providerHead}>
        <div>
          <div className={styles.providerTitle}>Curated voices</div>
          <p className={styles.providerPurpose}>
            The voice that reads each language or accent, per gender and profile. Where nothing is
            curated the library is searched for a native voice; where nothing speaks the language,
            the stock voice reads.
          </p>
        </div>
      </div>

      {curated.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Reads</th>
              <th>Gender</th>
              <th>Profile</th>
              <th>Voice</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {curated.map((row) => (
              <tr key={`${row.key}-${row.gender}-${row.profile}`}>
                <td>
                  {row.key} {languageName(row.key.slice(0, 2)) ? <span className="muted">({languageName(row.key.slice(0, 2))})</span> : null}
                </td>
                <td>{row.gender}</td>
                <td>{row.profile}</td>
                <td>
                  {row.name || row.voiceId} <span className="mono muted">{row.voiceId}</span>
                </td>
                <td>
                  <form action={runUncurate}>
                    <input type="hidden" name="key" value={row.key} />
                    <input type="hidden" name="gender" value={row.gender} />
                    <input type="hidden" name="profile" value={row.profile} />
                    <button className="btn btn--ghost" type="submit" disabled={uncurating}>
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hint">Nothing curated yet: every language is cast from the library.</p>
      )}
      {uncurate ? (
        <p className={styles.verdict} data-ok={uncurate.ok}>
          {uncurate.message}
        </p>
      ) : null}

      <form action={runSearch}>
        <div className={styles.providerBody}>
          <div className="field">
            <label htmlFor="c-language">Language</label>
            <select id="c-language" name="language" className="input" defaultValue="fr">
              {FILM_LANGUAGES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-locale">Accent (locale)</label>
            <input id="c-locale" name="locale" className="input" placeholder="fr-FR, en-GB… optional" />
          </div>
          <div className="field">
            <label htmlFor="c-gender">Gender</label>
            <select id="c-gender" name="gender" className="input" defaultValue="">
              <option value="">Either</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
        </div>
        <div className={styles.providerActions}>
          <button className="btn btn--secondary" type="submit" disabled={searching || !library}>
            {searching ? 'Searching…' : 'Search the library'}
          </button>
          {!library ? <span className="hint">Choose ElevenLabs for finals and save its key to curate.</span> : null}
          {search ? (
            <span className={styles.verdict} data-ok={search.ok}>
              {search.message}
            </span>
          ) : null}
        </div>
      </form>

      {search?.candidates && search.candidates.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Voice</th>
              <th>Accent</th>
              <th>Listen</th>
              <th>Curate as</th>
            </tr>
          </thead>
          <tbody>
            {search.candidates.map((voice) => (
              <tr key={voice.id}>
                <td>
                  <strong>{voice.name}</strong>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {[voice.gender, voice.age?.replace(/_/g, ' '), voice.useCase?.replace(/_/g, ' '), voice.category].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td>
                  {voice.accent ?? '—'}
                  {voice.locale ? <div className="mono muted">{voice.locale}</div> : null}
                </td>
                <td>{voice.previewUrl ? <audio controls preload="none" src={voice.previewUrl} style={{ height: 32, width: 200 }} /> : '—'}</td>
                <td>
                  <form action={runCurate} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <input type="hidden" name="voiceId" value={voice.id} />
                    <input type="hidden" name="publicOwnerId" value={voice.publicOwnerId ?? ''} />
                    <input type="hidden" name="name" value={voice.name} />
                    <input name="key" className="input" defaultValue={voice.locale ?? voice.language} style={{ width: 90 }} aria-label="Language or locale" />
                    <select name="gender" className="input" defaultValue={voice.gender ?? 'female'} aria-label="Gender" style={{ width: 100 }}>
                      <option value="female">female</option>
                      <option value="male">male</option>
                    </select>
                    <select name="profile" className="input" defaultValue="premium" aria-label="Profile" style={{ width: 110 }}>
                      <option value="premium">premium</option>
                      <option value="warm">warm</option>
                      <option value="neutral">neutral</option>
                    </select>
                    <button className="btn btn--secondary" type="submit" disabled={curating}>
                      Curate
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {curate ? (
        <p className={styles.verdict} data-ok={curate.ok}>
          {curate.message}
        </p>
      ) : null}
    </section>
  );
}

function Benchmark() {
  const [result, run, running] = useActionState<BenchmarkResult | null, FormData>(benchmarkVoicesAction, null);
  return (
    <section className={styles.provider}>
      <div className={styles.providerHead}>
        <div>
          <div className={styles.providerTitle}>Blind comparison</div>
          <p className={styles.providerPurpose}>
            One line, one direction, every engine with a key. Nothing is stored; it costs what one
            line costs.
          </p>
        </div>
      </div>
      <form action={run}>
        <div className={styles.providerBody}>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="b-text">The line</label>
            <input id="b-text" name="text" className="input" maxLength={300} defaultValue="Le matin, tout est déjà rapproché. Une idée, un film." />
          </div>
          <div className="field">
            <label htmlFor="b-language">Language</label>
            <select id="b-language" name="language" className="input" defaultValue="fr">
              {FILM_LANGUAGES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="b-gender">Gender</label>
            <select id="b-gender" name="gender" className="input" defaultValue="female">
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
        </div>
        <div className={styles.providerActions}>
          <button className="btn btn--secondary" type="submit" disabled={running}>
            {running ? 'Reading…' : 'Read it on every engine'}
          </button>
          {result ? (
            <span className={styles.verdict} data-ok={result.ok}>
              {result.message}
            </span>
          ) : null}
        </div>
      </form>
      {result?.reads && result.reads.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Engine</th>
              <th>Model</th>
              <th>Time</th>
              <th>Cost</th>
              <th>Listen</th>
            </tr>
          </thead>
          <tbody>
            {result.reads.map((read) => (
              <tr key={read.engine}>
                <td>{read.engine}</td>
                <td className="mono">{read.model}</td>
                <td className={styles.num}>{(read.ms / 1000).toFixed(1)}s</td>
                <td className={styles.num}>${read.costUsd.toFixed(4)}</td>
                <td>{read.dataUrl ? <audio controls preload="auto" src={read.dataUrl} style={{ height: 32 }} /> : 'failed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
