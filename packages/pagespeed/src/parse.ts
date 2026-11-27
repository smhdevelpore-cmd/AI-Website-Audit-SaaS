/**
 * Turning a PageSpeed answer into metrics we are willing to store (TRD §10, PRD FR-06).
 *
 * Pure on purpose: the decision that matters — *is this number really in the response?* — is made
 * here, from a JSON value, with no network and no clock. A test can therefore hand in exactly the
 * shapes Google produces: a full result, one with INP missing, one with no performance category at
 * all.
 *
 * Nothing is defaulted, converted or inferred. If Lighthouse reports a numeric `numericValue` and
 * it is finite, that is the metric. If it reports `null` — which it does when it could not run a
 * test — the metric is `unavailable` with no value, and the reason is `partial`.
 */

import type {
  PagespeedStrategy,
  PerformanceReport,
  ProviderFailureReason,
  ProviderMetric,
  ProviderOpportunity,
  ProviderStatus,
} from "./types.js";
import { emptyMetrics, PAGESPEED_METRIC_KEYS, type PagespeedMetricKey } from "./types.js";

/** The audit id Lighthouse uses for each metric we keep. The score has its own place. */
const AUDIT_IDS: Readonly<Record<Exclude<PagespeedMetricKey, "performance-score">, string>> = {
  "largest-contentful-paint": "largest-contentful-paint",
  "first-contentful-paint": "first-contentful-paint",
  "cumulative-layout-shift": "cumulative-layout-shift",
  "total-blocking-time": "total-blocking-time",
  "speed-index": "speed-index",
  "interaction-to-next-paint": "interaction-to-next-paint",
  "server-response-time": "server-response-time",
};

/** A metric score is 0–1 in Lighthouse; a response without a category scores nothing. */
function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export interface ParseOptions {
  readonly strategy: PagespeedStrategy;
  /** Used only for a report that arrives with no timestamp of its own. Not a measurement. */
  readonly measuredAt?: string | null;
}

/**
 * `null` means the body is not a PageSpeed result at all (an HTML error page, a JSON object we do
 * not recognise) — the caller records `malformed_response`. A recognised result that lacks numbers
 * returns a `partial` or `unavailable` report instead.
 */
export function parsePagespeedResult(body: unknown, options: ParseOptions): PerformanceReport | null {
  const root = record(body);
  const lighthouse = record(root?.["lighthouseResult"]);
  if (root === null || lighthouse === null) return null;

  const categories = record(lighthouse["categories"]);
  const performance = record(categories?.["performance"]);
  const audits = record(lighthouse["audits"]);
  if (audits === null) return null;

  const metrics: ProviderMetric[] = emptyMetrics().map((metric) => {
    if (metric.key === "performance-score") {
      const value = numeric(performance?.["score"]);
      return value === null ? metric : { ...metric, value: Math.round(value * 100), status: "ok" as const };
    }

    const audit = record(audits[AUDIT_IDS[metric.key]]);
    const value = numeric(audit?.["numericValue"]);
    return value === null ? metric : { ...metric, value, status: "ok" as const };
  });

  const provided = metrics.filter((metric) => metric.status === "ok").length;
  const status: ProviderStatus =
    provided === 0 ? "unavailable" : provided === metrics.length ? "ok" : "partial";
  const reason: ProviderFailureReason | null = status === "unavailable" ? "malformed_response" : null;

  const finalUrl = typeof lighthouse["finalUrl"] === "string" ? lighthouse["finalUrl"] : null;
  const fetchedAt = typeof lighthouse["fetchTime"] === "string" ? lighthouse["fetchTime"] : null;

  return {
    status,
    reason,
    strategy: options.strategy,
    finalUrl,
    providerVersion:
      typeof lighthouse["lighthouseVersion"] === "string" ? lighthouse["lighthouseVersion"] : null,
    measuredAt: fetchedAt ?? options.measuredAt ?? null,
    metrics,
    opportunities: opportunitiesFrom(audits),
  };
}

/**
 * The opportunities Lighthouse names, worst first. Bounded: this is the "where to start" list, and
 * a hundred rows is not a summary. A row with no title is not a recommendation, so it is skipped.
 */
export function opportunitiesFrom(audits: Record<string, unknown>): ProviderOpportunity[] {
  const found: ProviderOpportunity[] = [];

  for (const [id, raw] of Object.entries(audits)) {
    const audit = record(raw);
    if (audit === null) continue;
    const details = record(audit["details"]);
    if (details === null || details["type"] !== "opportunity") continue;

    const score = numeric(audit["score"]);
    // 0.9 and above is Lighthouse saying "already good"; a fixture with a null score is noise.
    if (score === null || score >= 0.9) continue;

    const title = typeof audit["title"] === "string" ? audit["title"].trim() : "";
    if (title === "") continue;

    found.push({
      id,
      title: title.slice(0, 200),
      savingsMs: numeric(details["overallSavingsMs"]),
    });
  }

  return found
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 5);
}

/** A report for a call that produced nothing: every metric present, none of them measured. */
export function unavailableReport(
  reason: ProviderFailureReason,
  strategy: PagespeedStrategy,
  measuredAt: string | null = null,
): PerformanceReport {
  return {
    status: "unavailable",
    reason,
    strategy,
    finalUrl: null,
    providerVersion: null,
    measuredAt,
    metrics: emptyMetrics(),
    opportunities: [],
  };
}

/** The rows `audit_metrics` gets. Keeps the mapping out of the worker and out of the database code. */
export interface MetricRow {
  readonly category: "performance";
  readonly metric_key: PagespeedMetricKey;
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly source: "pagespeed";
  readonly status: ProviderMetric["status"];
  readonly strategy: PagespeedStrategy;
  readonly provider_version: string | null;
  readonly measured_at: string | null;
  readonly reason: ProviderFailureReason | null;
}

export function toMetricRows(report: PerformanceReport): MetricRow[] {
  return report.metrics.map((metric) => ({
    category: "performance" as const,
    metric_key: metric.key,
    label: metric.label,
    value: metric.value,
    unit: metric.unit,
    source: "pagespeed" as const,
    status: metric.status,
    strategy: report.strategy,
    provider_version: report.providerVersion,
    measured_at: report.measuredAt,
    reason: report.reason,
  }));
}

export const STORED_METRIC_KEYS: readonly PagespeedMetricKey[] = PAGESPEED_METRIC_KEYS;
