# 04 · Navigating the code

*From [graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0). Installed here, and
every claim below was run on this machine — numbers included. The full upstream skill is
vendored at [`.agents/skills/graphify/SKILL.md`](../.agents/skills/graphify/SKILL.md); read it
when you need a flag this file does not name.*

## What it is, without the pitch

It parses a folder with tree-sitter, writes `graphify-out/graph.json` (nodes + typed edges),
clusters it into communities, and gives you `query`, `path`, `explain`, `affected`, `god-nodes`.
Code parsing is local and free. Docs, PDFs and images need a semantic pass and an API key —
we run code-only. No embeddings, no vector store: you traverse a graph, so an answer can be
checked hop by hop.

Measured here: this repo's own dependency tree, 345 Python/TS files → 5,436 nodes in **9
seconds, 0 tokens**. A 24k-node repo (graphify's own source) took 89 seconds, still 0 tokens.

## Decide first

| The question | Do this |
|---|---|
| "where is `X` defined", "what calls `Y`" — one known symbol | **`grep -rn` + read the file.** A graph is a 30-second detour for a 2-second answer. |
| Many questions against a large or unfamiliar corpus | **Build once, query many.** |
| Links text search cannot see: doc → code, ADR → module, import cycles, which subsystem this belongs to | **Build.** |
| "what breaks if I change this" | **`affected`.** Nothing else answers it. |
| `graphify-out/graph.json` already exists | **Query it.** Do not re-detect, do not re-read files. |

## Install here

The venv is gitignored; recreate it in one line:

```bash
python3 -m venv .venv && .venv/bin/pip install -q graphifyy
```

Then call it by path — `graphify` is not on `PATH`:

```bash
.venv/bin/graphify --help
```

Python floor upstream is 3.11.5; this sandbox has 3.11.2, and pip resolves `0.9.112`, which
runs fine. If a future version refuses to install, that is why.

This is a **developer tool, never a product dependency** — it lives in `.venv/`, out of
`package.json`, out of the build, out of production. That is the exception [01](01-craft.md)
allows: it buys us a whole codebase map, not a few lines of code.

## Build

```bash
.venv/bin/graphify extract . --code-only          # code only, no API key, free
.venv/bin/graphify extract .                      # + docs/PDFs/images: semantic pass, costs tokens
.venv/bin/graphify update .                       # after changing code: re-extract, free
.venv/bin/graphify cluster-only . --no-viz        # re-cluster + rewrite the report, no browser view
```

`.graphifyignore` decides whether the graph is signal or noise. Measured on a corpus that
vendored the same tree three times plus a minified chart bundle:

| | nodes | top god node |
|---|---|---|
| without `.graphifyignore` | 5,436 | `tn` — 131 edges (minified JS) |
| with `.graphifyignore` | 2,383 | `TailwindConfigGenerator` — 60 edges (a real hub) |

Same tool, same corpus, 56% fewer nodes, and every god node became something a human named.
Ignore minified bundles, vendored copies, `dist/`, `node_modules/`, fixtures and generated
code **before** you build, or you will spend the session reading noise.

## Read

```bash
.venv/bin/graphify god-nodes --top 10                    # the architectural hubs
.venv/bin/graphify affected "DesignSystemGenerator"      # blast radius, reverse traversal
.venv/bin/graphify explain "dispatch_command"            # one node: source, community, degree, edges
.venv/bin/graphify path "cli.py" "out_path()" --undirected
.venv/bin/graphify query "question" --seed <node> --depth 2 --budget 1500
.venv/bin/graphify section "Architecture"                # markdown back out, needs docs extracted
```

- `affected` prints `[relation] file:Lnnn` per hit and is the single most useful command we
  have: run it before changing anything shared, and the tests that will break are named.
- `path` is **directed by default**. "Are these two related?" wants `--undirected`; "how does A
  reach B?" wants the default.
- `explain` wants an exact label. `search.py` fails, `scripts_search.py::search.py` or the node
  id works. Node ids are `<path with / → _>_<symbol slug>`.
- Exit codes: `0` answered, `3` ambiguous (candidates listed), `4` no match. Script against them.

## Query honestly

The matcher is case-folded **substring + IDF**. No stemming, no synonyms, no translation. So
"how do auth tokens refresh" finds nothing in a graph that says `SessionRenewal`, and the naive
query returns plausible-looking noise — the first run here started from a YAML file called
`labels`.

The fix, and it is the same rule our product needs: **expand the question only with words that
exist in the corpus.** Dump the label vocabulary, choose tokens *from that list*, print the
expansion so a reader can audit it, then traverse. If no corpus token matches, say the corpus
has no vocabulary for this question. Never substitute a near-synonym from memory.

Seeding beats expanding when you already know a landmark: `--seed` skips keyword matching
entirely and is the shortest path to a right answer.

## Every edge is tagged, and that is the point

```json
{"source": "...", "target": "...", "relation": "calls",
 "confidence": "EXTRACTED", "confidence_score": 1.0,
 "_origin": "ast", "context": "call",
 "source_file": "graphify/cli.py", "source_location": "L323"}
```

- **EXTRACTED** — stated in the source. An import, a call, a reference.
- **INFERRED** — resolved by the tool. Probably true, not stated. Carries a score (`0.95`).
- **AMBIGUOUS** — the tool guessed between candidates.

A path is as certain as its **weakest hop**, and the report says so: `Path confidence:
EXTRACTED (weakest hop 1: imports)`. Never upgrade a tag in the retelling. A 24k-node graph
came out 98% EXTRACTED / 2% INFERRED — if your graph is mostly INFERRED, the resolver is
guessing and the map is a rumour.

**Hub questions have a trap.** A hub's neighbours only show what already calls it — never the
code that reimplements it without calling it. For "why is this node central", pick a literal
from the hub's body (a constant, a returned string) and grep the corpus for it. Files with no
edge to the hub that contain the literal are **bypasses**: duplicate logic the map cannot see.
Report them separately. Every god node we found is a candidate for exactly this.

## Let the map learn

```bash
.venv/bin/graphify save-result --question "..." --answer "..." \
  --type query --nodes Node1 Node2 --outcome useful|dead_end|corrected \
  [--correction "what was right"]
.venv/bin/graphify reflect --if-stale     # → graphify-out/reflections/LESSONS.md
```

`reflect` aggregates outcomes deterministically (no LLM, 30-day half-life, min 2 corroborations)
into preferred sources, known dead ends and corrections. The start of real graph work is reading
`LESSONS.md`, so a session does not re-derive a dead end. This is cheap and it is the only part
of the tool with a memory, so use it.

## What we do not index

Minified JS, vendored copies, `dist/`/`build/`, `node_modules/`, fixtures, generated types.
`graphify-out/` is derived data and stays out of Git. Never commit a graph.

## What this becomes for our product

The audit engine's spine is the same shape, and the schema above is the one to copy:

- A site is a graph: origin → page → asset → script → third-party. Build it once per audit,
  run every check against it instead of re-fetching.
- Every finding carries `confidence` (`EXTRACTED` = measured / `INFERRED` = derived from a
  signal / `AMBIGUOUS` = could not tell), `source_file` (the URL or selector), `source_location`
  (the measured value), and a `relation`. Our report's `observed · inferred · untestable` is the
  same vocabulary in plain English — see [05](05-report.md).
- "What breaks if I change this" is `affected`, and it is a product feature: *"you are about to
  change the header; these 14 pages inherit it."*
- Reimplementation detection is the bypass check: two components doing the same job with no edge
  between them is a finding no crawler reports today.

## Boundaries

- The graph is a map, never the code. Open the file before you change it.
- When the task is about the graph's own correctness, the graph is not evidence.
- Node count is not coverage: `graphify` warns when files had no extractor. 28% of one corpus
  never entered the graph. Repeat that disclosure in anything we publish.
