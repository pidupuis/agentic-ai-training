import { CheckIcon, PencilIcon, XIcon } from "lucide-react";

import type { Decision } from "@/types";

/** Wording and icon of each expert decision, the same everywhere on the page. */
export const DECISION_STYLE = {
  accepted: { label: "Accepted", Icon: CheckIcon },
  modified: { label: "Corrected", Icon: PencilIcon },
  rejected: { label: "Rejected", Icon: XIcon },
} satisfies Record<Decision, unknown>;

/** id of the "Your decision" card, the target of the "Needs review ↓" link. */
export const DECISION_FORM_ID = "your-decision";

/** Scroll to the "Your decision" card and move the keyboard focus to it, if shown. */
export function focusDecisionForm(): boolean {
  const form = document.getElementById(DECISION_FORM_ID);
  if (!form) return false;
  form.scrollIntoView({ behavior: "smooth" });
  form.focus({ preventScroll: true });
  return true;
}
