# AGENTS.md — how we work in this repo

Four skills, fused into one way of working. They are not vendors we call; they are the
house rules. Read this file first, then only the skill file the task needs.

| File | Source skill | Answers |
|---|---|---|
| [`skills/01-craft.md`](skills/01-craft.md) | [ponytail](https://github.com/DietrichGebert/ponytail) | How much code to write, and what never to cut |
| [`skills/02-design-floor.md`](skills/02-design-floor.md) | [hallmark](https://github.com/Nutlope/hallmark) | What a page may never look like |
| [`skills/03-ux-intel.md`](skills/03-ux-intel.md) | [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Which interface rule wins, in what order |
| [`skills/04-code-graph.md`](skills/04-code-graph.md) | [graphify](https://github.com/Graphify-Labs/graphify) | How to navigate the codebase |
| [`skills/05-report.md`](skills/05-report.md) | ponytail-audit + ours | The shape of every finding we hand a user |
| [`skills/06-checklist.md`](skills/06-checklist.md) | all four | The one list to run before saying "done" |

## The product we are building

AI-Website-Audit-SaaS: a person pastes a URL and gets a ranked, plain-English audit of
their site — what is wrong, why it costs them, how to fix it.

That makes the four skills load-bearing, not decorative:

- The **audit's checks** are 02 and 03 turned into rules. Our gate list is a product spec.
- The **audit's report** is 05. Same four-part finding a user reads, a machine can score.
- The **app's own UI** obeys 02 and 03. We cannot sell taste we do not have.
- The **codebase** obeys 01 and 04. Audits get big fast.

## Order of operations

1. **Scope before code.** Name every place the change must reach. That is 01 § Scope.
2. **Find before build.** Is it already here? Installed? In the platform? 01 § The smallest complete change.
3. **Blast radius before edit.** Changing something shared, or working in a repo you did not
   write? `.venv/bin/graphify affected "<thing>"` first — it names what breaks, by file and
   line. One symbol you already know: `grep` is faster, so grep. 04.
4. **Build.** UI work loads 02 and 03 first. Never design from memory.
5. **Check.** 06, in full.
6. **Report.** 05. Name what you skipped and what you did not check.

## When two skills disagree

Settled once, here, so no future session re-litigates it:

- **A Floor rule beats a size rule.** 01 never cuts accessibility, security, validation or
  error handling — 02's Floor and 03's priority 1 and 2 are exactly that. Lean code still
  passes both.
- **02 beats 03 on taste, 03 beats 02 on measurable UX.** Hallmark bans the eyebrow and the
  purple gradient; ui-ux-pro-max demands 4.5:1 contrast and a 44px target. Where a style
  preference meets a measurable one, the measurable one wins and the style adapts.
- **04 never overrules a file read.** A graph edge is a map, not the code. Open the file
  before changing it. When the question is about the graph itself, the graph is not evidence.
  The graph is installed, not aspirational: upstream skill at `.agents/skills/graphify/`, CLI at
  `.venv/bin/graphify`, `graphify-out/` gitignored.
- **05 is never shortened.** An audit is the thing the user asked for, so it ships in full,
  however lazy the code behind it is.

## House rules that are ours

- Every deliberate shortcut carries `shortcut: <the limit>, <when to upgrade>` on its line.
  `grep -rn "shortcut:" src` is our debt ledger. A shortcut with no upgrade trigger is rot.
- Every audit finding is numbered across the whole report, so a user can say "fix 2 and 5".
- No invented facts anywhere: no metric, quote, logo, screenshot or testimonial a user did
  not give us. In the app copy and in the reports we generate. This one is a Floor.
- Every finding and every graph edge carries provenance: `EXTRACTED` (measured, in the source),
  `INFERRED` (derived, keep the score), `AMBIGUOUS` (could not tell). Same three words in the
  JSON and in the sentence a customer reads. Never upgraded in the retelling.

## Keeping the contract alive

When a session learns something that would have changed a rule here, edit the rule. A rule
file that drifts from practice is worse than no rule file.
