/**
 * Basic accessibility rules (PRD FR-09).
 *
 * Three checks that can be made from the served HTML alone: images have alt text, links have an
 * accessible name, form fields have a label. They are not a WCAG audit and the report must never
 * present them as one — but they are measurable, evidence-carrying, and they catch the defects that
 * actually appear on agency sites.
 *
 * Alt text is filed under accessibility rather than SEO: the same omission is both, and one finding
 * that names the reader it affects is more useful than two that split the blame.
 */

import { findingFor, type AuditRule } from "../types.js";

export const ACCESSIBILITY_RULES: readonly AuditRule[] = [
  {
    code: "images-missing-alt",
    category: "accessibility",
    scope: "page",
    run: (context) => {
      const { images, imagesWithoutAlt } = context.parsed;
      if (images === 0 || imagesWithoutAlt === 0) return [];
      return [
        findingFor(context, "page", {
          code: "images-missing-alt",
          category: "accessibility",
          title: "Images have no alternative text",
          severity: "medium",
          description:
            "A screen reader announces an image by its alt text. Without one the reader hears nothing, or hears the file name, and loses whatever the image carried.",
          evidence: `${imagesWithoutAlt} of ${images} image elements have no alt attribute.`,
          recommendation:
            'Describe each image\'s purpose in its alt attribute, or use alt="" for decoration.',
        }),
      ];
    },
  },
  {
    code: "links-without-text",
    category: "accessibility",
    scope: "page",
    run: (context) => {
      const count = context.parsed.linksWithoutText;
      if (count === 0) return [];
      return [
        findingFor(context, "page", {
          code: "links-without-text",
          category: "accessibility",
          title: "Links have no accessible name",
          severity: "medium",
          description:
            "A link made only of an icon or an image needs a text alternative. Without one a screen reader announces a link with no destination name, so the reader cannot decide whether to follow it.",
          evidence: `${count} link element(s) have no text, aria-label, title or image alt.`,
          recommendation:
            "Give each link visible text, an aria-label, or an image with descriptive alt text inside it.",
        }),
      ];
    },
  },
  {
    code: "inputs-without-label",
    category: "accessibility",
    scope: "page",
    run: (context) => {
      const count = context.parsed.inputsWithoutLabel;
      if (count === 0) return [];
      return [
        findingFor(context, "page", {
          code: "inputs-without-label",
          category: "accessibility",
          title: "Form fields have no label",
          severity: "high",
          description:
            "A field without a label is announced as an unnamed edit box. A screen reader user cannot know what to type, and a voice-control user cannot target the field at all.",
          evidence: `${count} input(s) are not associated with a <label>, aria-label or aria-labelledby.`,
          recommendation:
            "Associate every field with a label element, or add aria-label when the design has no visible label.",
        }),
      ];
    },
  },
];

export const ACCESSIBILITY_RULE_CODES: readonly string[] = ACCESSIBILITY_RULES.map((rule) => rule.code);
