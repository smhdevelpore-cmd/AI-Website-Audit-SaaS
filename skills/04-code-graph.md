# 04 · Navigating the code

*From [graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0). The tool is optional;
the discipline is not.*

## The discipline

Search beats reading only when you know what you are looking for. Understanding needs structure:
which module owns this, what calls it, what breaks if I move it, where the doc that explains it
lives. Build the map when the map earns its keep, then query the map instead of grepping the
world.

## Decide first: query, search, or build

| The question | Do this |
|---|---|
| "where is X defined", "what calls Y", one known symbol | **Search.** `grep -rn` and read the file. A graph is a detour. |
| Many questions against a large or unfamiliar corpus | **Build a graph.** Then query. |
| Links text search cannot see: doc → code, ADR → module, import cycles, communities | **Build a graph.** |
| The repo already has `graphify-out/graph.json` | **Query it first.** Do not re-detect, do not re-read files. |

## How to build it, when we want it

```bash
uv tool install graphifyy           # Python 3.11.5–3.14, needs uv or pipx
graphify install                   # wires it into the assistant
/graphify .                        # → graphify-out/{graph.html, GRAPH_REPORT.md, graph.json}
```

Code is parsed with tree-sitter locally: deterministic, no LLM, nothing leaves the machine.
Docs, PDFs, images and video take a semantic pass and cost tokens — scope those deliberately.
After changing code: `graphify update .` (AST only, free).

## How to read it

```bash
graphify query "how does an audit run reach the database"   # broad, BFS
graphify query "where is rate limiting applied" --dfs       # trace one path
graphify path "AuditRunner" "Postgres"                      # how two things connect
graphify explain "ScoreRegistry"                            # one node, plainly
```

Every edge is tagged. This is the part worth copying into our own thinking:

- **EXTRACTED** — explicit in the source. An import, a call, an explicit reference.
- **INFERRED** — resolved by the tool. Probably true, not stated.
- **AMBIGUOUS** — the tool guessed between candidates.

A path is only as certain as its weakest hop. Never present an inferrable link as a fact, in
code review or in an audit report. Same rule as sourcing a claim.

Nodes worth knowing about: **god nodes** (everything flows through them — changing one is a
wide change), **communities** (subsystems as the graph actually splits, not as the folders
claim), and **rationale nodes** (`NOTE:` / `WHY:` comments and ADRs become first-class, which is
why those comments are worth writing).

## What this becomes for our product

The same technique is the audit engine's spine. A site is a graph too: page → asset → script →
third-party origin. Walk it once, keep it as data, and every check runs against the graph
instead of re-fetching the site. Findings become edges with provenance: *observed*,
*inferred* or *not testable*. That is the honest version of a score.

## Boundaries

- The graph is a map, never the code. Open the file before you change it.
- When the task is about the graph's own correctness, the graph is not evidence.
- Never commit `graphify-out/` unless we decide to ship a map; it is derived data.
