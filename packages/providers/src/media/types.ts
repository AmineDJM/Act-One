import type { CallContext, Provider } from '../types.ts';

/**
 * Quality tiers exposed to the product. Users choose Authentic / Studio /
 * Cinematic; the routing layer maps that to whatever model is currently best
 * and cheapest. No model name ever reaches the UI or the creative engines.
 */
export type MediaTier = 'authentic' | 'studio' | 'cinematic';

export type MediaAspect = '16:9' | '9:16' | '1:1' | '4:5';

export type ImageRequest = {
  prompt: string;
  negativePrompt?: string;
  aspect: MediaAspect;
  tier: MediaTier;
  referenceUrls?: string[];
  seed?: number;
};

export type VideoRequest = {
  prompt: string;
  aspect: MediaAspect;
  tier: MediaTier;
  durationSeconds: number;
  /** Drives image-to-video when present; otherwise text-to-video. */
  initImageUrl?: string;
  /** Style/subject references for consistency across shots. */
  referenceUrls?: string[];
  motionStrength?: number;
  seed?: number;
};

export type EditRequest = {
  imageUrl: string;
  instruction: string;
  maskUrl?: string;
  tier: MediaTier;
};

export type MediaJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type MediaJob = {
  id: string;
  status: MediaJobStatus;
  /** Provider-hosted and temporary. Always copied into our own storage. */
  outputUrls: string[];
  contentType: string;
  error?: string;
  costUsd: number;
  model: string;
  progress?: number;
};

export interface GenerativeMediaProvider extends Provider {
  readonly kind: 'media';
  generateImage(request: ImageRequest, context: CallContext): Promise<MediaJob>;
  generateVideo(request: VideoRequest, context: CallContext): Promise<MediaJob>;
  editImage(request: EditRequest, context: CallContext): Promise<MediaJob>;
  getJob(jobId: string, context: CallContext): Promise<MediaJob>;
  /** Polls until terminal or the budget/timeout is spent. */
  waitForJob(jobId: string, context: CallContext, timeoutMs?: number): Promise<MediaJob>;
  estimateCost(request: ImageRequest | VideoRequest | EditRequest): number;
}
