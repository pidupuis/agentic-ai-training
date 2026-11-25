import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { savedRunQuery, variantsQuery } from "@/lib/queries";
import { AgentStreamContext, useAgentStream } from "@/useAgentStream";

/**
 * Holds the app's live agent runs, above the router: switching between routes (e.g.
 * to the audit trail) never unmounts it, so a running analysis keeps going.
 *
 * After a live run, the backend has saved a new run: its saved run is refetched (its
 * saved_at changed, so the previous decision no longer applies to what is shown).
 * The variants too: after a FIRST analysis, has_saved_run turns true, and only then
 * does useVariantRuns query that variant's saved run.
 */
export function AgentStreamProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const stream = useAgentStream({
    onDone: (id) => {
      queryClient.invalidateQueries({ queryKey: savedRunQuery(id).queryKey });
      queryClient.invalidateQueries({ queryKey: variantsQuery().queryKey });
    },
  });
  return <AgentStreamContext value={stream}>{children}</AgentStreamContext>;
}
