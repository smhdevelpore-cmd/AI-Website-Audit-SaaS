# Product Requirements Document (PRD)

## AI Website Audit & Action Plan SaaS --- MVP

**Version:** 1.0 \| **Status:** Proposed baseline

## 1. Executive Summary

A web SaaS that accepts a public website URL, performs bounded
evidence-based audits across performance, SEO, technical health,
mobile/basic accessibility, security headers and links, explains
findings in plain language, prioritizes fixes, and generates a
client-ready PDF. Primary value: help agencies and freelancers audit
faster and turn findings into a credible client deliverable.

## 2. Problem

Professionals currently use multiple tools and manual checks to gather
metrics, interpret issues, prioritize fixes, explain findings to clients
and assemble reports. The workflow is fragmented and repetitive.

## 3. Goals

-   Scan a public URL and collect real measurements/checks.
-   Store structured metrics, findings, and scan evidence.
-   Produce deterministic scores and transparent methodology.
-   Use AI only to explain evidence and recommend actions.
-   Generate a professional PDF.
-   Save audit history.
-   Protect user data and scanning infrastructure.

## 4. Non-goals

No rank tracking, backlinks database, GSC/GA integration, competitor
monitoring, automatic fixes, full WCAG certification, penetration
testing, CRM, client portal, team roles, custom domain white-labeling,
recurring audits, unlimited crawling, or website builder in V1. Billing
can wait until beta willingness-to-pay is validated.

## 5. Target Users / Jobs

### Primary: Small agencies

2--15 people doing SEO, web design, growth or marketing; audit prospects
and clients. **JTBD:** "Help me prepare a clear, credible audit and
action plan quickly so I can explain opportunities and deliver value."
\### Secondary: Freelancers WordPress/frontend/web/SEO/maintenance
freelancers. **JTBD:** "Help me identify and explain actionable issues
so I can scope work and communicate professionally."

## 6. Positioning

**Find website problems. Turn them into opportunities.** Analyze
performance, SEO, technical signals and usability; turn verified
findings into an understandable action plan and client-ready report. Do
not promise rankings, revenue or conversion improvements.

## 7. User Stories

-   Register, login, logout, reset password, manage profile.
-   Submit HTTP/HTTPS URL and optional client/project labels.
-   See URL validation errors and safe rejection.
-   Start audit and receive an ID immediately.
-   View queued/running/completed/partial/failed status.
-   See scores, metrics, pages scanned, issue counts and date.
-   Filter issues by category and severity.
-   Inspect evidence, affected URL, explanation and recommended fix.
-   See AI-generated content labelled as such.
-   Generate/download PDF with basic agency/client branding.
-   View/search/paginate history; open old audits.
-   Re-audit creates a new snapshot rather than overwriting.

## 8. Functional Requirements

**FR-01 Auth:** Supabase Auth; email/password required; Google
optional.\
**FR-02 Profile:** name, agency name, website, timezone, optional logo.\
**FR-03 URL safety:** HTTP(S) only; reject
localhost/private/loopback/link-local/reserved/metadata IPs; validate
DNS answers and redirect destinations; prevent rebinding; limit ports,
redirects, response size and duration.\
**FR-04 Jobs:** async scan, truthful stage/status; no HTTP request held
for full scan.\
**FR-05 Crawl:** homepage, sitemap discovery if available, bounded
internal pages; default maximum 25 pages; deduplicate; respect robots
where applicable; identifiable user agent; no auth pages or non-HTML
pages as crawl targets.\
**FR-06 Performance:** PageSpeed/Lighthouse metrics: score, LCP, FCP,
CLS, INP where available, Speed Index, TBT, opportunities; record
provider/strategy and missing data.\
**FR-07 SEO:** title/meta presence and length, H1 count, heading
hierarchy, canonical, robots, alt text, Open Graph, lang, links,
indexability signals.\
**FR-08 Technical:** HTTP status, redirects, HTTPS, robots.txt, sitemap,
response time, canonical/indexing directives.\
**FR-09 Mobile/accessibility:** Lighthouse and basic viewport,
accessible names, labels, alt, heading and contrast/tap-target findings;
clearly state this is not certification.\
**FR-10 Security signals:** HTTPS and selected headers (HSTS, CSP,
X-Content-Type-Options, X-Frame-Options, Referrer-Policy), mixed content
if feasible; not a vulnerability scan.\
**FR-11 Links:** bounded link checks; status, source URL and failure;
transient timeouts treated conservatively.\
**FR-12 Normalization:** stable issue code, category, severity,
evidence, page, description, optional recommendation.\
**FR-13 Scoring:** category weights Performance 25%, SEO 25%, Technical
20%, Mobile 15%, Accessibility 10%, Security 5%. If unavailable, mark
N/A and renormalize available weights. Scores deterministic and
documented.\
**FR-14 AI:** summary, plain-language explanation, qualified impact,
fix, difficulty and priority; evidence-only, schema-validated; no
invented metrics.\
**FR-15 PDF:** generated from stored results; cover, summary, scores,
issue overview, action plan, details, methodology, limitations, date,
optional branding.\
**FR-16 History:** list, search, paginate, open, delete own audits;
re-audit creates new record.\
**FR-17 Usage:** track audits, pages, AI usage, reports; enforce
configurable limits and rate limits.

## 9. UX Requirements

Responsive desktop-first; truthful scan stages; partial-data and
unavailable states; distinguish evidence from AI interpretation; no
score implying guaranteed SEO success; include loading/empty/error
states.

## 10. Success Metrics (hypotheses)

-   Interview 5 target customers before broad build.
-   3--5 beta users.
-   At least 70% of supported beta scans complete.
-   Measure scan time and cost per audit.
-   At least 2 users use report with a real prospect/client.
-   Seek one paid beta or explicit payment commitment before expanding
    scope. Track start/completion/failure, report downloads, repeat
    audits, activation, feedback and cost.

## 11. Risks

  -----------------------------------------------------------------------
  Risk                                Mitigation
  ----------------------------------- -----------------------------------
  Generic competition                 Position as client-ready agency
                                      report/workflow

  AI hallucination                    Evidence-bound prompts and schema
                                      validation

  API costs                           Quotas, limits, tracking, selective
                                      calls

  SSRF                                DNS/redirect/IP validation and
                                      egress restrictions

  Scan timeouts                       Queue, bounded retries, partial
                                      results

  False positives                     Evidence, conservative severity,
                                      retry transient errors

  Scope creep                         Enforce non-goals

  Weak willingness-to-pay             Interviews and report prototype
                                      before subscriptions
  -----------------------------------------------------------------------

## 12. Release Criteria

Auth works; safe URL accepted; scan runs asynchronously; real data is
persisted; scoring is explainable; AI schema validates;
report/results/history work; ownership is enforced; SSRF and rate-limit
tests pass; E2E audit-to-PDF passes; known limitations documented.
