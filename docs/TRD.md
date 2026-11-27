# Technical Requirements Document (TRD)

**Version:** 1.0 \| **Implementation baseline**

## 1. Stack

Frontend: React, TypeScript, Vite, Tailwind, React Router, TanStack
Query, React Hook Form, Zod, Recharts if useful.\
API: Node.js LTS, Express, TypeScript, Zod, Supabase token verification,
structured logging.\
DB/Auth: Supabase PostgreSQL + Supabase Auth.\
Jobs: Redis + BullMQ; separate worker.\
Audit: PageSpeed Insights/Lighthouse provider, HTTP crawler, HTML parser
(Cheerio), DNS/IP validation.\
AI: LLM API with structured JSON/schema output.\
PDF: controlled HTML-to-PDF browser or PDF library.\
Tests: Vitest/Jest, Supertest, Playwright.

## 2. Deployable Components

Web frontend, API server, audit worker, Redis, Supabase database/auth,
private object storage. Keep a modular monolith; no microservices for
MVP.

## 3. Suggested Repository

``` text
siteaudit-ai/
  apps/web/src/
  apps/api/src/
  apps/worker/src/
  packages/shared-types/
  packages/validation/
  packages/audit-rules/
  packages/report-template/
  supabase/migrations/
  tests/fixtures/
  tests/integration/
  tests/e2e/
  docs/PRD.md
  docs/Design.md
  docs/TRD.md
  docs/ARD.md
  docker-compose.yml
  .env.example
```

Use npm workspaces or pnpm; choose one and commit lockfile.

## 4. Environment

Web: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`.\
API: `NODE_ENV`, `PORT`, `FRONTEND_ORIGIN`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only),
`REDIS_URL`, `PAGESPEED_API_KEY`, `LLM_API_KEY`, `LLM_MODEL`, storage
config, `LOG_LEVEL`, `AUDIT_MAX_PAGES`, `AUDIT_TIMEOUT_MS`,
`CRAWLER_USER_AGENT`, `AUDIT_CONCURRENCY`, rate-limit config. Validate
env at startup; never expose server secrets in VITE variables.

## 5. API

Base `/api/v1`; success envelope `{success:true,data:{},meta:{}}`; error
`{success:false,error:{code,message,details}}`. - `POST /audits`
create/enqueue. - `GET /audits` list with page/limit/status/search. -
`GET /audits/:id` status/details. - `DELETE /audits/:id`. -
`POST /audits/:id/cancel` if supported. - `POST /audits/:id/re-audit`
creates new audit. - `GET /audits/:id/findings` filters
category/severity/page/limit. - `GET /findings/:id`. -
`PATCH /findings/:id` optional status update. -
`POST /audits/:id/reports` generate PDF. - `GET /reports/:id` report
metadata/status. - `GET /reports/:id/download` authorized download. -
`GET /profile`, `PATCH /profile`. - `GET /usage`.

Create request:

``` json
{"url":"https://example.com","clientName":"Optional","projectName":"Optional","scanScope":{"maxPages":25}}
```

Server always enforces limits, regardless of client input.

## 6. Job Lifecycle

Statuses queued/running/completed/partial/failed/cancelled; stages
validating/crawling/performance/rules/links/scoring/AI/persisting.
Worker: load audit; validate target; crawl; call provider; run rules;
link checks; normalize/dedupe; score; AI; persist; update status. Module
failure may produce partial results; fatal error fails audit with
sanitized message. Bounded retries with backoff for transient failures.
Idempotent writes keyed by audit + issue code + page key.

## 7. Crawler/SSRF

Only HTTP/HTTPS; reject URL credentials;
localhost/private/loopback/link-local/multicast/reserved/metadata
addresses; validate IPv4 and IPv6; resolve and validate all DNS answers;
validate actual connection destination where possible; revalidate
redirects; block unsafe redirect; restrict ports (normally 80/443); DNS
rebinding protection; connect/read/total timeouts; response byte limit;
page/redirect limits; per-host/global concurrency; HTML content-type
only; identifiable UA; no large asset downloads. Respect robots.txt
where applicable (not a security control). Link checks bounded;
transient failures conservative.

## 8. Rule Engine

Deterministic, versioned, fixture-tested. Rule interface:

``` ts
interface AuditRule { code:string; category:AuditCategory; run(context:PageAuditContext):Finding[] }
```

Finding fields: issueCode, category, title, severity, description,
pageUrl?, evidence, recommendation?, source. Deduplicate by audit, code,
normalized page/global scope.

## 9. Scoring

Weights: Performance 25, SEO 25, Technical 20, Mobile 15, Accessibility
10, Security 5. Deterministic deductions/provider scores; clamp 0--100;
store scoring version; renormalize weights for available categories;
unavailable is N/A, not 0. Clearly identify Lighthouse/provider-derived
scores versus custom score.

## 10. Performance Provider

PageSpeed Insights/Lighthouse API quotas, latency, cost and availability
must be checked. Store strategy, timestamp, score, LCP/FCP/CLS/INP when
available, Speed Index, TBT, opportunity/audit IDs, provider status and
selected raw response. Handle quota, timeout, invalid URL, partial
responses; never fabricate missing data.

## 11. AI

Input only bounded sanitized structured audit evidence. Output schema:

``` ts
interface AIRecommendation {
  issueCode:string;
  plainExplanation:string;
  businessImpact:string;
  recommendedFix:string[];
  difficulty:"easy"|"medium"|"hard";
  priority:"critical"|"high"|"medium"|"low";
}
interface AuditSummary { overview:string; topPriorities:string[]; limitations:string[] }
```

Validate JSON; token limits; timeout; bounded retries; log usage/cost;
no secrets; website content is untrusted prompt data; don't send
unnecessary raw page text. AI cannot change measurements/severity. If AI
fails, deterministic findings remain.

## 12. PDF

Render from stored snapshot; sanitize/escape content; no arbitrary
remote assets; timeout/memory limit; handle long text, missing logo and
page breaks; private storage; signed download URL expiry or
authenticated stream.

## 13. DB/RLS

Tables: profiles, audits, audit_pages, audit_findings, audit_metrics,
audit_reports, usage_records. Indexes: audits(user_id,created_at desc),
audits(status,created_at), findings(audit_id,category,severity),
pages(audit_id), metrics(audit_id,category), reports(user_id,audit_id).
RLS owner access; child data access through owned audit; service role
only API/worker; private storage.

## 14. Usage/Cost

Meter audit count, pages, provider calls, AI tokens, reports.
Configurable plans/limits, per-user/IP rate limits, page cap, timeout,
concurrency, AI token cap. Track estimated cost per audit and budget
alerts.

## 15. Observability

Structured logs: request ID, audit/job ID, module, duration, outcome,
sanitized error code. Metrics: queue depth, completion/failure rate,
scan duration, provider/AI latency/errors, PDF time, cost estimate.
Never log credentials, tokens, API keys, signed URLs or unnecessary page
contents.

## 16. Deploy

Web, API, worker, Redis, managed Supabase, private storage. Local dev
uses Docker for Redis and local/test services where practical.
Production HTTPS, secrets, migrations, backups, health checks, worker
restart, rate limits and private reports.

## 17. Tests

Unit: URL/IP, redirects, SEO, severity, scoring, normalization, AI
schema, PDF data.\
Integration: auth, RLS, API, queue/worker, provider, AI, storage.\
E2E: signup/login, audit, progress, report, filters, PDF, ownership,
failure.\
Security: localhost/private/IPv6/metadata, redirects, DNS rebinding, URL
credentials, protocol, oversized responses, redirect loop, rate limit.

## 18. Definition of Done

Type/lint/tests pass; critical integration/E2E works; RLS and SSRF
verified; secrets protected; errors sanitized; migrations reproducible;
env/readme docs; deployment and rollback documented.
