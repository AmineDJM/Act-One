import type { CallContext, Provider } from '../types.ts';
import type { NavigationPolicy } from './policy.ts';

export type Viewport = { width: number; height: number; deviceScaleFactor?: number };

export type CaptureOptions = {
  fullPage?: boolean;
  /** CSS selector to isolate. Produces the clean crop the design engine wants. */
  selector?: string;
  /** Hide cookie banners, chat widgets and other things nobody wants in a film. */
  hideChrome?: boolean;
  /** Freeze CSS animations so captures are reproducible frame to frame. */
  freezeAnimations?: boolean;
  /** Wait for network to settle before capturing. */
  settleMs?: number;
};

export type PageCapture = {
  url: string;
  title: string;
  /** Rendered, visible text. Not raw HTML — evidence must be what a human sees. */
  text: string;
  html: string;
  screenshot: Uint8Array | null;
  /** Computed design tokens harvested from the live page. */
  styleProfile: StyleProfile | null;
  links: { href: string; text: string }[];
  statusCode: number;
  capturedAt: string;
};

/**
 * Measured, not inferred. Everything here comes from getComputedStyle on the
 * real page, which is why the brand system can be trusted to match.
 */
export type StyleProfile = {
  /** Colour -> painted area in CSS pixels, so dominance is by visual weight. */
  colorWeights: { color: string; weight: number; role: 'background' | 'text' | 'accent' }[];
  fontFamilies: { family: string; weight: number; usage: 'display' | 'body' | 'mono' }[];
  borderRadii: number[];
  spacingScale: number[];
  hasGradients: boolean;
  hasGlow: boolean;
  logoCandidates: { src: string; alt: string; width: number; height: number }[];
  maxHeadingSizePx: number;
  bodySizePx: number;
};

export type ElementBounds = { x: number; y: number; width: number; height: number };

export type InteractionStep =
  | { type: 'click'; selector: string; description?: string }
  | { type: 'type'; selector: string; text: string; description?: string }
  | { type: 'hover'; selector: string; description?: string }
  | { type: 'scroll'; y: number; description?: string }
  | { type: 'wait'; ms: number; description?: string }
  | { type: 'press'; key: string; description?: string };

export type RecordingResult = {
  video: Uint8Array | null;
  frames: Uint8Array[];
  durationSeconds: number;
};

/**
 * One isolated browser session. Sessions are scoped to a single project and
 * disposed when the work is done — never shared across tenants, and never
 * reused across customers even within a tenant.
 */
export interface BrowserSession {
  readonly id: string;
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<void>;
  capture(options?: CaptureOptions): Promise<PageCapture>;
  screenshot(options?: CaptureOptions): Promise<Uint8Array>;
  boundsOf(selector: string): Promise<ElementBounds | null>;
  perform(steps: InteractionStep[]): Promise<void>;
  record(steps: InteractionStep[], seconds: number): Promise<RecordingResult>;
  currentUrl(): Promise<string>;
  /** Clears cookies and storage. Called before release unless persistence is required. */
  clearState(): Promise<void>;
  close(): Promise<void>;
}

export type SessionOptions = {
  /** What this session is permitted to visit and do. Enforced inside the session. */
  policy: NavigationPolicy;
  viewport?: Viewport;
  /** Project scoping is mandatory: it is how session isolation is enforced. */
  projectId: string;
  organizationId: string;
  /** Keep cookies for the life of the session (needed for authenticated exploration). */
  persistState?: boolean;
  timeoutMs?: number;
  userAgent?: string;
};

export interface BrowserAutomationProvider extends Provider {
  readonly kind: 'browser';
  createSession(options: SessionOptions, context: CallContext): Promise<BrowserSession>;
}
