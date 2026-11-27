/**
 * Crawl results as `audit_pages` rows.
 *
 * The mapping lives next to the crawler, not in the worker, so the column names have one home
 * and a schema change has one place to update. The worker only has to call it.
 */

import type { CrawledPage } from "./crawl.js";

export interface AuditPageRow {
  readonly audit_id: string;
  readonly url: string;
  readonly final_url: string;
  readonly depth: number;
  readonly http_status: number | null;
  readonly content_type: string | null;
  readonly byte_size: number | null;
  readonly duration_ms: number | null;
  readonly title: string | null;
  readonly fetch_error: string | null;
  readonly parsed: Record<string, unknown> | null;
  readonly fetched_at: string | null;
}

/** `audit_pages_title_length` in the schema: a stored title is 1-300 characters, or NULL. */
const MAX_TITLE_LENGTH = 300;

/**
 * Trim and bound a title. A page can title itself with 2 000 characters; the database refuses
 * that, and losing the tail of a title is better than losing the page row that proves we saw it.
 */
function storedTitle(title: string | null): string | null {
  if (title === null) return null;
  const trimmed = title.trim();
  if (trimmed === "") return null;
  return trimmed.length > MAX_TITLE_LENGTH ? trimmed.slice(0, MAX_TITLE_LENGTH) : trimmed;
}

export function toPageRows(auditId: string, pages: readonly CrawledPage[]): AuditPageRow[] {
  return pages.map((page) => ({
    audit_id: auditId,
    url: page.url,
    final_url: page.finalUrl,
    depth: page.depth,
    http_status: page.status,
    content_type: page.contentType,
    byte_size: page.byteSize,
    duration_ms: page.durationMs,
    title: storedTitle(page.title),
    fetch_error: page.error,
    // The parsed shape is ours and bounded; it is stored so Phase 6's rules read data rather
    // than re-fetching, and so a report can explain what was seen.
    parsed: page.parsed === null ? null : { ...page.parsed },
    fetched_at: page.fetchedAt,
  }));
}
