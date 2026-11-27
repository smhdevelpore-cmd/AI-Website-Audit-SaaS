/**
 * API envelope and the error vocabulary (TRD §5).
 *
 * One shape for every response, and one code per failure, so a client never has to parse a
 * message to know what happened. Messages are for humans; codes are for code.
 */

export const ERROR_CODES = [
  // request
  "validation_failed",
  "not_found",
  "method_not_allowed",
  "payload_too_large",
  "unsupported_media_type",
  // auth and access
  "unauthenticated",
  "forbidden",
  "not_owned",
  // resources
  "conflict",
  "limit_exceeded",
  "rate_limited",
  // audits
  "target_not_allowed",
  "audit_not_cancellable",
  "audit_not_found",
  "provider_unavailable",
  "ai_unavailable",
  "report_not_ready",
  // server
  "internal_error",
  "service_unavailable",
  "misconfigured",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Stable mapping so a code cannot drift into a different status between routes. */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  validation_failed: 400,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  unauthenticated: 401,
  forbidden: 403,
  not_owned: 404,
  conflict: 409,
  limit_exceeded: 429,
  rate_limited: 429,
  target_not_allowed: 422,
  audit_not_cancellable: 409,
  audit_not_found: 404,
  provider_unavailable: 503,
  ai_unavailable: 503,
  report_not_ready: 409,
  internal_error: 500,
  service_unavailable: 503,
  misconfigured: 500,
};

export function httpStatusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

export interface ErrorDetail {
  /** Dot path of the offending field, e.g. `scanScope.maxPages`. */
  path: string;
  /** Machine-readable reason, e.g. `too_big` or `invalid_format`. */
  reason: string;
  message: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
}

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export type ApiBody<T> = ApiSuccessBody<T> | ApiErrorBody;

/**
 * The only error the application throws on purpose. Anything else reaching the error handler
 * is a bug, and is reported as `internal_error` with no internals attached.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: readonly ErrorDetail[];
  /** Internal context for logs only. Never serialised into a response. */
  readonly logContext: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      details?: readonly ErrorDetail[];
      logContext?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = httpStatusFor(code);
    this.details = options.details ?? [];
    this.logContext = options.logContext ?? {};
  }
}

export function toErrorBody(error: AppError): ApiErrorBody {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details.length > 0 ? { details: [...error.details] } : {}),
    },
  };
}

export function toSuccessBody<T>(data: T, meta?: Record<string, unknown>): ApiSuccessBody<T> {
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}
