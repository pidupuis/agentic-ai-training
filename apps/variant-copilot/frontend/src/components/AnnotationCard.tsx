import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceList } from "@/components/EvidenceList";
import { CLASSIFICATION_STYLE } from "@/lib/classification";
import type { EmptySearch } from "@/lib/sources";
import { pubmedResults } from "@/lib/sources";
import { cn } from "@/lib/utils";
import type { AgentEvent, Annotation } from "@/types";

/**
 * The agent's proposal: classification, evidence strength, summary, the searches that
 * found nothing, evidence, conflicts. Only the AI's work: the expert's decision is
 * outside this card (a band above it once decided, a form below it before).
 *
 * `events` (the run's trace) gives what the tools really returned: article details and
 * empty searches. `actions` (Replay, Re-analyze) sit in the card header; without an
 * annotation yet (never analyzed, or failed), the card shows `placeholder` instead.
 */
export function AnnotationCard({
  annotation,
  events,
  actions,
  placeholder,
}: {
  annotation: Annotation | null;
  events: AgentEvent[];
  actions?: ReactNode;
  placeholder?: ReactNode;
}) {
  const style = annotation && CLASSIFICATION_STYLE[annotation.classification];
  const { articles, emptySearches } = pubmedResults(events);
  // For an undecided class (VUS, insufficient evidence), "high" would read as "surely a
  // VUS": the strength of the evidence is only shown for a decided class.
  const showStrength =
    annotation && !["vus", "insufficient_evidence"].includes(annotation.classification);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">AI proposal</span>
          {annotation && style && (
            <Badge className={cn("text-sm", style.className)}>{style.label}</Badge>
          )}
          {annotation && showStrength && (
            <Badge variant="outline">Evidence strength: {annotation.confidence}</Badge>
          )}
        </CardTitle>
        {actions && <CardAction className="flex gap-2">{actions}</CardAction>}
      </CardHeader>
      <CardContent className="space-y-4">
        {annotation ? (
          <>
            <p className="max-w-prose leading-relaxed">{annotation.summary}</p>
            <ConflictsBox conflicts={annotation.conflicts} />
            <EmptySearches searches={emptySearches} />
            <EvidenceList
              evidence={annotation.evidence}
              articles={articles}
              // Already listed under "Searched, nothing found".
              hiddenUrls={new Set(emptySearches.map((s) => s.url))}
            />
          </>
        ) : (
          placeholder
        )}
      </CardContent>
    </Card>
  );
}

/**
 * PubMed searches that returned 0 articles, in a discreet block apart from the evidence:
 * an absence of evidence is not evidence. Each query links to its PubMed search page,
 * so the expert can rerun it.
 */
function EmptySearches({ searches }: { searches: EmptySearch[] }) {
  if (searches.length === 0) return null;
  return (
    <section className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <h4 className="mb-1 font-medium">Searched PubMed, nothing found</h4>
      <ul className="space-y-1">
        {searches.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs break-all underline-offset-4 hover:underline"
            >
              {s.query}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Disagreements between sources. Warning (sahara), and hidden when there are none. */
function ConflictsBox({ conflicts }: { conflicts: string[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="rounded-md border border-warning bg-warning/15 px-3 py-2 text-sm">
      <div className="mb-1 font-medium">Conflicting evidence</div>
      <ul className="list-disc space-y-1 pl-5">
        {conflicts.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
