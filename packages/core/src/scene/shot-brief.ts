import { z } from 'zod';

/**
 * What a video model is told, when a shot is commissioned from one.
 *
 * A generative provider is a production department, not a director. The
 * difference is visible in what it is handed: "a cinematic shot of a city,
 * premium feel" is a slot machine, and pulling it repeatedly until something
 * acceptable falls out is not direction — it is hoping. A department gets a
 * shot brief, and a shot brief is specific enough that two competent people
 * would produce recognisably the same shot from it.
 *
 * So every field here is a decision somebody made. `shotScale` is a framing,
 * not an adjective. `cameraMotion` says what the camera does. `startFrame` and
 * `endFrame` say what the shot opens and closes on, which is what makes it
 * cuttable — a shot whose ending composition is unknown cannot be planned
 * into an edit, and that is why generated footage so often ends up as a clip
 * dropped between two things rather than a shot inside a film.
 *
 * WHAT IS DELIBERATELY ABSENT. Nothing here describes the customer's
 * interface. A model may build the world a product lives in — a room, a
 * street, weather, hands, light — and may never build the product. That rule
 * is enforced structurally: `subject` is checked, and `forbids` is not
 * editable by whoever writes the brief.
 */

export const ShotScale = z.enum([
  'extreme_wide',
  'wide',
  'medium_wide',
  'medium',
  'medium_close',
  'close',
  'extreme_close',
  'macro',
]);
export type ShotScale = z.infer<typeof ShotScale>;

export const CameraMotion = z.enum([
  'locked',
  'push_in',
  'pull_back',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'track_with',
  'orbit',
  'crane_up',
  'handheld',
  'rack_focus',
]);
export type CameraMotion = z.infer<typeof CameraMotion>;

/** Where the light comes from, which is most of what makes a frame look shot. */
export const LightDirection = z.enum([
  'front',
  'side',
  'back_lit',
  'top',
  'under',
  'ambient_soft',
  'hard_directional',
  'practical_sources',
]);

export const ShotBrief = z.object({
  id: z.string().min(1).max(64),

  /**
   * What is in the frame, in the concrete.
   *
   * "A pair of hands closing a laptop on a kitchen table at dusk" rather than
   * "productivity". A model given an abstraction renders the most average
   * picture of that abstraction, which is precisely the stock look that makes
   * generated footage recognisable.
   */
  subject: z.string().min(8).max(400),

  shotScale: ShotScale,
  cameraMotion: CameraMotion,
  /** How far the camera travels, 0 to 1. A push that barely moves is a locked shot. */
  cameraIntensity: z.number().min(0).max(1).default(0.35),

  /** Where the subject sits, so the shot can be cut against its neighbours. */
  framing: z.string().max(300),
  /** Space left empty, and what it is for — often the type that lands in it. */
  negativeSpace: z.string().max(300).default(''),

  lens: z
    .object({
      /** Millimetres. Wide distorts and includes; long compresses and isolates. */
      focalLengthMm: z.number().min(12).max(300).default(50),
      /** 0 is deep focus, 1 throws the background away entirely. */
      shallowness: z.number().min(0).max(1).default(0.4),
    })
    .default(() => ({ focalLengthMm: 50, shallowness: 0.4 })),

  light: z
    .object({
      direction: LightDirection.default('side'),
      /** 0 is flat and even, 1 is a single hard source with deep shadow. */
      contrast: z.number().min(0).max(1).default(0.5),
      /** Kelvin. 2700 is domestic tungsten, 5600 daylight, 8000 open shade. */
      temperatureK: z.number().min(1500).max(12000).default(5600),
    })
    .default(() => ({ direction: 'side' as const, contrast: 0.5, temperatureK: 5600 })),

  /** The brand's own colours, so a shot cuts against the rest of the film. */
  palette: z.array(z.string().max(40)).max(6).default([]),

  /** 0 is almost still, 1 is violent. Most good shots are below 0.5. */
  motionIntensity: z.number().min(0).max(1).default(0.3),
  durationSeconds: z.number().min(1).max(30),

  /**
   * What the shot opens and closes on.
   *
   * The pair that makes a generated shot editable. Without them the edit is
   * built around whatever came back, which is the tail wagging the film.
   */
  startFrame: z.string().max(300).default(''),
  endFrame: z.string().max(300).default(''),

  /**
   * What must match the shots either side.
   *
   * Light direction, palette, the direction of travel, a colour that carries
   * across. A sequence of individually good generated shots with no continuity
   * is a mood board.
   */
  continuity: z.string().max(400).default(''),

  /**
   * What this shot may never contain.
   *
   * Not editable by the caller: it is appended on the way out. The product
   * rule is not a preference a brief can decline.
   */
  forbids: z.array(z.string().max(120)).default([]),
});
export type ShotBrief = z.infer<typeof ShotBrief>;

/**
 * The refusals every commissioned shot carries.
 *
 * A model asked for "a dashboard" will draw a convincing one, and a
 * convincing invented dashboard presented as a customer's software is the
 * single worst thing this system could ship. Stated to the model as well as
 * enforced in QA, because two defences against that are correct.
 */
const ALWAYS_FORBIDDEN: readonly string[] = [
  'any software interface, dashboard, app screen, browser window or UI of any kind',
  'readable text, logos, wordmarks or signage',
  'recognisable real people or brands',
  'watermarks, captions or subtitles',
];

/**
 * Words that mean somebody is trying to commission the product itself.
 *
 * Split into two lists, because a single word list gets this wrong in the
 * expensive direction. The first version matched `table` and rejected "a pair
 * of hands closing a laptop on a kitchen table at dusk" — a perfectly
 * shootable brief containing no software at all. A check that blocks good
 * briefs gets worked around, and a check that gets worked around is not
 * protecting the rule.
 *
 * So: words that only ever mean software are matched alone, and words that
 * have an ordinary meaning are matched only next to something that makes them
 * software.
 */
const UNAMBIGUOUS_PRODUCT_SURFACE =
  /\b(dashboard|user interface|app screen|software interface|sidebar|toolbar|webpage|web page|browser window|login screen|settings page|admin panel)\b/i;

/** Ordinary words that become product words in the right company. */
const AMBIGUOUS_SURFACE =
  /\b(screen|panel|chart|graph|table|editor|console|inbox|workspace|interface|ui|app)\b/i;
const SOFTWARE_CONTEXT =
  /\b(software|saas|application|web|browser|desktop|mobile app|analytics|data|product|platform|dashboard|login|user)\b/i;

function commissionsTheProduct(subject: string): boolean {
  if (UNAMBIGUOUS_PRODUCT_SURFACE.test(subject)) return true;
  return AMBIGUOUS_SURFACE.test(subject) && SOFTWARE_CONTEXT.test(subject);
}

export type BriefProblem = { field: string; message: string };

/**
 * Checks a brief before it is sent and before it is paid for.
 *
 * The product rule first, then the vagueness that makes a shot a gamble. Both
 * are cheaper to catch here than in a clip somebody has already been charged
 * for and has to look at before rejecting.
 */
export function checkBrief(brief: ShotBrief): BriefProblem[] {
  const problems: BriefProblem[] = [];

  if (commissionsTheProduct(brief.subject)) {
    problems.push({
      field: 'subject',
      message:
        'This brief asks a model to render a software interface. Generated imagery may build the world ' +
        'the product lives in; the product itself comes from a real capture, always.',
    });
  }
  if (brief.startFrame.trim() === '' || brief.endFrame.trim() === '') {
    problems.push({
      field: 'startFrame/endFrame',
      message:
        'A shot with no stated opening and closing composition cannot be cut into a film; the edit ends ' +
        'up built around whatever came back.',
    });
  }
  if (brief.subject.trim().split(/\s+/).length < 6) {
    problems.push({
      field: 'subject',
      message:
        'Too abstract to direct. A model given an abstraction renders the average picture of it.',
    });
  }
  return problems;
}

/**
 * The brief as prose for a model that takes a prompt, with the refusals bolted on.
 *
 * Generated rather than hand-written so the structured fields stay the source
 * of truth: a brief edited in prose and not in the object is a decision that
 * exists nowhere the system can check.
 */
export function briefToPrompt(brief: ShotBrief): { prompt: string; negative: string } {
  const lens =
    brief.lens.shallowness > 0.65
      ? 'shallow depth of field, background thrown well out of focus'
      : brief.lens.shallowness < 0.25
        ? 'deep focus, everything legible'
        : 'moderate depth of field';

  const contrast =
    brief.light.contrast > 0.7
      ? 'high contrast, deep shadow'
      : brief.light.contrast < 0.3
        ? 'soft even light, gentle falloff'
        : 'balanced contrast';

  const prompt = [
    brief.subject,
    `${brief.shotScale.replace(/_/g, ' ')} shot`,
    `${brief.cameraMotion.replace(/_/g, ' ')} camera${brief.cameraIntensity < 0.2 ? ', barely moving' : brief.cameraIntensity > 0.7 ? ', pronounced' : ''}`,
    `${brief.lens.focalLengthMm}mm, ${lens}`,
    `${brief.light.direction.replace(/_/g, ' ')} light at ${brief.light.temperatureK}K, ${contrast}`,
    brief.framing,
    brief.negativeSpace ? `Negative space: ${brief.negativeSpace}` : '',
    brief.palette.length ? `Palette: ${brief.palette.join(', ')}` : '',
    brief.startFrame ? `Opens on: ${brief.startFrame}` : '',
    brief.endFrame ? `Closes on: ${brief.endFrame}` : '',
    brief.continuity ? `Must match: ${brief.continuity}` : '',
    brief.motionIntensity < 0.2
      ? 'Almost still.'
      : brief.motionIntensity > 0.7
        ? 'Strong movement.'
        : 'Measured movement.',
  ]
    .filter(Boolean)
    .join('. ');

  return {
    prompt,
    negative: [...ALWAYS_FORBIDDEN, ...brief.forbids].join(', '),
  };
}

/** Seals a brief with the refusals it is not allowed to drop. */
export function sealBrief(brief: ShotBrief): ShotBrief {
  return { ...brief, forbids: [...new Set([...ALWAYS_FORBIDDEN, ...brief.forbids])] };
}
