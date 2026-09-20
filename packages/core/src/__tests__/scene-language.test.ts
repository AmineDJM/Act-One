import { describe, expect, it } from 'vitest';
import {
  Animatable,
  CapabilityRegistry,
  SceneGraph,
  Transform,
  assessExperiment,
  compileScene,
  compileIntent,
  CreativeIntent,
  inspectScene,
  migratedRecipes,
  objectPresent,
  promoteExperiment,
  routeScene,
  valueAt,
  ShotBrief,
  briefToPrompt,
  checkBrief,
  sealBrief,
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

describe('the generative shot brief', () => {
  const brief = (over: Record<string, unknown> = {}) =>
    ShotBrief.parse({
      id: 'shot_1',
      subject: 'A pair of hands closing a laptop on a kitchen table at dusk',
      shotScale: 'medium_close',
      cameraMotion: 'push_in',
      framing: 'Hands lower left, window behind',
      startFrame: 'Hands open on the keys',
      endFrame: 'Lid closed, room darker',
      durationSeconds: 5,
      ...over,
    });

  it('refuses a brief that asks a model to draw the product', () => {
    const problems = checkBrief(
      brief({ subject: 'A sleek analytics dashboard with charts and a sidebar' }),
    );
    expect(problems.some((p) => p.field === 'subject')).toBe(true);
  });

  it('refuses a shot with no stated opening and closing composition', () => {
    // Without them the edit gets built around whatever came back.
    expect(checkBrief(brief({ startFrame: '', endFrame: '' })).length).toBeGreaterThan(0);
  });

  it('refuses an abstraction, because a model renders the average picture of one', () => {
    expect(checkBrief(brief({ subject: 'productivity' })).some((p) => p.field === 'subject')).toBe(
      true,
    );
  });

  it('passes a brief somebody could actually shoot', () => {
    expect(checkBrief(brief())).toEqual([]);
  });

  it('always carries the refusals, whatever the caller supplied', () => {
    const sealed = sealBrief(brief({ forbids: ['rain'] }));
    expect(sealed.forbids).toContain('rain');
    expect(sealed.forbids.some((entry) => entry.includes('software interface'))).toBe(true);
  });

  it('compiles to a prompt that carries the decisions, not the adjectives', () => {
    const { prompt, negative } = briefToPrompt(sealBrief(brief()));
    expect(prompt).toContain('medium close shot');
    expect(prompt).toContain('50mm');
    expect(prompt).toContain('Opens on');
    expect(negative).toContain('dashboard');
  });
});

describe('the product rule does not block real shots', () => {
  const shoot = (subject: string) =>
    checkBrief(
      ShotBrief.parse({
        id: 's',
        subject,
        shotScale: 'wide',
        cameraMotion: 'locked',
        framing: 'Subject centre',
        startFrame: 'a',
        endFrame: 'b',
        durationSeconds: 4,
      }),
    ).filter((p) => p.field === 'subject' && p.message.includes('software interface'));

  it('allows ordinary words that happen to collide with UI vocabulary', () => {
    // The first version of this check rejected a kitchen table.
    expect(shoot('A pair of hands closing a laptop on a kitchen table at dusk')).toEqual([]);
    expect(
      shoot('Sunlight moving across a bare concrete wall, a window screen casting a grid'),
    ).toEqual([]);
    expect(shoot('A long dining table seen from above, plates being cleared')).toEqual([]);
  });

  it('still refuses the thing it exists to refuse', () => {
    expect(shoot('A sleek analytics dashboard with charts and a sidebar').length).toBe(1);
    expect(shoot('A web application screen showing user data tables').length).toBe(1);
    expect(shoot('A browser window with a login screen').length).toBe(1);
  });
});

describe('compiling a Director’s decisions', () => {
  const intent = (over: Record<string, unknown> = {}) =>
    CreativeIntent.parse({
      id: 'beat_1',
      durationSeconds: 4,
      gesture: 'arrival',
      energy: 0.5,
      says: 'The product arrives.',
      copy: ['Know before it happens.'],
      note: 'It should land rather than appear.',
      ...over,
    });

  it('keeps the prose as metadata and never as the instruction', () => {
    const { scene } = compileIntent(intent());
    expect(scene.intent).toBe('It should land rather than appear.');
    // Everything the renderer reads is a value, not the sentence.
    expect(
      typeof scene.camera.focalLengthMm === 'number' ||
        'from' in (scene.camera.focalLengthMm as object),
    ).toBe(true);
    expect(scene.objects[0]?.kind).toBe('text');
  });

  it('gives every gesture a different camera, not a different adjective', () => {
    const shape = (gesture: string) => {
      const { scene } = compileIntent(intent({ gesture }));
      return JSON.stringify(scene.camera);
    };
    const shapes = new Set(['arrival', 'departure', 'hold', 'travel', 'reveal'].map(shape));
    expect(shapes.size).toBe(5);
  });

  it('never produces a camera move too small to be seen', () => {
    // A 1.06 scale over four seconds measured as a still frame in a real
    // render; the floor exists so a gesture cannot compile to one.
    for (const gesture of ['arrival', 'departure', 'hold', 'travel', 'reveal'] as const) {
      const { scene } = compileIntent(intent({ gesture, energy: 0 }));
      const start = valueAt(scene.camera.scale, 0, CURVES);
      const end = valueAt(scene.camera.scale, 1, CURVES);
      const dolly = Math.abs(
        valueAt(scene.camera.dollyZ, 1, CURVES) - valueAt(scene.camera.dollyZ, 0, CURVES),
      );
      expect(Math.abs(end - start) + dolly).toBeGreaterThan(0.05);
    }
  });

  it('takes a capture apart when the director named regions', () => {
    const { scene } = compileIntent(
      intent({
        captureAssetId: 'ast_home',
        regions: [
          {
            id: 'header',
            crop: { x: 0, y: 0, width: 1, height: 0.3 },
            depth: -0.4,
            semantic: 'header',
          },
          {
            id: 'body',
            crop: { x: 0, y: 0.3, width: 0.6, height: 0.5 },
            depth: 0.3,
            semantic: 'body',
          },
        ],
      }),
    );
    const layers = scene.objects.filter((object) => object.kind === 'ui_layer');
    expect(layers).toHaveLength(2);
    // Regions replace the whole capture: the same pixels twice is a double exposure.
    expect(scene.objects.some((object) => object.kind === 'capture')).toBe(false);
    // And they are at different depths, or they are not regions.
    const depths = new Set(layers.map((l) => JSON.stringify(l.transform.z)));
    expect(depths.size).toBe(2);
  });

  it('staggers regions rather than landing them together', () => {
    const { scene } = compileIntent(
      intent({
        captureAssetId: 'ast_home',
        energy: 0.8,
        regions: [0, 1, 2].map((n) => ({
          id: `r${n}`,
          crop: { x: 0, y: n * 0.3, width: 1, height: 0.3 },
          depth: n * 0.2 - 0.2,
          semantic: `r${n}`,
        })),
      }),
    );
    const entries = scene.objects.filter((o) => o.kind === 'ui_layer').map((o) => o.enterAt);
    expect(new Set(entries).size).toBe(3);
  });

  it('says so when a beat has nothing in it', () => {
    const { warnings } = compileIntent(intent({ copy: [], captureAssetId: null }));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('nothing in it');
  });

  it('compiles to something that routes and inspects clean', () => {
    const { scene } = compileIntent(intent());
    expect(routeScene(scene).problems).toEqual([]);
    expect(inspectScene(scene, CURVES).filter((f) => f.severity === 'hard_fail')).toEqual([]);
  });
});
