'use client';

import { useActionState } from 'react';
import { saveRoutingAction, saveBudgetAction, type ActionResult } from '../actions.ts';
import styles from '../admin.module.css';

/**
 * Routing and creative budget.
 *
 * These are the two knobs that decide what a film costs and how much of it is
 * generated. They live behind the console, not in the product: a customer
 * choosing "Cinematic" should never be choosing a model name or a spend cap.
 */
export function RoutingForm({
  routing,
  prices,
  budget,
}: {
  prices: Record<string, { input: number; output: number }>;
  routing: {
    llm: { fast: string; balanced: string; deep: string };
    browser: { primary: string; fallback: string };
    speech: { primary: string; preview: string; recognizer: string };
    render: { engine: string; sceneAuthor: string; sceneAuthorTier: string };
    media: { enabled: boolean; maxCostPerRequestUsd: number; maxCostPerSecondUsd: number; maxRetries: number };
  };
  budget: {
    minDeterministicRatio: number;
    maxGenerativeRatio: number;
    minRealMediaRatio: number;
    maxCostPerSecondUsd: number;
    maxRetries: number;
  };
}) {
  const [routingResult, saveRouting, savingRouting] = useActionState<ActionResult | null, FormData>(
    saveRoutingAction,
    null,
  );
  const [budgetResult, saveBudget, savingBudget] = useActionState<ActionResult | null, FormData>(
    saveBudgetAction,
    null,
  );

  return (
    <>
      <section className={styles.provider}>
        <div className={styles.providerHead}>
          <div>
            <div className={styles.providerTitle}>Routing</div>
            <p className={styles.providerPurpose}>
              Which model serves each quality tier, and which browser vendor runs research. Customers
              never see any of these names.
            </p>
          </div>
        </div>
        <form action={saveRouting}>
          <div className={styles.providerBody}>
            <div className="field">
              <label htmlFor="llm-fast">Fast tier</label>
              <input id="llm-fast" name="llm.fast" className="input" defaultValue={routing.llm.fast} />
              <span className="hint">
                Classification, revisions, short calls.{' '}
                {prices[routing.llm.fast]
                  ? `$${prices[routing.llm.fast]!.input} in / $${prices[routing.llm.fast]!.output} out per 1M tokens.`
                  : 'No price on record — every call on this tier is billed at the dearest rate we know.'}
              </span>
            </div>
            <div className="field">
              <label htmlFor="llm-fast-input">Fast price, per 1M tokens</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id="llm-fast-input"
                  name="llm.fast.input"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="input"
                  defaultValue={prices[routing.llm.fast]?.input ?? ''}
                />
                <input
                  name="llm.fast.output"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="output"
                  defaultValue={prices[routing.llm.fast]?.output ?? ''}
                  aria-label="Fast output price per 1M tokens"
                />
              </div>
              <span className="hint">From the provider&rsquo;s own billing page. Blank leaves it as it is.</span>
            </div>
            <div className="field">
              <label htmlFor="llm-balanced">Balanced tier</label>
              <input id="llm-balanced" name="llm.balanced" className="input" defaultValue={routing.llm.balanced} />
              <span className="hint">
                Navigation planning, moment selection.{' '}
                {prices[routing.llm.balanced]
                  ? `$${prices[routing.llm.balanced]!.input} in / $${prices[routing.llm.balanced]!.output} out per 1M tokens.`
                  : 'No price on record — every call on this tier is billed at the dearest rate we know.'}
              </span>
            </div>
            <div className="field">
              <label htmlFor="llm-balanced-input">Balanced price, per 1M tokens</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id="llm-balanced-input"
                  name="llm.balanced.input"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="input"
                  defaultValue={prices[routing.llm.balanced]?.input ?? ''}
                />
                <input
                  name="llm.balanced.output"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="output"
                  defaultValue={prices[routing.llm.balanced]?.output ?? ''}
                  aria-label="Balanced output price per 1M tokens"
                />
              </div>
              <span className="hint">From the provider&rsquo;s own billing page. Blank leaves it as it is.</span>
            </div>
            <div className="field">
              <label htmlFor="llm-deep">Deep tier</label>
              <input id="llm-deep" name="llm.deep" className="input" defaultValue={routing.llm.deep} />
              <span className="hint">
                Product understanding, concepts, storyboard.{' '}
                {prices[routing.llm.deep]
                  ? `$${prices[routing.llm.deep]!.input} in / $${prices[routing.llm.deep]!.output} out per 1M tokens.`
                  : 'No price on record — every call on this tier is billed at the dearest rate we know.'}
              </span>
            </div>
            <div className="field">
              <label htmlFor="llm-deep-input">Deep price, per 1M tokens</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id="llm-deep-input"
                  name="llm.deep.input"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="input"
                  defaultValue={prices[routing.llm.deep]?.input ?? ''}
                />
                <input
                  name="llm.deep.output"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="output"
                  defaultValue={prices[routing.llm.deep]?.output ?? ''}
                  aria-label="Deep output price per 1M tokens"
                />
              </div>
              <span className="hint">From the provider&rsquo;s own billing page. Blank leaves it as it is.</span>
            </div>
            <div className="field">
              <label htmlFor="browser-primary">Browser</label>
              <select id="browser-primary" name="browser.primary" className="input" defaultValue={routing.browser.primary}>
                <option value="browserbase">Browserbase</option>
                <option value="local-chromium">Local Chromium</option>
                <option value="kernel">Kernel</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="browser-fallback">Browser fallback</label>
              <select id="browser-fallback" name="browser.fallback" className="input" defaultValue={routing.browser.fallback}>
                <option value="local-chromium">Local Chromium</option>
                <option value="browserbase">Browserbase</option>
                <option value="kernel">Kernel</option>
                <option value="none">None</option>
              </select>
              <span className="hint">Research is idempotent, so retrying elsewhere is safe.</span>
            </div>
            <div className="field">
              <label htmlFor="speech-primary">Voice, finals</label>
              <select id="speech-primary" name="speech.primary" className="input" defaultValue={routing.speech.primary}>
                <option value="elevenlabs">ElevenLabs v3 (needs its key under Integrations)</option>
                <option value="openai-speech">OpenAI (directed voices)</option>
              </select>
              <span className="hint">
                Both follow the film&rsquo;s language and the customer&rsquo;s choice of who reads. ElevenLabs
                casts a native voice and performs the direction on v3; OpenAI directs one of its own.
              </span>
            </div>
            <div className="field">
              <label htmlFor="speech-preview">Voice, previews</label>
              <select id="speech-preview" name="speech.preview" className="input" defaultValue={routing.speech.preview}>
                <option value="same">Same engine, on its fast model</option>
                <option value="openai-speech">OpenAI</option>
                <option value="elevenlabs">ElevenLabs</option>
              </select>
              <span className="hint">Animatics and drafts. Timing is what matters there, not the performance.</span>
            </div>
            <div className="field">
              <label htmlFor="speech-recognizer">Voice QA listens with</label>
              <select id="speech-recognizer" name="speech.recognizer" className="input" defaultValue={routing.speech.recognizer}>
                <option value="openai-speech">OpenAI (Whisper)</option>
                <option value="elevenlabs">ElevenLabs (Scribe)</option>
              </select>
              <span className="hint">
                Every passage is transcribed back and compared with the script: language, words, numbers.
                A different ear from the voice that spoke.
              </span>
            </div>
            <div className="field">
              <label htmlFor="render-engine">Film engine</label>
              <select id="render-engine" name="render.engine" className="input" defaultValue={routing.render.engine}>
                <option value="remotion">Remotion (Act One&rsquo;s own components)</option>
                <option value="hyperframes">HyperFrames (the same components, another renderer)</option>
              </select>
              <span className="hint">
                The same storyboard, sound and checks either way, and the hero shot&rsquo;s shortlist is drawn by the
                same engine as the film.
              </span>
            </div>
            <div className="field">
              <label htmlFor="render-scene-author">Who writes HyperFrames scenes</label>
              <select id="render-scene-author" name="render.sceneAuthor" className="input" defaultValue={routing.render.sceneAuthor}>
                <option value="engine">The engine (free, the Remotion components&rsquo; own port)</option>
                <option value="agent">A model (paid per scene)</option>
              </select>
              <span className="hint">
                A model costs a call per scene on a first render and, measured against the Remotion render, comes out
                no closer to it than the engine does. Animatics are drawn by the engine either way.
              </span>
            </div>
            <div className="field">
              <label htmlFor="render-author">Model that writes them</label>
              <select id="render-author" name="render.sceneAuthorTier" className="input" defaultValue={routing.render.sceneAuthorTier}>
                <option value="deep">Deep tier</option>
                <option value="balanced">Balanced tier</option>
                <option value="fast">Fast tier</option>
              </select>
              <span className="hint">Used only when a model writes the scenes: one call per scene on a first render, none on a re-render of the same brief.</span>
            </div>
            <div className="field">
              <label htmlFor="media-cost">Max spend per generated shot</label>
              <input
                id="media-cost"
                name="media.maxCostPerRequestUsd"
                className="input"
                type="number"
                step="0.5"
                min="0"
                defaultValue={routing.media.maxCostPerRequestUsd}
              />
              <span className="hint">Requests estimated above this are refused before they are sent.</span>
            </div>
            <div className="field">
              <label htmlFor="media-second">Max spend per second of film</label>
              <input
                id="media-second"
                name="media.maxCostPerSecondUsd"
                className="input"
                type="number"
                step="0.1"
                min="0"
                defaultValue={routing.media.maxCostPerSecondUsd}
              />
            </div>
            <div className="field">
              <label htmlFor="media-retries">Retries</label>
              <input
                id="media-retries"
                name="media.maxRetries"
                className="input"
                type="number"
                min="0"
                max="5"
                defaultValue={routing.media.maxRetries}
              />
            </div>
            <div className="field">
              <label htmlFor="media-enabled">Generative media</label>
              <label className="row" style={{ gap: 'var(--space-3)', height: 44 }}>
                <input
                  id="media-enabled"
                  name="media.enabled"
                  type="checkbox"
                  defaultChecked={routing.media.enabled}
                />
                <span className="secondary" style={{ fontSize: '0.9rem' }}>
                  Enabled platform-wide
                </span>
              </label>
            </div>
          </div>
          <div className={styles.providerActions}>
            <button className="btn" type="submit" disabled={savingRouting}>
              {savingRouting ? 'Saving…' : 'Save routing'}
            </button>
            {routingResult ? (
              <span className={styles.verdict} data-ok={routingResult.ok} role="status">
                {routingResult.ok ? '✓ ' : '✕ '}
                {routingResult.message}
              </span>
            ) : null}
          </div>
        </form>
      </section>

      <section className={styles.provider}>
        <div className={styles.providerHead}>
          <div>
            <div className={styles.providerTitle}>Creative budget</div>
            <p className={styles.providerPurpose}>
              The guard-rails that keep generated footage supplementary. A storyboard that breaches
              these is corrected on paper, before anything expensive runs.
            </p>
          </div>
        </div>
        <form action={saveBudget}>
          <div className={styles.providerBody}>
            <div className="field">
              <label htmlFor="b-det">Minimum rendered by our engine</label>
              <input id="b-det" name="minDeterministicRatio" className="input" type="number" step="0.05" min="0" max="1" defaultValue={budget.minDeterministicRatio} />
              <span className="hint">Typography and brand stay under our control.</span>
            </div>
            <div className="field">
              <label htmlFor="b-gen">Maximum generated</label>
              <input id="b-gen" name="maxGenerativeRatio" className="input" type="number" step="0.05" min="0" max="1" defaultValue={budget.maxGenerativeRatio} />
            </div>
            <div className="field">
              <label htmlFor="b-real">Minimum real product footage</label>
              <input id="b-real" name="minRealMediaRatio" className="input" type="number" step="0.05" min="0" max="1" defaultValue={budget.minRealMediaRatio} />
              <span className="hint">Applies when we actually captured the product.</span>
            </div>
            <div className="field">
              <label htmlFor="b-cost">Max cost per second</label>
              <input id="b-cost" name="maxCostPerSecondUsd" className="input" type="number" step="0.1" min="0" defaultValue={budget.maxCostPerSecondUsd} />
            </div>
            <div className="field">
              <label htmlFor="b-retries">Repair attempts</label>
              <input id="b-retries" name="maxRetries" className="input" type="number" min="0" max="5" defaultValue={budget.maxRetries} />
            </div>
          </div>
          <div className={styles.providerActions}>
            <button className="btn" type="submit" disabled={savingBudget}>
              {savingBudget ? 'Saving…' : 'Save budget'}
            </button>
            {budgetResult ? (
              <span className={styles.verdict} data-ok={budgetResult.ok} role="status">
                {budgetResult.ok ? '✓ ' : '✕ '}
                {budgetResult.message}
              </span>
            ) : null}
          </div>
        </form>
      </section>
    </>
  );
}
