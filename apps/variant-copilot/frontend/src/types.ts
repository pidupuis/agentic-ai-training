/**
 * Types shared with the backend. Keep in sync with:
 *   backend/app/models.py      (Annotation, Evidence)
 *   backend/app/agent.py       (tool_call, tool_result, annotation events)
 *   backend/app/main.py        (done, error events, has_saved_run)
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
