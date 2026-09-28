import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { DesignTokens } from '@act-one/design';
import { ProviderError, type CallContext, type ImageInput, type LlmProvider, type LlmTier } from '@act-one/providers';
import { fallbackScene, shotOf } from './fallback.ts';
import { launchReadable, launchScene, type LaunchBeat } from './launch.ts';
import { sceneMessages } from './prompt.ts';
import { sceneKey } from './scene-store.ts';
import type { FilmTokens } from './tokens.ts';
import type { AuthoredSceneStore, ScenePacket, SceneReport } from './types.ts';
import { figures, normalizeScene, validateScene, vocabulary, type ValidationContext, type ValidationFinding } from './validate.ts';

/**
 * Writing the scenes.
 *
 * One call per scene, in parallel up to a limit, each checked before it is
 * accepted and sent back with the reasons when it is not. A scene that cannot
 * be made to pass within its attempts falls back to the engine's own safe
 * composition, and the render record says so. A scene already written for
 * the same brief is served from the store, checked again against today's rules,
 * and never paid for twice.
 */
export type SceneAuthorOptions = {
  /** The model that writes scenes. Null draws every scene with the engine's own composition. */
  llm: LlmProvider | null;
  call: CallContext;
  tier: LlmTier;
  store: AuthoredSceneStore;
  /** Model calls per scene before the fallback. */
  maxAttempts: number;
  concurrency: number;
  /** Show the model the scene's pictures, small, so it can compose around them. */
  showPictures: boolean;
  /** Who draws a scene whose capture is taken apart or hung in a volume (see `isConstruction`). */
  constructions: 'engine' | 'agent';
  /** How the engine draws a scene itself. The classic port when absent. */
  look?: EngineLook;
  log: (line: string) => void;
  /**
   * Shared by every scene of a render. Set when the model answers in a way no
   * retry can change — no credit left, a key it refuses — so the scenes still
   * waiting are drawn by the engine at once instead of asking again, each
   * one, the same question that cannot be answered.
   */
  breaker?: { reason: string | null };
};

export type AuthoredScene = { packet: ScenePacket; key: string; html: string; report: SceneReport };

/**
 * How the engine draws a scene itself.
 *
 * `classic` is the port of the Remotion components, number for number. The
 * `launch` look stages the same beat as a motion designer would, over one
 * backdrop the film assembles under every scene, from a plan of the whole
 * film (which beat opens, which are chapters, which act each belongs to).
 */
export type EngineLook = { name: 'classic' } | { name: 'launch'; plan: ReadonlyMap<string, LaunchBeat> };

export const CLASSIC_LOOK: EngineLook = { name: 'classic' };

/** A beat the plan does not name is staged as the product's. */
const UNPLANNED_BEAT: LaunchBeat = { act: 'day', opener: false, chapter: false, chapterIndex: -1 };

const LAUNCH_REASON = 'drawn by the engine in the launch look, which stages every beat of the film itself';

/**
 * A scene whose capture is taken apart into layers or hung in a volume.
 *
 * These are constructions rather than compositions: dozens of values per
 * frame — the crop, the shell's recession, each layer's travel, the holes cut
 * under them, the panels' depth and turn — that the Remotion components
 * compute from the plan. The engine's own composition computes the same
 * numbers (SSIM 0.996 to 0.999 against the Remotion render); the agent,
 * working from their description, came to 0.96 to 0.98 on the same shots,
 * and a written scene cannot be told apart from a faithful one until it has
 * been rendered and compared.
 */
export function isConstruction(packet: ScenePacket): boolean {
  const shot = shotOf(packet);
  return shot.kind === 'ui' && shot.sequence.framings.some((framing) => framing.layers.length > 0);
}

const CONSTRUCTION_REASON = 'a capture taken apart or hung in a volume is drawn by the engine, whose construction is the Remotion engine’s own';

/**
 * The tokens a scene is made with: the agent's flattened copy, which is part
 * of every cache key, and the design engine's own, which the engine's
 * composition lays out with. Built together so the two cannot disagree.
 */
export type SceneTokens = { film: FilmTokens; design: DesignTokens };

export const SceneOutput = z.object({
  html: z.string(),
  notes: z.string(),
});

/** Marks a scene the engine drew itself, so a cached copy is still reported as a fallback. */
const FALLBACK_MARK = 'data-ao-fallback="true"';

export async function authorScenes(
  packets: readonly ScenePacket[],
  tokens: SceneTokens,
  projectDir: string,
  options: SceneAuthorOptions,
): Promise<AuthoredScene[]> {
  const results: AuthoredScene[] = new Array(packets.length);
  let next = 0;
  const worker = async () => {
    while (next < packets.length) {
      const index = next++;
      results[index] = await authorScene(packets[index]!, tokens, projectDir, options);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, packets.length)) }, worker));
  return results;
}

/**
 * One scene. With `feedback`, the scene is being rewritten after the assembled
 * film failed a check that names it; the store is bypassed and the new version
 * replaces the old one.
 */
export async function authorScene(
  packet: ScenePacket,
  tokens: SceneTokens,
  projectDir: string,
  options: SceneAuthorOptions,
  feedback?: { previous: string; findings: ValidationFinding[] },
): Promise<AuthoredScene> {
  const look = options.look ?? CLASSIC_LOOK;
  const key = sceneKey(packet, tokens.film, options.tier, lookVariant(look, packet));
  const context = validationContextFor(packet);

  // Drawn here, for nothing, every time: there is nothing to keep and nothing to ask a model.
  if (!feedback && look.name === 'launch') {
    return engineScene(packet, tokens.design, key, 0, 0, LAUNCH_REASON, look);
  }

  // Ahead of the store: a construction the agent wrote under the other setting is not what this one asks for.
  if (!feedback && options.constructions === 'engine' && isConstruction(packet)) {
    return engineScene(packet, tokens.design, key, 0, 0, CONSTRUCTION_REASON);
  }

  if (!feedback) {
    const cached = await options.store.get(key).catch((error: unknown) => {
      options.log(`${packet.frameId}: scene store unavailable (${(error as Error).message}); writing afresh`);
      return null;
    });
    if (cached) {
      const findings = validateScene(cached, context);
      if (!findings.some((finding) => finding.severity === 'error')) {
        const fallback = cached.includes(FALLBACK_MARK);
        return {
          packet,
          key,
          html: cached,
          report: report(packet, fallback ? 'fallback' : 'cache', 0, 0, findings, fallback ? 'kept from an earlier render of the same brief' : null),
        };
      }
      options.log(`${packet.frameId}: stored scene no longer passes the checks; writing afresh`);
    }
  }

  const llm = options.llm;
  if (!llm || options.maxAttempts < 1) {
    const drawn = engineScene(packet, tokens.design, key, 0, 0, 'no scene author is configured for this render');
    await options.store.put(key, drawn.html).catch(() => undefined);
    return drawn;
  }

  if (options.breaker?.reason) {
    const drawn = engineScene(packet, tokens.design, key, 0, 0, options.breaker.reason);
    options.log(`${packet.frameId}: drawn by the engine without asking the model (${options.breaker.reason})`);
    return drawn;
  }

  const images = options.showPictures ? await picturesFor(packet, projectDir, options.log) : [];
  let repair = feedback;
  let costUsd = 0;
  let lastProblem = '';
  let attempts = 0;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    if (options.call.signal?.aborted) throw options.call.signal.reason ?? new Error('aborted');
    if (options.breaker?.reason) {
      lastProblem = options.breaker.reason;
      break;
    }
    attempts = attempt;
    let html: string;
    try {
      const result = await llm.completeJson(
        sceneMessages(packet, tokens.film, repair),
        {
          tier: options.tier,
          schema: SceneOutput,
          schemaName: 'hyperframes_scene',
          temperature: 0.4,
          maxOutputTokens: 16_000,
          repairAttempts: 1,
          ...(images.length > 0 ? { images } : {}),
        },
        { ...options.call, sceneId: packet.sceneId },
      );
      costUsd += result.usage.costUsd;
      html = normalizeScene(result.value.html);
    } catch (error) {
      if (options.call.signal?.aborted) throw error;
      lastProblem = `the model call failed: ${(error as Error).message.slice(0, 240)}`;
      options.log(`${packet.frameId}: attempt ${attempt}, ${lastProblem}`);
      const lasting = unrecoverable(error);
      if (lasting) {
        lastProblem = lasting;
        if (options.breaker) options.breaker.reason = lasting;
        break;
      }
      continue;
    }

    const findings = validateScene(html, context);
    const errors = findings.filter((finding) => finding.severity === 'error');
    if (errors.length === 0) {
      await options.store.put(key, html).catch((error: unknown) => {
        options.log(`${packet.frameId}: could not keep the scene (${(error as Error).message}); the master may rewrite it`);
      });
      return { packet, key, html, report: report(packet, 'agent', attempt, costUsd, findings, null) };
    }
    lastProblem = errors.map((finding) => `[${finding.code}] ${finding.message}`).join(' ');
    options.log(`${packet.frameId}: attempt ${attempt} refused: ${lastProblem.slice(0, 400)}`);
    repair = { previous: html, findings: errors };
  }

  const drawn = engineScene(packet, tokens.design, key, attempts, costUsd, lastProblem || 'no attempt succeeded');
  // A scene the model could not write is kept; one it was never able to try is not, so the master asks again.
  if (!options.breaker?.reason) await options.store.put(key, drawn.html).catch(() => undefined);
  options.log(`${packet.frameId}: fell back to the engine's own composition after ${attempts} attempt(s)`);
  return drawn;
}

/**
 * A model error no retry can change, said plainly; null for everything else.
 *
 * An account with no credit, a key the provider refuses: asking again costs a
 * round trip per scene and changes nothing. A malformed answer, a gateway
 * hiccup, a rate limit are worth another attempt, and are left alone.
 */
export function unrecoverable(error: unknown): string | null {
  if (!(error instanceof ProviderError)) return null;
  if (/no credit left/i.test(error.message)) return 'the model provider has no credit left';
  if (error.status === 401 || error.status === 403) return `the model provider refused the credentials (HTTP ${error.status})`;
  return null;
}

/**
 * The engine's own composition for a scene, marked as such.
 *
 * Also used by the render when a written scene passes every check here but
 * still fails HyperFrames' own after its rewrites: the film goes out with a
 * quiet scene in that slot, and the record says which one and why.
 */
export function engineScene(
  packet: ScenePacket,
  design: DesignTokens,
  key: string,
  attempts: number,
  costUsd: number,
  reason: string,
  look: EngineLook = CLASSIC_LOOK,
): AuthoredScene {
  const drawn = look.name === 'launch' ? launchScene(packet, design, look.plan.get(packet.frameId) ?? UNPLANNED_BEAT) : fallbackScene(packet, design);
  const html = drawn.replace('<div id="root"', `<div ${FALLBACK_MARK} id="root"`);
  const context = validationContextFor(packet);
  // The launch look sets its own type, a typed line glyph by glyph; the studio's frame is the classic composition's.
  const findings = look.name === 'launch' ? validateScene(launchReadable(html), { ...context, expectsFrame: false }) : validateScene(html, context);
  if (findings.some((finding) => finding.severity === 'error')) {
    // The engine's own composition must always pass its own checks; if it does not, that is a bug here.
    throw new Error(`The engine's own scene for ${packet.frameId} fails validation: ${findings.filter((finding) => finding.severity === 'error').map((finding) => `[${finding.code}] ${finding.message}`).join(' ').slice(0, 600)}`);
  }
  return { packet, key, html, report: report(packet, 'fallback', attempts, costUsd, findings, reason) };
}

/** What a look adds to a scene's key: nothing for the classic port, the look and the beat's staging otherwise. */
function lookVariant(look: EngineLook, packet: ScenePacket): unknown {
  return look.name === 'launch' ? { look: 'launch', beat: look.plan.get(packet.frameId) ?? UNPLANNED_BEAT } : undefined;
}

/** Whether a stored or assembled scene is the engine's own composition. */
export function isEngineScene(html: string): boolean {
  return html.includes(FALLBACK_MARK);
}

/** What a scene may reference and say. */
export function validationContextFor(packet: ScenePacket): ValidationContext {
  const allowedPaths = new Set<string>(packet.assets.map((asset) => asset.path));
  if (packet.brand.logo) allowedPaths.add(packet.brand.logo.path);
  for (const source of layerSources(packet.uiSequence)) allowedPaths.add(source);

  const endCard = packet.recipe.name === 'cta_end_card' || packet.recipe.name === 'logo_reveal' || packet.isFinalScene;
  const texts = [...packet.onScreenText, packet.brand.name, packet.brand.cta, ...(endCard ? [packet.brand.tagline] : [])];
  return {
    frameId: packet.frameId,
    mountedSeconds: packet.timing.mountedSeconds,
    allowedPaths,
    allowedWords: vocabulary(...texts),
    allowedFigures: figures(...texts),
    expectsFrame: (packet.typeset?.blocks.length ?? 0) > 0,
  };
}

function layerSources(sequence: unknown): string[] {
  const framings = (sequence as { framings?: { layers?: { source?: unknown }[] }[] } | null)?.framings ?? [];
  return framings.flatMap((framing) => (framing.layers ?? []).map((layer) => layer.source)).filter(
    (source): source is string => typeof source === 'string' && source.startsWith('assets/'),
  );
}

/**
 * The scene's pictures, small, for the model to look at.
 *
 * Low detail and at most three: enough to see where the interface is busy and
 * where a line of type can sit, not enough to make every scene an expensive
 * vision call. A picture that cannot be read is skipped, not fatal.
 */
async function picturesFor(packet: ScenePacket, projectDir: string, log: (line: string) => void): Promise<ImageInput[]> {
  const images: ImageInput[] = [];
  for (const asset of packet.assets.filter((candidate) => candidate.kind === 'image').slice(0, 3)) {
    try {
      const buffer = await sharp(path.join(projectDir, asset.path), { limitInputPixels: 20_000 * 20_000 })
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 72 })
        .toBuffer();
      images.push({ url: `data:image/jpeg;base64,${buffer.toString('base64')}`, detail: 'low' });
    } catch (error) {
      log(`${packet.frameId}: could not show ${asset.path} to the model (${(error as Error).message})`);
    }
  }
  return images;
}

function report(
  packet: ScenePacket,
  source: SceneReport['source'],
  attempts: number,
  costUsd: number,
  findings: ValidationFinding[],
  fallbackReason: string | null,
): SceneReport {
  return {
    frameId: packet.frameId,
    sceneId: packet.sceneId,
    source,
    attempts,
    costUsd,
    findings: findings.map((finding) => ({ code: finding.code, severity: finding.severity, message: finding.message })),
    fallbackReason,
  };
}
