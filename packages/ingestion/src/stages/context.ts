import type { CDPSession, Page } from 'playwright-core';
import type { AssetCollector } from '../assets.ts';
import type { NetworkRecorder } from '../browser/network-recorder.ts';
import type { Deadline } from '../deadline.ts';
import type { IngestionLogger } from '../logger.ts';
import type { IngestionRequest } from '../schema.ts';

/** What every stage of one run shares. Stages add warnings; they never throw for a partial result. */
export type StageContext = {
  page: Page;
  cdp: CDPSession;
  deadline: Deadline;
  recorder: NetworkRecorder;
  assets: AssetCollector;
  logger: IngestionLogger;
  request: IngestionRequest;
  /** The address the page actually ended up at, after redirects. */
  pageUrl: string;
  warnings: string[];
};

export const CAPTURE_PIXEL_BUDGET = 16_000_000;
