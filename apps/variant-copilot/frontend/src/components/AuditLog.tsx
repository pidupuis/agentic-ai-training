import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLASSIFICATION_STYLE } from "@/lib/classification";
import { formatDateTime, utcTooltip } from "@/lib/dates";
import type { AuditResponse, Classification, Variant } from "@/types";

/**
 * The audit trail: every expert decision, newest first, from GET /api/audit.
 *
 * Headline figure: the agreement rate between the AI and the experts, i.e. the share of
 * decisions whose final classification is the AI's. Corrections are new lines, so
 * earlier decisions stay visible: the trail is a history, never edited.
 *
 * `variantId` filters the trail to one variant (selected in the left list);
 * `onShowAll` clears the filter. The agreement rate follows the filter.
 */
export function AuditLog({
  variants,
  variantId,
  onShowAll,
}: {
  variants: Variant[];
  variantId: string | null;
  onShowAll: () => void;
}) {
  const [audit, setAudit] = useState<AuditResponse | null>(null);

  // Fetched each time the view opens: always the current trail.
  useEffect(() => {
    fetch("/api/audit")
      .then((r) => r.json())
      .then(setAudit);
  }, []);

  if (!audit) return <p className="text-muted-foreground">Loading…</p>;

  // Computed here rather than read from audit.agreement, so that it follows the filter
  // (same definition as the backend: final classification == AI classification).
  const reviews = variantId
    ? audit.reviews.filter((r) => r.variant_id === variantId)
    : audit.reviews;
  const total = reviews.length;
  const agreed = reviews.filter((r) => r.final_classification === r.ai_classification).length;
  const rate = total ? agreed / total : null;
  const name = (id: string) => {
    const v = variants.find((v) => v.id === id);
    return v ? `${v.gene} ${v.protein_short}` : id;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{variantId ? name(variantId) : "All variants"}</span>
        {variantId && (
          <Button size="sm" variant="ghost" onClick={onShowAll}>
            Show all variants
          </Button>
        )}
      </div>
      <div>
        <div className="text-3xl font-semibold">
          {rate === null ? "—" : `${Math.round(rate * 100)}%`}
        </div>
        <div className="text-sm text-muted-foreground">
          AI–expert agreement ({agreed} of {total} decisions)
        </div>
      </div>

      {total === 0 ? (
        <p className="text-muted-foreground">No decision yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Variant</th>
              <th className="py-2 pr-4 font-medium">AI proposal</th>
              <th className="py-2 pr-4 font-medium">Decision</th>
              <th className="py-2 pr-4 font-medium">Final</th>
              <th className="py-2 pr-4 font-medium">Comment</th>
              <th className="py-2 font-medium">Reviewer</th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="py-2 pr-4 whitespace-nowrap">
                  <time dateTime={r.created_at} title={utcTooltip(r.created_at)}>
                    {formatDateTime(r.created_at)}
                  </time>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">{name(r.variant_id)}</td>
                <td className="py-2 pr-4">
                  <ClassBadge value={r.ai_classification} />
                </td>
                <td className="py-2 pr-4">{r.decision}</td>
                <td className="py-2 pr-4">
                  {r.final_classification ? <ClassBadge value={r.final_classification} /> : "—"}
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{r.comment || "—"}</td>
                <td className="py-2">{r.reviewer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ClassBadge({ value }: { value: Classification }) {
  const style = CLASSIFICATION_STYLE[value];
  return <Badge className={style.className}>{style.label}</Badge>;
}
