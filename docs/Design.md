# Design Specification --- AI Website Audit SaaS MVP

**Version:** 1.0

## 1. Principles

Evidence first; explain clearly; prioritize action; trustworthy scoring;
report-first workflow; transparent progress; responsive UI.

## 2. Visual Direction

Modern professional SaaS analytics. Neutral light background, white
surfaces, charcoal text, green primary, amber warning, red critical,
restrained shadows and borders. Suggested tokens: primary `#53B107`,
background `#F7F8FA`, surface `#FFFFFF`, text `#17202A`, muted
`#667085`, border `#E5E7EB`, critical `#DC2626`, warning `#D97706`,
success `#16A34A`. Typography: Inter/Geist or similar. 4px spacing
scale; card padding 20--24 desktop/16 mobile; radius 10--14px.

## 3. Information Architecture

Public: `/`, `/login`, `/register`. Authenticated: `/dashboard`,
`/audits`, `/audits/new`, `/audits/:auditId`, `/settings`. Navigation:
Overview, My Audits, New Audit, Settings. Do not show unfinished roadmap
sections.

## 4. Pages

### Landing

Header; hero with URL CTA; sample report preview; features; three-step
flow; audience; limitations/trust; footer. Suggested headline: "Find
what's holding your website back." Supporting text: "Audit performance,
SEO, and technical issues. Turn real findings into a clear action plan
and client-ready report." \### Login/Register Email/password, show/hide,
validation, loading/errors, password reset. Google only if implemented.
\### Dashboard Header + New Audit. Cards: total audits, completed,
average score (completed only), issues detected with clear definition.
Recent audits table: domain, client/project, score, issues, status,
date, action. Empty, loading, error states. \### New Audit URL required;
optional client/project; scope note (max pages); CTA. HTTP(S)
validation; normalize scheme only if behavior documented; safe URL
rejection message. \### Scan Progress URL, status, elapsed time, stages:
validating, crawling, performance, SEO/technical, links, scoring, AI,
report-ready. Stage-based progress, no fake percentages. Partial/failure
message and retry. \### Results Header: domain, date, client/project,
Re-audit, PDF. Overall score with methodology; category scores/N/A;
severity counts; prioritized action plan; category/severity filters;
search. Findings cards show severity, title, category, evidence,
affected URL, explanation, business impact (qualified), recommendation,
difficulty, AI label. \### Audit History Search, pagination, newest
first; domain/client, score, issues, status/date, view/download/delete;
deletion confirmation. \### Settings Profile, agency name, website,
timezone; optional report logo/branding; usage counters and limit/reset
explanation.

## 5. PDF Design

Cover; website/client/agency/date; executive summary; overall and
category scores; unavailable data; issue counts; priority plan; detailed
findings with evidence and affected URL; methodology/limitations. Footer
and page number. Avoid splitting finding title from body; wrap long
URLs; missing logo must not fail; print-safe contrast.

## 6. Components

AppShell, Sidebar, Topbar, PageHeader; ScoreCard, CategoryScoreCard,
ScoreGauge, IssueCountCards, AuditTable, FindingsList, FindingCard,
MetricTable, ActionPlanList, ProgressStages, EmptyState, ErrorState,
Skeleton; URLInput, SearchInput, CategoryFilter, SeverityFilter;
NewAudit, ReAudit, ExportPDF, DeleteAudit, Retry buttons.

## 7. Accessibility/Interaction

Keyboard accessible; visible focus; labels; status not conveyed by color
alone; sufficient contrast; dialogs focus handling; chart text
summaries; mobile tables become cards; reduced-motion support.

## 8. Responsive

Mobile \<640px; tablet 640--1023; desktop \>=1024. Desktop sidebar and
main; mobile collapsed navigation, stacked score cards, compact filters,
full-width findings, reachable export.

## 9. States

Every action has idle/loading/success/error. Audit states
queued/running/partial/completed/failed/cancelled. Partial audit is not
presented as fully complete.

## 10. Copy

Use measured language ("LCP measured at 4.8 seconds", "Page returned
HTTP 404"). Avoid "website is bad", "SEO is broken", guaranteed
rankings. Explain what was detected, evidence, possible impact and fix.

## 11. Design Acceptance

Landing value is clear above fold; audit form simple; progress truthful;
scores methodology/N/A; findings evidence+next step; AI labelled; export
visible; empty/loading/error states; responsive; keyboard navigable; no
dead/fake controls.
