# 06 · Before you say "done"

One pass, all four skills. Skip a line only when it cannot apply, and say so in the reply.

## Scope

- [ ] Every place the change must reach is named: callers, tests, fixtures, config, exports,
      migrations, the rule registry, the report shape.
- [ ] The diff is the smallest complete one. Anything I added "for later" is deleted or named.
- [ ] Nothing was cut from the never-cut list: validation, error handling, security, access.

## Code

- [ ] Existing helper/component/token reused instead of a new one.
- [ ] Every new dependency earns its place; the count did not grow for a few lines.
- [ ] Bug fix removes the root cause once, not four call sites.
- [ ] Non-trivial logic has one test that fails when it breaks.
- [ ] Every deliberate shortcut says `shortcut: <limit>, <when to upgrade>`.
- [ ] Empty, zero, one, many, unauthorised, offline and slow are answered.
- [ ] Shared thing changed → `.venv/bin/graphify affected "<thing>"` was run, and the files it
      named were read. Nothing shared changed → this line is skipped and said so.

## The floor

- [ ] No literal colour or font outside the token block.
- [ ] No `transition: all`; no animated `width`/`height`/`top`/`left`.
- [ ] `:focus-visible` on everything interactive, instant.
- [ ] Reduced-motion fallback; content visible with JS off.
- [ ] No invented number, quote, logo, testimonial or screenshot.
- [ ] No eyebrow, no tracked-caps label, no middle-dot meta, no glued arrow, no status dot.
- [ ] No purple-to-blue gradient, no card in a card, no emoji icon.
- [ ] Hero legible at 1280×800; ~80 words a screen; `dvh`/`svh`; container capped.
- [ ] The stamp is line one of the stylesheet, with any waiver stated.

## Interface order

- [ ] Contrast 4.5:1 / 3:1 large, measured not eyeballed.
- [ ] Targets 44px (24px web minimum), 8px apart, keyboard reaches everything in visual order.
- [ ] Every control has eight states: rest, hover, focus, active, disabled, loading, error, success.
- [ ] Images have dimensions and modern formats; async space is reserved; no layout jump.
- [ ] One container width, one spacing scale, one z-index scale, `min-h-dvh`.
- [ ] 16px body on mobile, 35–60ch there and 60–75ch on desktop, no horizontal scroll.
- [ ] Light and dark both designed; dark is desaturated, then re-checked.
- [ ] Forms: visible label, helper, error beside the field, validate on blur.

## The report

- [ ] Opens with what the thing does and the load assumed.
- [ ] Findings are tiered, numbered across tiers, four parts each, max 20.
- [ ] Every finding has a concrete case; nothing reported unverified.
- [ ] Confidence is `observed` / `inferred` / `untestable`, never upgraded in silence.
- [ ] Closes with `Verdict:`, `Lean:` when applicable, and `Not checked:`.

## Copy

- [ ] Swap test passed: no headline that would work on a competitor's page.
- [ ] Heads ≤7 words, section heads ≤6, budgets respected, 450 words a page at most.
- [ ] Curly quotes, real apostrophes, `…`, no `--`, no em or en dash.
- [ ] Errors say what happened, why, what to do. No "Oops".

## Hand-off

- [ ] The reply names one thing I skipped and one risk the user must know.
- [ ] The `Not checked:` line is true.
- [ ] The rule that would have prevented this bug is in these files, if one exists.
- [ ] Every relative link in the docs resolves from the file that contains it, and every command
      a doc tells you to run actually runs. (This check is here because it caught a broken
      `.agents/…` link and would have caught five more.)
- [ ] No doc states a number a sibling doc contradicts: findings cap, priority order, limits.
