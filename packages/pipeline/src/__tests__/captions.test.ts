import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Project, VARIANT_SPECS, newId } from '@act-one/core';
import { planVariant } from '@act-one/creative';
import { MemoryStore } from '@act-one/db';
import {
  NullCostSink,
  ProviderRegistry,
  ScriptedLlmProvider,
  type Alignment,
  type CallContext,
  type SpeechAligner,
} from '@act-one/providers';
import { captionFilm, type NarrationForCaptions } from '../stages/captions.ts';
import type { StageContext } from '../context.ts';

/**
 * The caption track.
 *
 * What matters here is not the shape of a cue — that is tested against the
 * published limits in core — but where the timings came from: an aligner when
 * there is one, an estimate when there is not, and an estimate rather than a
 * dead render when the aligner falls over.
 */

let workDir = '';
beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'act-one-captions-'));
});

/** An aligner that returns the words evenly spaced, or refuses. */
class FakeAligner implements SpeechAligner {
  readonly name = 'fake-aligner';
  readonly kind = 'speech' as const;
  readonly calls: string[] = [];
  private readonly behaviour: 'align' | 'fail' | 'empty';
  constructor(behaviour: 'align' | 'fail' | 'empty' = 'align') {
    this.behaviour = behaviour;
  }
  async health() {
    return { provider: this.name, kind: 'speech' as const, healthy: true, checkedAt: new Date().toISOString() };
  }
  async align(_audio: Uint8Array, text: string, _context: CallContext): Promise<Alignment> {
    this.calls.push(text);
    if (this.behaviour === 'fail') throw new Error('the aligner is down');
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (this.behaviour === 'empty') return { words: [], seconds: 0, costUsd: 0 };
    // Half a second a word, starting at zero: deliberately unlike the estimate,
    // so a test can tell which one produced the cue.
    return {
      words: words.map((word, index) => ({ word, start: index * 0.5, end: index * 0.5 + 0.4 })),
      seconds: words.length * 0.5,
      costUsd: 0.001,
    };
  }
}

async function contextWith(aligner: SpeechAligner | null): Promise<StageContext> {
  const organizationId = newId('org');
  return {
    store: new MemoryStore(),
    registry: new ProviderRegistry({
      costSink: new NullCostSink(),
      overrides: { llm: new ScriptedLlmProvider([]), ...(aligner ? { aligner } : {}) },
    }),
    organizationId,
    project: Project.parse({
      id: newId('prj'),
      organizationId,
      createdByUserId: newId('usr'),
      name: 'Northwind',
      websiteUrl: 'https://northwind.example',
      brief: { durationSeconds: 30, language: 'en' },
      stage: 'rendering',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    jobId: newId('job'),
    progress: async () => {},
    activity: async () => {},
  };
}

async function passage(over: Partial<NarrationForCaptions> = {}): Promise<NarrationForCaptions> {
  const file = path.join(workDir, `${newId('ast')}.wav`);
  await writeFile(file, Buffer.from('not really audio'));
  return {
    path: file,
    atSeconds: 0,
    durationSeconds: 3,
    headSilenceSeconds: 0.15,
    tailSilenceSeconds: 0.2,
    text: 'A week of manual reconciliation.',
    ...over,
  };
}

describe('captions for a film', () => {
  it('times the words from the recording, offset to where the passage sits', async () => {
    const aligner = new FakeAligner();
    const context = await contextWith(aligner);
    const result = await captionFilm(context, {
      tracks: [await passage({ atSeconds: 12, text: 'One run.' })],
      language: 'en',
      filmSeconds: 30,
      boundaries: [],
    });

    expect(aligner.calls).toEqual(['One run.']);
    expect(result.alignedPassages).toBe(1);
    expect(result.passages).toBe(1);
    // The aligner said word one starts at 0; the passage plays at 12.
    expect(result.cues[0]!.start).toBe(12);
    expect(result.cues[0]!.text).toBe('One run.');
    expect(result.vtt).toContain('00:00:12.000 -->');
  });

  it('estimates the timings when no aligner is configured, and says so', async () => {
    const context = await contextWith(null);
    const result = await captionFilm(context, {
      tracks: [await passage()],
      language: 'en',
      filmSeconds: 30,
      boundaries: [],
    });

    expect(result.cues.length).toBeGreaterThan(0);
    expect(result.alignedPassages).toBe(0);
    expect(result.passages).toBe(1);
    // Estimated from the file: the words start after the head silence and end
    // before the tail, rather than at zero the way the fake aligner reports.
    expect(result.cues[0]!.start).toBeCloseTo(0.15, 2);
    expect(result.vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('falls back to an estimate rather than losing the track when the aligner fails', async () => {
    const context = await contextWith(new FakeAligner('fail'));
    const result = await captionFilm(context, {
      tracks: [await passage()],
      language: 'en',
      filmSeconds: 30,
      boundaries: [],
    });
    expect(result.cues.length).toBeGreaterThan(0);
    expect(result.alignedPassages).toBe(0);
  });

  it('does the same when the aligner answers with nothing', async () => {
    const context = await contextWith(new FakeAligner('empty'));
    const result = await captionFilm(context, {
      tracks: [await passage()],
      language: 'en',
      filmSeconds: 30,
      boundaries: [],
    });
    expect(result.cues.length).toBeGreaterThan(0);
    expect(result.alignedPassages).toBe(0);
  });

  it('says nothing at all for a film with no voice-over', async () => {
    const context = await contextWith(new FakeAligner());
    const result = await captionFilm(context, {
      tracks: [await passage({ text: '   ' })],
      language: 'en',
      filmSeconds: 30,
      boundaries: [],
    });
    expect(result.cues).toEqual([]);
    expect(result.vtt).toBe('');
  });

  it('never holds a caption across a cut', async () => {
    // Two passages either side of a scene start, and no full stop on the first
    // to break them apart: only the boundary can do it.
    const context = await contextWith(null);
    const result = await captionFilm(context, {
      tracks: [
        await passage({ atSeconds: 0, durationSeconds: 3, text: 'Four systems and one ledger' }),
        await passage({ atSeconds: 3, durationSeconds: 3, text: 'closed before lunch' }),
      ],
      language: 'en',
      filmSeconds: 8,
      boundaries: [3],
    });

    for (const cue of result.cues) {
      const spans = cue.start < 3 && cue.end > 3.05;
      expect(spans, `"${cue.text}" spans the cut at 3s`).toBe(false);
    }
    expect(result.cues.some((cue) => cue.text.includes('ledger') && cue.text.includes('lunch'))).toBe(false);
  });

  it('reports a caption nobody could read as a minor, never a blocker', async () => {
    const context = await contextWith(new FakeAligner());
    const result = await captionFilm(context, {
      tracks: [
        // Forty-nine characters, and the aligner puts the words half a second
        // apart, so they are done at 1.9s. Reading them needs 2.45s and the
        // film ends at 2: there is no silence left to borrow.
        await passage({ text: 'Reconciliation, consolidation, attribution, done.' }),
      ],
      language: 'en',
      filmSeconds: 2,
      boundaries: [],
    });

    const rate = result.issues.filter((issue) => issue.message.includes('a second'));
    expect(rate.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      expect(issue.severity).toBe('warning');
      expect(issue.check).toBe('caption_readability');
      expect(issue.repair).toBeNull();
      // The finding cites the rule it broke, so it can be looked up.
      expect(issue.message).toMatch(/Netflix|BBC|WCAG|W3C|EBU/);
    }
  });
});

describe('which cuts wear their captions', () => {
  it('takes the decision from the format spec rather than from a guess', () => {
    const storyboard = {
      id: newId('sbd'),
      scenes: Array.from({ length: 6 }, (_, index) => ({
        id: `scn_${index}`,
        index,
        startTime: index * 5,
        duration: 5,
        purpose: 'a beat',
        visualType: index === 0 ? 'kinetic_type' : index === 5 ? 'logo_reveal' : 'product_ui',
        onScreenText: ['One run'],
        narration: 'One run.',
        voiceOver: true,
        claimEvidenceIds: [],
      })),
    } as unknown as Parameters<typeof planVariant>[0];

    for (const purpose of ['vertical_30', 'tiktok', 'hero_60', 'bumper_6'] as const) {
      expect(planVariant(storyboard, purpose).captionsBurned).toBe(VARIANT_SPECS[purpose].captions);
    }
    // The two that matter: a feed cut wears them, a hero film does not.
    expect(VARIANT_SPECS.tiktok.captions).toBe(true);
    expect(VARIANT_SPECS.hero_60.captions).toBe(false);
  });
});
