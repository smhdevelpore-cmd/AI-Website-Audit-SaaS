# Interface foundation (Phase 3)

The app shell, design tokens, shared components and the screens that exist so far. Every screen
that would need scan data shows a truthful status or an empty state instead of a number.

Phase 4 added the write path: a New Audit dialog, an audit list backed by the API, an audit page
that polls while the scan is live, and cancellation for queued audits. Data fetching is TanStack
Query; see §8.

- Tokens: `apps/web/src/styles/index.css`
- Components: `apps/web/src/components/ui/`
- Shell: `apps/web/src/components/AppShell.tsx`
- Pages: `apps/web/src/pages/`
- Tests: `tests/component/*.test.tsx`, `tests/unit/design-tokens.test.ts`, `tests/unit/site-url.test.ts`

## 1. Tokens, and the contrast decision

`docs/Design.md` §2 proposes `primary #53B107` and §7 requires sufficient contrast. Those two
statements disagree: white text on that green measures **2.74:1**, below the 4.5:1 that body text
needs.

Phase 3 was issued with the instruction to *prioritise accessible contrast*. The green is kept
exactly as specified; what changed is the colour of the text on it, and the status colours, which
are now split into a fill and a text-safe variant.

| Token | Value | Used for | Measured |
|---|---|---|---|
| `ink` | `#17202A` | body text | 16.45:1 on surface, 15.48:1 on canvas |
| `muted` | `#667085` | secondary text | 4.97:1 on surface, 4.68:1 on canvas |
| `primary` | `#53B107` | primary button fill | — |
| `on-primary` | `#17202A` | text on the primary fill | **6.00:1** (Design's white would be 2.74:1) |
| `primary-strong` | `#2F6B03` | green as text, links | 6.51:1 on surface |
| `critical` / `critical-strong` | `#DC2626` / `#B42318` | fill with white text / text on tint | 4.83:1 / 5.45:1 |
| `warning` / `warning-strong` | `#D97706` / `#92400E` | icon fill only / text on tint | 3.19:1 / 6.37:1 |
| `success` / `success-strong` | `#16A34A` / `#15803D` | fill only / text on tint | 3.30:1 / 4.57:1 |
| `line` / `line-strong` | `#E5E7EB` / `#868F9E` | separators / control borders | 1.24:1 / **3.26:1** |

`line` is deliberately low-contrast: it is only ever a decorative separator. A control's border
uses `line-strong`, because WCAG 1.4.11 requires 3:1 for the visible edge of a control.

Badges never rely on colour: each carries a word ("Completed", "Partial", "Failed"), which is
also what `Design.md` §7 asks for.

All of the above is asserted in `tests/unit/design-tokens.test.ts`, which parses the shipped CSS
and recomputes each ratio. A palette edit that drops a pair below its threshold fails the build.

Typography uses the system UI stack rather than fetching Inter: one less render-blocking request,
and `Design.md` allows "or similar". The stack is set once in `--font-sans`.

## 2. Components

`apps/web/src/components/ui/`

| Component | What it guarantees |
|---|---|
| `Button` | real `<button>`, `type="button"` unless told otherwise, `loading` disables and sets `aria-busy` while keeping the label |
| `Input` | `label` is a required prop; hint and error are wired through `aria-describedby`; error sets `aria-invalid`; `required` renders an asterisk *outside* the label text so the accessible name stays "Email" |
| `PasswordInput` | show/hide as a named, `aria-pressed` toggle |
| `Card` | surface, radius, padding from tokens |
| `Badge` | tint + text; meaning never carried by colour alone |
| `Dialog` | `role="dialog"`, `aria-modal`, named by its title, focus moves in, Tab is trapped, Escape closes, focus returns to the opener, page scroll locked |
| `Toast` | polite live region, per-toast dismiss buttons with names |
| `Skeleton` | `aria-hidden`; the surrounding region announces the loading state in words |
| `EmptyState` | optional action — a state with nothing to do renders no button |
| `ErrorState` | `role="alert"`, optional single retry |
| `PageHeader` | the screen's only `<h1>` |
| `Table` (`DataTable`) | caption, column headers, and a labelled card list below 640px |

## 3. Screens

| Route | State |
|---|---|
| `/` | landing: hero, illustrative report layout, features, three steps, audience, limits, footer |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | wired to the Phase 2 auth operations |
| `/dashboard` | profile + five most recent audits; empty state offers "Run your first audit" |
| `/audits` | real list: search, status filter, pagination, per-row status/stage, cancel for queued rows |
| `/audits/:id` | one audit: status, stage, timestamps, failure reason; polls every 2 s while live, then stops |
| `/settings` | real profile form: `PATCH /profile`, loading, retry, per-field errors, success |
| `/dev/ui` | component gallery, **development builds only**, every row labelled a fixture |
| anything else | 404 with a way back |

The landing page's address field is checked for typing mistakes only (`apps/web/src/lib/site-url.ts`)
and hands the address to sign-up. The server's SSRF gate is the real check, and `packages/validation`
cannot run in a browser at all (it imports `node:net` and `node:dns`) — an earlier version of this
page imported it and Vite externalised those modules, which would have broken the page at runtime.

## 4. What this phase deliberately does not build

Design.md §3 says not to show unfinished sections, and §11 forbids dead controls. Both point the
same way:

- **No dashboard metric cards, no score gauge, no findings list.** They need a scan to produce
  them; the overview shows recent audits and lets the empty state speak.
- **No usage counters in settings.** The daily limit is enforced server-side and surfaces as a
  429 with its own sentence, which is where it belongs.
- **No "re-audit" button.** It creates a second audit; PRD FR-16 puts it with results, and results
  do not exist yet.
- **No search or filters when the list is empty.** A filter over nothing is noise, so the controls
  only render once there is something to filter.

The one place fixture rows exist is `/dev/ui`, which is excluded from production builds
(`import.meta.env.DEV`) and says on screen that its rows are fixtures. Every row on every real
screen comes from `GET /api/v1/audits`.

## 5. Accessibility, and how it is checked

`tests/component/a11y.test.tsx` renders each page inside the router and providers, then inspects
the DOM:

- every `input`, `select` and `textarea` has a label association, `aria-label` or `aria-labelledby`;
- every `button` and link has an accessible name;
- no link points at `#`, an empty href, or a route this app does not define;
- every image has `alt`;
- the landing page has exactly one `<h1>`.

Keyboard behaviour is tested rather than asserted in prose: dialog focus moves in, Tab stays
inside, Escape closes, focus returns; the mobile drawer opens with `aria-expanded`, closes on
Escape, and closes after navigating from it. Reduced motion is handled in CSS
(`prefers-reduced-motion`).

## 6. Data fetching

TanStack Query, one client (`lib/query-client.ts`), one module per resource (`lib/audits.ts`).

| Behaviour | Choice | Why |
|---|---|---|
| Retries | 1 | A dropped connection is worth one more try; a dead API should not cost 30 seconds of spinner |
| `refetchOnWindowFocus` | off | A list that rewrites itself while someone reads it is worse than a slightly stale row |
| List pagination | `keepPreviousData` | Paging should not blank the table |
| Live audit | poll every 2 s, stop at a terminal status | The only thing on the site that changes without a user action |
| After a mutation | invalidate `["audits"]` | One rule, so no screen shows a stale copy |

The dialog validates the address with `checkSiteAddress` before submitting, and then obeys the
server: a 422 puts the server's sentence under the field, a 503 says nothing was queued.

## 7. Responsive

- `<640px`: single column, tables become labelled cards, the sidebar becomes a top bar with a
  drawer, dialogs slide from the bottom.
- `640–1023px`: two-column forms, stacked cards.
- `≥1024px`: fixed sidebar and a centred content column (max 5xl).

## 8. Testing notes

Component tests run under jsdom (`// @vitest-environment jsdom` per file), so the other suites keep
the faster Node environment. There is no `jest-dom`, no snapshot testing and no CSS assertions:
the tests check roles, names, states and behaviour, which is what a user perceives and what a
styling change should not break.

Not covered: real browser rendering, actual pixel layout, Safari/Firefox differences, and a
manual screen-reader pass. Those need a browser, which this environment does not have.
