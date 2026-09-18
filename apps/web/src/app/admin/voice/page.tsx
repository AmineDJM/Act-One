import { speechUsageFrom } from '@act-one/core';
import { getPlatformConfig, listProviderState } from '@/server/platform.ts';
import { getStore } from '@/server/store.ts';
import { VoiceConfigForm, type CuratedRow } from './VoiceConfigForm.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * The voice, for staff: engines, what they may do, who reads each language,
 * what it has cost, and a way to hear two engines on one line.
 */
export default async function VoicePage() {
  const store = getStore();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [config, states, costs] = await Promise.all([
    getPlatformConfig(),
    listProviderState(),
    store.costs.listSince(since, 'speech.'),
  ]);
  const usage = speechUsageFrom(costs);
  const speech = config.providers.speech;
  const elevenlabs = states.find((state) => state.id === 'elevenlabs')?.configured ?? false;
  const library = speech.primary === 'elevenlabs' && elevenlabs;

  const curated: CuratedRow[] = [];
  for (const [key, entry] of Object.entries(speech.curated)) {
    for (const gender of ['female', 'male'] as const) {
      const profiles = entry[gender];
      if (!profiles) continue;
      for (const [profile, voice] of Object.entries(profiles)) {
        if (voice) curated.push({ key, gender, profile, voiceId: voice.voiceId, name: voice.name });
      }
    }
  }

  return (
    <>
      <header className={styles.head}>
        <h1>Voice</h1>
        <p className="lede">
          Content, the spoken adaptation, the direction, the performance, QA, the master. This is
          where the engines behind that are chosen and what they may do; customers only ever see a
          voice, a language, an accent, a style and a pace.
        </p>
      </header>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Voice cost, 30 days</span>
          <span className={styles.metricValue}>${usage.costUsd.toFixed(2)}</span>
          <span className={styles.metricNote}>
            {usage.calls} calls{usage.failed > 0 ? `, ${usage.failed} failed` : ''}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Characters read</span>
          <span className={styles.metricValue}>{usage.characters.toLocaleString('en-US')}</span>
          <span className={styles.metricNote}>
            {usage.secondsTranscribed > 0 ? `${Math.round(usage.secondsTranscribed)}s listened back` : 'nothing listened back'}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Reads finals</span>
          <span className={styles.metricValue} style={{ fontSize: '1.1rem' }}>
            {speech.primary === 'elevenlabs' ? (elevenlabs ? 'ElevenLabs v3' : 'ElevenLabs (no key: OpenAI reads)') : 'OpenAI'}
          </span>
          <span className={styles.metricNote}>
            previews: {speech.preview === 'same' ? 'same engine, fast model' : speech.preview} · ear: {speech.recognizer}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Clones</span>
          <span className={styles.metricValue}>{usage.clones}</span>
          <span className={styles.metricNote}>{speech.cloning ? 'cloning on, under consent' : 'cloning off'}</span>
        </div>
      </div>

      {usage.byProvider.length > 0 ? (
        <table className={styles.table} style={{ marginBottom: 'var(--space-5)' }}>
          <thead>
            <tr>
              <th>Engine</th>
              <th>Model</th>
              <th>Operation</th>
              <th>Calls</th>
              <th>Characters</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {usage.byProvider.map((row) => (
              <tr key={`${row.provider}-${row.model}-${row.operation}`}>
                <td>{row.provider}</td>
                <td className="mono">{row.model ?? '—'}</td>
                <td className="mono">{row.operation}</td>
                <td className={styles.num}>{row.calls}</td>
                <td className={styles.num}>{row.characters.toLocaleString('en-US')}</td>
                <td className={styles.num}>${row.costUsd.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className={styles.providerList}>
        <VoiceConfigForm
          speech={{
            primary: speech.primary,
            preview: speech.preview,
            recognizer: speech.recognizer,
            cloning: speech.cloning,
            takes: speech.takes,
            maxRegenerations: speech.maxRegenerations,
            maxCostPerProjectUsd: speech.maxCostPerProjectUsd,
          }}
          curated={curated}
          library={library}
        />
      </div>
    </>
  );
}
