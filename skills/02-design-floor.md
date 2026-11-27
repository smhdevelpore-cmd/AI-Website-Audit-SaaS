# 02 · The design floor

*From [hallmark](https://github.com/Nutlope/hallmark) (MIT, by Together AI). Distilled; the
full gate table lives in the upstream `references/gates.md`.*

The floor is a hard minimum against the defaults a model was trained into. Above the floor the
page is yours: you are a capable designer.

Three tiers decide whether you may disagree with a rule:

- **Floor** — never waivable. Correctness, access, honesty, and the house bans.
- **Reflex** — a default models fall into. Waive one *on the record*, with a real reason and
  the evidence that the guard holds. Three waivers of the same gate is a house style: put it
  in the design system, not in a comment.
- **Finish** — craft detail, invisible at arm's length. Answered, never blocking.

Nothing ships with an open Floor finding or an unanswered Reflex finding.

## The Floor

1. **Every colour and every font goes through a token.** No literal hex outside the token
   block. This is also how the app's theming and the audit report share a look.
2. **Never `transition: all`. Never animate `width`, `height`, `top` or `left`.** Transform and
   opacity only.
3. **Never one italic word inside a roman heading.**
4. **`overflow-x: clip` on `html` and `body`.** Never `hidden` (it kills sticky), never `100vw`.
5. **Image-bearing grid tracks are `minmax(0, 1fr)`**; display heads carry
   `overflow-wrap: break-word; min-width: 0`. Long tokens, URLs and user content reflow with
   `overflow-wrap: anywhere`, never `word-break: break-all` on prose.
6. **Every interactive element has `:focus-visible`, appearing instantly.** Never animate a
   focus ring away, never remove one because it "looks cleaner".
7. **Every animation has a `prefers-reduced-motion: reduce` fallback**, and content is visible
   with scripting off. Reveal the safe way: the hidden state behind a `.js` class that the
   script adds — never a default `opacity: 0` in the stylesheet.
8. **Never an invented metric, testimonial, logo wall, case-study count or screenshot.** A
   number nobody gave is absent, not estimated. This binds the product too: an audit report may
   never show a score we did not compute.
9. **Never an eyebrow, and never a tracked-caps label.** A small uppercase, letter-spaced line
   above a heading is the single loudest tell of a generated page. Labels, captions, table
   heads, tags and nav links are the body face, one step smaller, sentence case, untracked.
10. **Never middle-dot-joined meta strings, arrows glued to link text, or decorative status dots.**
11. **Never a purple-to-blue gradient, a card inside a card, an emoji as an icon, or a
    hand-drawn browser/OS window.**
12. **The hero says everything it has to say at 1280 × 800 without scrolling:** headline, one
    sentence, primary action.
13. **About 80 words on any one screen.** Fullness comes from scale and pictures, never from
    more words.
14. **The container is capped and centred.** At 1920 the gutters grow; the measure and the
    grids do not.
15. **`dvh`/`svh`, never `vh` for a hero.**
16. **Line one of the stylesheet is the stamp.** See below.

## The Reflex tells worth naming

Each of these is what a model reaches for when it has nothing to say. Recognise it, then
choose on purpose.

**Colour.** Zero-chroma neutrals on a page with an anchor hue (breathe 0.005 chroma into the
greys). `#000` / `#fff` used as a colour (tint toward the hue). The accent covering more than
~5% of a viewport (retreat, or declare a posture for it). Aurora/mesh blobs, floating blurred
orbs, a chromatic halo behind text, or a zero-offset coloured glow on dark — elevation comes
from lightness and offset shadows. A framework's stock palette (Tailwind `indigo-500`,
`violet-600`, `slate-900`) as a token. Gradient text, unless it is a single-hue ramp inside
the same family. Cream paper + high-contrast serif + terracotta: the most recognised generated
look there is; move one axis.

**Type.** Inter, Roboto, Open Sans, Poppins or a system face *as the display*. Prose measure
outside 45–75ch. More than three families. One accented word in a headline. Monospace used as
costume on labels and meta rather than because the material is code. Running text under 12px,
functional text under 11px, prose leaded under 1.3.

**Structure.** Three equal columns of icon-above-heading tiles. An icon in a rounded tile above
a heading. A thick coloured side stripe on a card. Every section separated the same way with
the same gap. The stock anatomy: hero, three features, call to action, footer. A hero where
title, lede, action and mark all sit on one centred axis.

**Honesty.** A form that answers "Sent" to nobody. A page that promises material it does not
have by showing empty frames. Repetition of the same fact in the hero, on the cards, in the FAQ
and the footer.

## Craft: the parts that carry the quality

**Copy.** Write as the owner would say it across a counter. The swap test: a headline that would
work on a competitor's page gets rewritten with a noun only this product has. *Software that
works for you* fits anyone; *Invoices that chase themselves* fits one product. Three tests a
line: can the reader picture it, could it be proven false, could only this business say it.
Section heads say what the visitor will see, never a category label (*Features*, *Why us*). No
triads of adjectives, no *reimagine*, no *journey*, no *game-changer*, no colon title.

**Budget.** Headlines seven words or fewer. Section heads six or fewer. Section intros one line.
Paragraphs two short sentences. Lists four items. Tables five rows. 450 visible words a page.

**Motion.** Hover is one signal that raises contrast. Tooltips 800–1000ms on hover, 0 on focus.
No parallax, no custom cursors, no marquee that will not pause, no pulsing dot, no infinite
loop except a loader, no ambient loop faster than 8s. Every loop stops under reduced motion and
off-screen.

**Controls.** One filled primary per screen. Marketing controls 44–52px; app UI 32–40px with a
44px hit target. One primary button style, one container width, one column gap, one radius per
nesting level. An input matches the button beside it. Every `<button>` gets an explicit `type`.
Disabled means `opacity: .55` *and* `cursor: not-allowed` *and* the native attribute.

**The document.** `lang`, a `<title>` in the page's own words, a one-sentence meta description,
heading levels stepping one at a time, every `<img>` with `width`, `height` and a real file.
Punctuation in page copy: curly quotes, real apostrophes, `…`, and no em or en dash (this rule
binds what we ship, not these internal notes).

## Before you emit: the critique

Score the planned screen 1–5 on six axes. Anything under 3 is revised before you build, not
after.

| Axis | 3 | 5 |
|---|---|---|
| **P**hilosophy | has a tone | has an argument a reader could disagree with |
| **H**ierarchy | needs a second look | survives the squint test |
| **E**xecution | two or three loose details | would pass the gates first time |
| **S**pecificity | fits the category | could belong to no other product |
| **R**estraint | keeps one decoration too many | lost something you liked |
| **V**ariety | differs from the last build on three axes | shares almost nothing with it |

Name the weakest axis and the fix taken. Straight 5s name what was cut to earn them. Never
invent a weakness to fill the field.

## The stamp

Line one of our stylesheet records the decisions, so the next session inherits reasons rather
than vibes:

```css
/* Hallmark · Redline v0 · genre modern-minimal · surface: tinted paper · accent: one hue, ~4% · display: [face] · body: [face] · waive 64 · the diff view is code, mono is the material */
```

Add a `waive`, `answered` or `dismissed` line for each departure, naming the gate, the evidence
and the reason. A fabricated pass is itself slop.

The literal word `Hallmark` must start that comment: the linter keys on it, and it is also
honest credit for the gate system we are using. Keep your project name after it.

## The linter

`tools/sloplint/` is the upstream checker, vendored unchanged (MIT, zero dependencies, Node 18+).
The floor is only a floor while something can fail you against it:

```bash
node tools/sloplint/sloplint.mjs index.html --genre modern-minimal
```

`--render` (screenshots, eight widths) needs a headless Chrome; the static tier does not, and it
catches most of the Floor. Fix every `FAIL`, fix or waive every `REFLEX`, answer every `WARN`.
`REFLEX` and `WARN` ids map to the gate numbers in the upstream `references/gates.md`.
