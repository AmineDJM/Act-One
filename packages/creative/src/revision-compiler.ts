import { z } from 'zod';
import {
  RevisionIntent,
  newId,
  resequence,
  round3,
  type BrandSystem,
  type RevisionRequest,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';

/**
 * Natural-language revisions.
 *
 * The customer writes "the opening is too slow" or "show our analytics feature
 * instead". They should never see "Revision Round 2" or a properties panel.
 *
 * Two-stage on purpose. Cheap, deterministic patterns handle the instructions
 * people actually send — they are unambiguous, and matching them locally is
 * instant, free and cannot misread the request. Anything genuinely ambiguous
 * goes to the model, which is asked only to classify and scope, never to
 * rewrite the storyboard. Structural edits stay in code, where they are
 * testable and reversible.
 */
const RESOLUTION_RULES: {
  intent: z.infer<typeof RevisionIntent>;
  patterns: RegExp[];
  scope: 'opening' | 'ending' | 'all' | 'mentioned' | 'slowest' | 'wordiest';
}[] = [
  {
    intent: 'retime_scene',
    patterns: [
      /\b(too )?slow\b/i,
      /\bspeed (it )?up\b/i,
      /\bdrags?\b/i,
      /\btighten\b/i,
      /\bfaster\b/i,
    ],
    scope: 'slowest',
  },
  {
    intent: 'retime_scene',
    patterns: [
      /\btoo (fast|quick|rushed)\b/i,
      /\bslow (it )?down\b/i,
      /\blinger\b/i,
      /\bhold longer\b/i,
    ],
    scope: 'slowest',
  },
  {
    intent: 'remove_voiceover',
    patterns: [/\b(remove|no|drop|lose|kill) (the )?(voice|voice-?over|vo|narration)\b/i],
    scope: 'all',
  },
  {
    intent: 'add_voiceover',
    patterns: [/\badd (a )?(voice|voice-?over|narration)\b/i, /\bnarrate\b/i],
    scope: 'all',
  },
  {
    intent: 'reduce_text',
    patterns: [/\b(less|fewer|too much) (text|words|copy)\b/i, /\bwordy\b/i, /\btoo many words\b/i],
    scope: 'wordiest',
  },
  {
    intent: 'restrict_to_real_media',
    patterns: [
      /\bonly (use )?real\b/i,
      /\breal (product )?(assets|footage|media) only\b/i,
      /\bno (ai|generated|generative|stock)\b/i,
    ],
    scope: 'all',
  },
  {
    intent: 'change_tone',
    patterns: [
      /\bmore cinematic\b/i,
      /\bmore premium\b/i,
      /\bmore energy\b/i,
      /\bmore serious\b/i,
      /\bpunchier\b/i,
    ],
    scope: 'all',
  },
  {
    intent: 'remove_scene',
    patterns: [/\b(remove|delete|cut|drop) (scene|shot)\s*(\d+)/i],
    scope: 'mentioned',
  },
  {
    intent: 'replace_visual',
    patterns: [
      /\bshow .* instead\b/i,
      /\bswap .* for\b/i,
      /\buse .* instead\b/i,
      /\bdifferent (shot|visual|screen)\b/i,
    ],
    scope: 'mentioned',
  },
  {
    intent: 'recapture_product',
    patterns: [/\b(show|use|film) (our|the) ([a-z ]+) (feature|screen|page|view|dashboard)\b/i],
    scope: 'mentioned',
  },
  {
    intent: 'adjust_sound',
    patterns: [/\b(music|sound|audio|track)\b/i],
    scope: 'all',
  },
];

const ClassifiedRevision = z.object({
  intent: RevisionIntent,
  /** 1-based scene numbers the customer is talking about, if any. */
  sceneNumbers: z.array(z.number().int().min(1)).max(10).default([]),
  /** For replace/recapture: what they want shown instead. */
  requestedSubject: z.string().max(200).default(''),
  direction: z.enum(['faster', 'slower', 'more', 'less', 'none']).default('none'),
  reasoning: z.string().max(300).default(''),
});

export type ResolvedRevision = {
  intent: z.infer<typeof RevisionIntent>;
  affectedSceneIds: string[];
  requestedSubject: string;
  direction: 'faster' | 'slower' | 'more' | 'less' | 'none';
  /** True when the edit needs new product capture before it can render. */
  needsRecapture: boolean;
  /** Human-readable summary shown back to the customer. */
  summary: string;
};

export class RevisionCompiler {
  private readonly llm: LlmProvider | null;

  constructor(llm: LlmProvider | null = null) {
    this.llm = llm;
  }

  /** Resolves an instruction into a scoped, structured edit. */
  async resolve(
    instruction: string,
    storyboard: Storyboard,
    context: CallContext,
  ): Promise<ResolvedRevision> {
    const local = this.resolveLocally(instruction, storyboard);
    if (local) return local;
    if (!this.llm) return this.fallback(instruction, storyboard);

    const { value } = await this.llm.completeJson(
      [
        {
          role: 'system',
          content:
            'You classify a customer’s revision request against a storyboard. You do not rewrite ' +
            'anything — you identify what they mean and which scenes they mean it about. ' +
            'Scene numbers are 1-based. Return JSON only.',
        },
        {
          role: 'user',
          content: [
            `Request: "${instruction}"`,
            ``,
            `Storyboard:`,
            ...storyboard.scenes.map(
              (scene, i) =>
                `${i + 1}. [${scene.visualType}, ${scene.duration}s] ${scene.purpose}` +
                (scene.onScreenText.length > 0
                  ? ` — text: "${scene.onScreenText.join(' / ')}"`
                  : '') +
                (scene.narration ? ` — vo: "${scene.narration.slice(0, 80)}"` : ''),
            ),
          ].join('\n'),
        },
      ],
      {
        schema: ClassifiedRevision,
        schemaName: 'ClassifiedRevision',
        tier: 'fast',
        temperature: 0.1,
      },
      context,
    );

    const affected =
      value.sceneNumbers.length > 0
        ? value.sceneNumbers
            .map((n) => storyboard.scenes[n - 1]?.id)
            .filter((id): id is string => Boolean(id))
        : scopeToScenes(value.intent, storyboard);

    return {
      intent: value.intent,
      affectedSceneIds: affected,
      requestedSubject: value.requestedSubject,
      direction: value.direction,
      needsRecapture: value.intent === 'recapture_product' || value.intent === 'replace_visual',
      summary: describe(value.intent, affected.length, value.requestedSubject),
    };
  }

  /**
   * Handles the instructions people actually send, without a model call.
   * Faster, free, and incapable of misreading an unambiguous request.
   */
  resolveLocally(instruction: string, storyboard: Storyboard): ResolvedRevision | null {
    const explicitScenes = [...instruction.matchAll(/\bscenes?\s*(\d+)/gi)]
      .map((match) => Number(match[1]))
      .filter((n) => Number.isFinite(n));

    for (const rule of RESOLUTION_RULES) {
      if (!rule.patterns.some((pattern) => pattern.test(instruction))) continue;
      // "Show our analytics instead" needs a subject the rules cannot supply.
      if (
        rule.scope === 'mentioned' &&
        explicitScenes.length === 0 &&
        rule.intent !== 'remove_scene'
      ) {
        return null;
      }

      // "The opening is too slow" is about the opening, whichever scenes are
      // longest. A place the customer names outranks the rule's own scope.
      const affected =
        explicitScenes.length > 0
          ? explicitScenes
              .map((n) => storyboard.scenes[n - 1]?.id)
              .filter((id): id is string => Boolean(id))
          : scopeToScenes(rule.intent, storyboard, placeNamed(instruction) ?? rule.scope);

      const direction: ResolvedRevision['direction'] =
        /\b(too )?slow|drags?|speed up|faster|tighten\b/i.test(instruction)
          ? 'faster'
          : /\btoo (fast|quick|rushed)|slow (it )?down|linger|hold longer\b/i.test(instruction)
            ? 'slower'
            : /\b(less|fewer|too much)\b/i.test(instruction)
              ? 'less'
              : /\bmore\b/i.test(instruction)
                ? 'more'
                : 'none';

      return {
        intent: rule.intent,
        affectedSceneIds: affected,
        requestedSubject: '',
        direction,
        needsRecapture: rule.intent === 'recapture_product',
        summary: describe(rule.intent, affected.length, ''),
      };
    }

    return null;
  }

  private fallback(instruction: string, storyboard: Storyboard): ResolvedRevision {
    return {
      intent: 'unknown',
      affectedSceneIds: storyboard.scenes.map((s) => s.id),
      requestedSubject: instruction.slice(0, 200),
      direction: 'none',
      needsRecapture: false,
      summary: 'We could not tell which scenes this refers to, so nothing was changed.',
    };
  }
}

function scopeToScenes(
  intent: z.infer<typeof RevisionIntent>,
  storyboard: Storyboard,
  scope?: 'opening' | 'ending' | 'all' | 'mentioned' | 'slowest' | 'wordiest',
): string[] {
  const scenes = storyboard.scenes;
  if (scenes.length === 0) return [];

  const resolved =
    scope ??
    (intent === 'remove_voiceover' || intent === 'add_voiceover' || intent === 'change_tone'
      ? 'all'
      : 'slowest');

  switch (resolved) {
    case 'opening':
      return scenes.slice(0, 2).map((s) => s.id);
    case 'ending':
      return scenes.slice(-2).map((s) => s.id);
    case 'all':
      return scenes.map((s) => s.id);
    case 'slowest':
      // The scenes actually responsible for a film feeling slow are the longest
      // ones, not the ones the customer happened to be looking at.
      return [...scenes]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, Math.max(1, Math.ceil(scenes.length * 0.3)))
        .map((s) => s.id);
    case 'wordiest':
      return [...scenes]
        .sort((a, b) => wordCount(b) - wordCount(a))
        .filter((s) => wordCount(s) > 0)
        .slice(0, Math.max(1, Math.ceil(scenes.length * 0.3)))
        .map((s) => s.id);
    default:
      return scenes.map((s) => s.id);
  }
}

/** The part of the film the customer pointed at, when they did. */
export function placeNamed(instruction: string): 'opening' | 'ending' | null {
  if (
    /\b(opening|intro|introduction|start|beginning|first (scene|shot|few seconds))\b/i.test(
      instruction,
    )
  ) {
    return 'opening';
  }
  if (
    /\b(ending|outro|the end|closing|last (scene|shot|few seconds)|finale)\b/i.test(instruction)
  ) {
    return 'ending';
  }
  return null;
}

function wordCount(scene: Scene): number {
  return scene.onScreenText.join(' ').split(/\s+/).filter(Boolean).length;
}

function describe(intent: z.infer<typeof RevisionIntent>, count: number, subject: string): string {
  const scenes = count === 1 ? '1 scene' : `${count} scenes`;
  switch (intent) {
    case 'retime_scene':
      return `Retiming ${scenes}.`;
    case 'remove_voiceover':
      return 'Removing the voice-over and re-timing the film around the on-screen text.';
    case 'add_voiceover':
      return 'Adding narration and ducking the music underneath it.';
    case 'reduce_text':
      return `Cutting the copy back on ${scenes}.`;
    case 'restrict_to_real_media':
      return 'Replacing every generated shot with real product or typography.';
    case 'change_tone':
      return 'Adjusting pacing and motion across the film.';
    case 'remove_scene':
      return `Removing ${scenes} and re-timing what is left.`;
    case 'replace_visual':
      return subject
        ? `Replacing the visual with ${subject}.`
        : `Replacing the visual on ${scenes}.`;
    case 'recapture_product':
      return subject
        ? `Going back into the product to capture ${subject}.`
        : 'Going back into the product to capture new footage.';
    case 'adjust_sound':
      return 'Adjusting the music and sound design.';
    default:
      return `Updating ${scenes}.`;
  }
}

/**
 * Applies a resolved revision to the storyboard.
 *
 * Deterministic and total: every intent either produces a changed storyboard or
 * returns the original untouched. The scenes it reports as changed are exactly
 * the scenes that will be re-rendered, which is what keeps a revision cheap.
 */
export function applyRevision(
  storyboard: Storyboard,
  revision: ResolvedRevision,
  brand: BrandSystem,
): { storyboard: Storyboard; changedSceneIds: string[] } {
  const affected = new Set(revision.affectedSceneIds);
  const changed = new Set<string>();

  let scenes = storyboard.scenes.map((scene): Scene => {
    if (!affected.has(scene.id)) return scene;

    switch (revision.intent) {
      case 'retime_scene': {
        const factor = revision.direction === 'slower' ? 1.25 : 0.78;
        // Never below the floor where on-screen text stops being readable.
        const floor = Math.max(0.6, minimumLegibleDuration(scene));
        const next = round3(Math.max(floor, Math.min(12, scene.duration * factor)));
        if (next === scene.duration) return scene;
        changed.add(scene.id);
        return { ...scene, duration: next, status: 'draft' };
      }

      case 'remove_voiceover': {
        if (!scene.voiceOver && scene.narration === '') return scene;
        changed.add(scene.id);
        return {
          ...scene,
          narration: '',
          voiceOver: false,
          soundCues: scene.soundCues.filter((cue) => cue.type !== 'music_duck'),
          status: 'draft',
        };
      }

      case 'add_voiceover': {
        if (scene.voiceOver) return scene;
        changed.add(scene.id);
        // The copy team writes the words; here we reserve the slot and the duck.
        return {
          ...scene,
          voiceOver: true,
          soundCues: [
            ...scene.soundCues,
            {
              time: scene.startTime,
              type: 'music_duck',
              assetId: null,
              intensity: 0.4,
              durationSeconds: scene.duration,
            },
          ],
          status: 'draft',
        };
      }

      case 'reduce_text': {
        if (scene.onScreenText.length === 0) return scene;
        const reduced = scene.onScreenText.slice(0, Math.max(1, scene.onScreenText.length - 1));
        if (reduced.join() === scene.onScreenText.join()) return scene;
        changed.add(scene.id);
        return { ...scene, onScreenText: reduced, status: 'draft' };
      }

      case 'restrict_to_real_media': {
        if (scene.visualType !== 'generated_broll' && scene.visualType !== 'mixed_media')
          return scene;
        changed.add(scene.id);
        return {
          ...scene,
          visualType: 'kinetic_typography',
          generativeNeeds: [],
          assetRefs: [],
          notes: 'Replaced generated footage at the customer’s request.',
          status: 'draft',
        };
      }

      case 'change_tone': {
        changed.add(scene.id);
        const faster = revision.direction === 'faster' || revision.direction === 'more';
        // "More cinematic" must still move the way this brand moves; a global
        // easing swap is what makes every revised film converge on one feel.
        const easing = faster
          ? brand.motionStyle === 'cinematic'
            ? 'out_quint'
            : 'out_expo'
          : brand.motionStyle === 'snappy'
            ? 'out_quint'
            : 'in_out_quart';
        return {
          ...scene,
          motionRecipe: {
            ...scene.motionRecipe,
            easing,
            intensity: Math.min(
              1,
              Math.max(0.2, scene.motionRecipe.intensity + (faster ? 0.15 : -0.15)),
            ),
          },
          cameraRecipe: {
            ...scene.cameraRecipe,
            motionBlur: Math.min(
              0.24,
              Math.max(0.04, scene.cameraRecipe.motionBlur + (faster ? 0.04 : -0.02)),
            ),
          },
          status: 'draft',
        };
      }

      case 'recapture_product':
      case 'replace_visual': {
        changed.add(scene.id);
        return {
          ...scene,
          // Clearing the assets is what tells the pipeline to go and get new
          // ones rather than re-rendering the same frame.
          assetRefs: [],
          status: 'assets_pending',
          notes: revision.requestedSubject
            ? `Customer asked for: ${revision.requestedSubject}`
            : scene.notes,
        };
      }

      case 'adjust_sound': {
        changed.add(scene.id);
        const louder = revision.direction === 'more';
        return {
          ...scene,
          soundCues: scene.soundCues.map((cue) => ({
            ...cue,
            intensity: Math.min(1, Math.max(0, cue.intensity + (louder ? 0.12 : -0.12))),
          })),
        };
      }

      default:
        return scene;
    }
  });

  if (revision.intent === 'remove_scene') {
    const before = scenes.length;
    scenes = scenes.filter((scene) => !affected.has(scene.id));
    if (scenes.length !== before) for (const id of affected) changed.add(id);
  }

  if (revision.intent === 'remove_voiceover') {
    // Without narration the film can breathe differently; hand the timing model
    // the new floors rather than leaving scenes padded for words nobody speaks.
    scenes = scenes.map((scene) =>
      changed.has(scene.id)
        ? {
            ...scene,
            duration: round3(Math.max(minimumLegibleDuration(scene), scene.duration * 0.88)),
          }
        : scene,
    );
  }

  const next = resequence({
    ...storyboard,
    scenes,
    voiceStrategy: revision.intent === 'remove_voiceover' ? 'none' : storyboard.voiceStrategy,
    updatedAt: new Date().toISOString(),
  });

  return { storyboard: next, changedSceneIds: [...changed] };
}

function minimumLegibleDuration(scene: Scene): number {
  const words = scene.onScreenText.join(' ').split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0.8;
  return round3(0.45 + words / 2.6 + 0.35);
}

export function toRevisionRequest(params: {
  projectId: string;
  storyboardId: string;
  authorUserId: string;
  instruction: string;
  resolved: ResolvedRevision;
}): RevisionRequest {
  return {
    id: newId('cmt'),
    projectId: params.projectId,
    storyboardId: params.storyboardId,
    authorUserId: params.authorUserId,
    instruction: params.instruction,
    intent: params.resolved.intent,
    affectedSceneIds: params.resolved.affectedSceneIds,
    applied: false,
    appliedAt: null,
    // Direct from a job, with no conversation before it: confirmed by arrival.
    status: 'confirmed',
    proposal: { ...params.resolved, rerender: false },
    reply: params.resolved.summary,
    decidedAt: null,
    createdAt: new Date().toISOString(),
  };
}
