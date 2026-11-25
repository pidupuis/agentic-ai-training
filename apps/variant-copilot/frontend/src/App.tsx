import { useEffect, useState } from "react";

import { AgentTrace } from "@/components/AgentTrace";
import { Button } from "@/components/ui/button";
import { VariantList } from "@/components/VariantList";
import { AnnotationCard } from "@/components/AnnotationCard";
import type { SavedRun, Variant } from "@/types";
import { IDLE_RUN, useAgentStream } from "@/useAgentStream";

/**
 * Two-column page: the variant list on the left, the selected variant's analysis
 * on the right (live trace, then the annotation).
 */
export default function App() {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { runs, start, load } = useAgentStream();

  // On mount ([] = no dependencies): load the variant list, then the saved run of each
  // variant that has one. Saved runs are shown as finished right away: no LLM call.
  useEffect(() => {
    fetch("/api/variants")
      .then((r) => r.json())
      .then((list: Variant[]) => {
        setVariants(list);
        for (const v of list.filter((v) => v.has_saved_run)) {
          fetch(`/api/variants/${v.id}/run`)
            .then((r) => r.json())
            .then((saved: SavedRun) => load(v.id, saved.events));
        }
      });
  }, [load]);

  const selected = variants.find((v) => v.id === selectedId);
  // The selected variant's OWN run: never another variant's trace or conclusion.
  const run = (selectedId && runs[selectedId]) || IDLE_RUN;
  // A saved run exists if the backend said so at load time, or if a live run just
  // finished (the backend saves every successful run).
  const canReplay = selected?.has_saved_run || run.status === "done";

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
              <div className="flex gap-2">
                {/* Free: streams the saved run again, no LLM call */}
                <Button
                  variant="outline"
                  onClick={() => start(selected.id, { replay: true })}
                  disabled={!canReplay || run.status === "running"}
                >
                  Replay
                </Button>
                {/* Paid: a real agent run (a few cents), saved on success */}
                <Button onClick={() => start(selected.id)} disabled={run.status === "running"}>
                  {run.status === "idle" ? "Analyze" : "Re-analyze"}
                </Button>
              </div>
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
