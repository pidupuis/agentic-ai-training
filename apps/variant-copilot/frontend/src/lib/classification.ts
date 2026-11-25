import type { Classification } from "@/types";

/**
 * Label and color of each classification, shared by the annotation card, the review
 * panel and the audit log.
 *
 * Color is reserved for meaning, with the brand palette (index.css): corail-deep
 * (oncogenic) through sahara to menthe (benign), fantome when undecided. Full-strength
 * fills, with the text color that passes WCAG AA on each (white on corail-deep, graphite
 * on the others).
 * Full class names on purpose: Tailwind only generates classes it can find written out,
 * so a name built at runtime like `bg-${color}-100` would never exist.
 * Record<Classification, ...> forces an entry for every class: adding one to types.ts
 * makes TypeScript point here.
 */
export const CLASSIFICATION_STYLE: Record<Classification, { label: string; className: string }> = {
  oncogenic: { label: "Oncogenic", className: "bg-corail-deep text-white" },
  likely_oncogenic: { label: "Likely oncogenic", className: "bg-sahara text-foreground" },
  vus: { label: "VUS", className: "bg-fantome text-foreground" },
  likely_benign: { label: "Likely benign", className: "bg-menthe/50 text-foreground" },
  benign: { label: "Benign", className: "bg-menthe text-foreground" },
  insufficient_evidence: {
    label: "Insufficient evidence",
    className: "bg-fantome text-foreground",
  },
};

/** The 6 classes in scale order, e.g. for a select. */
export const CLASSIFICATIONS = Object.keys(CLASSIFICATION_STYLE) as Classification[];
