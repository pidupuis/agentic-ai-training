import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useParams } from "@tanstack/react-router";

import { buttonVariants } from "@/components/ui/button";
import { BACKEND_DOWN } from "@/lib/api";
import { variantsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TAB = buttonVariants({ size: "sm", variant: "ghost" });
const TAB_CURRENT = "bg-fantome text-foreground hover:bg-fantome";
const TAB_OTHER = "text-muted-foreground";

/**
 * The page layout (root route), as a single column of cards: header (title, view
 * tabs), then the current route (src/router.tsx): a variant's analysis, or the audit
 * trail.
 *
 * Data flow (src/lib/queries.ts, cached and refetched by TanStack Query):
 *   GET /api/variants          -> variants, each with its latest expert decision
 *   GET /api/variants/{id}/run -> the saved run: shown right away, and its saved_at
 *                                 tells whether the latest decision is about THIS run
 *                                 (refetched after a live run, see AgentStreamProvider)
 *   POST .../review            -> then the variants and the audit trail are refetched
 */
export default function App() {
  const { isError } = useQuery(variantsQuery());
  const onAudit = useLocation({ select: (l) => l.pathname === "/audit" });
  // On the analysis view, the Analysis tab stays on the open variant; from the audit
  // trail, it opens the first one.
  const { variantId } = useParams({ strict: false });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-8">
      <header className="flex items-center justify-between rounded-xl border bg-card px-5 py-3">
        <h1 className="text-lg font-semibold">Variant Copilot</h1>
        {/* A state, not an action: the current view is a quiet fantome tab, never the
            primary (indigo) button color. */}
        <nav className="flex gap-1">
          {variantId ? (
            <Link to="/variants/$variantId" params={{ variantId }} className={cn(TAB, TAB_CURRENT)}>
              Analysis
            </Link>
          ) : (
            <Link
              to="/"
              // Exact: "/" would otherwise count as current on every page.
              activeOptions={{ exact: true }}
              className={cn(TAB, onAudit ? TAB_OTHER : TAB_CURRENT)}
            >
              Analysis
            </Link>
          )}
          <Link
            to="/audit"
            // Current whatever the filter (?variant=...).
            activeOptions={{ includeSearch: false }}
            className={cn(TAB, onAudit ? TAB_CURRENT : TAB_OTHER)}
          >
            Audit trail
          </Link>
        </nav>
      </header>

      {isError && <p className="text-sm text-destructive">{BACKEND_DOWN}</p>}

      <Outlet />
    </div>
  );
}
