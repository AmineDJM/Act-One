import type { CallContext, Provider } from '../types.ts';
import type { EditRequest, ImageRequest, MediaAspect, MediaJob, MediaTier } from './types.ts';

/**
 * Providers that make a still, and say what kind of still they make.
 *
 * `GenerativeMediaProvider` was written around the one thing the film pipeline
 * needed: a moving shot, made by a model, polled until it exists. Stills came
 * along on the same interface because the same vendor made both, and that held
 * exactly as long as there was one vendor.
 *
 * It stops holding now. A vector illustration with named paths, a typographic
 * composition, a photographic still and a background removal are four
 * different capabilities, they live at three different vendors, and the
 * difference matters upstream: a vector can be recoloured to the brand and
 * animated per path, a PNG of the same drawing cannot. A planner that can only
 * ask for "an image" will get whichever of those the routing happened to pick.
 *
 * So a still provider declares what it can do and the router matches on that.
 * The rule the package already had still holds — no vendor name reaches
 * creative code — but the vocabulary is now rich enough to express a real
 * art-direction decision rather than just "generate something".
 */
export type StillCapability =
  /** A photographic or painted picture. */
  | 'raster'
  /** Real SVG with paths: recolourable, layoutable, animatable per path. */
  | 'vector'
  /** Type as the composition, not type laid over a picture. */
  | 'typography'
  /** A whole frame composed as a poster or a style frame. */
  | 'style_frame'
  /** Layout exploration: where things sit, at speed, before anything is final. */
  | 'layout'
  | 'background_removal'
  | 'upscale'
  /** Takes reference images and holds their look across a set. */
  | 'style_reference';

export type VectorRequest = {
  prompt: string;
  aspect: MediaAspect;
  tier: MediaTier;
  /** The vendor's sub-style, where it has one worth naming. */
  substyle?: string;
};

export type StyleFrameRequest = {
  prompt: string;
  aspect: MediaAspect;
  tier: MediaTier;
  /** How much the engine may rewrite the prompt. Off, where the words matter. */
  magicPrompt?: boolean;
  /** Frames to hold a look against. */
  styleReferenceUrls?: string[];
  seed?: number;
};

/**
 * A provider of stills that can be asked what it is for.
 *
 * Deliberately not an extension of `GenerativeMediaProvider`: nothing here
 * polls a job or estimates a video cost, and inheriting those would mean four
 * new providers each throwing from five methods they will never implement.
 */
export interface StillImageProvider extends Provider {
  readonly kind: 'media';
  /** What this provider is good for. The router matches on this, never on a name. */
  capabilities(): StillCapability[];
  generateImage(request: ImageRequest, context: CallContext): Promise<MediaJob>;
  editImage(request: EditRequest, context: CallContext): Promise<MediaJob>;
  /** Only where `capabilities()` includes `vector`. */
  generateVector?(request: VectorRequest, context: CallContext): Promise<MediaJob>;
  /** Only where `capabilities()` includes `style_frame`. */
  generateStyleFrame?(request: StyleFrameRequest, context: CallContext): Promise<MediaJob>;
}
