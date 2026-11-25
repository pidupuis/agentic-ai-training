import { useCallback, useEffect, useState } from "react";

import { AgentTrace } from "@/components/AgentTrace";
import { AnnotationCard } from "@/components/AnnotationCard";
import { AuditLog } from "@/components/AuditLog";
import { DecisionBand, ReviewPanel } from "@/components/ReviewPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VariantList } from "@/components/VariantList";
import { BACKEND_DOWN, getJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DECISION_FORM_ID, focusDecisionForm } from "@/lib/decision";
import type { SavedRun, Variant } from "@/types";
import { IDLE_RUN, useAgentStream } from "@/useAgentStream";

type View = "analysis" | "audit";

const TAB_CURRENT = "bg-fantome text-foreground hover:bg-fantome";
const TAB_OTHER = "text-muted-foreground";

/**
 * The page, as a single column of cards: header (title, view switch), then either the
 * analysis view (one card per variant, the selected variant's analysis) or the audit
 * trail (its own variant filter chips).
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
  // Audit view filter: the variants whose decisions are shown (none = all).
  const [auditFilter, setAuditFilter] = useState<string[]>([]);
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

  // The audit trail, filtered on `ids`: none from the header tab, the current variant
  // from its decision history link.
  const openAudit = (ids: string[]) => {
    setAuditFilter(ids);
    setView("audit");
  };
  const toggleFilter = (id: string) =>
    setAuditFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // The latest decision about each variant's CURRENT run (null if none): a decision about
  // an earlier run does not apply to a re-analysis.
  const currentReviews = Object.fromEntries(
    variants.map((v) => {
      const r = v.latest_review;
      const current = r && runs[v.id]?.status === "done" && r.run_saved_at === savedAt[v.id];
      return [v.id, current ? r : null];
    }),
  );

  const selected = variants.find((v) => v.id === selectedId);
  // The selected variant's OWN run: never another variant's trace or conclusion.
  const run = (selectedId && runs[selectedId]) || IDLE_RUN;
  const canReplay = selected?.has_saved_run || run.status === "done";
  const review = selected ? currentReviews[selected.id] : null;
  const revising = selected !== undefined && revisingId === selected.id;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-8">
      <header className="flex items-center justify-between rounded-xl border bg-card px-5 py-3">
        <h1 className="text-lg font-semibold">Variant Copilot</h1>
        {/* A state, not an action: the current view is a quiet fantome tab, never the
            primary (indigo) button color. */}
        <nav className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className={cn(view === "analysis" ? TAB_CURRENT : TAB_OTHER)}
            aria-current={view === "analysis" ? "page" : undefined}
            onClick={() => setView("analysis")}
          >
            Analysis
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={cn(view === "audit" ? TAB_CURRENT : TAB_OTHER)}
            aria-current={view === "audit" ? "page" : undefined}
            onClick={() => openAudit([])}
          >
            Audit trail
          </Button>
        </nav>
      </header>

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      {view === "audit" ? (
        <main className="rounded-xl border bg-card p-5">
          <AuditLog
            variants={variants}
            variantIds={auditFilter}
            onToggle={toggleFilter}
            onShowAll={() => setAuditFilter([])}
            onOpen={(id) => {
              setSelectedId(id);
              setView("analysis");
            }}
          />
        </main>
      ) : (
        <>
          <VariantList
            variants={variants}
            selectedId={selectedId}
            runs={runs}
            reviews={currentReviews}
            onSelect={setSelectedId}
          />
          {selected ? (
            // One column. Before the expert's decision: AI proposal, then the decision form
            // (read first, then decide). After: the decision band on top (the human's
            // verdict is the conclusion), then the AI proposal that supports it. The trace
            // comes last, collapsed; it is the only thing shown while the agent runs.
            <main className="space-y-4">
              <h2 className="text-xl font-semibold">
                {selected.gene} {selected.protein}{" "}
                <span className="text-sm font-normal text-muted-foreground">{selected.hgvs_g}</span>
              </h2>
              {review && run.status === "done" && (
                <DecisionBand
                  review={review}
                  onRevise={
                    revising
                      ? undefined
                      : () => {
                          setRevisingId(selected.id);
                          // Once the form is rendered, below the proposal.
                          requestAnimationFrame(focusDecisionForm);
                        }
                  }
                  onShowHistory={() => openAudit([selected.id])}
                />
              )}
              {run.status !== "running" && (
                <AnnotationCard
                  annotation={run.status === "done" ? run.annotation : null}
                  events={run.events}
                  placeholder={
                    <p className="text-muted-foreground">
                      {run.status === "error" ? "Analysis failed." : "Not analyzed yet."}
                    </p>
                  }
                  // Primary: the expert's task (review), or Analyze if there is nothing
                  // to review yet. Secondary: Re-analyze. Tertiary: Replay.
                  actions={
                    <>
                      {/* The form is below the proposal, so that the expert reads before
                          deciding: this scrolls to it and moves the focus there. */}
                      {run.status === "done" && review === null && !revising && (
                        <Button size="sm" onClick={focusDecisionForm}>
                          Needs review <span aria-hidden="true">↓</span>
                        </Button>
                      )}
                      {/* Paid: a real agent run (a few cents), saved on success */}
                      <Button
                        size="sm"
                        variant={run.status === "done" ? "outline" : "default"}
                        onClick={() => start(selected.id)}
                      >
                        {run.status === "idle" ? "Analyze" : "Re-analyze"}
                      </Button>
                      {/* Free: streams the saved run again, no LLM call */}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => start(selected.id, { replay: true })}
                        disabled={!canReplay}
                      >
                        Replay
                      </Button>
                    </>
                  }
                />
              )}
              {run.error && <p className="text-sm text-destructive">{run.error}</p>}
              {run.annotation && run.status === "done" && (!review || revising) && (
                // tabIndex -1: focusable from the "Needs review ↓" link and from Revise.
                <Card id={DECISION_FORM_ID} tabIndex={-1} className="scroll-mt-4 outline-none">
                  <CardHeader>
                    <CardTitle>Your decision</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ReviewPanel
                      // A new key resets the form when the variant or its run changes.
                      key={`${selected.id}-${savedAt[selected.id]}`}
                      variantId={selected.id}
                      aiClassification={run.annotation.classification}
                      onReviewed={() => {
                        setRevisingId(null);
                        loadVariants();
                      }}
                      onCancel={revising ? () => setRevisingId(null) : undefined}
                    />
                  </CardContent>
                </Card>
              )}
              {run.status !== "idle" && (
                <section className="rounded-xl border bg-card px-4 py-3">
                  <AgentTrace events={run.events} status={run.status} />
                </section>
              )}
            </main>
          ) : (
            <p className="text-muted-foreground">Select a variant.</p>
          )}
        </>
      )}
    </div>
  );
}
