import type { AgentEvent, ToolCallEvent, ToolResultEvent } from "@/types";

/** One tool call and, once it has arrived, its result. */
export type Step = { call: ToolCallEvent; result?: ToolResultEvent };

/**
 * Pair each tool_result with its tool_call.
 *
 * The backend always emits a tool_result right after its tool_call, so a result
 * belongs to the last call that has none yet. Other event types are ignored.
 *
 * Example:
 *   [call(vep), result(vep), call(pubmed)]  ->  [{vep, result}, {pubmed, no result yet}]
 */
export function toSteps(events: AgentEvent[]): Step[] {
  const steps: Step[] = [];
  for (const e of events) {
    if (e.type === "tool_call") steps.push({ call: e });
    if (e.type === "tool_result") {
      const open = steps.findLast((s) => !s.result);
      if (open) open.result = e;
    }
  }
  return steps;
}

/**
 * A line a biologist can read, never the Python function name.
 *
 * Examples:
 *   Ensembl VEP · 7:g.140753336A>T
 *   PubMed · "BRAF"[tiab] AND "V600E"[tiab] → 9001 articles
 *   Annotation submitted          (or: Annotation rejected, when the check failed)
 */
export function label({ call, result }: Step): string {
  const r = result?.result;
  // args is the raw string when the model sent invalid JSON: show nothing for it.
  const args = typeof call.args === "string" ? {} : call.args;
  switch (call.tool) {
    case "get_vep_annotation":
      return `Ensembl VEP · ${args.hgvs_g ?? "invalid arguments"}`;
    case "search_pubmed": {
      const count = r?.data?.total_count;
      return `PubMed · ${args.query ?? "invalid arguments"}${count !== undefined ? ` → ${count} articles` : ""}`;
    }
    case "submit_annotation":
      return r?.error ? "Annotation rejected, retrying" : "Annotation submitted";
    default:
      return call.tool;
  }
}
