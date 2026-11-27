# The PDF report

`@siteaudit/report-template` (PRD FR-15, TRD §12). A real, downloadable document, produced per
request from stored rows.

```
GET /api/v1/audits/:id/report.pdf
  → requireOwnedAudit      (RLS + ownership; someone else's audit is a 404)
  → status must be completed or partial, else 409 report_not_ready
  → buildAuditSnapshot     (rows → ReportSnapshot)
  → renderReportPdf        (snapshot → bytes; pdf-lib, no browser)
  → 200 application/pdf, Content-Disposition: attachment
```

## Three parts, tested apart

| File | What it owns |
|---|---|
| `src/snapshot.ts` | `buildReportSnapshot(source, { now })` — sorting, severity counts, limitations, methodology, versions. No I/O |
| `src/pdf.ts` | `buildReportOutline(snapshot)` — the document's visible content, in order — and `renderReportPdf(snapshot)` which paints it |
| `apps/api/src/report.ts` | The join: `UserData` rows → `ReportSource` → bytes. The only place that knows both |

The outline is separate from the painter for one reason: everything worth testing about a report is
*what it says*. A test can assert that the AI label exists, that a limitation is printed, and that
no summary section is drawn for an audit without one — none of which can be read back out of
compressed PDF bytes without a text extractor.

## Every number comes from a row

The snapshot is built from `audits`, `audit_findings` and `audit_pages` and nothing else. No site is
fetched, no rule is re-run, no score is recomputed: `overallScore` is `audits.overall_score`,
`scoringVersion` is `audits.scoring_version`, and the severity counts are counted from stored
findings. The only generated text is the limitations and the methodology — statements about the
boundaries of the result, which cannot contradict it.

So a report re-rendered from history is the same report, even if the site has changed since.

## What is printed

1. **Cover** — agency name (from the profile), host, address, audit id, requested/finished dates.
2. **Score** — the overall score, then each weighted category with its weight and score. A category
   that was not checked prints **N/A**, never 0.
3. **Issues by severity** — four counts, in one line, plus how many pages were read.
4. **Summary** — only when `ai_status = 'ok'`; the model's overview and its top priorities, labelled
   as AI-written. When `ai_status = 'unavailable'` the section says no summary could be produced.
   When `'skipped'`, the section is absent and a limitation says so.
5. **Findings** — grouped by category, worst severity first, each with the page URL, description,
   evidence and the deterministic fix. An AI explanation, where one exists, follows under the label
   *"Written by AI, from the evidence above"*, with its impact, its steps and its difficulty. Up to
   `MAX_LISTED_FINDINGS = 120`; beyond that the report says how many more there are.
6. **Methodology** — how pages were fetched, how rules and the score work, what an AI explanation is.
7. **Limitations** — always: our performance figures are not Lighthouse, accessibility checks are
   not a WCAG certification, the crawl is bounded, findings describe the site as served. Sometimes:
   how many pages could not be read, that the audit is partial, that explanations are missing.
8. **Versions** — template, rules, scoring, explanation model, generation date.

## Text that a real website produces

The standard PDF fonts cover Latin-1. A page titled with an emoji or a CJK name would otherwise
throw mid-render, so every string goes through `sanitizePdfText`:

- typographic characters are **mapped** where an exact ASCII equivalent exists — `—` → `-`,
  `…` → `...`, `“ ”` → `"`, `→` → `->`, `×` → `x`;
- characters with no mapping become `?`, so the report still renders;
- control characters are removed; whitespace is collapsed.

A single word wider than the column (an unbroken hash, a long URL) is cut by character rather than
running off the paper. The renderer paginates: when the next line would cross the bottom margin, a
new page starts.

## Determinism

`renderReportPdf` takes `now`; the route passes the request time, the tests pass a fixed one. The
same rows and the same `now` produce byte-identical output — asserted over HTTP in
`tests/integration/report-api.test.ts`.

## Headers

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="audit-example.com-2026-11-27.pdf"
Cache-Control: private, max-age=0, must-revalidate
X-Content-Type-Options: nosniff
```

The filename is built from the host with everything but letters, digits, dots and dashes replaced:
the host is user-influenced data, and a quote or a newline in a `Content-Disposition` header is how
response splitting starts.

The download is not a link. The endpoint requires the caller's `Authorization` header (a plain
`<a href>` cannot carry it), so the web app fetches the blob with the session token and hands it to
the browser — `downloadReport()` in `apps/web/src/lib/audits.ts`.

## What is not here

- **No stored PDF.** The document is rendered on demand, so there is no cache to go stale and no
  object to leak. `audit_reports` exists in the schema for a later queued-render path; nothing writes
  to it yet, and this document does not claim otherwise.
- **No images.** A logo would be fetched from a URL embedded in the file — a request the reader's
  machine makes, and an SSRF surface in somebody's inbox. The agency name is text.
- **No charts.** Severity is a word, and a report is printed in black and white as often as not.
- **No background colours that carry meaning.** A score is a number with its explanation beside it.
