import { Link } from "@tanstack/react-router";

import { CLASSIFICATION_STYLE } from "@/lib/classification";
import { DecisionBadge } from "@/components/DecisionBadge";
import { cn } from "@/lib/utils";
import type { Review, Variant } from "@/types";
import type { Run } from "@/useAgentStream";

/**
 * Top row: one card per variant, each a link to /variants/{id}. The open one is raised
 * (white, with a shadow; the Link marks it aria-current="page"); the others stay flat.
 *
 * Each card says where the variant stands in the review: "Needs review", "✓ Accepted ·
 * Oncogenic", "✎ Corrected → Insufficient evidence", "✕ Rejected". Before the expert's
 * decision it never hints at the AI's answer, so the expert's judgment is not biased.
 *
 * `reviews`: the latest decision about each variant's CURRENT run, null if none.
 */
export function VariantList({
  variants,
  selectedId,
  runs,
  reviews,
}: {
  variants: Variant[];
  selectedId: string | null;
  runs: Record<string, Run>;
  reviews: Record<string, Review | null>;
}) {
  return (
    <ul aria-label="Variants" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {variants.map((v) => {
        const on = v.id === selectedId;
        return (
          <li key={v.id}>
            <Link
              to="/variants/$variantId"
              params={{ variantId: v.id }}
              className={cn(
                "block h-full w-full rounded-xl border px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                // Open: a raised white card. Others: flat on the page, white on hover.
                on ? "border-transparent bg-card shadow-md" : "hover:bg-card/60",
              )}
            >
              <div className="font-medium">
                {v.gene} {v.protein_short}
              </div>
              <ReviewStatus run={runs[v.id]} review={reviews[v.id]} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ReviewStatus({ run, review }: { run?: Run; review: Review | null }) {
  const muted = "text-xs text-muted-foreground";
  if (run?.status === "running") return <div className={muted}>Analyzing…</div>;
  if (run?.status === "error") return <div className="text-xs text-destructive">Failed</div>;
  if (run?.status !== "done") return <div className={muted}>Not analyzed</div>;
  if (!review) return <div className="text-xs font-medium">Needs review</div>;

  const final = review.final_classification && CLASSIFICATION_STYLE[review.final_classification];
  return (
    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      <DecisionBadge decision={review.decision} />
      {final && (review.decision === "modified" ? `→ ${final.label}` : final.label)}
    </div>
  );
}
