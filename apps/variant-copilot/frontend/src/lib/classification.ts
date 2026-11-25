import type { Classification } from "@/types";

/**
 * Label and color of each classification, shared by the annotation card, the review
 * panel and the audit log.
 *
 * Color is reserved for meaning: red (oncogenic) to green (benign), grey when undecided.
 * Full class names on purpose: Tailwind only generates classes it can find written out,
 * so a name built at runtime like `bg-${color}-100` would never exist.
 * Record<Classification, ...> forces an entry for every class: adding one to types.ts
 * makes TypeScript point here.
 */
export const CLASSIFICATION_STYLE: Record<Classification, { label: string; className: string }> = {
  oncogenic: { label: "Oncogenic", className: "bg-red-100 text-red-800" },
  likely_oncogenic: { label: "Likely oncogenic", className: "bg-orange-100 text-orange-800" },
  vus: { label: "VUS", className: "bg-neutral-200 text-neutral-800" },
  likely_benign: { label: "Likely benign", className: "bg-lime-100 text-lime-800" },
  benign: { label: "Benign", className: "bg-green-100 text-green-800" },
  insufficient_evidence: {
    label: "Insufficient evidence",
    className: "bg-neutral-200 text-neutral-800",
  },
};

/** The 6 classes in scale order, e.g. for a select. */
export const CLASSIFICATIONS = Object.keys(CLASSIFICATION_STYLE) as Classification[];
