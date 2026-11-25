import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import App from "@/App";
import { AuditPage } from "@/pages/AuditPage";
import { FirstVariant } from "@/pages/FirstVariant";
import { VariantPage } from "@/pages/VariantPage";

/**
 * The routes, declared in code (three routes: no file-based routing plugin needed).
 *
 *   /                        -> redirects to the first variant
 *   /variants/{id}           -> that variant's analysis
 *   /audit?variant=a,b       -> the audit trail, filtered on variants a and b (none = all)
 *
 * The URL is the navigation state: Back works, links can be shared, and a reload keeps
 * the page where it was.
 */
const rootRoute = createRootRoute({
  component: App,
  notFoundComponent: () => <p className="text-muted-foreground">Page not found.</p>,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FirstVariant,
});

const variantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/variants/$variantId",
  component: VariantPage,
});

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit",
  // A comma-separated string, not an array: an array would be JSON in the URL.
  validateSearch: (search: Record<string, unknown>): { variant?: string } =>
    search.variant ? { variant: String(search.variant) } : {},
  component: AuditPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, variantRoute, auditRoute]),
});

// Type-safe links and params everywhere: <Link to="/variants/$variantId"> is checked.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
