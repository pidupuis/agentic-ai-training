import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLASSIFICATION_STYLE, CLASSIFICATIONS } from "@/lib/classification";
import { DECISION_STYLE } from "@/lib/decision";
import { formatDateTime, utcTooltip } from "@/lib/dates";
import type { Classification, Decision, Review, ReviewRequest } from "@/types";

// The reviewer's name is remembered in the browser, so it is typed only once.
const REVIEWER_KEY = "variant-copilot.reviewer";

/**
 * The expert's decision on the AI proposal: accept, correct or reject.
 *
 * "Correct" asks for the expert's own classification; "Correct" and "Reject" require a
 * comment (an expert must justify a disagreement). The same rules are enforced by the
 * backend (ReviewRequest in models.py): this form only gives earlier feedback.
 *
 * Also used to revise a decision: the new decision is appended to the audit trail,
 * the previous one stays in the history (decisions are never edited or deleted).
 * `onCancel` adds a Cancel button, for that case.
 */
export function ReviewPanel({
  variantId,
  aiClassification,
  onReviewed,
  onCancel,
}: {
  variantId: string;
  aiClassification: Classification;
  onReviewed: (review: Review) => void;
  onCancel?: () => void;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [finalClass, setFinalClass] = useState<Classification>(aiClassification);
  const [comment, setComment] = useState("");
  const [reviewer, setReviewer] = useState(() => localStorage.getItem(REVIEWER_KEY) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const needsComment = decision === "modified" || decision === "rejected";
  const canSubmit =
    decision !== null &&
    reviewer.trim() !== "" &&
    (!needsComment || comment.trim() !== "") &&
    (decision !== "modified" || finalClass !== aiClassification) &&
    !sending;

  async function submit() {
    if (!decision) return;
    setSending(true);
    setError(null);
    localStorage.setItem(REVIEWER_KEY, reviewer.trim());
    const body: ReviewRequest = {
      decision,
      comment: comment.trim(),
      reviewer: reviewer.trim(),
      ...(decision === "modified" && { final_classification: finalClass }),
    };
    try {
      const response = await fetch(`/api/variants/${variantId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // FastAPI errors: {"detail": "..."} (404, 409) or {"detail": [{msg}, ...]} (422).
        const { detail } = await response.json();
        throw new Error(
          Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : String(detail),
        );
      }
      onReviewed((await response.json()) as Review);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const choices: { value: Decision; label: string }[] = [
    { value: "accepted", label: "Accept" },
    { value: "modified", label: "Correct" },
    { value: "rejected", label: "Reject" },
  ];

  return (
    // No border or title: shown inside the "Expert decision" card (App.tsx).
    <div className="space-y-3">
      <div className="flex gap-2">
        {choices.map((c) => (
          <Button
            key={c.value}
            variant={decision === c.value ? "default" : "outline"}
            aria-pressed={decision === c.value}
            onClick={() => setDecision(c.value)}
          >
            {c.label}
          </Button>
        ))}
      </div>

      {decision === "modified" && (
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Your classification</span>
          <select
            value={finalClass}
            onChange={(e) => setFinalClass(e.target.value as Classification)}
            className="rounded-md border bg-background px-2 py-1"
          >
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c} disabled={c === aiClassification}>
                {CLASSIFICATION_STYLE[c].label}
                {c === aiClassification ? " (AI proposal)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {decision !== null && (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">
              Comment {needsComment ? "(required)" : "(optional)"}
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-2 py-1"
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Reviewer</span>
              <input
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="Name or initials"
                className="rounded-md border bg-background px-2 py-1"
              />
            </label>
            <Button onClick={submit} disabled={!canSubmit}>
              {sending ? "Saving…" : "Submit decision"}
            </Button>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/**
 * The expert's verdict, in a compact band ABOVE the AI proposal card and outside it: once
 * decided, the human's conclusion comes first and the AI's proposal becomes the file that
 * supports it (like a signed clinical report: conclusion on top, reasoning below).
 *
 * One line, the comment (if any) on a second one:
 *   Final: [Oncogenic] · ✓ Accepted by PD · 25/11/2026 16:09          Revise  History
 *   Final: [Insufficient evidence] · ✎ Corrected from Oncogenic by PD · ...
 *   ✕ Rejected by PD · 25/11/2026 16:09 · no final classification
 *
 * "Revise" (hidden while revising) reopens the form: revising appends a new decision, it
 * never edits or deletes this one. "History" opens the audit trail filtered on this
 * variant, where earlier decisions remain visible.
 */
export function DecisionBand({
  review,
  onRevise,
  onShowHistory,
}: {
  review: Review;
  onRevise?: () => void;
  onShowHistory: () => void;
}) {
  const final = review.final_classification;
  const ai = CLASSIFICATION_STYLE[review.ai_classification];
  const { label, Icon } = DECISION_STYLE[review.decision];

  return (
    <section aria-label="Expert decision" className="rounded-xl border px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {final ? (
          <>
            <span className="font-medium">Final:</span>
            <Badge className={CLASSIFICATION_STYLE[final].className}>
              {CLASSIFICATION_STYLE[final].label}
            </Badge>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Icon aria-hidden="true" className="size-3.5" />
          {label}
          {review.decision === "modified" && ` from ${ai.label}`}
        </span>
        <span className="text-muted-foreground">
          by {review.reviewer} ·{" "}
          <time dateTime={review.created_at} title={utcTooltip(review.created_at)}>
            {formatDateTime(review.created_at)}
          </time>
          {!final && " · no final classification"}
        </span>
        <span className="ml-auto flex gap-1">
          {/* Secondary: Revise. Tertiary: History. */}
          {onRevise && (
            <Button size="sm" variant="outline" onClick={onRevise}>
              Revise
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onShowHistory}>
            History
          </Button>
        </span>
      </div>
      {review.comment && <p className="text-muted-foreground">“{review.comment}”</p>}
    </section>
  );
}
