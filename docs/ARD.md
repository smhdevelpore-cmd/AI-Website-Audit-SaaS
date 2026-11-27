# Architecture Requirements / Architecture Design Document (ARD)

**Version:** 1.0 \| **Architecture:** Modular monolith + asynchronous
worker

## 1. Architecture Drivers

Security (SSRF and tenant isolation), correctness/traceability,
reliability for long scans, cost controls, maintainability for a small
team, MVP speed, extensibility.

## 2. Context and Boundary

Actors: freelancer/agency user, audited public website (untrusted),
PageSpeed provider, LLM provider, storage. System scans bounded public
pages and produces findings/reports. It does not change sites, perform
intrusive security testing, certify compliance, or guarantee rankings.

## 3. High-Level Architecture

``` mermaid
flowchart LR
  U[Browser] --> WEB[React Web]
  WEB --> API[Express API]
  API --> AUTH[Supabase Auth]
  API --> DB[(PostgreSQL)]
  API --> Q[Redis/BullMQ]
  Q --> W[Audit Worker]
  W --> SAFE[URL Safety / Egress Guard]
  SAFE --> SITE[Public Website]
  W --> PSI[PageSpeed Provider]
  W --> RULES[Deterministic Rules]
  RULES --> SCORE[Scoring]
  SCORE --> AI[AI Explanation]
  AI --> DB
  W --> DB
  API --> RQ[Report Job]
  RQ --> RW[Report Renderer]
  RW --> STORE[Private Storage]
  STORE --> API
```

## 4. Decisions

**ADR-001 Modular monolith:** shared domain packages, separate
API/worker processes; avoid microservice overhead.\
**ADR-002 Background scans:** queue jobs; HTTP requests return audit
ID.\
**ADR-003 Supabase/Postgres:** managed auth, relational DB, private
storage.\
**ADR-004 Deterministic checks + AI explanation:** metrics/rules are
testable; AI cannot invent findings.\
**ADR-005 Private report storage:** owner-authorized short-lived
downloads.\
**ADR-006 Strict outbound scan boundary:** validate URL, DNS, IP and
redirects; egress controls.\
**ADR-007 Immutable audit snapshots:** re-audit creates a new audit.

## 5. Component Responsibilities

Web: auth, submit, status, results, filters, download, settings.\
API: validation, auth, ownership, CRUD, usage, queue dispatch, report
access.\
Worker: crawl, provider, rule engine, normalize, score, AI, persist.\
Rule engine: deterministic checks, stable codes, evidence.\
AI service: grounded explanations, structured output,
validation/fallback.\
Report service: data assembly, render, storage, metadata.

## 6. Data Flow

### Audit submission

Browser submits URL → API validates user/schema/usage → preliminary
safety validation → creates queued audit → enqueues job → returns ID.
\### Scan Worker loads job → safety validation → bounded crawl →
performance provider → rules/link checks → normalization/deduplication →
score → AI → persist → completed/partial. \### PDF User requests →
ownership check → report job → render from stored snapshot → private
storage → metadata → authorized signed download/stream.

## 7. Domain

Entities: Profile, Audit, AuditPage, Finding, Metric, Report,
UsageRecord. Audit states
queued/running/completed/partial/failed/cancelled. Finding states
open/resolved/ignored if status management is included. Categories
performance/SEO/technical/mobile/accessibility/security/links. Select
one partial-result representation and use consistently; recommended
explicit `partial` status.

## 8. Trust Boundaries

Browser/API; API/database; API/queue; worker/public internet;
worker/providers; AI provider receiving sanitized data; PDF renderer
handling untrusted text; storage/user download.

## 9. Threat Model

**SSRF:** schemes, DNS, IP ranges, redirect validation, actual egress
restrictions, allowed ports, no internal access.\
**Cross-tenant access:** owner checks, RLS, service-role isolation,
tests.\
**Prompt injection:** scraped text untrusted; send only needed evidence;
instruction/data separation; schema validation.\
**XSS:** encode content, sanitize, no unsafe HTML, PDF sanitization,
CSP.\
**Cost abuse:** rate/usage limits, max pages, concurrency, timeout,
provider quotas.\
**PDF leakage:** private bucket, ownership, expiring signed links.\
**DoS:** bounded response/page/redirect/time/concurrency and worker
isolation.

## 10. Reliability

Website unreachable → safe failure. Provider unavailable → partial audit
if other modules work. AI unavailable → deterministic findings retained,
AI marked unavailable. Crawl blocked → limitation/partial. Redis
unavailable → safe error, don't claim queued. PDF fails → audit remains
valid, report retry. Storage fails → report failure. DB failures →
bounded retry/idempotent writes.

## 11. Scalability

MVP: one API, worker replicas configurable, Redis, managed DB/storage.
Scale workers; isolate Lighthouse/crawl workloads; per-domain
concurrency; provider caching where permitted; isolate crawler further.
Avoid Kubernetes, sharding and microservices prematurely.

## 12. Decisions to Revisit

Provider quota/cost, self-hosted Lighthouse vs API, Redis hosting, PDF
renderer memory, organization/team model, billing, white-label, audit
comparison, retention policy.

## 13. Architecture Acceptance

Bounded scans; no internal access; jobs don't hold HTTP open;
retry/idempotency; AI failure preserves findings; private reports;
ownership/RLS; secret-safe logs; traceable audit/job outcomes.
