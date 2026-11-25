import { Badge } from "@/components/ui/badge";
import { DECISION_STYLE } from "@/lib/decision";
import type { Decision } from "@/types";

/** "✓ Accepted", "✎ Corrected", "✕ Rejected", in the decision's color. */
export function DecisionBadge({ decision }: { decision: Decision }) {
  const { label, Icon, fill } = DECISION_STYLE[decision];
  return (
    <Badge className={fill}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}
