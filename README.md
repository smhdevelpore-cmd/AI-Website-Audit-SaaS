# AI-Website-Audit-SaaS

A person pastes a URL and gets a ranked, plain-English audit of their site: what is wrong, what
it costs them, how to fix it.

## How this repo works

Engineering and design rules live in [`AGENTS.md`](AGENTS.md) and [`skills/`](skills/). Read
`AGENTS.md` before writing code; it names the order of operations and settles conflicts between
the four skills this repo is built on.

- [`skills/01-craft.md`](skills/01-craft.md) — the smallest complete change, and what never to cut
- [`skills/02-design-floor.md`](skills/02-design-floor.md) — what a page may never look like
- [`skills/03-ux-intel.md`](skills/03-ux-intel.md) — which interface rule wins, in what order
- [`skills/04-code-graph.md`](skills/04-code-graph.md) — how to navigate the codebase
- [`skills/05-report.md`](skills/05-report.md) — the shape of every finding we hand a user
- [`skills/06-checklist.md`](skills/06-checklist.md) — the pass to run before "done"

Status: rules in place, product not yet built.
