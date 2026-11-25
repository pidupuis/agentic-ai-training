import { CheckIcon, PencilIcon, XIcon } from "lucide-react";

import type { Decision } from "@/types";

/**
 * Wording, icon and color of each expert decision, the same everywhere on the page:
 * menthe (accepted), sahara (corrected), corail-deep (rejected).
 * `fill`: buttons and badges, with a text color that passes WCAG AA on it.
 * Full class names on purpose: Tailwind only generates classes written out in full.
 */
export const DECISION_STYLE = {
  accepted: {
    label: "Accepted",
    Icon: CheckIcon,
    fill: "bg-menthe text-foreground hover:bg-menthe/80",
  },
  modified: {
    label: "Corrected",
    Icon: PencilIcon,
    fill: "bg-sahara text-foreground hover:bg-sahara/80",
  },
  rejected: {
    label: "Rejected",
    Icon: XIcon,
    fill: "bg-corail-deep text-white hover:bg-corail-deep/80",
  },
} satisfies Record<Decision, unknown>;

/** id of the "Your decision" card, the target of the "Needs review ↓" button. */
export const DECISION_FORM_ID = "your-decision";

/** Scroll to the "Your decision" card and move the keyboard focus to it, if shown. */
export function focusDecisionForm(): boolean {
  const form = document.getElementById(DECISION_FORM_ID);
  if (!form) return false;
  form.scrollIntoView({ behavior: "smooth" });
  form.focus({ preventScroll: true });
  return true;
}
