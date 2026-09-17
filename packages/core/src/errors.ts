export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'conflict'
  | 'rate_limited'
  | 'entitlement_required'
  | 'insufficient_credits'
  | 'provider_unavailable'
  | 'provider_failed'
  | 'budget_exceeded'
  | 'unsafe_operation'
  | 'internal';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Safe to show a customer. Internal errors get a generic message instead. */
  readonly publicMessage: string;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { status?: number; details?: unknown; publicMessage?: string; cause?: unknown } = {},
  ) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? defaultStatus(code);
    this.details = opts.details;
    this.publicMessage =
      opts.publicMessage ?? (code === 'internal' ? 'Something went wrong on our side.' : message);
  }

  toJSON() {
    return { error: { code: this.code, message: this.publicMessage, details: this.details } };
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'forbidden':
    case 'unsafe_operation':
      return 403;
    case 'not_found':
      return 404;
    case 'validation_failed':
      return 422;
    case 'conflict':
      return 409;
    case 'rate_limited':
      return 429;
    case 'entitlement_required':
    case 'insufficient_credits':
    case 'budget_exceeded':
      return 402;
    case 'provider_unavailable':
    case 'provider_failed':
      return 502;
    default:
      return 500;
  }
}

export const unauthorized = (m = 'Sign in to continue.') => new AppError('unauthorized', m);
export const forbidden = (m = 'You do not have access to this.') => new AppError('forbidden', m);
export const notFound = (what = 'Resource') => new AppError('not_found', `${what} not found.`);
export const validationFailed = (m: string, details?: unknown) =>
  new AppError('validation_failed', m, { details });

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Error) return new AppError('internal', e.message, { cause: e });
  return new AppError('internal', String(e));
}
