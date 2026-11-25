import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceList } from "@/components/EvidenceList";
import { CLASSIFICATION_STYLE } from "@/lib/classification";
import { cn } from "@/lib/utils";
import type { Annotation } from "@/types";

/** The agent's proposal: classification, confidence, summary, evidence, conflicts. */
export function AnnotationCard({ annotation }: { annotation: Annotation }) {
  const style = CLASSIFICATION_STYLE[annotation.classification];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-muted-foreground">AI proposal</span>
          <Badge className={cn("text-sm", style.className)}>{style.label}</Badge>
          <Badge variant="outline">{annotation.confidence} confidence</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {annotation.needs_expert_review && <ReviewBanner />}
        <p className="leading-relaxed">{annotation.summary}</p>
        <ConflictsBox conflicts={annotation.conflicts} />
        <EvidenceList evidence={annotation.evidence} />
      </CardContent>
    </Card>
  );
}

/** Shown when the annotation must not be used without an expert's decision. */
function ReviewBanner() {
  return (
    <div className="rounded-md border px-3 py-2 text-sm font-medium">Expert review required</div>
  );
}

/** Disagreements between sources. Orange, and hidden when there are none. */
function ConflictsBox({ conflicts }: { conflicts: string[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">
      <div className="mb-1 font-medium">Conflicting evidence</div>
      <ul className="list-disc space-y-1 pl-5">
        {conflicts.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
