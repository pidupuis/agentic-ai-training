import { Badge } from "@/components/ui/badge";
import { DECISION_STYLE } from "@/lib/decision";
import type { Decision } from "@/types";

/** "✓ Accepted", "✎ Corrected", "✕ Rejected": neutral, color stays for classifications. */
export function DecisionBadge({ decision }: { decision: Decision }) {
  const { label, Icon } = DECISION_STYLE[decision];
  return (
    <Badge variant="outline">
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}
