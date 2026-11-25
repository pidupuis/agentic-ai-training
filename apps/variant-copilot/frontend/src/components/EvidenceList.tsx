import { Badge } from "@/components/ui/badge";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { Evidence } from "@/types";

// Display order and wording: "for" first, since it is what the classification rests on.
const GROUPS: { direction: Evidence["direction"]; label: string }[] = [
  { direction: "supports_pathogenic", label: "Supports oncogenicity" },
  { direction: "supports_benign", label: "Supports benign" },
  { direction: "neutral", label: "Context" },
];

/**
 * The evidence behind the annotation, grouped by direction.
 * Every item is a link to its source (Ensembl or PubMed), opened in a new tab:
 * the expert can check any claim in one click.
 */
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <TraceCollapsible defaultOpen>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceTitle>{evidence.length} pieces of evidence</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="space-y-4">
        {GROUPS.map(({ direction, label }) => {
          const items = evidence.filter((e) => e.direction === direction);
          if (items.length === 0) return null; // hide empty groups
          return (
            <section key={direction}>
              <h4 className="mb-2 text-xs font-medium tracking-wide uppercase">{label}</h4>
              <ul className="space-y-2">
                {items.map((e, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0">
                      {e.source}
                    </Badge>
                    {/* noreferrer: the source site does not learn where the click came from */}
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      {e.claim}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
