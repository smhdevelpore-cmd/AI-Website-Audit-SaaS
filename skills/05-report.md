# 05 · The finding is the product

*From ponytail-audit, reshaped for what we sell.*

Every audit — ours, the app's, and the report a customer reads — uses one shape. Same shape in
the code, in the API response, in the PDF, in the chat reply. That is what makes it scoreable
and what makes it trustworthy.

## The report

Open with `What this site does:` in two or three sentences, and the load you assumed (a brochure
site, a shop at 200 orders a day, a SaaS dashboard behind a login). A judgement without a
stated assumption is not a judgement.

Then findings in three tiers, most important first, empty tiers skipped:

- **Must fix** — a bug, a security hole, data loss, or something that breaks at the expected load.
- **Should fix** — risky code with no test, real slowness, duplication, a function doing three
  jobs, something that should not exist.
- **Nice to have** — small speed-ups, shorter forms, polish.

Number findings *across* all tiers. A user must be able to say "fix 2 and 5".

At most 20 findings. If you left smaller ones out, say how many.

## One finding, four parts

Every finding, in plain English, one or two short sentences each. No jargon without its
explanation the first time — the reader may never have seen this code or this site.

```
4. **Checkout dies on a slow card** — `checkout/submit.ts:L40-52`
   - **What this is:** what the thing does, for a reader who has never seen it.
   - **Problem:** the concrete case. This input, or this situation, produces this wrong result.
   - **Fix:** the smallest change that works, prefer one that deletes code.
   - **If we skip it:** what it costs them — money, trust, a support ticket, a slow month.
```

Rules that keep a finding alive:

- **No case, no finding.** "This is slow" is not a finding. "This query runs per row; a
  1,000-row audit issues 1,001 queries" is.
- **Nothing is reported unverified.** Before calling code unused, grep the whole tree — tests,
  fixtures, config, string and dynamic references. Before claiming a contrast failure, measure.
- **A marked shortcut is a decision, not a finding**, unless the expected load already crosses
  the limit it names.
- **No taste in the list.** No "consider", no vague worries, no rewrites dressed as bugs. Taste
  lives in the design review, where it is done on purpose and against a stated floor.
- **Propose fixes that shrink the system.** Never add a layer, a framework or config the problem
  does not need.

## Close with

- `Verdict:` one line — healthy, or what to fix first.
- `Lean: -N lines possible, -M dependencies possible.` when lean findings exist.
- `Not checked:` what you did not read, could not run, or could not reach. This line is the
  difference between an audit and a guess.

Nothing found: `Healthy. Nothing to fix.` plus one line on what you checked. Resist inventing
work to look busy.

## How this becomes a data structure

One finding, one row. Anything the product cannot fill stays empty rather than filled with a
plausible number:

| Field | Notes |
|---|---|
| `id`, `tier`, `title` | the title is the consequence, not the rule name |
| `rule_id`, `source` | which gate or UX rule fired: `02:67`, `03:a11y-contrast`, `perf:cls` |
| `anchor` | selector, URL or `file:line` — must resolve on re-run |
| `what`, `problem`, `fix`, `cost` | the four parts, verbatim from the report |
| `evidence` | the observation itself: measured value, expected value, or the snippet |
| `confidence` | `observed` · `inferred` · `untestable` — never silently upgraded |
| `score_impact` | only if the score is deterministic from it. A score we cannot reproduce is invented |

## Honesty boundaries, written down once

- No fabricated pass. If a check did not run, it reports `not checked`, not green.
- No invented benchmark or percentile. "Faster than 70% of sites" needs a corpus behind it.
- No metric the user did not give, in the marketing page about the product either.
- The engine's own coverage is disclosed: what we test, and what we deliberately do not.
