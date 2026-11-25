import { useCallback, useEffect, useState } from "react";

import { AgentTrace } from "@/components/AgentTrace";
import { AnnotationCard } from "@/components/AnnotationCard";
import { AuditLog } from "@/components/AuditLog";
import { ReviewPanel, ValidatedBanner } from "@/components/ReviewPanel";
import { Button } from "@/components/ui/button";
import { VariantList } from "@/components/VariantList";
import { BACKEND_DOWN, getJson } from "@/lib/api";
import type { SavedRun, Variant } from "@/types";
import { IDLE_RUN, useAgentStream } from "@/useAgentStream";

type View = "analysis" | "audit";

/**
 * The page: the variant list on the left; on the right either the selected variant's
 * analysis (live trace, annotation card, expert review) or the audit trail.
 *
 * Data flow:
 *   GET /api/variants          -> variants, each with its latest expert decision
 *   GET /api/variants/{id}/run -> the saved run: shown right away, and its saved_at
 *                                 tells whether the latest decision is about THIS run
 *   POST .../review            -> then reload the variants to get the new decision
 */
export default function App() {
  const [view, setView] = useState<View>("analysis");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // saved_at of each variant's saved run, to match decisions with the run they reviewed.
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  // Variant whose decision is being revised (form reopened over the banner), if any.
  const [revisingId, setRevisingId] = useState<string | null>(null);
  // Set when the variant list cannot be loaded: shown instead of an empty list.
  const [loadError, setLoadError] = useState<string | null>(null);

  // After a live run, the backend has saved a new run: reload it (its saved_at changed,
  // so the previous decision no longer applies to what is shown).
  const { runs, start, load } = useAgentStream({ onDone: (id) => loadSavedRun(id) });

  const loadVariants = useCallback(async () => {
    try {
      setVariants(await getJson<Variant[]>("/api/variants"));
      setLoadError(null);
    } catch {
      setLoadError(BACKEND_DOWN);
    }
  }, []);

  const loadSavedRun = useCallback(
    async (id: string) => {
      try {
        const saved = await getJson<SavedRun>(`/api/variants/${id}/run`);
        setSavedAt((prev) => ({ ...prev, [id]: saved.saved_at }));
        load(id, saved.events); // shown as finished: no LLM call
      } catch {
        // 404 (never analyzed) or backend down: the variant simply shows no saved run.
      }
    },
    [load],
  );

  // On mount: the variant list, then the saved run of each variant that has one.
  // setState is called in .then(), once the response arrives, never synchronously in
  // the effect body (React's set-state-in-effect rule).
  useEffect(() => {
    getJson<Variant[]>("/api/variants")
      .then((list) => {
        setVariants(list);
        list.filter((v) => v.has_saved_run).forEach((v) => loadSavedRun(v.id));
      })
      .catch(() => setLoadError(BACKEND_DOWN));
  }, [loadSavedRun]);

  const selected = variants.find((v) => v.id === selectedId);
  // The selected variant's OWN run: never another variant's trace or conclusion.
  const run = (selectedId && runs[selectedId]) || IDLE_RUN;
  const canReplay = selected?.has_saved_run || run.status === "done";

  // The latest decision counts only if it was about the run on screen.
  const review = selected?.latest_review ?? null;
  const reviewed =
    review !== null &&
    run.status === "done" &&
    selected !== undefined &&
    review.run_saved_at === savedAt[selected.id];

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[16rem_1fr] gap-8 p-8">
      <aside className="space-y-4">
        <h1 className="text-lg font-semibold">Variant Copilot</h1>
        <nav className="flex gap-1">
          <Button
            size="sm"
            variant={view === "analysis" ? "default" : "ghost"}
            onClick={() => setView("analysis")}
          >
            Analysis
          </Button>
          <Button
            size="sm"
            variant={view === "audit" ? "default" : "ghost"}
            onClick={() => setView("audit")}
          >
            Audit trail
          </Button>
        </nav>
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        <VariantList
          variants={variants}
          selectedId={selectedId}
          runs={runs}
          // In the analysis view a click opens the variant; in the audit view it filters
          // the trail to that variant (the view stays the same).
          onSelect={setSelectedId}
        />
      </aside>

      <main className="min-w-0 space-y-6">
        {view === "audit" ? (
          <AuditLog
            variants={variants}
            variantId={selectedId}
            onShowAll={() => setSelectedId(null)}
          />
        ) : selected ? (
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
            {run.annotation && run.status === "done" && (
              <>
                <AnnotationCard annotation={run.annotation} />
                {reviewed && review && revisingId !== selected.id ? (
                  <ValidatedBanner review={review} onRevise={() => setRevisingId(selected.id)} />
                ) : (
                  <ReviewPanel
                    // A new key resets the form when the variant or its run changes.
                    key={`${selected.id}-${savedAt[selected.id]}`}
                    variantId={selected.id}
                    aiClassification={run.annotation.classification}
                    onReviewed={() => {
                      setRevisingId(null);
                      loadVariants();
                    }}
                    onCancel={revisingId === selected.id ? () => setRevisingId(null) : undefined}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Select a variant.</p>
        )}
      </main>
    </div>
  );
}
