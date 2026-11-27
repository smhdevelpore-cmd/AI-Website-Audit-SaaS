-- ---------------------------------------------------------------------------
-- AI explanations (TRD §11, PRD FR-14)
--
-- AI output is stored *beside* the deterministic result, never inside it:
--
--   - `audit_findings.ai_explanation` is one `AIRecommendation` per finding (plain explanation,
--     business impact, fix steps, difficulty, priority). It has no column for a measurement, so
--     an explanation cannot become the source of a severity, a metric or a score.
--   - `audits.ai_summary` is the audit-level `AuditSummary` (overview, top priorities,
--     limitations).
--   - `audits.ai_status` records whether the step ran at all, so a report can say "no AI
--     explanation" instead of showing an empty section, and can never imply that a missing
--     explanation means nothing was found.
--
-- Default `'skipped'` is the truthful value for every row that predates this migration: those
-- audits were produced by a build that had no explanation step.
-- ---------------------------------------------------------------------------

alter table public.audit_findings
  add column ai_explanation jsonb,
  add constraint audit_findings_ai_explanation_object
    check (ai_explanation is null or jsonb_typeof(ai_explanation) = 'object');

alter table public.audits
  add column ai_summary jsonb,
  add column ai_status text not null default 'skipped',
  add column ai_model text,
  add constraint audits_ai_summary_object
    check (ai_summary is null or jsonb_typeof(ai_summary) = 'object'),
  -- 'ok' means an explanation was produced; the other two mean it was not, for a stated reason.
  add constraint audits_ai_status_valid
    check (ai_status in ('ok', 'unavailable', 'skipped')),
  add constraint audits_ai_model_length
    check (ai_model is null or char_length(ai_model) <= 120),
  -- A summary without the status that says it was produced would be an unlabelled AI claim.
  add constraint audits_ai_summary_has_status
    check (ai_summary is null or ai_status = 'ok');

comment on column public.audits.ai_status is
  'ok = explanations produced; unavailable = the provider failed; skipped = no key configured.';
comment on column public.audit_findings.ai_explanation is
  'AI-written explanation for this finding. Never a source of severity, metrics or the score.';
