/**
 * Performance metrics from Google PageSpeed Insights (PRD FR-06, TRD §10).
 *
 * The provider measures; we store what it measured and label it as its own. Nothing here scores an
 * audit — the deterministic rules do that — and a provider that is down leaves an audit's findings
 * and score exactly as they were, with a stated absence where the metrics would be.
 *
 * Why a package rather than a module in the worker: the parse step is the part worth testing, it
 * has no dependency on the queue or the database, and the API needs the same metric vocabulary to
 * render what was stored. See `docs/PROVIDERS.md`.
 */

export {
  DEFAULT_ENDPOINT,
  DEFAULT_STRATEGY,
  DEFAULT_TIMEOUT_MS,
  emptyMetrics,
  METRIC_LABELS,
  METRIC_UNITS,
  PAGESPEED_METRIC_KEYS,
} from "./types.js";
export type {
  PagespeedClient,
  PagespeedMetricKey,
  PagespeedStrategy,
  PerformanceReport,
  ProviderFailureReason,
  ProviderMetric,
  ProviderOpportunity,
  ProviderStatus,
} from "./types.js";

export {
  opportunitiesFrom,
  parsePagespeedResult,
  STORED_METRIC_KEYS,
  toMetricRows,
  unavailableReport,
} from "./parse.js";
export type { MetricRow, ParseOptions } from "./parse.js";

export { createPagespeedClient } from "./client.js";
export type { PagespeedClientOptions } from "./client.js";
