-- ---------------------------------------------------------------------------
-- audits: the score a finished scan produced
--
-- Phase 6 computes a deterministic score from the findings of one crawl (PRD FR-13, TRD §9).
-- The number lives on the audit row, not in `audit_metrics`, for two reasons:
--
--   1. `audit_metrics.category` only accepts the seven audit categories, and "overall" is not one
--      of them; storing it there would have meant inventing an eighth category to satisfy a check.
--   2. The API, the history screen and the report all need the score with the audit, and a score
--      that requires aggregating child rows to read is a score two screens can disagree about.
--
-- `scoring_version` already exists (Phase 2). It becomes not-null-by-constraint for finished
-- audits below: a score whose formula cannot be identified is not reproducible.
-- ---------------------------------------------------------------------------

alter table public.audits
  add column overall_score integer,
  add column category_scores jsonb,
  add constraint audits_overall_score_range
    check (overall_score is null or overall_score between 0 and 100),
  -- An array of {category, score, weight}: a score per category, `score` null where it is N/A.
  add constraint audits_category_scores_array
    check (category_scores is null or jsonb_typeof(category_scores) = 'array'),
  -- A finished audit that claims results must carry the number and the version that produced it.
  -- A `failed` audit carries neither, and must not pretend to.
  add constraint audits_finished_has_score
    check (
      status not in ('completed', 'partial')
      or (overall_score is not null and scoring_version is not null)
    );

comment on column public.audits.overall_score is
  'Weighted score 0-100 over the categories that were checked. Never set for a failed audit.';
comment on column public.audits.category_scores is
  'Per-category score and FR-13 weight. A null score is N/A (not checked), which is not zero.';
