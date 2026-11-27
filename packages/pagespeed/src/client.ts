/**
 * The HTTP client for PageSpeed Insights (TRD §10).
 *
 * The key travels in an `X-Goog-Api-Key` header rather than the `?key=` query parameter Google
 * documents. Both work; one of them puts a billable secret in a URL that proxies, logs and error
 * trackers copy. The URL is built from `URL`/`URLSearchParams`, so the audited address is encoded
 * once and cannot inject a second parameter.
 *
 * Every answer that is *about the target or the quota* — 429, 400 with `invalid_url`, 5xx, a
 * timeout, an unparseable body — becomes a `PerformanceReport` with `status: "unavailable"` and a
 * reason. Only a bug in this process rejects the promise, which keeps a third party's bad day out
 * of the audit's exception path.
 */

import {
  DEFAULT_ENDPOINT,
  DEFAULT_STRATEGY,
  DEFAULT_TIMEOUT_MS,
  type PagespeedClient,
  type PagespeedStrategy,
  type PerformanceReport,
  type ProviderFailureReason,
} from "./types.js";
import { parsePagespeedResult, unavailableReport } from "./parse.js";

export interface PagespeedClientOptions {
  readonly apiKey: string;
  readonly strategy?: PagespeedStrategy;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  /** Injected in tests. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

/** Google signals a refused URL this way; it is the caller's address, not our request. */
function looksLikeInvalidUrl(status: number, body: unknown): boolean {
  if (status !== 400) return false;
  const error = (body as { error?: { message?: unknown } } | null)?.error;
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  return (
    message.includes("invalid") ||
    message.includes("url") ||
    message.includes("host") ||
    message.includes("resolve")
  );
}

export function createPagespeedClient(options: PagespeedClientOptions): PagespeedClient {
  const call = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const strategy = options.strategy ?? DEFAULT_STRATEGY;
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(url: string, signal: AbortSignal): Promise<PerformanceReport> {
    const query = new URLSearchParams({ url, strategy });
    // One category: we store LCP/FCP/CLS/TBT/SI/INP and the performance score, not five scores.
    query.append("category", "performance");

    // The caller's budget may be shorter than ours; both cancel the request.
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await call(`${endpoint}?${query.toString()}`, {
        headers: { "x-goog-api-key": options.apiKey, accept: "application/json" },
        signal: controller.signal,
      });

      if (response.status === 429) return failed("quota");
      if (response.status === 400) {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return failed(looksLikeInvalidUrl(400, body) ? "invalid_url" : "http_error");
      }
      if (!response.ok) return failed("http_error");

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return failed("malformed_response");
      }

      const parsed = parsePagespeedResult(body, { strategy, measuredAt: now().toISOString() });
      return parsed ?? failed("malformed_response");
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return failed(aborted ? "timeout" : "http_error");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  function failed(reason: ProviderFailureReason): PerformanceReport {
    return unavailableReport(reason, strategy, null);
  }

  return {
    async run(url, signal) {
      return request(url, signal);
    },
  };
}
