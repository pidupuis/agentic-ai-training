/**
 * Types shared with the backend. Keep in sync with:
 *   backend/app/models.py      (Annotation, Evidence)
 *   backend/app/agent.py       (tool_call, tool_result, annotation events)
 *   backend/app/main.py        (done, error events, has_saved_run, latest_review, audit)
 *   backend/app/models.py      (ReviewRequest, Review)
 *   backend/app/runs.py        (SavedRun)
 */

export type Variant = {
  id: string;
  gene: string;
  protein: string; // HGVS protein notation, e.g. "p.Val600Glu"
  protein_short: string; // e.g. "V600E"
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  hgvs_g: string; // e.g. "7:g.140753336A>T"
  has_saved_run: boolean; // true if GET /api/variants/{id}/run has a saved analysis
  latest_review: Review | null; // the last expert decision, whatever run it was about
};

export type Classification =
  | "oncogenic"
  | "likely_oncogenic"
  | "vus"
  | "likely_benign"
  | "benign"
  | "insufficient_evidence";

export type Evidence = {
  source: "Ensembl VEP" | "PubMed";
  claim: string;
  url: string;
  direction: "supports_pathogenic" | "supports_benign" | "neutral";
};

export type Annotation = {
  classification: Classification;
  confidence: "low" | "medium" | "high";
  summary: string;
  evidence: Evidence[];
  conflicts: string[];
  needs_expert_review: boolean;
};

/** The common tool contract: either data or an error, never both. */
export type ToolResult =
  | { source: string; url: string; data: Record<string, unknown>; error?: never }
  | { source: string; error: string; url?: never; data?: never };

// One type per event, discriminated by `type`. `ts` is a Unix timestamp in seconds.
export type ToolCallEvent = {
  type: "tool_call";
  tool: string;
  args: Record<string, unknown>;
  ts: number;
};
export type ToolResultEvent = { type: "tool_result"; tool: string; result: ToolResult; ts: number };
export type AnnotationEvent = { type: "annotation"; annotation: Annotation; ts: number };
export type DoneEvent = { type: "done"; ts: number };
export type ErrorEvent = { type: "error"; message: string; ts: number };

export type AgentEvent = ToolCallEvent | ToolResultEvent | AnnotationEvent | DoneEvent | ErrorEvent;

/** A saved analysis, as returned by GET /api/variants/{id}/run. */
export type SavedRun = {
  variant_id: string;
  model: string; // the LLM that produced it
  saved_at: number; // Unix timestamp, seconds
  events: AgentEvent[]; // the whole run, ending with the annotation event
};

export type Decision = "accepted" | "modified" | "rejected";

/** Body of POST /api/variants/{id}/review: the expert's decision only. */
export type ReviewRequest = {
  decision: Decision;
  final_classification?: Classification; // required when modified
  comment: string; // required when modified or rejected
  reviewer: string;
};

/** One line of the audit trail, as stored by the backend. */
export type Review = {
  id: string;
  variant_id: string;
  decision: Decision;
  ai_classification: Classification;
  final_classification: Classification | null; // null when rejected
  comment: string;
  reviewer: string;
  model: string;
  run_saved_at: number; // saved_at of the run that was reviewed
  created_at: string; // ISO 8601, UTC, e.g. "2026-11-25T14:40:00.123456Z"
  annotation: Annotation;
};

/** GET /api/audit */
export type AuditResponse = {
  agreement: { agreed: number; total: number; rate: number | null };
  reviews: Review[]; // newest first
};
