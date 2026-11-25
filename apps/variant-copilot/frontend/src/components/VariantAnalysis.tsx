import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { AgentTrace } from "@/components/AgentTrace";
import { AnnotationCard } from "@/components/AnnotationCard";
import { DecisionBand, ReviewPanel } from "@/components/ReviewPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DECISION_FORM_ID, focusDecisionForm } from "@/lib/decision";
import type { Review, Variant } from "@/types";
import type { Run, useAgentStream } from "@/useAgentStream";

/**
 * One variant's analysis, as a single column. Before the expert's decision: AI proposal,
 * then the decision form (read first, then decide). After: the decision band on top (the
 * human's verdict is the conclusion), then the AI proposal that supports it. The trace
 * comes last, collapsed; it is the only thing shown while the agent runs.
 *
 * `run` is this variant's OWN run: never another variant's trace or conclusion.
 * `review` is the latest decision about this run, null if none.
 * Mounted with key={variant.id}: opening another variant resets `revising`.
 */
export function VariantAnalysis({
  variant,
  run,
  review,
  savedAt,
  start,
}: {
  variant: Variant;
  run: Run;
  review: Review | null;
  savedAt: number | undefined;
  start: ReturnType<typeof useAgentStream>["start"];
}) {
  const navigate = useNavigate();
  // The decision form is reopened over the banner, to revise the decision.
  const [revising, setRevising] = useState(false);
  const canReplay = variant.has_saved_run || run.status === "done";

  return (
    <main className="space-y-4">
      <h2 className="text-xl font-semibold">
        {variant.gene} {variant.protein}{" "}
        <span className="text-sm font-normal text-muted-foreground">{variant.hgvs_g}</span>
      </h2>
      {review && run.status === "done" && (
        <DecisionBand
          review={review}
          onRevise={
            revising
              ? undefined
              : () => {
                  setRevising(true);
                  // Once the form is rendered, below the proposal.
                  requestAnimationFrame(focusDecisionForm);
                }
          }
          onShowHistory={() => navigate({ to: "/audit", search: { variant: variant.id } })}
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
                onClick={() => start(variant.id)}
              >
                {run.status === "idle" ? "Analyze" : "Re-analyze"}
              </Button>
              {/* Free: streams the saved run again, no LLM call */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => start(variant.id, { replay: true })}
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
              // A new key resets the form when the run changes.
              key={savedAt}
              variantId={variant.id}
              aiClassification={run.annotation.classification}
              onReviewed={() => setRevising(false)}
              onCancel={revising ? () => setRevising(false) : undefined}
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
  );
}
