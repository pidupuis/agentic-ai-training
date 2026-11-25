import { Badge } from "@/components/ui/badge";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { Article } from "@/lib/sources";
import type { Evidence } from "@/types";

// Display order and wording: "for" first, since it is what the classification rests on.
const GROUPS: { direction: Evidence["direction"]; label: string }[] = [
  { direction: "supports_pathogenic", label: "Supports oncogenicity" },
  { direction: "supports_benign", label: "Supports benign" },
  { direction: "neutral", label: "Context" },
];

/**
 * The evidence behind the annotation, grouped by direction.
 * Every item links to its source (Ensembl or PubMed), opened in a new tab: the expert
 * can check any claim in one click. A PubMed article shows its PMID, year and journal
 * (from `articles`, what the tool returned), the first things an expert checks.
 * Items whose url is in `hiddenUrls` are left out (shown elsewhere).
 */
export function EvidenceList({
  evidence,
  articles,
  hiddenUrls,
}: {
  evidence: Evidence[];
  articles: Map<string, Article>;
  hiddenUrls: Set<string>;
}) {
  const shown = evidence.filter((e) => !hiddenUrls.has(e.url));
  if (shown.length === 0) return null;
  return (
    <TraceCollapsible defaultOpen>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceTitle>{shown.length} pieces of evidence</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="space-y-4">
        {GROUPS.map(({ direction, label }) => {
          const items = shown.filter((e) => e.direction === direction);
          if (items.length === 0) return null; // hide empty groups
          return (
            <section key={direction}>
              <h4 className="mb-2 text-xs font-medium tracking-wide uppercase">{label}</h4>
              <ul className="space-y-3">
                {items.map((e, i) => (
                  <EvidenceItem key={i} evidence={e} article={articles.get(e.url)} />
                ))}
              </ul>
            </section>
          );
        })}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/**
 * Example of a PubMed line:
 *   [PubMed] PMID 41368991 · 2025 · Thyroid
 *            A review on BRAF V600E in thyroid cancer states that ...
 */
function EvidenceItem({ evidence: e, article }: { evidence: Evidence; article?: Article }) {
  return (
    <li className="flex items-start gap-2">
      <Badge variant="outline" className="shrink-0">
        {e.source}
      </Badge>
      {/* noreferrer: the source site does not learn where the click came from */}
      <a
        href={e.url}
        target="_blank"
        rel="noreferrer"
        className="max-w-prose text-foreground underline-offset-4 hover:underline"
      >
        {article && (
          <span className="block text-xs text-muted-foreground tabular-nums">
            PMID {article.pmid}
            {article.year && ` · ${article.year}`}
            {article.journal && ` · ${article.journal}`}
          </span>
        )}
        {e.claim}
      </a>
    </li>
  );
}
