import { useQueries, useQuery } from "@tanstack/react-query";
import { use } from "react";

import { savedRunQuery, variantsQuery } from "@/lib/queries";
import type { AgentEvent, Review } from "@/types";
import { AgentStreamContext, IDLE_RUN, type Run } from "@/useAgentStream";

/**
 * Everything the analysis view knows about each variant, combined from the server
 * (variants, saved runs) and the live agent streams:
 *
 *   variants  GET /api/variants, each with its latest expert decision
 *   runs      each variant's live run if there is one, else its saved run, else IDLE_RUN
 *   savedAt   saved_at of each variant's saved run
 *   reviews   the latest decision about each variant's CURRENT run, null if none: a
 *             decision about an earlier run does not apply to a re-analysis
 *   start     starts a live run (see useAgentStream)
 */
export function useVariantRuns() {
  const stream = use(AgentStreamContext);
  if (!stream) throw new Error("useVariantRuns must be used inside AgentStreamProvider");

  const { data: variants = [] } = useQuery(variantsQuery());
  // Only the variants that have one: the others would answer 404.
  const saved = useQueries({
    queries: variants.filter((v) => v.has_saved_run).map((v) => savedRunQuery(v.id)),
    combine: (results) =>
      Object.fromEntries(
        results.flatMap(({ data }) => (data ? [[data.variant_id, data] as const] : [])),
      ),
  });

  const runs: Record<string, Run> = {};
  const savedAt: Record<string, number> = {};
  const reviews: Record<string, Review | null> = {};
  for (const v of variants) {
    const s = saved[v.id];
    // A live run is always newer than the saved one (loaded at startup or refetched
    // after that same run), and only exists for a variant started in this session.
    runs[v.id] = stream.runs[v.id] ?? (s ? savedRunAsRun(s.events) : IDLE_RUN);
    if (s) savedAt[v.id] = s.saved_at;
    const r = v.latest_review;
    const current = r && runs[v.id].status === "done" && r.run_saved_at === savedAt[v.id];
    reviews[v.id] = current ? r : null;
  }

  return { variants, runs, savedAt, reviews, start: stream.start };
}

/** A saved run, shown as finished: no stream, no LLM call. */
function savedRunAsRun(events: AgentEvent[]): Run {
  // findLast + type guard: TypeScript then knows `found` is an annotation event.
  const found = events.findLast(
    (e): e is Extract<AgentEvent, { type: "annotation" }> => e.type === "annotation",
  );
  return { events, annotation: found?.annotation ?? null, status: "done", error: null };
}
