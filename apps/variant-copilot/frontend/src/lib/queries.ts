import { QueryClient, queryOptions } from "@tanstack/react-query";

import { getJson } from "@/lib/api";
import type { AuditResponse, SavedRun, Variant } from "@/types";

/**
 * Every backend read, as TanStack Query options: the query keys live here only.
 *
 * Keys are top-level and distinct on purpose: invalidating ["variants"] (after a review)
 * must not refetch every saved run, which a ["variants", id, "run"] key would do
 * (invalidation matches key prefixes).
 */
export const queryClient = new QueryClient({
  // One retry, not three: when the backend is down, the error shows within a second.
  defaultOptions: { queries: { retry: 1 } },
});

/** GET /api/variants: the variants, each with its latest expert decision. */
export const variantsQuery = () =>
  queryOptions({ queryKey: ["variants"], queryFn: () => getJson<Variant[]>("/api/variants") });

/**
 * GET /api/variants/{id}/run: the saved run, shown right away without any LLM call.
 * Its saved_at tells whether the latest decision is about THIS run.
 * It only changes after a new analysis, which invalidates it (AgentStreamProvider):
 * never stale until then.
 */
export const savedRunQuery = (id: string) =>
  queryOptions({
    queryKey: ["runs", id],
    queryFn: () => getJson<SavedRun>(`/api/variants/${id}/run`),
    staleTime: Infinity,
  });

/** GET /api/audit: every expert decision. Refetched each time the audit view opens. */
export const auditQuery = () =>
  queryOptions({ queryKey: ["audit"], queryFn: () => getJson<AuditResponse>("/api/audit") });
