import { z } from 'zod';
import { SceneGraph, type SceneObject, type SceneObjectKind } from './language.ts';

/**
 * What this installation can actually do, declared rather than assumed.
 *
 * The Director's question is "what does this scene need", never "which vendor
 * should I call". That separation already existed for providers; this extends
 * it to the whole studio, because the failure it prevents is the same one and
 * worse: a director who does not know what is executable will compose a shot
 * that cannot be made, and the first anybody hears of it is a frame that came
 * out empty.
 *
 * Every capability says what it takes, what it can animate, what it refuses,
 * roughly what it costs, and whether it is trusted for production. The
 * compiler checks a scene against this BEFORE anything renders, so an
 * impossible shot is a sentence at plan time rather than a hole in a master.
 */

export const CapabilityCategory = z.enum([
  'deterministic.motion',
  'typography.kinetic',
  'ui.layers',
  'ui.cinematography',
  'compositing.mask',
  'compositing.depth',
  'render.3d',
  'render.generative_video',
  'render.generative_image',
  'audio.voice',
  'audio.sfx',
  'audio.music',
]);
export type CapabilityCategory = z.infer<typeof CapabilityCategory>;

/**
 * Who executes it.
 *
 * Named by what they are rather than by vendor: `generative_video` is a
 * department, and which model staffs it on a given day is the provider
 * registry's business and nobody else's.
 */
export const Executor = z.enum([
  'remotion',
  'geometry',
  'generative_video',
  'generative_image',
  'audio_engine',
  'experimental',
]);
export type Executor = z.infer<typeof Executor>;

export const Capability = z.object({
  id: z.string().min(1).max(64),
  category: CapabilityCategory,
  executor: Executor,
  /** Object kinds this capability can draw. */
  accepts: z.array(z.string().max(32)).default([]),
  /** Transform and object properties it can animate. Anything else is ignored at render. */
  animates: z.array(z.string().max(32)).default([]),
  constraints: z
    .object({
      maxObjects: z.number().int().min(1).max(500).optional(),
      maxDurationSeconds: z.number().min(0.1).max(600).optional(),
      /** Aspects it can render. Empty means all. */
      aspects: z.array(z.string().max(8)).default([]),
      /** Properties it explicitly cannot do, so a compiler can say why. */
      cannot: z.array(z.string().max(64)).default([]),
    })
    .default(() => ({ aspects: [], cannot: [] })),
  cost: z
    .object({
      /** Rough USD per second of output. Zero for deterministic work. */
      usdPerSecond: z.number().min(0).default(0),
      /** Rough wall-clock seconds to produce one second of output. */
      renderSecondsPerSecond: z.number().min(0).default(1),
    })
    .default(() => ({ usdPerSecond: 0, renderSecondsPerSecond: 1 })),
  /**
   * Whether a customer's film may use it.
   *
   * The one field that matters most. An experimental capability is reachable
   * from a test render and from nowhere else, and promotion is a decision
   * somebody makes on evidence rather than a flag that drifts to true.
   */
  productionReady: z.boolean().default(false),
  notes: z.string().max(400).default(''),
});
export type Capability = z.infer<typeof Capability>;

/**
 * The trusted studio.
 *
 * Each of these is something Act One already does; declaring them is what lets
 * the compiler reason about them. Adding a capability here is a claim that the
 * executor genuinely implements it, and the registry test checks the claims
 * that can be checked mechanically.
 */
export const TRUSTED_CAPABILITIES: Capability[] = [
  Capability.parse({
    id: 'deterministic.layers',
    category: 'deterministic.motion',
    executor: 'remotion',
    accepts: ['text', 'shape', 'image', 'gradient', 'field', 'capture', 'ui_layer'],
    animates: [
      'x',
      'y',
      'z',
      'scale',
      'rotationZ',
      'opacity',
      'blurPx',
      'width',
      'height',
      'cornerRadiusPx',
      'strokeWidthPx',
    ],
    constraints: {
      maxObjects: 200,
      aspects: [],
      cannot: ['true 3D geometry', 'physical lighting'],
    },
    cost: { usdPerSecond: 0, renderSecondsPerSecond: 1.4 },
    productionReady: true,
    notes: 'The browser compositor. Everything the brand must be exact about is rendered here.',
  }),
  Capability.parse({
    id: 'typography.kinetic',
    category: 'typography.kinetic',
    executor: 'remotion',
    accepts: ['text'],
    animates: ['x', 'y', 'scale', 'opacity', 'blurPx', 'tracking'],
    constraints: { cannot: ['per-glyph 3D extrusion'] },
    productionReady: true,
    notes: 'Real font metrics, our own line breaking, word and line stagger.',
  }),
  Capability.parse({
    id: 'ui.layers',
    category: 'ui.layers',
    executor: 'remotion',
    accepts: ['ui_layer', 'capture'],
    animates: ['x', 'y', 'z', 'scale', 'rotationX', 'rotationY', 'opacity', 'blurPx'],
    constraints: { maxObjects: 24, cannot: ['inventing interface that was not captured'] },
    productionReady: true,
    notes: 'Regions cropped from a real capture and placed at separate depths. Never redrawn.',
  }),
  Capability.parse({
    id: 'compositing.mask',
    category: 'compositing.mask',
    executor: 'remotion',
    accepts: ['mask'],
    animates: ['x', 'y', 'width', 'height', 'featherPx'],
    productionReady: true,
  }),
  Capability.parse({
    id: 'compositing.depth',
    category: 'compositing.depth',
    executor: 'remotion',
    accepts: [],
    animates: ['z', 'dollyZ', 'focusZ', 'depthOfField'],
    constraints: { cannot: ['true depth-of-field; this is a 2.5D approximation'] },
    productionReady: true,
    notes: 'Parallax and defocus by depth. Honest 2.5D, not a camera model.',
  }),
  Capability.parse({
    id: 'render.3d',
    category: 'render.3d',
    executor: 'geometry',
    accepts: ['three_d'],
    animates: ['x', 'y', 'z', 'scale', 'rotationX', 'rotationY', 'rotationZ'],
    constraints: {
      maxDurationSeconds: 30,
      cannot: ['running without a geometry renderer installed'],
    },
    cost: { usdPerSecond: 0, renderSecondsPerSecond: 20 },
    productionReady: false,
    notes: 'Requires Blender on the worker. Declared unready until the host proves it.',
  }),
  Capability.parse({
    id: 'render.generative_video',
    category: 'render.generative_video',
    executor: 'generative_video',
    accepts: ['clip'],
    animates: [],
    constraints: { maxDurationSeconds: 30, cannot: ['depicting the customer interface'] },
    cost: { usdPerSecond: 0.46, renderSecondsPerSecond: 30 },
    productionReady: true,
    notes: 'A production department, not a director. Act One owns the crop, timing and sound.',
  }),
  Capability.parse({
    id: 'render.generative_image',
    category: 'render.generative_image',
    executor: 'generative_image',
    accepts: ['image'],
    animates: [],
    constraints: { cannot: ['depicting the customer interface'] },
    cost: { usdPerSecond: 0.04, renderSecondsPerSecond: 6 },
    productionReady: true,
  }),
  Capability.parse({
    id: 'audio.sfx',
    category: 'audio.sfx',
    executor: 'audio_engine',
    accepts: [],
    animates: [],
    productionReady: true,
    notes: 'Pre-roll compensated so the attack lands on the frame, not the file start.',
  }),
  Capability.parse({
    id: 'audio.music',
    category: 'audio.music',
    executor: 'audio_engine',
    accepts: [],
    animates: [],
    productionReady: true,
  }),
];

export class CapabilityRegistry {
  private readonly byId = new Map<string, Capability>();

  constructor(capabilities: Capability[] = TRUSTED_CAPABILITIES) {
    for (const capability of capabilities) this.byId.set(capability.id, capability);
  }

  all(): Capability[] {
    return [...this.byId.values()];
  }

  get(id: string): Capability | null {
    return this.byId.get(id) ?? null;
  }

  /**
   * Registers an experimental capability.
   *
   * Forced unready on the way in rather than trusted to arrive that way: this
   * is the door new code comes through, and the one guarantee worth making
   * about that door is that nothing walks through it into a customer's film.
   */
  registerExperimental(capability: Capability): Capability {
    const guarded = { ...capability, productionReady: false, executor: 'experimental' as const };
    this.byId.set(guarded.id, guarded);
    return guarded;
  }

  /** Marks an experimental capability trusted. Only ever called with evidence. */
  promote(id: string, evidence: { testRenderPath: string; reviewedBy: string }): Capability | null {
    const found = this.byId.get(id);
    if (!found) return null;
    const promoted = {
      ...found,
      productionReady: true,
      notes:
        `${found.notes} Promoted on ${evidence.testRenderPath}, reviewed by ${evidence.reviewedBy}.`.trim(),
    };
    this.byId.set(id, promoted);
    return promoted;
  }

  /** Capabilities that can draw a given object kind, production-ready first. */
  forKind(kind: SceneObjectKind): Capability[] {
    return this.all()
      .filter((capability) => capability.accepts.includes(kind))
      .sort((a, b) => Number(b.productionReady) - Number(a.productionReady));
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type RoutingProblem = {
  objectId: string;
  kind: string;
  /** `unsupported` is nothing can draw it; `experimental` is only untrusted code can. */
  problem: 'unsupported' | 'experimental' | 'over_constraint';
  message: string;
};

export type Routing = {
  /** Object id to the capability that will draw it. */
  assignments: Record<string, string>;
  /** Executors this scene needs, so a host can say up front what it lacks. */
  executors: Executor[];
  problems: RoutingProblem[];
  estimatedCostUsd: number;
  estimatedRenderSeconds: number;
};

/**
 * Works out who makes each object, and what cannot be made at all.
 *
 * The answer a director needs before spending anything: this shot is
 * executable, this one needs a geometry renderer nobody installed, this one
 * asks for something no capability claims. Returning problems rather than
 * throwing is deliberate — a scene with one impossible object should report
 * that object, not refuse to be looked at.
 */
export function routeScene(
  scene: SceneGraph,
  registry: CapabilityRegistry = new CapabilityRegistry(),
  options: { allowExperimental?: boolean } = {},
): Routing {
  const assignments: Record<string, string> = {};
  const problems: RoutingProblem[] = [];
  const executors = new Set<Executor>();
  let costUsd = 0;
  let renderSeconds = 0;

  const counts = new Map<string, number>();

  for (const object of scene.objects) {
    const candidates = registry.forKind(object.kind);
    const usable = candidates.filter(
      (capability) => capability.productionReady || options.allowExperimental === true,
    );

    if (usable.length === 0) {
      problems.push({
        objectId: object.id,
        kind: object.kind,
        problem: candidates.length === 0 ? 'unsupported' : 'experimental',
        message:
          candidates.length === 0
            ? `Nothing in this studio can draw a ${object.kind}.`
            : `A ${object.kind} can only be drawn by a capability that is not production-ready (${candidates.map((c) => c.id).join(', ')}).`,
      });
      continue;
    }

    const chosen = usable[0]!;
    assignments[object.id] = chosen.id;
    executors.add(chosen.executor);
    counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
    costUsd += chosen.cost.usdPerSecond * scene.durationSeconds;
    renderSeconds = Math.max(
      renderSeconds,
      chosen.cost.renderSecondsPerSecond * scene.durationSeconds,
    );

    const cap = chosen.constraints.maxDurationSeconds;
    if (cap !== undefined && scene.durationSeconds > cap) {
      problems.push({
        objectId: object.id,
        kind: object.kind,
        problem: 'over_constraint',
        message: `${chosen.id} produces at most ${cap}s; this scene is ${scene.durationSeconds}s.`,
      });
    }
  }

  for (const [id, used] of counts) {
    const capability = registry.get(id);
    const max = capability?.constraints.maxObjects;
    if (max !== undefined && used > max) {
      problems.push({
        objectId: '*',
        kind: id,
        problem: 'over_constraint',
        message: `${id} handles at most ${max} objects; this scene gives it ${used}.`,
      });
    }
  }

  return {
    assignments,
    executors: [...executors],
    problems,
    estimatedCostUsd: Math.round(costUsd * 1000) / 1000,
    estimatedRenderSeconds: Math.round(renderSeconds),
  };
}

/** Objects a routing could not place, for a caller that wants to degrade rather than fail. */
export function unroutable(scene: SceneGraph, routing: Routing): SceneObject[] {
  return scene.objects.filter((object) => !routing.assignments[object.id]);
}
