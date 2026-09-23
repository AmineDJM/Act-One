import { AppError, type ErrorCode } from '@act-one/core';

export type IngestionFailure =
  | 'invalid_request'
  | 'blocked'
  | 'unreachable'
  | 'http_error'
  | 'empty_page'
  | 'timeout'
  | 'cancelled'
  | 'browser_unavailable'
  | 'nothing_extracted';

const CODE: Record<IngestionFailure, ErrorCode> = {
  invalid_request: 'validation_failed',
  blocked: 'unsafe_operation',
  unreachable: 'provider_failed',
  http_error: 'provider_failed',
  empty_page: 'validation_failed',
  timeout: 'provider_failed',
  cancelled: 'conflict',
  browser_unavailable: 'provider_unavailable',
  nothing_extracted: 'validation_failed',
};

/*
 * Sentences a customer may read. They say what did not happen, never which
 * vendor, status code or stack was involved: those stay in `message`, for the
 * console.
 */
const PUBLIC: Record<IngestionFailure, string> = {
  invalid_request: 'That address is not one we can read.',
  blocked: 'That address is outside what we are permitted to visit.',
  unreachable: 'We could not reach that address.',
  http_error: 'The site answered with an error instead of a page.',
  empty_page: 'We could not read anything at that address.',
  timeout: 'Reading the site took longer than we allow.',
  cancelled: 'Reading the site was stopped.',
  browser_unavailable: 'Reading sites is briefly unavailable.',
  nothing_extracted: 'We could not measure a brand on that page.',
};

/**
 * Why an ingestion stopped, where, and whether trying again can help.
 *
 * `retryable` is decided here, once, by the failure itself: a 404 fails the
 * same way forever and a timeout usually does not, and a job runner that has
 * to guess from a message string retries the wrong one.
 */
export class IngestionError extends AppError {
  readonly failure: IngestionFailure;
  readonly stage: string;
  readonly retryable: boolean;

  constructor(
    failure: IngestionFailure,
    message: string,
    options: { stage: string; retryable?: boolean; cause?: unknown; details?: unknown },
  ) {
    super(CODE[failure], message, {
      publicMessage: PUBLIC[failure],
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    });
    this.name = 'IngestionError';
    this.failure = failure;
    this.stage = options.stage;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[failure];
  }
}

const DEFAULT_RETRYABLE: Record<IngestionFailure, boolean> = {
  invalid_request: false,
  blocked: false,
  unreachable: true,
  http_error: false,
  empty_page: false,
  timeout: true,
  cancelled: false,
  browser_unavailable: true,
  nothing_extracted: false,
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
