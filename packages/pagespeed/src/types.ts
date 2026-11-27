/**
 * The performance provider's contract (TRD §10, PRD FR-06).
 *
 * PageSpeed Insights is a third party: it has quotas, latency, outages and opinions. Three rules
 * follow, and they shape every type in this file:
 *
 *  - **A missing number is missing, not zero.** A metric slot always exists; its `value` is null
 *    and its `status` says why. The database refuses an `unavailable` metric that carries a value,
 *    so this is not only a convention in code.
 *  - **The provider's own status is recorded separately from ours.** `status` here describes the
 *    *call*; the metrics describe what came back. A call can succeed and return five of six
 *    metrics — that is `partial`, and saying so is more honest than either dropping the sixth or
 *    inventing it.
 *  - **Nothing from this provider is presented as our own measurement.** Every metric carries
 *    `source: "pagespeed"`, the strategy it was measured with, and the Lighthouse version that
 *    produced it.
 */

import type { MetricStatus, MetricUnit } from "@siteaudit/shared-types";

/** The keys we ask for. A key that is absent from the response is stored as unavailable. */
export const PAGESPEED_METRIC_KEYS = [
  "performance-score",
  "largest-contentful-paint",
  "first-contentful-paint",
  "cumulative-layout-shift",
  "total-blocking-time",
  "speed-index",
  "interaction-to-next-paint",
  "server-response-time",
] as const;

export type PagespeedMetricKey = (typeof PAGESPEED_METRIC_KEYS)[number];

export const METRIC_LABELS: Readonly<Record<PagespeedMetricKey, string>> = {
  "performance-score": "Performance score",
  "largest-contentful-paint": "Largest Contentful Paint",
  "first-contentful-paint": "First Contentful Paint",
  "cumulative-layout-shift": "Cumulative Layout Shift",
  "total-blocking-time": "Total Blocking Time",
  "speed-index": "Speed Index",
  "interaction-to-next-paint": "Interaction to Next Paint",
  "server-response-time": "Server response time",
};

export const METRIC_UNITS: Readonly<Record<PagespeedMetricKey, MetricUnit>> = {
  "performance-score": "score",
  "largest-contentful-paint": "ms",
  "first-contentful-paint": "ms",
  "cumulative-layout-shift": "ratio",
  "total-blocking-time": "ms",
  "speed-index": "ms",
  "interaction-to-next-paint": "ms",
  "server-response-time": "ms",
};

export type PagespeedStrategy = "MOBILE" | "DESKTOP";

/**
 * Why a call produced nothing usable. `quota` is separated from `http_error` because it is the
 * failure this deployment will actually meet, and because the fix is different (a key, a budget).
 */
export type ProviderFailureReason =
  "not_configured" | "quota" | "timeout" | "invalid_url" | "http_error" | "malformed_response";

export type ProviderStatus = "ok" | "partial" | "unavailable";

export interface ProviderMetric {
  readonly key: PagespeedMetricKey;
  readonly label: string;
  readonly unit: MetricUnit;
  /** Null whenever the provider did not supply the number. Never a stand-in value. */
  readonly value: number | null;
  readonly status: MetricStatus;
}

/** One Lighthouse opportunity we keep: the id, what it is called, and the seconds it claims. */
export interface ProviderOpportunity {
  readonly id: string;
  readonly title: string;
  /** Estimated savings in milliseconds, when Lighthouse gives one. */
  readonly savingsMs: number | null;
}

export interface PerformanceReport {
  readonly status: ProviderStatus;
  /** Present when `status` is not `ok`; the reason the call or the answer fell short. */
  readonly reason: ProviderFailureReason | null;
  readonly strategy: PagespeedStrategy;
  /** The final URL PageSpeed measured — it follows redirects, and it may differ from ours. */
  readonly finalUrl: string | null;
  /** The Lighthouse version that produced these numbers, for a report's footer. */
  readonly providerVersion: string | null;
  /** When the provider ran the test, as it reports it. Never the time of our request. */
  readonly measuredAt: string | null;
  readonly metrics: readonly ProviderMetric[];
  readonly opportunities: readonly ProviderOpportunity[];
}

/**
 * A provider a test can replace, and the only surface the worker knows.
 *
 * `run` resolves for every answer that is a *result* — including a refused one, which is a
 * `PerformanceReport` with `status: "unavailable"` and a reason. It rejects only for a bug in
 * this process, so the pipeline never has to treat a third party's outage as our exception.
 */
export interface PagespeedClient {
  run(url: string, signal: AbortSignal): Promise<PerformanceReport>;
}

export const DEFAULT_STRATEGY: PagespeedStrategy = "MOBILE";
export const DEFAULT_TIMEOUT_MS = 45_000;
/** Google's documented endpoint. Overridable so a test, or a proxy, can answer. */
export const DEFAULT_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Metrics that PageSpeed sometimes omits (INP on an old browser run) are `unavailable`, not 0. */
export function emptyMetrics(): ProviderMetric[] {
  return PAGESPEED_METRIC_KEYS.map((key) => ({
    key,
    label: METRIC_LABELS[key],
    unit: METRIC_UNITS[key],
    value: null,
    status: "unavailable" as const,
  }));
}
