# 03 · Interface rule order

*From [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT). The full
set is 141 UX guidelines + 194 palettes + 74 font pairings across 23 stacks; this file keeps
the ordering and the rules that decide arguments.*

## The order

When you cannot do all of it, do it in this order. This is the priority list, not a checklist.

| # | Category | Impact | The checks that must hold |
|---|---|---|---|
| 1 | **Accessibility** | critical | 4.5:1 contrast (3:1 large), visible focus, alt text, `aria-label` on icon-only controls, keyboard order matches visual order, labels bound with `for`, no meaning by colour alone, `prefers-reduced-motion`, sticky UI never hides the focused control, 24×24px minimum pointer target |
| 2 | **Touch and interaction** | critical | 44×44 targets (48 on coarse pointers), 8px between them, tap not hover for primary actions, feedback within 100ms, disabled button during async, error near the field, `touch-action: manipulation`, no gesture-only critical actions, safe-area padding |
| 3 | **Performance** | high | WebP/AVIF with `srcset`, width/height or `aspect-ratio` on every image (CLS < 0.1), `font-display: swap`, lazy-load below the fold, split by route, batch DOM reads then writes, per-frame work under ~16ms, debounce scroll/resize/input |
| 4 | **Style** | high | one style across the product, SVG icons never emoji, palette from the product not a framework, shadows/radius/effects consistent with the chosen style, light and dark designed together, one primary action per screen |
| 5 | **Layout** | high | viewport meta without `zoom` disabled, mobile-first, systematic breakpoints (375/768/1024/1440), 16px body on mobile, 35–60 chars mobile and 60–75 desktop, no horizontal scroll, 4/8pt spacing scale, one container width, a z-index scale, `min-h-dvh` not `100vh` |
| 6 | **Type and colour** | medium | line-height 1.5–1.75, semantic colour tokens not raw hex in components, dark mode desaturated rather than inverted, tabular figures in data columns, wrap before truncating and reveal the full value when you must truncate, balanced wrapping on short heads |
| 7 | **Animation** | medium | shared motion tokens by distance and context, transform/opacity only, 1–2 animated elements per view, decelerate to arrive and accelerate to leave, a real loading state rather than a flashing spinner, reduced-motion fallback |
| 8 | **Forms** | medium | visible label, helper text, error beside the field, validate on blur not on every keystroke, never placeholder-as-label, never errors only at the top, progressive disclosure over a wall of fields |
| 9 | **Navigation** | high | predictable back, bottom nav ≤5 items, deep links, no overloaded nav, no nested scroll traps |
| 10 | **Charts and data** | low | legend, tooltip, accessible colours, never colour alone to carry meaning, a title that never wraps |

## Rules that settle arguments

- **Identity is not a cheat code.** Brand chrome must still clear contrast and target size. A
  gorgeous page a keyboard user cannot use is a failed page, and our product exists to say so.
- **Prefer the platform.** Native controls, native validation, native date pickers, native
  scroll. Customise only where the brand truly requires it, and keep the semantics underneath.
- **Two states are not enough.** Every control has: rest, hover, focus-visible, active, disabled,
  loading, error, success. Missing states are the most common gap in generated UI.
- **Reserve space for everything async.** Skeletons and fixed heights, never a jump.
- **A spinner past 1s is a bad answer.** Skeleton for content, progress for jobs, and for our
  audits: stream findings as they land rather than holding the whole page.
- **Dark mode is designed, not inverted.** Desaturate, then re-check contrast separately.

## Stack notes we will actually need

Detect the stack from the repo before applying stack-specific guidance — never assume one.
For this product the likely set is **nextjs** (or **react** + **shadcn**), **html-tailwind**
for the report page, and **html** alone for the artefact we hand a customer. The stack rules
change the implementation, not the ordering above.

## Anti-patterns, as a single list

Removing focus rings. Icon-only buttons with no name. Hover as the only affordance. 0ms state
changes. Emoji as icons. Random shadow values. Fixed px container widths. Disabled zoom.
Placeholder-only labels. Errors only at the top of a form. Nested scroll regions. One duration
for every transition. Animating width or height. A carousel that cannot be paused. Colour as
the only carrier of meaning. All of these are also audit-rule candidates for the product.
