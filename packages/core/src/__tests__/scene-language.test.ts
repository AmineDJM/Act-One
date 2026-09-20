import { describe, expect, it } from 'vitest';
import {
  Animatable,
  CapabilityRegistry,
  SceneGraph,
  Transform,
  assessExperiment,
  compileScene,
  inspectScene,
  migratedRecipes,
  objectPresent,
  promoteExperiment,
  routeScene,
  valueAt,
  type CurveFn,
  type CurveName,
  type Scene,
  type SceneObject,
} from '../index.ts';

/**
 * The scene language is the layer everything else will come to depend on, so
 * what is protected here is its contracts rather than its conveniences: that a
 * curve evaluates the way a renderer will draw it, that the router refuses
 * what cannot be made, that QA can find the defects that are knowable from the
 * plan, and that the experimental door cannot be walked through.
 */

/** Simple, exact curves. The real ones live in the motion package. */
const CURVES: Record<CurveName, CurveFn> = {
  linear: (t) => t,
  out_quint: (t) => 1 - (1 - t) ** 5,
  out_cubic: (t) => 1 - (1 - t) ** 3,
  in_cubic: (t) => t ** 3,
  in_out_cubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  in_out_quart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  out_expo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  spring_soft: (t) => t,
  spring_tight: (t) => t,
  anticipate: (t) => t,
};

const scene = (over: Partial<SceneGraph> = {}): SceneGraph =>
  SceneGraph.parse({ id: 'scn_test', durationSeconds: 4, ...over });

const text = (over: Record<string, unknown> = {}): SceneObject =>
  ({
    kind: 'text',
    id: 'copy',
    content: 'Six weeks becomes an afternoon',
    token: 'display',
    role: 'payload',
    reason: 'The line of the beat.',
    transform: Transform.parse({ x: 0.5, y: 0.5 }),
    staggerBy: 'none',
    staggerSeconds: 0,
    maxWidth: 0.8,
    maxLines: 2,
    align: 'left',
    color: 'onCanvas.primary',
    ...over,
  }) as SceneObject;

describe('animatable values', () => {
  it('reads a constant as itself', () => {
    expect(valueAt(0.42, 0.7, CURVES)).toBe(0.42);
  });

  it('eases a from/to across the span', () => {
    const property = Animatable.parse({ from: 0, to: 10, curve: 'linear' });
    expect(valueAt(property, 0, CURVES)).toBeCloseTo(0);
    expect(valueAt(property, 0.5, CURVES)).toBeCloseTo(5);
    expect(valueAt(property, 1, CURVES)).toBeCloseTo(10);
  });

  it('walks keyframes and uses the curve INTO each one', () => {
    const property = Animatable.parse({
      keyframes: [
        { t: 0, value: 0 },
        { t: 0.5, value: 100, curve: 'linear' },
        { t: 1, value: 50, curve: 'linear' },
      ],
      curve: 'linear',
    });
    expect(valueAt(property, 0.25, CURVES)).toBeCloseTo(50);
    expect(valueAt(property, 0.5, CURVES)).toBeCloseTo(100);
    expect(valueAt(property, 0.75, CURVES)).toBeCloseTo(75);
  });

  it('holds the end values outside the span rather than extrapolating', () => {
    // A property read past its object's life must not keep travelling; that is
    // how an element ends up off screen in the frame after it should have settled.
    const property = Animatable.parse({
      keyframes: [
        { t: 0.2, value: 5 },
        { t: 0.8, value: 9 },
      ],
      curve: 'linear',
    });
    expect(valueAt(property, 0, CURVES)).toBe(5);
    expect(valueAt(property, 1, CURVES)).toBe(9);
  });
});

describe('object presence', () => {
  it('is on screen between its own enter and exit', () => {
    const object = text({ enterAt: 1, exitAt: 3 });
    expect(objectPresent(object, 0.5, 4)).toBe(false);
    expect(objectPresent(object, 2, 4)).toBe(true);
    expect(objectPresent(object, 3.5, 4)).toBe(false);
  });

  it('runs to the end of the scene when it never exits', () => {
    expect(objectPresent(text({ enterAt: 0 }), 3.9, 4)).toBe(true);
  });
});

describe('capability routing', () => {
  it('places every object it can and names the ones it cannot', () => {
    const graph = scene({
      objects: [
        text(),
        { ...text({ id: 'geo' }), kind: 'three_d', sceneId: 'rig_1' } as unknown as SceneObject,
      ],
    });
    const routing = routeScene(graph);
    expect(routing.assignments['copy']).toBeTruthy();
    // The geometry executor is declared not production-ready, so it must not
    // be silently used.
    expect(routing.assignments['geo']).toBeUndefined();
    expect(routing.problems.some((p) => p.objectId === 'geo')).toBe(true);
  });

  it('will use an unready capability only when explicitly allowed', () => {
    const graph = scene({
      objects: [
        { ...text({ id: 'geo' }), kind: 'three_d', sceneId: 'rig_1' } as unknown as SceneObject,
      ],
    });
    expect(
      routeScene(graph, new CapabilityRegistry(), { allowExperimental: true }).assignments['geo'],
    ).toBe('render.3d');
  });

  it('estimates cost from the capabilities actually used', () => {
    const graph = scene({ durationSeconds: 5, objects: [text()] });
    // Deterministic work is free; the estimate must not invent a number.
    expect(routeScene(graph).estimatedCostUsd).toBe(0);
  });
});

describe('structural inspection', () => {
  it('fails a line nobody can finish reading', () => {
    const graph = scene({
      durationSeconds: 4,
      objects: [
        text({
          enterAt: 0,
          exitAt: 0.6,
          content:
            'A considerably longer sentence than anybody could read in six tenths of a second',
        }),
      ],
    });
    const findings = inspectScene(graph, CURVES);
    expect(
      findings.some((f) => f.check === 'unreadable_duration' && f.severity === 'hard_fail'),
    ).toBe(true);
  });

  it('fails a payload outside the title-safe area', () => {
    const graph = scene({ objects: [text({ transform: Transform.parse({ x: 0.01, y: 0.5 }) })] });
    expect(inspectScene(graph, CURVES).some((f) => f.check === 'outside_safe_area')).toBe(true);
  });

  it('flags motion that gives no reason', () => {
    const graph = scene({
      objects: [
        text({
          reason: '',
          transform: Transform.parse({ x: { from: 0.2, to: 0.8, curve: 'linear' }, y: 0.5 }),
        }),
      ],
    });
    expect(inspectScene(graph, CURVES).some((f) => f.check === 'unmotivated_motion')).toBe(true);
  });

  it('does not flag motion that gives one', () => {
    const graph = scene({
      objects: [
        text({
          reason: 'It leaves so the next idea can take the space.',
          transform: Transform.parse({ x: { from: 0.2, to: 0.8, curve: 'linear' }, y: 0.5 }),
        }),
      ],
    });
    expect(inspectScene(graph, CURVES).some((f) => f.check === 'unmotivated_motion')).toBe(false);
  });

  it('refuses a generated object that claims to be the product interface', () => {
    const graph = scene({
      objects: [
        {
          kind: 'image',
          id: 'fake',
          assetId: 'gen_1',
          generated: true,
          role: 'payload',
          reason: 'A dashboard showing the analytics screen.',
          transform: Transform.parse({}),
          crop: { x: 0, y: 0, width: 1, height: 1 },
          width: 0.8,
        } as unknown as SceneObject,
      ],
    });
    const findings = inspectScene(graph, CURVES);
    expect(
      findings.some((f) => f.check === 'generated_product_ui' && f.severity === 'hard_fail'),
    ).toBe(true);
  });

  it('allows a generated object that is not claiming to be the product', () => {
    const graph = scene({
      objects: [
        {
          kind: 'image',
          id: 'mood',
          assetId: 'gen_2',
          generated: true,
          role: 'atmosphere',
          reason: 'A city at dusk, for the environment the beat describes.',
          transform: Transform.parse({}),
          crop: { x: 0, y: 0, width: 1, height: 1 },
          width: 1,
        } as unknown as SceneObject,
      ],
    });
    expect(inspectScene(graph, CURVES).some((f) => f.check === 'generated_product_ui')).toBe(false);
  });

  it('notices the same device three times running', () => {
    const graph = scene({ macro: 'product_zoom', objects: [text()] });
    const findings = inspectScene(graph, CURVES, {
      previousMacros: ['product_zoom', 'product_zoom'],
    });
    expect(findings.some((f) => f.check === 'repeated_device')).toBe(true);
  });
});

describe('compiling old scenes', () => {
  const oldScene = (over: Partial<Scene> = {}): Scene =>
    ({
      id: 'scn_old',
      storyboardId: 'sbd',
      index: 0,
      startTime: 0,
      duration: 4,
      purpose: 'Say the thing',
      narration: '',
      onScreenText: ['Six weeks', 'becomes an afternoon'],
      visualType: 'kinetic_typography',
      assetRefs: [],
      momentIds: [],
      motionRecipe: {
        name: 'kinetic_headline',
        easing: 'out_quint',
        delay: 0,
        stagger: 0.07,
        intensity: 0.6,
        params: {},
      },
      cameraRecipe: {
        move: 'push_in',
        fromScale: 1,
        toScale: 1.16,
        fromX: -0.04,
        toX: 0.03,
        fromY: 0,
        toY: 0,
        motionBlur: 0.2,
        depthOfField: 0,
        easing: 'out_quint',
      },
      uiSequence: null,
      soundCues: [],
      voiceOver: false,
      generativeNeeds: [],
      threeDSceneId: null,
      status: 'draft',
      claimEvidenceIds: [],
      notes: '',
      estimatedCostUsd: 0,
      ...over,
    }) as Scene;

  it('turns a recipe into primitives and keeps the camera', () => {
    const { scene: graph, warnings } = compileScene(oldScene());
    expect(warnings).toEqual([]);
    expect(graph.macro).toBe('kinetic_headline');
    expect(
      graph.objects.some((object) => object.kind === 'text' && object.role === 'payload'),
    ).toBe(true);
    // The camera is carried across as a curve, not reinterpreted.
    expect(valueAt(graph.camera.scale, 1, CURVES)).toBeCloseTo(1.16);
  });

  it('compiles a recipe with no macro to something renderable, and says so', () => {
    const { scene: graph, warnings } = compileScene(
      oldScene({
        motionRecipe: {
          name: 'window_explosion',
          easing: 'out_quint',
          delay: 0,
          stagger: 0,
          intensity: 0.6,
          params: {},
        },
      }),
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('window_explosion');
    // A beat with no macro is still a beat, never a hole.
    expect(graph.objects.length).toBeGreaterThan(0);
  });

  it('turns an opaque field parameter into an object QA can read', () => {
    const { scene: graph } = compileScene(
      oldScene({
        motionRecipe: {
          name: 'word_reveal',
          easing: 'out_quint',
          delay: 0,
          stagger: 0.07,
          intensity: 0.6,
          params: { field: 'converge', fieldCount: 6 },
        },
      }),
    );
    const field = graph.objects.find((object) => object.kind === 'field');
    expect(field).toBeTruthy();
    expect(field && field.kind === 'field' && field.count).toBe(6);
  });

  it('puts storyboard cues onto the scene’s own clock', () => {
    const { scene: graph } = compileScene(
      oldScene({
        startTime: 20,
        soundCues: [
          { time: 21.85, type: 'impact', assetId: null, intensity: 0.8, durationSeconds: null },
        ],
      }),
    );
    expect(graph.audio[0]?.at).toBeCloseTo(1.85);
  });

  it('reports which recipes have macros, so the migration edge is visible', () => {
    expect(migratedRecipes()).toContain('product_zoom');
    expect(migratedRecipes().length).toBeGreaterThan(3);
  });
});

describe('the experimental door', () => {
  it('refuses to run model-written code, and says what a sandbox would need', () => {
    const verdict = assessExperiment({
      id: 'magnetic',
      kind: 'executor',
      intent: 'A magnetic field shader.',
      proposal: null,
      executorBrief: 'A GLSL pass.',
      requestedAt: new Date().toISOString(),
    });
    expect(verdict.status).toBe('needs_sandbox');
    if (verdict.status === 'needs_sandbox') {
      expect(verdict.requirements.length).toBeGreaterThan(4);
    }
  });

  it('accepts a composition made only of trusted primitives', () => {
    // "Eighty cards collapse into the mark" needs no new code: it is a field,
    // a mask and a text object, all of which the renderer already draws.
    const proposal = scene({
      durationSeconds: 4,
      objects: [
        {
          kind: 'field',
          id: 'cards',
          figure: 'converge',
          count: 80,
          member: 'card',
          memberSizePx: 40,
          color: 'onCanvas.muted',
          staggerSeconds: 0.03,
          seed: 4,
          role: 'atmosphere',
          reason: 'Eighty fragments collapsing onto the mark.',
          transform: Transform.parse({}),
        } as unknown as SceneObject,
        text({ id: 'mark', content: 'Act One', enterAt: 2 }),
      ],
    });
    const verdict = assessExperiment({
      id: 'magnetic_collapse',
      kind: 'composition',
      intent: 'Eighty interface cards behave like a magnetic field and collapse into the logo.',
      proposal,
      executorBrief: '',
      requestedAt: new Date().toISOString(),
    });
    expect(verdict.status).toBe('executable');
  });

  it('registers a composition unready, whatever it was asked for', () => {
    const registry = new CapabilityRegistry();
    const before = registry.all().length;
    assessExperiment(
      {
        id: 'x',
        kind: 'composition',
        intent: 'anything',
        proposal: scene({ objects: [text()] }),
        executorBrief: '',
        requestedAt: new Date().toISOString(),
      },
      registry,
    );
    expect(registry.all().length).toBe(before + 1);
    expect(registry.get('composition.x')?.productionReady).toBe(false);
  });

  it('will not promote without a test render and a reviewer', () => {
    const registry = new CapabilityRegistry();
    registry.registerExperimental({ ...registry.get('deterministic.layers')!, id: 'candidate' });
    expect(
      promoteExperiment(registry, 'candidate', { testRenderPath: '', reviewedBy: 'someone' }),
    ).toBeNull();
    expect(
      promoteExperiment(registry, 'candidate', { testRenderPath: '/x.mp4', reviewedBy: '' }),
    ).toBeNull();
    expect(
      promoteExperiment(registry, 'candidate', { testRenderPath: '/x.mp4', reviewedBy: 'someone' })
        ?.productionReady,
    ).toBe(true);
  });
});
