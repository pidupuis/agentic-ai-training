import { useEffect, useState } from "react";

import { AgentTrace } from "@/components/AgentTrace";
import { Button } from "@/components/ui/button";
import { VariantList } from "@/components/VariantList";
import { AnnotationCard } from "@/components/AnnotationCard";
import type { Variant } from "@/types";
import { IDLE_RUN, useAgentStream } from "@/useAgentStream";

/**
 * Two-column page: the variant list on the left, the selected variant's analysis
 * on the right (live trace, then the annotation).
 */
export default function App() {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { runs, start } = useAgentStream();

  // Load the variant list once, on mount ([] = no dependencies).
  useEffect(() => {
    fetch("/api/variants")
      .then((r) => r.json())
      .then(setVariants);
  }, []);

  const selected = variants.find((v) => v.id === selectedId);
  // The selected variant's OWN run: never another variant's trace or conclusion.
  const run = (selectedId && runs[selectedId]) || IDLE_RUN;

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[16rem_1fr] gap-8 p-8">
      <aside>
        <h1 className="mb-4 text-lg font-semibold">Variant Copilot</h1>
        <VariantList
          variants={variants}
          selectedId={selectedId}
          runs={runs}
          onSelect={setSelectedId}
        />
      </aside>
      <main className="min-w-0 space-y-6">
        {selected ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {selected.gene} {selected.protein}
              </h2>
              <Button onClick={() => start(selected.id)} disabled={run.status === "running"}>
                {run.status === "idle" ? "Analyze" : "Re-analyze"}
              </Button>
            </div>
            <AgentTrace events={run.events} status={run.status} />
            {run.error && <p className="text-sm text-destructive">{run.error}</p>}
            {run.annotation && <AnnotationCard annotation={run.annotation} />}
          </>
        ) : (
          <p className="text-muted-foreground">Select a variant.</p>
        )}
      </main>
    </div>
  );
}
