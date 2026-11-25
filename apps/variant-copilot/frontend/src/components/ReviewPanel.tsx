import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLASSIFICATION_STYLE, CLASSIFICATIONS } from "@/lib/classification";
import { cn } from "@/lib/utils";
import type { Classification, Decision, Review, ReviewRequest } from "@/types";

// The reviewer's name is remembered in the browser, so it is typed only once.
const REVIEWER_KEY = "variant-copilot.reviewer";

/**
 * The expert's decision on the AI proposal: accept, correct or reject.
 *
 * "Correct" asks for the expert's own classification; "Correct" and "Reject" require a
 * comment (an expert must justify a disagreement). The same rules are enforced by the
 * backend (ReviewRequest in models.py): this form only gives earlier feedback.
 */
export function ReviewPanel({
  variantId,
  aiClassification,
  onReviewed,
}: {
  variantId: string;
  aiClassification: Classification;
  onReviewed: (review: Review) => void;
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
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-medium">Expert review</h3>

      <div className="flex gap-2">
        {choices.map((c) => (
          <Button
            key={c.value}
            variant={decision === c.value ? "default" : "outline"}
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
              {sending ? "Saving…" : "Sign off"}
            </Button>
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

/**
 * Shown instead of the review panel once the current proposal has been reviewed:
 * "Accepted by PD on 25/11 at 14:40", with the final class when it differs.
 */
export function ValidatedBanner({ review }: { review: Review }) {
  // created_at is UTC; toLocaleDateString/TimeString show it in the browser's time zone.
  const date = new Date(review.created_at);
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const verb = { accepted: "Accepted", modified: "Corrected", rejected: "Rejected" }[
    review.decision
  ];
  const final = review.final_classification;

  return (
    <section
      className={cn(
        "space-y-1 rounded-xl border px-4 py-3 text-sm",
        review.decision === "rejected" && "border-destructive/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">
          {verb} by {review.reviewer} on {day} at {time}
        </span>
        {final && review.decision === "modified" && (
          <Badge className={CLASSIFICATION_STYLE[final].className}>
            {CLASSIFICATION_STYLE[final].label}
          </Badge>
        )}
      </div>
      {review.comment && <p className="text-muted-foreground">“{review.comment}”</p>}
    </section>
  );
}
