/**
 * The browser's only door to the API.
 *
 * Every call carries the current access token, and every failure is turned into an `ApiError`
 * carrying the API's own error code — so the UI can branch on `code` instead of matching on
 * prose that a copywriter may reword.
 */

import type { ErrorCode } from "@siteaudit/shared-types";

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: Array<{ path: string; reason: string; message: string }>;
}

export class ApiError extends Error {
  readonly code: ErrorCode | "network_error";
  readonly details: ReadonlyArray<{ path: string; reason: string; message: string }>;

  constructor(code: ErrorCode | "network_error", message: string, details: ApiErrorBody["details"] = []) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details ?? [];
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiRequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly accessToken?: string | null;
  /** Injected in tests. */
  readonly fetch?: typeof globalThis.fetch;
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.accessToken != null) headers["authorization"] = `Bearer ${options.accessToken}`;

  let response: Response;
  try {
    response = await doFetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError("network_error", "We could not reach the server. Check your connection.");
  }

  // 204 (a successful DELETE) has no body, and asking for JSON would throw a SyntaxError that
  // looks like a server fault.
  if (response.status === 204) return { data: undefined as T };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // A proxy or a crash can return HTML. That is not an envelope, and is handled below.
    payload = null;
  }

  const envelope = payload as
    | { success: true; data: T; meta?: Record<string, unknown> }
    | { success: false; error: ApiErrorBody }
    | null;

  if (envelope !== null && envelope.success === true) {
    return envelope.meta === undefined
      ? { data: envelope.data }
      : { data: envelope.data, meta: envelope.meta };
  }
  if (envelope !== null && envelope.success === false) {
    throw new ApiError(envelope.error.code, envelope.error.message, envelope.error.details);
  }
  throw new ApiError("internal_error", "The server sent a response we did not understand.");
}
