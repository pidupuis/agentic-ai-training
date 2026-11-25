import { useEffect, useState } from "react";

import { DecisionBadge } from "@/components/DecisionBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BACKEND_DOWN, getJson } from "@/lib/api";
import { CLASSIFICATION_STYLE } from "@/lib/classification";
import { formatDateTime, utcTooltip } from "@/lib/dates";
import type { AuditResponse, Classification, Variant } from "@/types";

// Below this many decisions, a percentage would suggest a precision that is not there.
const MIN_FOR_RATE = 10;

/**
 * The audit trail: every expert decision, newest first, from GET /api/audit.
 *
 * Headline figure: how many decisions agree with the AI (final classification == the
 * AI's), e.g. "1 of 3 decisions agree with the AI". A percentage on a handful of
 * decisions would look like a solid measure: it is only added from MIN_FOR_RATE on.
 * Corrections are new lines, so earlier decisions stay visible: the trail is a history,
 * never edited.
 *
 * Filter chips above the table: `variantIds` are the variants shown (none = all), toggled
 * with `onToggle`, cleared with `onShowAll`. The figure follows the filter.
 * A click on a row opens that variant's analysis (`onOpen`).
 */
export function AuditLog({
  variants,
  variantIds,
  onToggle,
  onShowAll,
  onOpen,
}: {
  variants: Variant[];
  variantIds: string[];
  onToggle: (id: string) => void;
  onShowAll: () => void;
  onOpen: (id: string) => void;
}) {
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetched each time the view opens: always the current trail.
  useEffect(() => {
    getJson<AuditResponse>("/api/audit")
      .then(setAudit)
      .catch(() => setError(BACKEND_DOWN));
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!audit) return <p className="text-muted-foreground">Loading…</p>;

  // Computed here rather than read from audit.agreement, so that it follows the filter
  // (same definition as the backend: final classification == AI classification).
  const filtered = variantIds.length > 0;
  const reviews = filtered
    ? audit.reviews.filter((r) => variantIds.includes(r.variant_id))
    : audit.reviews;
  const total = reviews.length;
  const agreed = reviews.filter((r) => r.final_classification === r.ai_classification).length;
  const name = (id: string) => {
    const v = variants.find((v) => v.id === id);
    return v ? `${v.gene} ${v.protein_short}` : id;
  };

  return (
    <div className="space-y-6">
      <div
        role="group"
        aria-label="Filter by variant"
        className="flex flex-wrap items-center gap-2"
      >
        {variants.map((v) => {
          const on = variantIds.includes(v.id);
          return (
            <Button
              key={v.id}
              size="sm"
              variant={on ? "default" : "outline"}
              aria-pressed={on}
              onClick={() => onToggle(v.id)}
            >
              {name(v.id)}
            </Button>
          );
        })}
        <Button size="sm" variant="ghost" onClick={onShowAll} disabled={!filtered}>
          All variants
        </Button>
      </div>

      {/* Announced to screen readers when the filter changes. */}
      <p aria-live="polite" className="text-sm">
        <span className="text-2xl font-semibold">
          {agreed} of {total}
        </span>{" "}
        <span className="text-muted-foreground">
          decisions agree with the AI
          {total >= MIN_FOR_RATE && ` (${Math.round((agreed / total) * 100)}%)`}
          {filtered ? ` · ${variantIds.map(name).join(", ")}` : " · all variants"}
        </span>
      </p>

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
              // The variant cell is a real button, for keyboard and screen reader users;
              // the whole row is clickable with a mouse (the click bubbles up).
              <tr
                key={r.id}
                onClick={() => onOpen(r.variant_id)}
                className="cursor-pointer border-b align-top hover:bg-muted"
              >
                <td className="py-2 pr-4 whitespace-nowrap">
                  <time dateTime={r.created_at} title={utcTooltip(r.created_at)}>
                    {formatDateTime(r.created_at)}
                  </time>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  <button
                    type="button"
                    aria-label={`Open the analysis of ${name(r.variant_id)}`}
                    className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {name(r.variant_id)}
                  </button>
                </td>
                <td className="py-2 pr-4">
                  <ClassBadge value={r.ai_classification} />
                </td>
                <td className="py-2 pr-4">
                  <DecisionBadge decision={r.decision} />
                </td>
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
