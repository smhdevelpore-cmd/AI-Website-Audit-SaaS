# skills/

Four external design and engineering skills, read once, distilled, and rewritten as the rules
this repo works by. Not vendored: none of the four repos is copied in. If you want the full
upstream material — 50 themes, 141 UX guidelines, the entire gate table, the graph builder —
install it from source.

| File | Came from | Licence |
|---|---|---|
| [01-craft.md](01-craft.md) | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | MIT |
| [02-design-floor.md](02-design-floor.md) | [Nutlope/hallmark](https://github.com/Nutlope/hallmark) (Together AI) | MIT |
| [03-ux-intel.md](03-ux-intel.md) | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT |
| [04-code-graph.md](04-code-graph.md) | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | Apache-2.0 |
| [05-report.md](05-report.md) | ponytail-audit, reshaped for this product | MIT |
| [06-checklist.md](06-checklist.md) | all four, fused | — |

Start at [`../AGENTS.md`](../AGENTS.md) for the order of operations and how conflicts settle.

## What each one actually gave us

**Ponytail** — the answer to "how much code". One ordering (does it need to exist → already
here → platform → installed dep → one line → minimum), a never-cut list that stops lean code
from being cheap code, and the `shortcut:` marker that keeps a deferral from turning permanent.

**Hallmark** — the answer to "why does this look generated". A tiered gate list: Floor rules
that never ship broken, Reflex tells you may overrule only on the record, Finish checks that
never block. Its most useful idea is the *stamp*: one comment at the top of the stylesheet that
records the decisions and the waivers, so the next session inherits reasons.

**UI/UX Pro Max** — the answer to "which rule wins". A strict impact order, accessibility and
touch above taste, and a long list of concrete measurements (contrast ratios, target sizes,
breakpoints, line lengths, line heights) that turn an opinion into a check.

**Graphify** — the answer to "how do I understand a codebase I did not write". Build the map
when the map earns its keep, query instead of grepping the world, and tag every edge as
extracted or inferred — the same honesty rule our audit reports need.

## The one idea lifted from all four

Every one of them, independently, is about refusing a plausible-looking default. The extra
feature, the gradient, the hover-only control, the guessed dependency. So the house rule is:
**a believable output is not the same as a correct one, and the difference is always recorded
somewhere the next person can read.**
